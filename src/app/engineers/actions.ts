"use server";

import { revalidatePath } from "next/cache";
import { engerAdmin, publicAdmin, authAdmin } from "@/lib/supabase";
import { currentAccess } from "@/lib/accounts";
import { normalizeSkills } from "@/lib/skills";
import { classifySource, listEngineers, freelanceShortId, type SkillSheet } from "@/lib/engineers";
import { ageToBand, formatRateRange, normalizeRemote, normalizeNationality, extractFreelanceFields, extractSkillCard } from "@/lib/freelance-to-candidate";
import { notifySlack, appUrl } from "@/lib/slack";

type Result = { ok: boolean; error?: string };

/** スカウトを起点に、その人材とのチャットスレッドを開く（enger-lp の staff API を必ずサーバ経由で呼ぶ）。
 *  ・POST {ENGER_LP_BASE_URL}/api/staff/chat/open-thread（Bearer STAFF_API_TOKEN）。
 *  ・既存スレッドがあれば API が既存を返す（created=false・タイトル据え置き）。DX 側は新規作成せず、
 *    返ってきた thread_id のチャット（/chat?t=...）へ遷移するだけ。トークンはクライアントへ露出しない。 */
export async function openScoutChatThread(scoutId: string): Promise<{ ok: boolean; thread_id?: string; title?: string | null; created?: boolean; error?: string }> {
  const id = (scoutId ?? "").trim();
  if (!id) return { ok: false, error: "scout_id がありません" };
  const base = (process.env.ENGER_LP_BASE_URL ?? "").replace(/\/$/, "");
  const token = process.env.STAFF_API_TOKEN ?? "";
  if (!base || !token) return { ok: false, error: "連携設定が未完了です（ENGER_LP_BASE_URL / STAFF_API_TOKEN を設定してください）" };
  // 操作スタッフの auth.users.id（任意）。取得できなければ null。
  let staffUserId: string | null = null;
  try { staffUserId = ((await currentAccess()) as any)?.userId ?? null; } catch { /* 任意のためなくてもよい */ }
  try {
    const res = await fetch(`${base}/api/staff/chat/open-thread`, {
      method: "POST",
      headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
      body: JSON.stringify({ scout_id: id, staff_user_id: staffUserId }),
      cache: "no-store",
    });
    const data = await res.json().catch(() => ({} as any));
    if (!res.ok || !data?.ok) return { ok: false, error: data?.error || `open-thread failed (${res.status})` };
    revalidatePath("/chat");
    return { ok: true, thread_id: data.thread_id, title: data.title ?? null, created: !!data.created };
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : "連携に失敗しました" };
  }
}

/** スカウトに紐づくチャットスレッドを開く（DB優先・③対応）。
 *  ・まず chat_threads.scout_id で既存スレッドを探し、あればその thread_id を返す
 *    （= 既にやり取りがある場合は該当スレッドへ遷移）。
 *  ・無ければスカウト情報から新規スレッドを作成し、スカウトのタイトル（案件名）を
 *    スレッド名(subject)にする。スカウト本文も初回メッセージとして残す。
 *  ・外部(enger-lp)staff API には依存しない（未設定/失敗でも DX 内で完結する）。
 *    DB に該当スカウトが無い特殊ケースのみ、最後に従来の staff API を試す。 */
export async function openScoutThread(scoutId: string): Promise<{ ok: boolean; thread_id?: string; error?: string }> {
  const id = (scoutId ?? "").trim();
  if (!id) return { ok: false, error: "scout_id がありません" };
  let admin: ReturnType<typeof engerAdmin>;
  try { admin = engerAdmin(); } catch { return { ok: false, error: "SUPABASE_SERVICE_ROLE_KEY 未設定" }; }

  // 1) 既存スレッド（scout_id 紐付け）を最優先で返す。
  try {
    const ex: any = await admin.from("chat_threads").select("id").eq("scout_id", id).maybeSingle();
    if (ex.data?.id) { revalidatePath("/chat"); return { ok: true, thread_id: ex.data.id }; }
  } catch { /* スレッド未整備でも続行（作成にトライ） */ }

  // 2) スカウト情報から新規スレッドを作成（スカウトのタイトル＝案件名をスレッド名に）。
  const sc: any = await admin.from("scouts")
    .select("id, engineer_id, engineer_name, agent, job_no, job_id, job_title, message")
    .eq("id", id).maybeSingle();
  if (sc.error || !sc.data) {
    // DB に無い（LP 由来など）→ 従来の staff API にフォールバック。
    return openScoutChatThread(id);
  }
  const s = sc.data;
  const subject = (s.job_title?.trim())
    || (s.message ? String(s.message).split(/\r?\n/)[0].trim().slice(0, 40) : "")
    || "スカウト";
  const jobNoInt = s.job_no && /^\d+$/.test(String(s.job_no)) && Number(s.job_no) <= 2147483647 ? Number(s.job_no) : null;
  const threadBase: Record<string, any> = {
    scout_id: s.id, engineer_id: s.engineer_id, engineer_name: s.engineer_name, agent: s.agent,
    job_no: jobNoInt, job_title: s.job_title ?? null, subject,
  };
  let th: any = await admin.from("chat_threads").insert({ ...threadBase, job_id: s.job_id ?? null }).select("id").maybeSingle();
  if (th.error && /job_id|column/i.test(th.error.message ?? "")) {
    th = await admin.from("chat_threads").insert(threadBase).select("id").maybeSingle();
  }
  if (th.error || !th.data?.id) {
    // NOT NULL 列等で作成できない環境向けに staff API フォールバック。
    return openScoutChatThread(id);
  }
  // スカウト本文を初回メッセージとして残す（best-effort）。
  if (s.message) {
    const msgBase = { thread_id: th.data.id, sender_role: "agent", sender_id: s.agent, sender_name: s.agent, body: s.message };
    let mr: any = await admin.from("chat_messages").insert({ ...msgBase, sender_kind: "agent" });
    if (mr.error && /sender_kind|column .* does not exist/i.test(mr.error.message ?? "")) {
      await admin.from("chat_messages").insert(msgBase);
    }
  }
  // 対応履歴のスカウト送信行に thread_id を補完しておく（次回からは即遷移）。
  try { await admin.from("engineer_actions").update({ thread_id: th.data.id }).eq("engineer_id", s.engineer_id).eq("action", "スカウト送信").is("thread_id", null); } catch { /* thread_id 列が無い環境は無視 */ }
  revalidatePath("/chat");
  return { ok: true, thread_id: th.data.id };
}

/** エンジニアへの対応を1件記録（誰が・いつ・何をしたか）。 */
export async function addEngineerAction(input: { engineer_id: string; engineer_name?: string | null; action: string; note?: string | null }): Promise<Result> {
  let admin: ReturnType<typeof engerAdmin>;
  try { admin = engerAdmin(); } catch { return { ok: false, error: "SUPABASE_SERVICE_ROLE_KEY 未設定" }; }
  if (!input.engineer_id) return { ok: false, error: "対象エンジニアが未指定です" };
  if (!input.action?.trim()) return { ok: false, error: "対応内容が未選択です" };

  const access = await currentAccess();
  const operator = access?.name || access?.email || null;

  const { error } = await admin.from("engineer_actions").insert({
    engineer_id: input.engineer_id,
    engineer_name: input.engineer_name?.trim() || null,
    action: input.action.trim(),
    note: input.note?.trim() || null,
    operator,
  });
  if (error) return { ok: false, error: error.message };
  revalidatePath("/engineers");
  return { ok: true };
}

/** 案件ID(job_no)から実在案件を解決し、その jobs.id(UUID) を返す。
 *  ・フリーランス側のお気に入り(enger.job_favorites)は job_id(= jobs.id) が必須。
 *    スカウトに正しい job_id を紐づけることが、お気に入り登録→お気に入り案件一覧まで
 *    通すための必須条件（LP側はこの job_id を起点に案件を解決・候補注入する）。
 *  ・job_no は表記ゆれ（"No.1554" / "#1554" / ゼロ埋め）があり得るため、
 *    数字だけを抽出して enger.jobs.job_no(int) と突き合わせる。
 *  ・削除済み(deleted_at)は対象外。公開状態(is_published)は問わない（未公開でも紐づける）。 */
function digitsOf(jobNo: string | null | undefined): number | null {
  const d = String(jobNo ?? "").replace(/\D/g, "");
  if (!d) return null;
  const n = Number(d);
  return Number.isSafeInteger(n) ? n : null;
}

async function resolveJobByNo(admin: ReturnType<typeof engerAdmin>, jobNo: string): Promise<{ id: string; job_no: string; title: string | null; published: boolean } | null> {
  const n = digitsOf(jobNo);
  if (n == null) return null;
  try {
    // 削除済みを除外して引く。deleted_at 列が無い環境ではフィルタを外して再取得。
    let r: any = await admin.from("jobs").select("id, job_no, title, is_published").eq("job_no", n).is("deleted_at", null).maybeSingle();
    if (r.error && /deleted_at|column/i.test(r.error.message ?? "")) {
      r = await admin.from("jobs").select("id, job_no, title, is_published").eq("job_no", n).maybeSingle();
    }
    if (r.error || !r.data) return null;
    return { id: String(r.data.id), job_no: r.data.job_no != null ? String(r.data.job_no) : String(n), title: r.data.title ?? null, published: r.data.is_published === true };
  } catch { return null; }
}

/** 案件ID(= enger.jobs.job_no)から案件タイトルを取得（スカウトの「対象案件名」自動入力用）。
 *  公開・未公開どちらの案件も対象。解決できれば jobs.id(UUID) も返す（お気に入り/応募画面の紐づけ用）。 */
export async function lookupJobByNo(jobNo: string): Promise<{ ok: boolean; id?: string; job_no?: string; title?: string | null; published?: boolean; error?: string }> {
  const access = await currentAccess();
  if (!access) return { ok: false, error: "未認証です" };
  if (digitsOf(jobNo) == null) return { ok: false, error: "案件IDは数字で入力してください" };
  let admin: ReturnType<typeof engerAdmin>;
  try { admin = engerAdmin(); } catch { return { ok: false, error: "SUPABASE_SERVICE_ROLE_KEY 未設定" }; }
  const job = await resolveJobByNo(admin, jobNo);
  if (!job) return { ok: false, error: "該当案件が見つかりません（案件マスタに未登録の可能性）" };
  return { ok: true, id: job.id, job_no: job.job_no, title: job.title, published: job.published };
}

/** エンジニアへスカウトを送る。対応履歴にも「スカウト送信」を自動記録。
 *  案件ID(job_no)とそれが指す案件(jobs.id)を一緒に保存し、フリーランス側の「応募画面へ」「お気に入り登録」に紐づける。 */
export async function sendScout(input: { engineer_id: string; engineer_name?: string | null; job_title?: string | null; job_no?: string | null; message: string }): Promise<Result> {
  let admin: ReturnType<typeof engerAdmin>;
  try { admin = engerAdmin(); } catch { return { ok: false, error: "SUPABASE_SERVICE_ROLE_KEY 未設定" }; }
  if (!input.engineer_id) return { ok: false, error: "対象エンジニアが未指定です" };
  if (!input.message?.trim()) return { ok: false, error: "スカウト本文が空です" };

  const access = await currentAccess();
  const agent = access?.name || access?.email || null;
  const engineer_name = input.engineer_name?.trim() || null;
  const job_title = input.job_title?.trim() || null;
  // 案件参照はサーバ側で確定する（クライアントの解決結果は信用しない＝デバウンス競合での誤紐づけ防止）。
  //   ・案件ID(job_no)から実在案件を解決し、その jobs.id を job_id として必ず保存する。
  //     この job_id がフリーランス側のお気に入り(job_favorites.job_id)／応募の紐づけに使われる。
  //   ・job_no は表記ゆれを許容して数字で突き合わせる（resolveJobByNo）。公開状態は問わない。
  //   ・解決できない（案件マスタに該当なし）場合は job_no(入力値)のみ保持し、job_id は null（誤紐づけ防止）。
  const typedJobNo = input.job_no?.trim() || null;
  let job_id: string | null = null;
  let job_no: string | null = typedJobNo;
  if (typedJobNo) {
    const resolved = await resolveJobByNo(admin, typedJobNo);
    if (resolved) { job_id = resolved.id; job_no = resolved.job_no; }
  }
  // chat_threads.job_no は integer。int 範囲(<=2147483647)のときだけ数値化（範囲外は null にして thread 生成を妨げない）。
  const jobNoInt = job_no && /^\d+$/.test(job_no) && Number(job_no) <= 2147483647 ? Number(job_no) : null;

  const scoutBody = input.message.trim();
  // 案件参照列(job_id/job_no)を含めて insert。未マイグレ環境（列なし）でもスカウト自体は成功させる。
  const scoutBase: Record<string, any> = { engineer_id: input.engineer_id, engineer_name, agent, job_title, message: scoutBody, status: "sent" };
  let scoutIns: any = await admin.from("scouts").insert({ ...scoutBase, job_id, job_no }).select("id").maybeSingle();
  if (scoutIns.error && /job_id|job_no|column/i.test(scoutIns.error.message ?? "")) {
    scoutIns = await admin.from("scouts").insert(scoutBase).select("id").maybeSingle();
  }
  if (scoutIns.error) return { ok: false, error: scoutIns.error.message };
  const scoutRow = scoutIns.data;

  // スカウトを起点にチャットスレッドを生成し、スカウト本文を初回メッセージとして残す。
  //   企業(client)は後から talent_interest 等で合流するため、ここでは担当↔人材で開始する。
  //   チャット未整備環境でもスカウト自体は成功させる（best-effort）。
  let createdThreadId: string | null = null;
  try {
    if (scoutRow?.id) {
      // 案件参照(job_no/job_id)も併せて保存し、フリーランス側の案件モーダル/お気に入りに紐づける。
      const threadBase: Record<string, any> = { scout_id: scoutRow.id, engineer_id: input.engineer_id, engineer_name, agent, job_no: jobNoInt, job_title, subject: job_title };
      let th: any = await admin.from("chat_threads").insert({ ...threadBase, job_id }).select("id").maybeSingle();
      if (th.error && /job_id|column/i.test(th.error.message ?? "")) {
        th = await admin.from("chat_threads").insert(threadBase).select("id").maybeSingle();
      }
      if (th.data?.id) {
        createdThreadId = th.data.id;
        // sender_kind(本番=NOT NULL のことがある) は sender_role と同義の値を入れる。
        //   列が無い/弾かれる環境では sender_kind を外して再挿入（best-effort）。
        const msgBase = { thread_id: th.data.id, sender_role: "agent", sender_id: agent, sender_name: agent, body: scoutBody };
        let mr: any = await admin.from("chat_messages").insert({ ...msgBase, sender_kind: "agent" });
        if (mr.error && /sender_kind|column .* does not exist/i.test(mr.error.message ?? "")) {
          await admin.from("chat_messages").insert(msgBase);
        }
      }
    }
  } catch { /* chat_* 未整備でもスカウトは成功 */ }

  // 履歴にも残す（重複アプローチ防止・引き継ぎ）。スレッドに直接遷移できるよう thread_id も保存。
  //   thread_id 列が無い旧環境では列を外して再挿入（best-effort）。
  const actionRow: Record<string, any> = {
    engineer_id: input.engineer_id,
    engineer_name,
    action: "スカウト送信",
    note: job_title ? `案件: ${job_title}` : null,
    operator: agent,
    thread_id: createdThreadId,
  };
  let ar: any = await admin.from("engineer_actions").insert(actionRow);
  if (ar.error && /thread_id|column/i.test(ar.error.message ?? "")) {
    const { thread_id: _omit, ...withoutThread } = actionRow;
    await admin.from("engineer_actions").insert(withoutThread);
  }

  // ※ スカウト/チャットはフリーランスとのやり取りのみ。提案ボード（提案管理）へは記録しない。
  //   （提案ボードへの記録はフリーランスが「応募」した時だけ＝createApplication / 応募トリガで行う。）

  revalidatePath("/engineers");
  revalidatePath("/chat");
  return { ok: true };
}

/** 応募を作成（dx側からも応募を起票できるよう。enger.jp が INSERT する経路と並行）。
 *  作成時は notifications にお知らせを投函（DBトリガー未実行環境でもアプリ側で確実に通知）。 */
export async function createApplication(input: { engineer_id: string; engineer_name?: string | null; job_id?: string | null; job_no?: string | null; job_title?: string | null; message?: string | null }): Promise<{ ok: boolean; existed?: boolean; id?: string; error?: string }> {
  const access = await currentAccess();
  if (!access) return { ok: false, error: "未認証です" };
  if (!input.engineer_id) return { ok: false, error: "engineer_id がありません" };
  let admin: ReturnType<typeof engerAdmin>;
  try { admin = engerAdmin(); } catch { return { ok: false, error: "サーバ設定エラー" }; }
  try {
    // 重複チェック（engineer_id × job_id）。既にあれば既存を返す。
    if (input.job_id) {
      const dup: any = await admin.from("applications").select("id").eq("engineer_id", input.engineer_id).eq("job_id", input.job_id).maybeSingle();
      if (dup.data?.id) return { ok: true, existed: true, id: dup.data.id };
    }
    const ins: any = await admin.from("applications").insert({
      engineer_id: input.engineer_id,
      engineer_name: input.engineer_name ?? null,
      job_id: input.job_id ?? null,
      job_no: input.job_no ?? null,
      job_title: input.job_title ?? null,
      message: input.message ?? null,
      stage: "応募",
    }).select("id").maybeSingle();
    if (ins.error) return { ok: false, error: ins.error.message };
    // ② 応募時のみ提案ボードへ記録：所属確認フォルダに「対象案件＋人材名」を表示する（best-effort）。
    //   LP（enger.jp）からの応募は DBトリガ（applications-to-proposals.sql）が同等の提案を作るため、
    //   ここでは「既に同一応募の提案があればスキップ」して二重作成を防ぐ。トリガ未適用環境でも
    //   この dx 側経路で確実に提案ボードへ載せる。next_action に「直接応募」を含め LP直接応募バッジを点ける。
    try {
      const engName = input.engineer_name?.trim() || null;
      const jobTitle = input.job_title?.trim() || null;
      // #250：マスタ登録済み(E↔P紐付けあり)なら、その P番号(candidate) を判別し、氏名/candidate_id を
      //   DBトリガ(applications-to-proposals.sql)と一致させる。これで dx経路とLP経路で二重作成が起きない。
      let candId: string | null = null;
      let candName = engName;
      let candInit = engName ? engName.slice(0, 2) : "";
      try {
        const lk: any = await admin.from("freelance_candidate_links").select("candidate_id").eq("engineer_id", input.engineer_id).maybeSingle();
        if (lk?.data?.candidate_id) {
          candId = String(lk.data.candidate_id);
          const cr: any = await admin.from("candidates").select("name, initials").eq("id", candId).maybeSingle();
          if (cr?.data) { candName = (cr.data.name ?? candName); candInit = (cr.data.initials || String(cr.data.name ?? "").slice(0, 2)); }
        }
      } catch { /* リンクテーブル未整備でも続行（従来どおり氏名で作成） */ }
      if (candName) {
        // 二重作成防止：紐付けありは candidate_id×案件名、無しは 人材名×案件名（＋従来の人材名でも念のため確認）。
        let dupId: string | null = null;
        if (candId) {
          const d: any = await admin.from("proposals").select("id").eq("candidate_id", candId).eq("job_title", jobTitle ?? "").like("next_action", "%直接応募%").maybeSingle();
          dupId = d?.data?.id ?? null;
        }
        if (!dupId) {
          const d2: any = await admin.from("proposals").select("id").eq("candidate_name", candName).eq("job_title", jobTitle ?? "").like("next_action", "%直接応募%").maybeSingle();
          dupId = d2?.data?.id ?? null;
        }
        if (!dupId && engName && candName !== engName) {
          const d3: any = await admin.from("proposals").select("id").eq("candidate_name", engName).eq("job_title", jobTitle ?? "").like("next_action", "%直接応募%").maybeSingle();
          dupId = d3?.data?.id ?? null;
        }
        if (!dupId) {
          // 案件先の会社名を補完（任意）。
          let company: string | null = null;
          if (input.job_id) {
            const jr: any = await admin.from("jobs").select("client_name").eq("id", input.job_id).maybeSingle();
            company = jr?.data?.client_name ?? null;
          }
          const insP: any = await admin.from("proposals").insert({
            job_id: input.job_id ?? null, candidate_id: candId, stage: "所属確認",
            job_title: jobTitle ?? "（応募）", company, candidate_name: candName, c_init: candInit,
            proposer: null, ai: false, next_action: "エンジニア直接応募（LP）",
          }).select("id").maybeSingle();
          dupId = insP?.data?.id ?? null;
        }
        // #258①：応募時の「事前に相談したいこと・ご希望」を提案レコードのメモ履歴へ自動記録。
        //   新規作成・既存（重複防止で再利用）どちらの提案にも、本文があれば追記する。fail-soft。
        const consult = String(input.message ?? "").trim();
        if (dupId && consult) {
          try {
            await admin.from("proposal_memos").insert({
              proposal_id: dupId,
              category: "人材側→当社",
              body: `【自動記録】応募時の事前相談・ご希望：\n${consult.slice(0, 2000)}`,
              created_by_email: null,
              created_by_name: "自動記録（LP応募）",
            });
          } catch { /* メモ記録失敗は応募を止めない */ }
        }
      }
    } catch { /* proposals 未整備でも応募は成立させる */ }
    // 通知（DBトリガーが入っていない環境向け・冗長で安全）
    try {
      await admin.from("notifications").insert({
        recipient: "all",
        title: "新しい応募がありました",
        body: `${input.engineer_name ?? "人材"} さんが「${input.job_title ?? "案件"}」(No.${input.job_no ?? "-"}) に応募しました。`,
        kind: "info",
      });
    } catch { /* 通知失敗は無視 */ }
    // Slack 通知（SLACK_WEBHOOK_URL 未設定なら skip）。営業/管理者が選考画面に直行できるよう URL 付き。
    try {
      const eng = input.engineer_name ?? "人材";
      const job = input.job_title ?? "案件";
      const jobNo = input.job_no ? `No.${input.job_no}` : "";
      const reviewUrl = appUrl("/engineers");
      const portalUrl = appUrl("/portal/selection");
      await notifySlack({
        text: `📥 新しい応募：${eng} → ${job} ${jobNo}`,
        blocks: [
          { type: "section", text: { type: "mrkdwn", text: `*📥 新しい応募がありました*\n• 応募者: *${eng}*\n• 案件: *${job}* ${jobNo}` } },
          { type: "context", elements: [{ type: "mrkdwn", text: `<${reviewUrl}|選考管理(社内)> ／ <${portalUrl}|選考管理(企業ポータル)>` }] },
        ],
      });
    } catch { /* Slack 失敗は無視 */ }
    revalidatePath("/notifications");
    revalidatePath("/proposals");
    return { ok: true, existed: false, id: ins.data?.id };
  } catch (e: any) { return { ok: false, error: String(e?.message ?? e) }; }
}

/** 応募の選考ステージを更新（営業/管理者）。応募→面談合格→稼働を追跡。
 *  ステージ変更時に notifications にお知らせを投函（操作した営業が誰か、どの応募がどう動いたか）。 */
export async function updateApplicationStage(id: string, stage: string): Promise<Result> {
  const access = await currentAccess();
  if (!access || (access.role !== "admin" && access.role !== "agent")) return { ok: false, error: "権限がありません" };
  const allowed = ["応募", "書類選考", "面談", "面談合格", "稼働", "見送り"];
  if (!allowed.includes(stage)) return { ok: false, error: "不正なステージです" };
  let admin: ReturnType<typeof engerAdmin>;
  try { admin = engerAdmin(); } catch { return { ok: false, error: "SUPABASE_SERVICE_ROLE_KEY 未設定" }; }
  // 変更前ステージ + 関連情報を取得（通知本文用）
  const prev: any = await admin.from("applications").select("stage, engineer_name, job_title, job_no").eq("id", id).maybeSingle();
  const before = prev?.data?.stage ?? "応募";
  const { error } = await admin.from("applications").update({ stage, stage_updated_at: new Date().toISOString() }).eq("id", id);
  if (error) return { ok: false, error: error.message };
  // お知らせ投函（担当営業 = 操作した本人。'all' でチーム全員にも見えるように同報）
  try {
    const eng = prev?.data?.engineer_name ?? "—";
    const job = prev?.data?.job_title ?? prev?.data?.job_no ?? "—";
    const op = access?.name?.trim() || access?.email || "管理者";
    const title = `📋 応募ステージ更新：${eng}`;
    const body = [
      `案件：${job}`,
      `変更：${before} → ${stage}`,
      `操作：${op}`,
    ].join("\n");
    await admin.from("notifications").insert([
      { recipient: op, title, body, kind: "info" },
      { recipient: "all", title, body, kind: "info" },
    ]);
  } catch { /* 通知失敗してもステージ更新は成功とする */ }
  revalidatePath("/engineers");
  revalidatePath("/notifications");
  return { ok: true };
}

/** 対応履歴を1件削除（誤記録の取り消し）。 */
export async function deleteEngineerAction(id: string): Promise<Result> {
  let admin: ReturnType<typeof engerAdmin>;
  try { admin = engerAdmin(); } catch { return { ok: false, error: "SUPABASE_SERVICE_ROLE_KEY 未設定" }; }
  if (!id) return { ok: false, error: "IDが未指定です" };
  const { error } = await admin.from("engineer_actions").delete().eq("id", id);
  if (error) return { ok: false, error: error.message };
  revalidatePath("/engineers");
  return { ok: true };
}

/** エンジニアの「面談済」を設定／解除する。
 *  専用列を増やさず、対応履歴(engineer_actions) の action="面談済" の有無で表現する。
 *    done=true  : 既に無ければ1件 insert（重複は作らない）
 *    done=false : action="面談済" の行をすべて delete
 *  これで未マイグレ環境でも動作し、対応履歴とも整合する。 */
export async function setEngineerMeetingDone(input: { engineer_id: string; engineer_name?: string | null; done: boolean }): Promise<Result> {
  let admin: ReturnType<typeof engerAdmin>;
  try { admin = engerAdmin(); } catch { return { ok: false, error: "SUPABASE_SERVICE_ROLE_KEY 未設定" }; }
  if (!input.engineer_id) return { ok: false, error: "対象エンジニアが未指定です" };
  const access = await currentAccess();
  const operator = access?.name || access?.email || null;
  if (input.done) {
    const { data: ex } = await admin.from("engineer_actions").select("id").eq("engineer_id", input.engineer_id).eq("action", "面談済").limit(1);
    if (!ex || ex.length === 0) {
      const { error } = await admin.from("engineer_actions").insert({
        engineer_id: input.engineer_id,
        engineer_name: input.engineer_name?.trim() || null,
        action: "面談済",
        operator,
      });
      if (error) return { ok: false, error: error.message };
    }
  } else {
    const { error } = await admin.from("engineer_actions").delete().eq("engineer_id", input.engineer_id).eq("action", "面談済");
    if (error) return { ok: false, error: error.message };
  }
  revalidatePath("/engineers");
  return { ok: true };
}

/** LP登録者（public.profiles）を複数まとめて削除（admin / agent）。
 *  削除対象は profiles のみに限定（app_users 等の内部アカウントは触らない＝権限昇格防止）。
 *  ※ OAuth(GitHub/Google)の auth ユーザーは残るため、本人が再ログインすると LP 側で再生成される
 *    可能性がある。一覧からの除去（重複アプローチ防止・整理）が目的。 */
export async function bulkDeleteEngineers(ids: string[]): Promise<{ ok: boolean; deleted?: number; error?: string }> {
  const access = await currentAccess();
  if (!access || (access.role !== "admin" && access.role !== "agent")) return { ok: false, error: "権限がありません（管理者またはエージェントのみ）" };
  const clean = Array.from(new Set((ids ?? []).map((s) => String(s ?? "").trim()).filter(Boolean)));
  if (clean.length === 0) return { ok: false, error: "削除対象がありません" };
  try {
    const pub = publicAdmin();
    const r: any = await pub.from("profiles").delete().in("id", clean).select("id");
    if (r.error) return { ok: false, error: r.error.message };
    revalidatePath("/engineers");
    return { ok: true, deleted: Array.isArray(r.data) ? r.data.length : clean.length };
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : String(e) };
  }
}

/** LP登録者（public.profiles）を「退会処理（無効化）」する（admin / agent）。
 *  実削除は行わず、withdrawal_completed_at に現在時刻をセットして「退会済み」状態に切り替える。
 *  これで以後は一覧の通常表示から除外され、必要なときだけフィルタで参照できる。
 *  LP側の auth.users はそのまま残す（再ログインしても profiles.withdrawal_completed_at が
 *  残っている限り無効扱い／一覧では「退会済み」バッジ）。 */
export async function markEngineerWithdrawn(id: string): Promise<{ ok: boolean; error?: string }> {
  const access = await currentAccess();
  if (!access || (access.role !== "admin" && access.role !== "agent")) return { ok: false, error: "権限がありません（管理者またはエージェントのみ）" };
  const clean = String(id ?? "").trim();
  if (!clean) return { ok: false, error: "対象IDが未指定です" };
  try {
    const pub = publicAdmin();
    const now = new Date().toISOString();
    const r: any = await pub.from("profiles").update({ withdrawal_completed_at: now }).eq("id", clean).select("id");
    if (r.error) {
      // 列が無い環境（未マイグレ）はメッセージを明示
      if (/withdrawal_completed_at|column/i.test(r.error.message ?? "")) {
        return { ok: false, error: "supabase/profiles-withdrawal.sql の適用が必要です（withdrawal_completed_at 列が未追加）" };
      }
      return { ok: false, error: r.error.message };
    }
    if (!Array.isArray(r.data) || r.data.length === 0) return { ok: false, error: "対象が見つかりませんでした" };
    revalidatePath("/engineers");
    return { ok: true };
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : String(e) };
  }
}

// profiles.id が auth.users.id と一致しない環境向けフォールバック：email から auth ユーザーIDを解決。
async function resolveAuthUserId(auth: ReturnType<typeof authAdmin>, profileId: string, email: string | null): Promise<string | null> {
  // まず profiles.id ＝ auth.users.id を試す（LP登録は auth の uid を profiles PK に使う想定）。
  try {
    const g: any = await auth.auth.admin.getUserById(profileId);
    if (!g.error && g.data?.user?.id) return g.data.user.id;
  } catch { /* fallthrough */ }
  const needle = String(email ?? "").trim().toLowerCase();
  if (!needle) return null;
  try {
    for (let page = 1; page <= 10; page++) {
      const r: any = await auth.auth.admin.listUsers({ page, perPage: 200 });
      if (r.error) return null;
      const users: any[] = r.data?.users ?? [];
      const hit = users.find((u) => String(u.email ?? "").toLowerCase() === needle);
      if (hit) return hit.id;
      if (users.length < 200) return null;
    }
  } catch { /* noop */ }
  return null;
}

/** #263 ログイン停止/解除（一括・admin / agent）。
 *  ・public.profiles.login_suspended_at に記録（一覧バッジ・LP側バリデーション用）。
 *  ・Supabase Auth の ban（banned_until）を設定/解除 → 新規ログインは Auth 層で遮断され、
 *    停止中はリフレッシュトークンも使えないため、ログイン中のセッションも失効する（強制キック）。
 *  ・解除（suspend=false）で即座に通常ログイン可能へ復帰（ペナルティなし）。 */
export async function bulkSetLoginSuspension(ids: string[], suspend: boolean): Promise<{ ok: boolean; updated?: number; banned?: number; banErrors?: number; error?: string }> {
  const access = await currentAccess();
  if (!access || (access.role !== "admin" && access.role !== "agent")) return { ok: false, error: "権限がありません（管理者またはエージェントのみ）" };
  const clean = Array.from(new Set((ids ?? []).map((s) => String(s ?? "").trim()).filter(Boolean)));
  if (clean.length === 0) return { ok: false, error: "対象がありません" };
  try {
    const pub = publicAdmin();
    // ① フラグ更新（記録・バッジ・LP側バリデーション用）
    const now = new Date().toISOString();
    const up: any = await pub.from("profiles").update({ login_suspended_at: suspend ? now : null }).in("id", clean).select("id, email");
    if (up.error) {
      if (/login_suspended_at|column/i.test(up.error.message ?? "")) {
        return { ok: false, error: "supabase/profiles-login-suspension.sql の適用が必要です（login_suspended_at 列が未追加）" };
      }
      return { ok: false, error: up.error.message };
    }
    const rows: { id: string; email: string | null }[] = Array.isArray(up.data) ? up.data : [];
    if (rows.length === 0) return { ok: false, error: "対象が見つかりませんでした" };

    // ② Auth 層の ban/解除（ログイン遮断＋セッション失効）。ban_duration: "none" で解除。
    let banned = 0, banErrors = 0;
    let auth: ReturnType<typeof authAdmin> | null = null;
    try { auth = authAdmin(); } catch { auth = null; }
    if (auth) {
      for (const row of rows) {
        try {
          const uid = await resolveAuthUserId(auth, row.id, row.email);
          if (!uid) { banErrors++; continue; }
          const r: any = await auth.auth.admin.updateUserById(uid, { ban_duration: suspend ? "876000h" : "none" } as any);
          if (r.error) banErrors++; else banned++;
        } catch { banErrors++; }
      }
    } else {
      banErrors = rows.length;
    }
    revalidatePath("/engineers");
    return { ok: true, updated: rows.length, banned, banErrors };
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : String(e) };
  }
}

/** 「退会処理」を取り消す（誤操作の救済用）。withdrawal_completed_at を NULL に戻す。 */
export async function unmarkEngineerWithdrawn(id: string): Promise<{ ok: boolean; error?: string }> {
  const access = await currentAccess();
  if (!access || (access.role !== "admin" && access.role !== "agent")) return { ok: false, error: "権限がありません（管理者またはエージェントのみ）" };
  const clean = String(id ?? "").trim();
  if (!clean) return { ok: false, error: "対象IDが未指定です" };
  try {
    const pub = publicAdmin();
    const r: any = await pub.from("profiles").update({ withdrawal_completed_at: null }).eq("id", clean).select("id");
    if (r.error) return { ok: false, error: r.error.message };
    revalidatePath("/engineers");
    return { ok: true };
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : String(e) };
  }
}

/**
 * サイト経由登録のエンジニア(public.profiles)を、enger.candidates に「候補者」として
 * 取り込み、マッチング画面でそのまま使えるようにする。
 *   - 同名(name)で既に取り込み済みなら既存の candidate_no を返す
 *   - source_csv に登録元(エンジャーLP/無限道場LP/...)を記録して辿れるようにする
 */
export async function convertEngineerToCandidate(engineerId: string): Promise<{ ok: boolean; candidate_no?: number; error?: string }> {
  try {
    const pub = publicAdmin();
    const er: any = await pub.from("profiles").select("id, display_name, github_login, name, role, primary_language, skills, estimated_pay_low, estimated_pay_mid, estimated_pay_high, headline, bio, skill_sheet_url, portfolio_url, email").eq("id", engineerId).maybeSingle();
    if (er.error || !er.data) return { ok: false, error: "エンジニアが見つかりません" };
    const e = er.data;
    const name = (e.display_name || e.github_login || e.name || "").trim();
    if (!name) return { ok: false, error: "氏名が取得できません（display_name/github_login/name すべて空）" };
    const src = classifySource(e);

    let admin: ReturnType<typeof engerAdmin>;
    try { admin = engerAdmin(); } catch { return { ok: false, error: "SUPABASE_SERVICE_ROLE_KEY 未設定" }; }
    const existing: any = await admin.from("candidates").select("candidate_no").eq("name", name).limit(1).maybeSingle();
    if (existing.data?.candidate_no) return { ok: true, candidate_no: existing.data.candidate_no };

    const skills = (Array.isArray(e.skills) ? e.skills.map((s: any) => s?.name).filter(Boolean) : []) as string[];
    const allSkills = e.primary_language ? [e.primary_language, ...skills] : skills;
    const rate = e.estimated_pay_mid ? `¥${e.estimated_pay_mid}万`
      : (e.estimated_pay_low && e.estimated_pay_high ? `¥${e.estimated_pay_low}〜${e.estimated_pay_high}万` : null);
    const initials = (name.split(/\s+/)[0]?.[0] ?? "") + (name.split(/\s+/)[1]?.[0] ?? "");

    const row: Record<string, any> = {
      name,
      initials,
      title: e.headline || e.primary_language || null,
      skills: normalizeSkills(allSkills),
      rate,
      exp: e.bio?.toString().slice(0, 500) || null,
      status: "提案可",
      email: e.email || null,
      skill_sheet_url: e.skill_sheet_url || null,
      source_csv: `engineer:${src.key}`,
      imported_at: new Date().toISOString(),
    };
    const stripped = (o: Record<string, any>) => { const c = { ...o }; delete c.email; delete c.skill_sheet_url; return c; };
    let ins: any = await admin.from("candidates").insert(row).select("candidate_no").maybeSingle();
    if (ins.error && /skill_sheet_url|email|column/i.test(ins.error.message)) {
      ins = await admin.from("candidates").insert(stripped(row)).select("candidate_no").maybeSingle();
    }
    if (ins.error) return { ok: false, error: ins.error.message };
    revalidatePath("/people");
    return { ok: true, candidate_no: ins.data?.candidate_no };
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : String(e) };
  }
}

/**
 * LP(public.profiles)で登録された全エンジニアを enger.candidates に一括取込（自動同期）。
 *   - cron（auto-ingest）から定期実行され、人材一覧(/people)に常に反映させる。
 *   - 重複は氏名一致で除外（convertEngineerToCandidate と同じ基準＝同名は同一人物とみなす）。
 *   - source_csv に登録元(engineer:<key>) を記録して辿れるようにする。
 * 返り値: created=新規取込件数 / skipped=既存等でスキップした件数。
 */
export async function syncLpRegistrantsToCandidates(opts?: { limit?: number }): Promise<{ ok: boolean; created?: number; skipped?: number; error?: string }> {
  try {
    const { rows, available } = await listEngineers();
    if (!available) return { ok: false, error: "LP(profiles) を参照できません" };
    let admin: ReturnType<typeof engerAdmin>;
    try { admin = engerAdmin(); } catch { return { ok: false, error: "SUPABASE_SERVICE_ROLE_KEY 未設定" }; }

    // 既存 candidate 名の集合（氏名一致で重複取込を防ぐ）。
    const ex: any = await admin.from("candidates").select("name").limit(20000);
    const existing = new Set<string>(((ex.data ?? []) as any[]).map((r) => String(r.name ?? "").trim()).filter(Boolean));

    const toInsert: Record<string, any>[] = [];
    for (const e of rows) {
      const name = (e.display_name || e.github_login || e.name || "").trim();
      if (!name || existing.has(name)) continue;
      existing.add(name); // 取込対象内の同名重複も1件に抑える
      const skills = (Array.isArray(e.skills) ? e.skills.map((s: any) => s?.name).filter(Boolean) : []) as string[];
      const allSkills = e.primary_language ? [e.primary_language, ...skills] : skills;
      const rate = e.estimated_pay_mid ? `¥${e.estimated_pay_mid}万`
        : (e.estimated_pay_low && e.estimated_pay_high ? `¥${e.estimated_pay_low}〜${e.estimated_pay_high}万` : null);
      const initials = (name.split(/\s+/)[0]?.[0] ?? "") + (name.split(/\s+/)[1]?.[0] ?? "");
      toInsert.push({
        name,
        initials,
        title: e.headline || e.primary_language || null,
        skills: normalizeSkills(allSkills),
        rate,
        exp: e.bio?.toString().slice(0, 500) || null,
        status: "提案可",
        email: e.email || null,
        skill_sheet_url: e.skill_sheet_url || null,
        source_csv: `engineer:${e.source.key}`,
        imported_at: new Date().toISOString(),
      });
    }
    if (opts?.limit && toInsert.length > opts.limit) toInsert.length = opts.limit;
    if (toInsert.length === 0) return { ok: true, created: 0, skipped: rows.length };

    const stripped = (o: Record<string, any>) => { const c = { ...o }; delete c.email; delete c.skill_sheet_url; return c; };
    let ins: any = await admin.from("candidates").insert(toInsert);
    if (ins.error && /skill_sheet_url|email|column/i.test(ins.error.message)) {
      ins = await admin.from("candidates").insert(toInsert.map(stripped));
    }
    if (ins.error) return { ok: false, error: ins.error.message };
    revalidatePath("/people");
    return { ok: true, created: toInsert.length, skipped: rows.length - toInsert.length };
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : String(e) };
  }
}

// ============================================================
// #250 ENGERフリーランス → 人材マスタ（人材一覧）への新規登録
// ============================================================

export type FreelancePrefill = {
  engineer_id: string;
  freelance_id: string;            // 元のE番号（E-XXXXX）
  name: string;                    // 氏名＝フリーランス側のイニシャル（例：FT）。未登録なら空欄。
  title: string;                   // 職種（希望職種）
  affiliation: string;             // 所属区分＝既定「弊社所属フリーランス」（#262・編集可）
  skills: string[];                // スキルカードの技術スタック
  rate: string;                    // 希望単価（"50万〜" / "50万〜60万"）
  rate_num: number | null;
  location: string;                // 最寄駅
  remote_pref: string;             // リモート希望（3区分）
  age_band: string;                // 年代区分（年齢から自動変換：36→"30代後半"）
  nationality: string;             // 国籍（3区分）
  email: string;                   // 連絡先メール
  skill_sheets: SkillSheet[];      // スキルシート（署名URL付き・ログイン不要で閲覧/DL可）
  predicted_no: number | null;     // 表示用：次に振られる見込みのP番号
  already_no: number | null;       // 既にマスタ登録済みなら そのP番号
};

/** 「人材マスタへ新規登録」フォーム用：対象フリーランスのプロフィールを読み、流し込み用データを返す。
 *  ・LP の列名差異は select("*") ＋ 名前パターンの動的スキャンで吸収。空欄はそのまま空欄に倒す（#250）。
 *  ・スキルシートはログイン不要で閲覧/DLできる署名URLに付け替える。 */
export async function prepareCandidateFromFreelancer(engineerId: string): Promise<{ ok: boolean; data?: FreelancePrefill; error?: string }> {
  const access = await currentAccess();
  if (!access || (access.role !== "admin" && access.role !== "agent")) return { ok: false, error: "権限がありません（ENGERスタッフのみ）" };
  const id = (engineerId ?? "").trim();
  if (!id) return { ok: false, error: "engineer_id がありません" };
  let admin: ReturnType<typeof engerAdmin>;
  let pub: ReturnType<typeof publicAdmin>;
  try { admin = engerAdmin(); pub = publicAdmin(); } catch { return { ok: false, error: "サーバ設定エラー（SUPABASE_SERVICE_ROLE_KEY 未設定）" }; }

  // 既にマスタ登録済みか（E↔P 紐付け）。
  let already: number | null = null;
  try {
    const lk: any = await admin.from("freelance_candidate_links").select("candidate_no").eq("engineer_id", id).maybeSingle();
    already = lk?.data?.candidate_no ?? null;
  } catch { /* リンクテーブル未整備でも続行 */ }

  // プロフィールを全列取得（LP 列名差異を吸収）。
  let p: any = {};
  try {
    const r: any = await pub.from("profiles").select("*").eq("id", id).maybeSingle();
    if (!r.error && r.data) p = r.data;
  } catch { /* 取得失敗でも空で続行 */ }

  const initials = String(p?.initial_display ?? p?.initial_auto ?? p?.initials ?? p?.initial ?? "").trim();
  const f = extractFreelanceFields(p);
  const skills = extractSkillCard(p);

  // スキルシート：skill_sheets(jsonb) 優先、無ければ旧 skill_sheet_url を1件として扱う。
  //   ※ 永続保存する側は「path＋公開URL（skillsheets バケットは公開＝ログイン不要・期限なし）」をそのまま持たせる。
  //     期限切れで死ぬ署名URLは保存しない。期間限定の外部共有が必要な時は skill_sheets[].path から都度
  //     署名URL を再発行できる（src/lib/skill-sheet-url.ts の signSkillSheets）。
  const skill_sheets: SkillSheet[] = (Array.isArray(p?.skill_sheets)
    ? (p.skill_sheets as any[]).filter((s) => s && (s.url || s.path)).slice(0, 3)
    : (p?.skill_sheet_url ? [{ url: String(p.skill_sheet_url), name: p?.skill_sheet_name ?? null, path: null }] : [])
  ).map((s: any) => ({ url: String(s.url ?? ""), name: s.name ?? null, path: s.path ?? null, uploaded_at: s.uploaded_at ?? null }));

  // 表示用の次P番号（最新+1）。実際の採番は保存時（IDENTITY）に確定する。
  let predicted: number | null = null;
  try {
    const mx: any = await admin.from("candidates").select("candidate_no").order("candidate_no", { ascending: false }).limit(1).maybeSingle();
    predicted = (mx?.data?.candidate_no != null ? Number(mx.data.candidate_no) : 0) + 1;
  } catch { /* 採番予測不可でも続行 */ }

  return {
    ok: true,
    data: {
      engineer_id: id,
      freelance_id: freelanceShortId(id),
      name: initials,                                  // 氏名＝イニシャル（空欄ならそのまま空欄）
      title: f.desiredJob,
      affiliation: "弊社所属フリーランス",              // 既定（#262・フォームで編集可）
      skills,
      rate: formatRateRange(f.rateMin, f.rateMax),
      rate_num: f.rateMin ?? f.rateMax ?? null,
      location: f.nearestStation,
      remote_pref: normalizeRemote(f.remote),
      age_band: ageToBand(f.age),
      nationality: normalizeNationality(f.nationality),
      email: String(p?.email ?? "").trim(),
      skill_sheets,
      predicted_no: predicted,
      already_no: already,
    },
  };
}

/** 「人材マスタへ新規登録」確定：人材マスタ(enger.candidates)に新規作成し、E↔P 紐付けを有効化する。
 *  ・name×company の既存統合は使わず直接 insert（イニシャル同名の別人を取り違えないため）。
 *  ・既に紐付け済みなら二重作成せず既存P番号を返す。
 *  ・空欄項目はそのまま空欄で保存（初期テキストで埋めない）。 */
export async function registerCandidateFromFreelancer(input: {
  engineer_id: string;
  name: string;
  title?: string | null;
  affiliation?: string | null;
  source_company?: string | null;  // #262 所属会社（既定「ENGERフリーランス」）→ 人材一覧の所属会社欄に反映
  avail?: string | null;           // #262 稼働開始（例「2026年8月1日〜」）→ 人材一覧の稼働開始欄に反映
  skills?: string[];
  rate?: string | null;
  rate_num?: number | null;
  location?: string | null;
  remote_pref?: string | null;
  age_band?: string | null;
  nationality?: string | null;
  email?: string | null;
  skill_sheets?: SkillSheet[];
}): Promise<{ ok: boolean; candidate_no?: number; existed?: boolean; error?: string }> {
  const access = await currentAccess();
  if (!access || (access.role !== "admin" && access.role !== "agent")) return { ok: false, error: "権限がありません（ENGERスタッフのみ）" };
  const engId = (input.engineer_id ?? "").trim();
  if (!engId) return { ok: false, error: "engineer_id がありません" };
  const name = (input.name ?? "").trim();
  if (!name) return { ok: false, error: "氏名（イニシャル）を入力してください" };
  let admin: ReturnType<typeof engerAdmin>;
  try { admin = engerAdmin(); } catch { return { ok: false, error: "サーバ設定エラー（SUPABASE_SERVICE_ROLE_KEY 未設定）" }; }

  // 既に紐付け済みなら二重作成しない。
  try {
    const lk: any = await admin.from("freelance_candidate_links").select("candidate_no, candidate_id").eq("engineer_id", engId).maybeSingle();
    if (lk?.data?.candidate_id) return { ok: true, candidate_no: lk.data.candidate_no ?? undefined, existed: true };
  } catch { /* リンクテーブル未整備でも続行（作成にトライ） */ }

  const now = new Date().toISOString();
  const operator = access?.name || access?.email || null;
  const sheets = (input.skill_sheets ?? []).filter((s) => s && s.url).slice(0, 3);
  const row: Record<string, any> = {
    name,
    initials: name,                                      // イニシャルそのものを氏名/イニシャルに使う
    title: input.title?.trim() || null,
    affiliation: (input.affiliation?.trim() || "弊社所属フリーランス"),  // 所属区分（#262 既定）
    // #262 所属会社：人材一覧の「所属会社」欄は source_company 優先・company フォールバックで
    //   表示されるため両方に保存（既定「ENGERフリーランス」）。
    source_company: (input.source_company?.trim() || "ENGERフリーランス"),
    company: (input.source_company?.trim() || "ENGERフリーランス"),
    // #262 稼働開始：カレンダー選択値（表示用テキスト）。人材一覧の「稼働開始」欄に反映。
    avail: input.avail?.trim() || null,
    skills: normalizeSkills(input.skills ?? []),
    rate: input.rate?.trim() || null,
    rate_num: input.rate_num ?? null,
    location: input.location?.trim() || null,
    remote_pref: input.remote_pref?.trim() || null,
    age_band: input.age_band?.trim() || null,
    nationality: input.nationality?.trim() || null,
    email: input.email?.trim() || null,
    skill_sheet_url: sheets[0]?.url || null,
    skill_sheets: sheets.length ? sheets : null,
    status: "提案可",
    score: 0,
    source_csv: "freelance",
    signup_source: "enger",
    operator,
    imported_at: now,
  };

  // insert。列未整備の環境でも通るよう、エラーが指す列を落として再試行（最大8回・列名を動的に除去）。
  let ins: any = await admin.from("candidates").insert(row).select("id, candidate_no").maybeSingle();
  for (let i = 0; i < 8 && ins.error; i++) {
    const msg = String(ins.error.message ?? "");
    const m = msg.match(/Could not find the '([a-z_0-9]+)' column|column "?([a-z_0-9]+)"? of relation/i);
    const col = m?.[1] || m?.[2];
    if (!col || !(col in row)) break;
    delete (row as any)[col];
    ins = await admin.from("candidates").insert(row).select("id, candidate_no").maybeSingle();
  }
  if (ins.error || !ins.data?.id) return { ok: false, error: ins.error?.message ?? "人材マスタへの登録に失敗しました" };
  const candidateId = String(ins.data.id);
  const candidateNo = ins.data.candidate_no != null ? Number(ins.data.candidate_no) : undefined;

  // E↔P 紐付けを作成（応募→提案ボードの自動結びつけのソース）。engineer_id は PK。
  //   同時実行で別リクエストが先に紐付けた場合は一意制約違反 → こちらが作った重複候補を消し、
  //   先勝ちの既存P番号を返す（1フリーランス→1マスタの不変条件を守る）。
  const linkIns: any = await admin.from("freelance_candidate_links")
    .insert({ engineer_id: engId, candidate_id: candidateId, candidate_no: candidateNo ?? null, linked_by: operator });
  if (linkIns.error && /duplicate|unique|conflict|already exists/i.test(linkIns.error.message ?? "")) {
    try { await admin.from("candidates").delete().eq("id", candidateId); } catch { /* noop */ }
    let existingNo: number | undefined;
    try {
      const ex: any = await admin.from("freelance_candidate_links").select("candidate_no").eq("engineer_id", engId).maybeSingle();
      existingNo = ex?.data?.candidate_no != null ? Number(ex.data.candidate_no) : undefined;
    } catch { /* noop */ }
    return { ok: true, candidate_no: existingNo, existed: true };
  }
  // duplicate 以外（例：リンクテーブル未整備）は候補作成のみ成立（紐付け未作成）。

  revalidatePath("/people");
  revalidatePath("/engineers");
  return { ok: true, candidate_no: candidateNo };
}
