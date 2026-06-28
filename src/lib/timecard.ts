// タイムカード（社内バイト/副業向け）：型・取得・集計のヘルパー。
//   ・「働く予定」と「実績打刻」をカレンダーで突き合わせ、月単位で集計
//   ・月締め申請（submitted）→ マネージャー承認（approved）のシンプルな2段階
//   ・タイムゾーンは Asia/Tokyo を前提に work_date を扱う

import { engerAdmin, engerClient, dbConfigured } from "./supabase";

export type TimecardStatus = "open" | "submitted" | "approved" | "rejected";

export type ShiftStatus = "open" | "submitted" | "approved" | "rejected";

export type TimeEntry = {
  id: string;
  user_email: string;
  user_name: string | null;
  department: string | null;
  work_date: string;                  // YYYY-MM-DD
  planned_start: string | null;       // ISO
  planned_end: string | null;
  actual_start: string | null;
  actual_end: string | null;
  break_minutes: number;
  note: string | null;
  status: TimecardStatus;
  approver_email: string | null;
  approver_name: string | null;
  approved_at: string | null;
  reject_reason: string | null;
  // シフト申請（予定）の承認フロー。timecard-shift.sql 未実行の環境では null/undefined。
  shift_status?: ShiftStatus | null;
  shift_submitted_at?: string | null;
  shift_approved_at?: string | null;
  shift_approver_email?: string | null;
  shift_approver_name?: string | null;
  shift_reject_reason?: string | null;
  deviation_reason?: string | null;   // シフト外で働いた理由
};

/** 実績が承認済シフトから外れているかの判定。
 *   shift_status='approved' のときだけ判定対象。planned が無い or 実績が無い場合は false。
 *   許容しきい値（分）以内のずれは「シフト通り」と見なす（既定±10分）。 */
export function deviatesFromShift(e: Pick<TimeEntry,
  "shift_status" | "planned_start" | "planned_end" | "actual_start" | "actual_end">,
  toleranceMin = 10): boolean {
  if (e.shift_status !== "approved") return false;
  if (!e.planned_start || !e.planned_end) return false;
  if (!e.actual_start && !e.actual_end) return false;
  const ps = new Date(e.planned_start).getTime();
  const pe = new Date(e.planned_end).getTime();
  const as = e.actual_start ? new Date(e.actual_start).getTime() : ps;
  const ae = e.actual_end ? new Date(e.actual_end).getTime() : pe;
  const tol = toleranceMin * 60_000;
  return Math.abs(as - ps) > tol || Math.abs(ae - pe) > tol;
}

export type MonthSummary = {
  days: number;                       // 実績がある日数
  laborMinutes: number;               // 実労働時間（合計・分）
  plannedMinutes: number;             // 予定の合計（分）
  pendingApproval: number;            // submitted の数
  approved: number;                   // approved の数
  rejected: number;                   // rejected の数
};

const TZ = "Asia/Tokyo";

// ── 日付ユーティリティ（JSTで扱う） ─────────────────────────────
export function jstYmd(d: Date = new Date()): string {
  // toLocaleDateString("sv-SE", {timeZone}) は YYYY-MM-DD で安全
  return d.toLocaleDateString("sv-SE", { timeZone: TZ });
}

/** YYYY-MM 文字列から、その月の開始日(YYYY-MM-01)と翌月初日(YYYY-MM-01) を返す（半開区間）。 */
export function monthRange(ym: string): { start: string; end: string } {
  const [y, m] = ym.split("-").map(Number);
  const start = `${y}-${String(m).padStart(2, "0")}-01`;
  const nextY = m === 12 ? y + 1 : y;
  const nextM = m === 12 ? 1 : m + 1;
  const end = `${nextY}-${String(nextM).padStart(2, "0")}-01`;
  return { start, end };
}

/** 今月の YYYY-MM（JST） */
export function currentYm(): string {
  const ymd = jstYmd();
  return ymd.slice(0, 7);
}

/** 月の最終日(1..31)。 */
export function lastDayOf(ym: string): number {
  const [y, m] = ym.split("-").map(Number);
  return new Date(y, m, 0).getDate(); // m は1始まり、0日目=前月末
}

/** 当日打刻が必要な「YYYY-MM-DD」をクライアント現在時刻(JST)から作る。 */
export function todayJst(): string { return jstYmd(); }

/** 実打刻の拘束時間（分・休憩を引く前）。シフトクランプなし。照合表示・端数判定用。 */
export function spanMinutes(startIso: string | null, endIso: string | null): number {
  if (!startIso || !endIso) return 0;
  const s = new Date(startIso).getTime(), t = new Date(endIso).getTime();
  if (!isFinite(s) || !isFinite(t) || t <= s) return 0;
  return Math.round((t - s) / 60000);
}

/** 実労働時間（分）を「開始・終了・休憩（分）」から算出（モーダルの即時計算と共通化）。
 *  ・(終了 − 開始 − 休憩) を分単位そのままで返す（実績と一致＝照合できるよう端数の丸めはしない）。
 *    ※ 以前は15分単位で切り捨てていたが「自動計算と実績が異なる」「短時間勤務が0になる」原因のため廃止。
 *  ・シフト申請（planned_start/end）が両方ある日は「申請したシフト時間内」にクランプする
 *    （早出 max(実打刻,シフト開始) / 残業 min(実打刻,シフト終了)）。シフトが無ければ実打刻そのまま。 */
export function laborMinutesFrom(
  startIso: string | null, endIso: string | null, breakMin: number,
  plannedStartIso?: string | null, plannedEndIso?: string | null,
): number {
  if (!startIso || !endIso) return 0;
  let s = new Date(startIso).getTime();
  let t = new Date(endIso).getTime();
  if (!isFinite(s) || !isFinite(t) || t <= s) return 0;
  const ps = plannedStartIso ? new Date(plannedStartIso).getTime() : null;
  const pe = plannedEndIso ? new Date(plannedEndIso).getTime() : null;
  if (ps != null && pe != null && isFinite(ps) && isFinite(pe) && pe > ps) {
    s = Math.max(s, ps);
    t = Math.min(t, pe);
    if (t <= s) return 0;
  }
  const raw = Math.round((t - s) / 60000) - Math.max(0, breakMin ?? 0);
  return raw > 0 ? raw : 0;
}

/** 実労働時間（分）。actual_start/end が両方あるときだけ計算、無効値は 0。break_minutes を引く。 */
export function laborMinutesOf(e: { actual_start: string | null; actual_end: string | null; break_minutes: number; planned_start?: string | null; planned_end?: string | null }): number {
  return laborMinutesFrom(e.actual_start, e.actual_end, e.break_minutes ?? 0, e.planned_start, e.planned_end);
}

/** 予定時間（分）。 */
export function plannedMinutesOf(e: { planned_start: string | null; planned_end: string | null }): number {
  if (!e.planned_start || !e.planned_end) return 0;
  const s = new Date(e.planned_start).getTime();
  const t = new Date(e.planned_end).getTime();
  if (!isFinite(s) || !isFinite(t) || t <= s) return 0;
  return Math.round((t - s) / 60000);
}

/** 月の集計。 */
export function summarizeMonth(entries: TimeEntry[]): MonthSummary {
  let laborMinutes = 0, plannedMinutes = 0, days = 0;
  let pendingApproval = 0, approved = 0, rejected = 0;
  for (const e of entries) {
    const labor = laborMinutesOf(e);
    if (labor > 0) days++;
    laborMinutes += labor;
    plannedMinutes += plannedMinutesOf(e);
    if (e.status === "submitted") pendingApproval++;
    if (e.status === "approved") approved++;
    if (e.status === "rejected") rejected++;
  }
  return { days, laborMinutes, plannedMinutes, pendingApproval, approved, rejected };
}

/** 「7:30」形式の表示。 */
export function fmtHm(min: number): string {
  if (!isFinite(min) || min <= 0) return "0:00";
  const h = Math.floor(min / 60), m = min % 60;
  return `${h}:${String(m).padStart(2, "0")}`;
}

/** 時刻部分のみ "HH:MM"（JST） */
export function fmtHmJst(iso: string | null): string {
  if (!iso) return "";
  const d = new Date(iso);
  return d.toLocaleTimeString("ja-JP", { timeZone: TZ, hour: "2-digit", minute: "2-digit", hour12: false });
}

// ── データ取得 ─────────────────────────────────────────────────

/** 指定ユーザーの指定月のエントリ。 */
export async function getMyMonth(userEmail: string, ym: string): Promise<TimeEntry[]> {
  if (!dbConfigured || !userEmail) return [];
  let sb: ReturnType<typeof engerClient>;
  try { sb = engerAdmin(); } catch { sb = engerClient(); }
  const { start, end } = monthRange(ym);
  const r: any = await sb.from("time_entries").select("*")
    .eq("user_email", userEmail).gte("work_date", start).lt("work_date", end)
    .order("work_date", { ascending: true });
  if (r.error) return [];
  return (r.data ?? []) as TimeEntry[];
}

/** シフト申請の承認待ち（マネージャー/admin 用）。部署で絞り込み可能。
 *   shift_status 列が未マイグレ環境では空配列を返す。 */
export async function getShiftApprovalQueue(opts: { department?: string | null } = {}): Promise<TimeEntry[]> {
  if (!dbConfigured) return [];
  let sb: ReturnType<typeof engerClient>;
  try { sb = engerAdmin(); } catch { sb = engerClient(); }
  let q: any = sb.from("time_entries").select("*").eq("shift_status", "submitted");
  if (opts.department) q = q.eq("department", opts.department);
  q = q.order("work_date", { ascending: true });
  const r: any = await q;
  if (r.error) return [];
  return (r.data ?? []) as TimeEntry[];
}

/** 承認待ち（マネージャー/admin 用）。部署を渡すとその部署に絞り込み、null/undefined で全件。 */
export async function getApprovalQueue(opts: { department?: string | null; ym?: string | null } = {}): Promise<TimeEntry[]> {
  if (!dbConfigured) return [];
  let sb: ReturnType<typeof engerClient>;
  try { sb = engerAdmin(); } catch { sb = engerClient(); }
  let q: any = sb.from("time_entries").select("*").eq("status", "submitted");
  if (opts.department) q = q.eq("department", opts.department);
  if (opts.ym) {
    const { start, end } = monthRange(opts.ym);
    q = q.gte("work_date", start).lt("work_date", end);
  }
  q = q.order("work_date", { ascending: true });
  const r: any = await q;
  if (r.error) return [];
  return (r.data ?? []) as TimeEntry[];
}

/** タイムカード対象ユーザーの一覧（管理者の概観用）。 */
export async function listTimecardUsers(): Promise<{ email: string; name: string | null; department: string | null }[]> {
  if (!dbConfigured) return [];
  try {
    const sb = engerAdmin();
    const r: any = await sb.from("app_users")
      .select("email, name, department, is_timecard_user")
      .eq("is_timecard_user", true).order("name");
    if (r.error) return [];
    return (r.data ?? []).map((u: any) => ({ email: u.email, name: u.name ?? null, department: u.department ?? null }));
  } catch { return []; }
}
