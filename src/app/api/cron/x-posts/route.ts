// X集客PRの投稿文を時間帯ごとに自動生成し、Slack に「ワンクリックで投稿できる形」で流す定期ジョブ。
//   運用: GitHub Actions（.github/workflows/x-posts.yml）から時間帯ごとに ?slot= を付けて叩く。
//   保護（任意）: CRON_SECRET を設定していれば Authorization: Bearer ${CRON_SECRET} を要求する。
//     未設定でも動作する（副作用は自社Slackへの投稿下書き通知のみ・データ露出/実投稿なし）。
//   ※ 実投稿はしない（X API 不要）。Slack に貼られた「▶ Xに投稿」リンクを担当が押すと、
//      X の投稿画面が本文＋案件リンク付きで開く（リンク先 /job/<No> の案件カードが自動添付）。
//
//   スロット（JST）:
//     morning   08:00  高単価・新着案件
//     noon      12:15  フルリモート・柔軟な案件
//     afternoon 15:00  本日の新着案件
//     night     21:00  注目案件＋無料登録の案内
//   各スロットは候補カードを複数（既定3件）Slackに出し、担当が1つ選んで投稿する。
//   slot 未指定時は現在時刻(JST)から最も近いスロットを推定。slot=all で4スロット送る。
//   ?dry=1 で Slack 送信せず生成結果を JSON で返す（確認用）。
import { engerAdmin } from "@/lib/supabase";
import { notifySlack } from "@/lib/slack";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 60;

const PAY_DEDUCT = 7; // #243 フリーランス表示は -7万（案件ページ/OGPカードと同一ルール）
const adj = (v: number) => Math.max(0, Math.round(v) - PAY_DEDUCT);
const remoteLabel = (r?: string | null) =>
  r === "full_remote" ? "フルリモート" : r === "partial_remote" ? "一部リモート" : r === "onsite" ? "出社" : "";
// 単価が万単位で妥当（桁崩れデータ除外）。
const saneHi = (hi: number) => Number.isFinite(hi) && hi >= 20 && hi <= 300;
function rateText(lo: number | null, hi: number | null): string {
  const L = lo != null && Number.isFinite(lo) ? adj(lo) : null;
  const H = hi != null && Number.isFinite(hi) ? adj(hi) : null;
  if (L && H) return L === H ? `月${L}万円` : `月${L}〜${H}万円`;
  if (H) return `月${H}万円`;
  if (L) return `月${L}万円〜`;
  return "";
}
const utm = (content: string) =>
  new URLSearchParams({ utm_source: "x", utm_medium: "social", utm_campaign: "pr", utm_content: content }).toString();
const jobUrl = (no: string, content: string) => `https://enger.jp/job/${no}?${utm(content)}`;
const cardPng = (no: string) => `https://enger.jp/og/job/${no}.png`;
const intent = (text: string, url: string) => `https://twitter.com/intent/tweet?${new URLSearchParams({ text, url })}`;
const tagize = (s: string) => s.replace(/[^0-9A-Za-zぁ-んァ-ヶ一-龠]/g, "");

type Slot = "morning" | "noon" | "afternoon" | "night";
const SLOT_LABEL: Record<Slot, string> = {
  morning: "08:00 高単価・新着案件",
  noon: "12:15 フルリモート・柔軟な案件",
  afternoon: "15:00 本日の新着案件まとめ",
  night: "21:00 注目案件＋無料登録の案内",
};
type J = { no: string; role: string; skills: string[]; rate: string; remote: string };

function toJ(r: any): J {
  return {
    no: String(r.job_no),
    role: String(r.role_label ?? "").trim() || "エンジニア",
    skills: (Array.isArray(r.skills) ? r.skills : []).map((s: any) => String(s).trim()).filter(Boolean).slice(0, 4),
    rate: rateText(r.salary_min != null ? Number(r.salary_min) : null, r.salary_max != null ? Number(r.salary_max) : null),
    remote: remoteLabel(r.remote_type),
  };
}

async function queryJobs(
  admin: ReturnType<typeof engerAdmin>,
  opts: { fullRemote?: boolean; sinceIso?: string | null; bySalary?: boolean; limit?: number },
): Promise<J[]> {
  let q = admin.from("jobs")
    .select("job_no, role_label, skills, salary_min, salary_max, remote_type, created_at")
    .eq("is_published", true).not("job_no", "is", null);
  if (opts.fullRemote) q = q.eq("remote_type", "full_remote");
  if (opts.sinceIso) q = q.gte("created_at", opts.sinceIso);
  q = opts.bySalary ? q.order("salary_max", { ascending: false }) : q.order("created_at", { ascending: false });
  const { data } = await q.limit(opts.limit ?? 40);
  return ((data ?? []) as any[]).filter((r) => r.job_no != null && saneHi(Number(r.salary_max))).map(toJ);
}

/** JST の本日0:00 を UTC ISO で返す（本日の新着抽出用）。 */
function jstTodayStartIso(): string {
  const jst = new Date(Date.now() + 9 * 3600 * 1000);
  return new Date(Date.UTC(jst.getUTCFullYear(), jst.getUTCMonth(), jst.getUTCDate()) - 9 * 3600 * 1000).toISOString();
}

type Post = { slot: Slot; label: string; tweet: string; url: string; no: string | null };

const CANDIDATES = 3; // 各時間帯で提示する候補カード数（担当が1つ選んで投稿）。

const head = (j: J) => [j.remote, j.role].filter(Boolean).join("・");
const skillHash = (j: J) => (j.skills[0] && tagize(j.skills[0]) ? ` #${tagize(j.skills[0])}案件` : "");

/** スロットのテーマに沿った投稿文を、対象案件から生成する。 */
function tweetFor(slot: Slot, j: J): string {
  const s3 = j.skills.slice(0, 3).join("・");
  if (slot === "morning")
    return `🔥高単価の新着案件\n【${head(j)}】${j.rate}\n${s3}\nあなたのスキルでこの単価、狙えます。マッチ度を30秒で診断👇\n#フリーランス #高単価案件${skillHash(j)}`;
  if (slot === "noon")
    return `🏠フルリモート・柔軟に働ける案件\n【${head(j)}】${j.rate}\n${s3}\n通勤なし、自分のペースで。まずは30秒でマッチ度診断👇\n#フリーランス #リモート案件${skillHash(j)}`;
  if (slot === "afternoon")
    return `📋本日の新着案件\n【${head(j)}】${j.rate}\n${s3}\nあなたに合うか、30秒でマッチ度診断👇\n#フリーランス #エンジニア案件${skillHash(j)}`;
  return `✨注目のフリーランス案件\n【${head(j)}】${j.rate}\n${s3}\n登録無料・カード不要。あなたに合うか30秒で診断できます👇\n#フリーランス #エンジニア案件${skillHash(j)}`;
}

/** スロットのテーマで案件プールを取得（担当が選べるよう候補を複数返す）。 */
async function slotPool(admin: ReturnType<typeof engerAdmin>, slot: Slot): Promise<J[]> {
  if (slot === "noon") {
    const r = await queryJobs(admin, { fullRemote: true, limit: 20 });
    return r.length ? r : await queryJobs(admin, { limit: 20 });
  }
  if (slot === "afternoon") {
    const todays = await queryJobs(admin, { sinceIso: jstTodayStartIso(), limit: 20 });
    return todays.length ? todays : await queryJobs(admin, { limit: 20 });
  }
  return await queryJobs(admin, { bySalary: true, limit: 20 }); // morning / night
}

// ── 重複配信の抑止（ローテーション）────────────────────────────────────────
//   直近 ROTATION_DAYS 日以内に Slack へ提示した案件（enger.pr_featured_jobs）は候補から外す。
//   morning/night は高単価順のため、これが無いと毎日同じ案件が出続ける。
//   フレッシュな候補が足りない時だけ、既出案件で埋める（空配信にはしない）。
//   テーブル未作成（supabase/pr-featured-jobs.sql 未適用）なら空集合＝従来動作（fail-soft）。
const ROTATION_DAYS = 7;

async function recentlyFeatured(admin: ReturnType<typeof engerAdmin>): Promise<Set<string>> {
  try {
    const since = new Date(Date.now() - ROTATION_DAYS * 86400000).toISOString();
    const { data, error } = await admin.from("pr_featured_jobs")
      .select("job_no").gte("featured_at", since).limit(2000);
    if (error) return new Set();
    return new Set(((data ?? []) as any[]).map((r) => String(r.job_no)));
  } catch { return new Set(); }
}

async function markFeatured(admin: ReturnType<typeof engerAdmin>, slot: Slot, nos: string[]) {
  if (nos.length === 0) return;
  try {
    await admin.from("pr_featured_jobs").insert(nos.map((no) => ({ job_no: Number(no), slot })));
  } catch { /* テーブル未作成でも配信は成功扱い */ }
}

/** スロットの候補投稿（最大 CANDIDATES 件）。担当は Slack で1つ選んで投稿する。
 *  直近提示済み（featured）の案件は後ろに回し、フレッシュな案件を優先する。 */
async function buildPosts(admin: ReturnType<typeof engerAdmin>, slot: Slot, featured: Set<string>): Promise<Post[]> {
  const label = SLOT_LABEL[slot];
  const pool = await slotPool(admin, slot);
  const fresh = pool.filter((j) => !featured.has(j.no));
  const reused = pool.filter((j) => featured.has(j.no));
  return [...fresh, ...reused].slice(0, CANDIDATES)
    .map((j) => ({ slot, label, tweet: tweetFor(slot, j), url: jobUrl(j.no, slot), no: j.no }));
}

/** 1スロット分の Slack メッセージ（候補を並べ、各候補にワンクリック投稿リンクを付ける）。 */
function slackBlocks(label: string, posts: Post[]) {
  const blocks: any[] = [
    { type: "header", text: { type: "plain_text", text: `𝕏 ${label}`, emoji: true } },
    { type: "context", elements: [{ type: "mrkdwn", text: `下の${posts.length}件から1つ選んで「▶ Xに投稿」を押してください（文面は投稿画面で編集可）。` }] },
  ];
  posts.forEach((p, i) => {
    const links = [
      `<${intent(p.tweet, p.url)}|▶ Xに投稿（ワンクリック）>`,
      p.no ? `<${cardPng(p.no)}|カード画像>` : "",
      `<${p.url}|案件ページ>`,
    ].filter(Boolean).join("　・　");
    blocks.push({ type: "divider" });
    blocks.push({ type: "section", text: { type: "mrkdwn", text: `*候補${i + 1}${p.no ? `（No.${p.no}）` : ""}*\n` + "```\n" + p.tweet + "\n```" } });
    blocks.push({ type: "context", elements: [{ type: "mrkdwn", text: links }] });
  });
  return blocks;
}

/** 現在時刻(JST)から最も近いスロットを推定（slot 未指定時のフォールバック）。 */
function inferSlot(): Slot {
  const h = new Date(Date.now() + 9 * 3600 * 1000).getUTCHours();
  if (h < 10) return "morning";
  if (h < 13) return "noon";
  if (h < 18) return "afternoon";
  return "night";
}

async function handle(req: Request) {
  // 保護は任意。専用の X_POSTS_SECRET を設定していれば Bearer 一致を要求する（推奨）。
  //   ※ auto-ingest 用の CRON_SECRET とは分離している（Vercel に CRON_SECRET があっても
  //     x-posts はそれに縛られず、X_POSTS_SECRET 未設定なら素通しで動く）。
  //   未設定でも動作する：このエンドポイントの副作用は「自社Slackに投稿下書きを流す」だけで、
  //   データ露出や外部への実投稿（X等）は一切ないため。まず手軽に動かしたい場合は未設定でよい。
  const secret = process.env.X_POSTS_SECRET;
  if (secret && (req.headers.get("authorization") ?? "") !== `Bearer ${secret}`)
    return Response.json({ ok: false, error: "Unauthorized" }, { status: 401 });

  const url = new URL(req.url);
  const dry = url.searchParams.get("dry") === "1";
  const slotParam = (url.searchParams.get("slot") || "").toLowerCase();
  const slots: Slot[] = slotParam === "all"
    ? ["morning", "noon", "afternoon", "night"]
    : (["morning", "noon", "afternoon", "night"] as Slot[]).includes(slotParam as Slot)
      ? [slotParam as Slot]
      : [inferSlot()];

  let admin: ReturnType<typeof engerAdmin>;
  try { admin = engerAdmin(); } catch { return Response.json({ ok: false, error: "SUPABASE_SERVICE_ROLE_KEY 未設定" }, { status: 503 }); }

  // 直近提示済みの案件（ローテーション用）。slot=all の同一実行内でも重複しないよう随時追加する。
  const featured = await recentlyFeatured(admin);

  const results: { slot: Slot; ok: boolean; candidates: number; nos: string[]; reused?: number; skipped?: boolean; error?: string }[] = [];
  const built: Post[] = [];
  for (const slot of slots) {
    let posts: Post[] = [];
    try { posts = await buildPosts(admin, slot, featured); } catch (e: any) { results.push({ slot, ok: false, candidates: 0, nos: [], error: String(e?.message ?? e) }); continue; }
    if (posts.length === 0) { results.push({ slot, ok: false, candidates: 0, nos: [], error: "該当案件が見つかりません" }); continue; }
    built.push(...posts);
    const nos = posts.map((p) => p.no).filter(Boolean) as string[];
    const reused = nos.filter((n) => featured.has(n)).length;
    if (dry) { results.push({ slot, ok: true, candidates: posts.length, nos, reused }); continue; }
    const r = await notifySlack({ text: `𝕏 ${SLOT_LABEL[slot]}（候補${posts.length}件）`, blocks: slackBlocks(SLOT_LABEL[slot], posts) });
    if (r.ok && !r.skipped) {
      await markFeatured(admin, slot, nos);          // 提示履歴を記録（次回から候補除外）
      nos.forEach((n) => featured.add(n));           // 同一実行内（slot=all）の重複も防ぐ
    }
    results.push({ slot, ok: r.ok, candidates: posts.length, nos, reused, skipped: r.skipped, error: r.error });
  }
  return Response.json({ ok: results.every((r) => r.ok), dry, results, posts: dry ? built : undefined });
}

export const GET = handle;
export const POST = handle;
