import { cache } from "react";
import { engerAdmin, engerClient, dbConfigured, publicAdmin, authAdmin } from "./supabase";
import { authServerClient, authConfigured } from "./supabase-auth";
import { type Role, type AccountStatus, canAccess, roleHome, isExecDepartment } from "./roles";
import { isExcludedProfile } from "./engineers";

/** 1リクエスト内でログインユーザーのメールを1回だけ解決（layout と各ページの二重 getUser を防ぐ）。
 *  getClaims: JWT をローカル検証（非対称署名キー時は Auth API への HTTP 往復ゼロ）。getUser だと
 *  ページ描画のたびに Auth API へ往復し、混雑時に数百ms〜1.5秒の待ちが積み上がっていた。
 *  ※署名は JWKS で検証＝偽造は弾く。アカウント有効/無効・ロールは resolveAccess(app_users) で別途確認。*/
export const getSessionEmail = cache(async (): Promise<string> => {
  if (!authConfigured) return "";
  try {
    const sb = await authServerClient();
    const { data } = await sb.auth.getClaims();
    return (data?.claims?.email as string | undefined)?.toLowerCase() ?? "";
  } catch { return ""; }
});

export { canAccess, roleHome };
export type { Role, AccountStatus };
export type SalesPosition = "inside" | "outside" | null;
export type Account = {
  id: string;
  email: string;
  name: string | null;
  role: Role;
  status: AccountStatus;
  company_name: string | null;
  position: SalesPosition;
  functions: string[] | null;
  note: string | null;
  created_at: string;
  approved_at: string | null;
  approved_by_email?: string | null;
  approved_by_name?: string | null;
  meeting_done?: boolean | null;
  meeting_done_at?: string | null;
  meeting_done_by_email?: string | null;
  meeting_done_by_name?: string | null;
  department?: string | null;
  team_role?: string | null;
  kpi_role?: string | null;       // KPI役割: outside / inside / telapo（kpi-roles-funnel.sql）
  is_timecard_user?: boolean | null;
  /** LP登録の出所。'enger' | 'dojo' | 将来の値（profile/auth起源のときのみ）。表示バッジ用。 */
  signup_source?: string | null;
  signup_method?: string | null;
};

/** signup_source の正規化＋フォールバック判定。
 *   1) 保存値（'enger'|'enger_lp'|'dojo'|'mugen_dojo' ...）があればそれを正規化
 *   2) メールドメインから推定（@mugendojo.jp 等 → dojo）
 *   3) role=student も dojo として扱う
 *   4) どれにも当たらなければ null（UI側で「不明」と出す） */
export function resolveSignupSource(stored: any, email: string | null | undefined, ctx: { role?: string | null } = {}): string | null {
  const s = String(stored ?? "").toLowerCase().trim();
  if (s === "dojo" || s === "mugen_dojo" || s === "mugendojo") return "dojo";
  if (s === "enger" || s === "enger_lp" || s === "engerjp") return "enger";
  if (s) return s; // 将来の新LP（保存値そのまま）
  const em = String(email ?? "").toLowerCase();
  if (/@(mugendojo|mugen-dojo|dojo)\./.test(em)) return "dojo";
  if (/@enger\.jp$/.test(em)) return "enger";
  if (String(ctx.role ?? "").toLowerCase() === "student") return "dojo";
  return null;
}

/** signup_method の正規化（'github'|'google'|'form'|'email' に寄せる）。 */
export function normalizeSignupMethod(m: any): string | null {
  const s = String(m ?? "").toLowerCase().trim();
  if (!s) return null;
  if (s.includes("github")) return "github";
  if (s.includes("google")) return "google";
  if (s.includes("form")) return "form";
  if (s.includes("mail")) return "email";
  return s;
}

/** メールでアカウントを取得（サーバ専用 / service role）。 */
export async function getAccountByEmail(email: string): Promise<Account | null> {
  const e = (email || "").toLowerCase().trim();
  if (!e || !dbConfigured) return null;
  try {
    const sb = engerAdmin();
    const { data, error } = await sb.from("app_users").select("*").ilike("email", e).maybeSingle();
    if (error || !data) return null;
    return data as Account;
  } catch { return null; }
}

/**
 * ログイン中ユーザーのアクセス情報を解決。
 *  1) app_users にレコードあり → その role/status
 *  2) 無い場合は staff の email 許可リストにあれば admin 扱い（移行期の締め出し防止）
 *  3) どちらも無ければ null（未許可）
 */
export const resolveAccess = cache(async (email: string): Promise<{ role: Role; rawRole: Role; status: AccountStatus; companyName: string | null; name: string | null; position: SalesPosition; functions: string[]; meetingDone: boolean; department: string | null; teamRole: string | null; isTimecardUser: boolean } | null> => {
  const acc = await getAccountByEmail(email);
  if (acc) {
    const department = (acc as any).department ?? null;
    // 経営部署の内部メンバー(agent/admin)は管理者相当に昇格（全メニュー・全機能）。
    //   役職別権限の煩雑さを避け「経営＝全部できる」を単純に実現する。
    //   外部ロール(client/candidate/partner/freelance)は対象外（誤って部署が入っても昇格しない）。
    //   rawRole には昇格前の素のロールを残す（「経営の日報は管理者のみ閲覧可」等の判定に使用）。
    const isInternal = acc.role === "agent" || acc.role === "admin";
    const role: Role = isExecDepartment(department) && isInternal ? "admin" : acc.role;
    return {
      role, rawRole: acc.role, status: acc.status, companyName: acc.company_name, name: acc.name,
      position: (acc.position ?? null) as SalesPosition,
      functions: (acc.functions ?? []) as string[],
      meetingDone: !!(acc as any).meeting_done,
      department, teamRole: (acc as any).team_role ?? null,
      isTimecardUser: !!(acc as any).is_timecard_user,
    };
  }

  // フォールバック: 既存 staff 許可リストに載っている email のみ admin（移行期の救済）。
  // ※ 未登録の email を admin に“素通り”させない（Googleログイン等で勝手に管理者になる事故を防止）。
  //    app_users に未登録の人は null（=未許可）。コールバックで承認待ち(client)として作成される。
  const e = (email || "").toLowerCase().trim();
  if (!e || !dbConfigured) return null;
  try {
    const sb = engerClient();
    const { data, error } = await sb.from("staff").select("name, email, position").eq("active", true).not("email", "is", null);
    if (error) return null;
    const rows = (data ?? []) as { name: string; email: string | null; position?: string | null }[];
    if (rows.length === 0) return null;
    const me = rows.find((r) => String(r.email || "").toLowerCase() === e);
    if (me) return { role: "admin", rawRole: "admin", status: "active", companyName: null, name: me.name ?? null, position: (me.position ?? null) as SalesPosition, functions: [], meetingDone: true, department: null, teamRole: null, isTimecardUser: false };
    return null;
  } catch { return null; }
});

/** 承認待ちアカウントを作成（自己登録 / Google初回）。既存はそのまま。 */
export async function createPendingAccount(opts: { email: string; name?: string | null; role?: "agent" | "client" | "candidate" | "partner" | "freelance"; companyName?: string | null }): Promise<{ ok: boolean; created: boolean; error?: string }> {
  const e = (opts.email || "").toLowerCase().trim();
  if (!e) return { ok: false, created: false, error: "メールアドレスが不正です" };
  if (!dbConfigured) return { ok: false, created: false, error: "DB未設定" };
  try {
    const existing = await getAccountByEmail(e);
    if (existing) return { ok: true, created: false };
    const sb = engerAdmin();
    const { error } = await sb.from("app_users").insert({
      email: e,
      name: opts.name ?? null,
      role: opts.role ?? "client",
      status: "pending",
      company_name: opts.companyName ?? null,
    });
    if (error) return { ok: false, created: false, error: error.message };
    // 管理者へアプリ内通知（#15：登録申請時に通知が来ない問題への対応）。best-effort。
    try {
      const who = opts.companyName ? `${opts.companyName}（${e}）` : (opts.name ? `${opts.name}（${e}）` : e);
      await sb.from("notifications").insert({
        recipient: "all",
        title: "新規アカウント登録申請",
        body: `${who} が登録申請しました。設定 → アカウント・権限管理で承認してください。`,
        kind: "info",
      });
    } catch { /* notifications 未整備でも登録は成功 */ }
    return { ok: true, created: true };
  } catch (err: any) { return { ok: false, created: false, error: String(err?.message ?? err) }; }
}

/** ログイン中ユーザーのアクセス情報（role/status/会社名/名前）。未ログインや未設定は null。 */
export async function currentAccess(): Promise<{ role: Role; rawRole: Role; status: AccountStatus; companyName: string | null; name: string | null; position: SalesPosition; functions: string[]; meetingDone: boolean; department: string | null; teamRole: string | null; isTimecardUser: boolean; email: string } | null> {
  if (!authConfigured) return { role: "admin", rawRole: "admin", status: "active", companyName: null, name: null, position: null, functions: [], meetingDone: true, department: null, teamRole: null, isTimecardUser: true, email: "" };
  try {
    const email = await getSessionEmail(); // cache() でリクエスト内1回に集約
    if (!email) return null;
    const access = await resolveAccess(email);
    if (!access) return null;
    return { ...access, email };
  } catch { return null; }
}

/** 指定部署に所属するメンバーの氏名一覧（日報の閲覧範囲の算出に使用）。 */
export async function listDepartmentMemberNames(department: string): Promise<string[]> {
  if (!department || !dbConfigured) return [];
  try {
    const sb = engerAdmin();
    const { data, error } = await sb.from("app_users").select("name").eq("department", department).not("name", "is", null);
    if (error || !data) return [];
    return Array.from(new Set(data.map((r: any) => r.name).filter(Boolean)));
  } catch { return []; }
}

/** あるアカウントに紐づく送信メール履歴＋打合せ予定/実績を取得（承認画面用）。 */
export async function listAccountActivity(accountId: string): Promise<{ emails: any[]; meetings: any[] }> {
  if (!accountId || !dbConfigured) return { emails: [], meetings: [] };
  try {
    const sb = engerAdmin();
    const [em, mt] = await Promise.all([
      sb.from("account_emails").select("id, template, subject, body, actor_email, actor_name, status, created_at").eq("account_id", accountId).order("created_at", { ascending: false }).limit(50),
      sb.from("meetings").select("id, title, meeting_date, our_owner, new_or_existing, account_email, fb_sentiment, ai_summary, created_at").eq("account_id", accountId).order("meeting_date", { ascending: false }).limit(20),
    ]);
    return { emails: em.error ? [] : (em.data ?? []), meetings: mt.error ? [] : (mt.data ?? []) };
  } catch { return { emails: [], meetings: [] }; }
}

/** 承認待ち一覧（管理者用）。 */
export async function listAccounts(): Promise<Account[]> {
  if (!dbConfigured) return [];
  try {
    const sb = engerAdmin();
    const { data, error } = await sb.from("app_users").select("*").order("created_at", { ascending: false });
    if (error || !data) return [];
    return data as Account[];
  } catch { return []; }
}

/** LP(enger.jp)からGoogle等で登録されたが、まだ app_users に無い人材を「承認待ちの人材」として返す。
 *   enger.jp 側は public.profiles に保存し、app_users には書き込まないため、
 *   承認画面の人材タブに出ない問題を仮想エントリで解消する。
 *   承認時に app_users へ昇格させる（approveProfileAsCandidate）。 */
export async function listLpPendingCandidates(): Promise<Account[]> {
  if (!dbConfigured) return [];
  try {
    const sb = engerAdmin();
    const pub = publicAdmin();
    const sel = "id, display_name, email, name, phone, contact_line, signup_source, signup_method, source, created_at, role";
    // 先に profiles を取得（候補は最大500件）。app_users 全件取得を避け、
    // 候補の email だけで .in() 存在チェックに切り替える（50000件取得→数十件 in クエリ）。
    let r: any = await pub.from("profiles").select(sel)
      .or("github_id.not.is.null,github_login.not.is.null,display_name.not.is.null,role.eq.student,email.not.is.null")
      .order("created_at", { ascending: false }).limit(500);
    if (r.error) {
      r = await pub.from("profiles").select("id, display_name, email, name, signup_source, signup_method, created_at, role")
        .or("github_id.not.is.null,github_login.not.is.null,display_name.not.is.null,role.eq.student,email.not.is.null")
        .order("created_at", { ascending: false }).limit(500);
    }
    if (r.error || !r.data) return [];
    const candidateEmails = Array.from(new Set(
      (r.data as any[]).map((p) => String(p.email ?? "").toLowerCase()).filter(Boolean)
    ));
    let existingEmails = new Set<string>();
    if (candidateEmails.length > 0) {
      // 大文字混じり保存（例：Keiei@gw...）で .in() が取りこぼさないよう、
      // ilike("email", ...) を OR 連結して候補メールごとに突合する。
      const orExpr = candidateEmails.map((e) => `email.ilike.${e.replace(/,/g, "")}`).join(",");
      const ex: any = await sb.from("app_users").select("email").or(orExpr);
      if (!ex.error) existingEmails = new Set<string>((ex.data ?? []).map((r: any) => String(r.email ?? "").toLowerCase().trim()).filter(Boolean));
      else {
        // フォールバック：.in() 単発
        const ex2: any = await sb.from("app_users").select("email").in("email", candidateEmails);
        if (!ex2.error) existingEmails = new Set<string>((ex2.data ?? []).map((r: any) => String(r.email ?? "").toLowerCase().trim()).filter(Boolean));
      }
    }
    const accounts: Account[] = [];
    const profileEmails = new Set<string>();
    for (const p of r.data as any[]) {
      const em = String(p.email ?? "").toLowerCase();
      if (!em || existingEmails.has(em)) continue;
      if (isExcludedProfile(p)) continue; // 外部システム由来（LMS 等）は承認待ちから除外
      profileEmails.add(em);
      // signup_source の解決：保存値 → メールドメイン推定 → role/ヒューリスティック
      const ss = resolveSignupSource(p?.signup_source, em, { role: p?.role });
      const sm = normalizeSignupMethod(p?.signup_method);
      accounts.push({
        id: `profile:${p.id}`,
        email: em,
        name: p.display_name ?? p.name ?? null,
        role: "candidate" as Role,
        status: "pending" as AccountStatus,
        company_name: null,
        position: null,
        functions: null,
        note: [p.phone ? `📞 ${p.phone}` : "", p.contact_line ? `💬 ${p.contact_line}` : ""].filter(Boolean).join(" / ") || null,
        signup_source: ss,
        signup_method: sm,
        created_at: p.created_at ?? new Date().toISOString(),
        approved_at: null,
      } as Account);
    }
    // フォールバック: auth.users に居るが profiles にも app_users にも無い人（enger.jp 側で profiles を作っていない場合）
    //   → こちらも「LP登録 (Auth)」として承認待ち人材に拾う
    //   ★重要：先の existingEmails は「profiles の email を app_users と突合」しただけなので、
    //     profiles に存在しないが app_users には居るユーザー（管理者を直接アカウント追加した
    //     ケース等）が拾い漏れて「未承認」扱いになる事故が起きていた。
    //     ここで全 app_users の email を取得して app_users 既存判定に追加する。
    try {
      const allAu: any = await sb.from("app_users").select("email");
      if (!allAu.error && Array.isArray(allAu.data)) {
        for (const r of allAu.data) {
          const e = String(r.email ?? "").toLowerCase().trim();
          if (e) existingEmails.add(e);
        }
      }
    } catch { /* app_users 全取得失敗時は profiles 由来のみで判定（最悪でも従来通り） */ }
    try {
      const aa = authAdmin();
      for (let page = 1; page <= 5; page++) {
        const { data, error } = await aa.auth.admin.listUsers({ page, perPage: 1000 });
        if (error || !data) break;
        for (const u of data.users) {
          const em = String(u.email ?? "").toLowerCase();
          if (!em || existingEmails.has(em) || profileEmails.has(em)) continue;
          const prov = (u.app_metadata as any)?.provider ?? "email";
          const meta: any = u.user_metadata ?? {};
          const appMeta: any = u.app_metadata ?? {};
          // 外部システム由来（LMS 等）は承認待ちから除外。auth metadata の app/signup_source/source を見る。
          if (isExcludedProfile({ signup_source: meta.signup_source, source: meta.source, app: meta.app ?? appMeta.app })) continue;
          const name = (meta.full_name as string) || (meta.name as string) || null;
          // signup_source は user_metadata に保存されていれば最優先、無ければメールドメインで推定
          const metaSource = (meta.signup_source as string) || null;
          const ss = resolveSignupSource(metaSource, em, {});
          accounts.push({
            id: `auth:${u.id}`,
            email: em,
            name,
            role: "candidate" as Role,
            status: "pending" as AccountStatus,
            company_name: null,
            position: null,
            functions: null,
            note: "profiles未作成（auth.users のみ）",
            signup_source: ss,
            signup_method: normalizeSignupMethod(prov),
            created_at: u.created_at ?? new Date().toISOString(),
            approved_at: null,
          } as Account);
        }
        if (data.users.length < 1000) break;
      }
    } catch { /* authAdmin 未設定環境はスキップ */ }
    return accounts;
  } catch { return []; }
}
