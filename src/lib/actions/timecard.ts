"use server";

// ────────────────────────────────────────────────────────
// タイムカード（社内バイト/副業向け）
// ────────────────────────────────────────────────────────
//   ・月締めで申請（status: open → submitted）
//   ・マネージャー（自部署のみ）/ admin が承認・差し戻し
//
//   セキュリティ：操作は currentAccess() で本人 or 承認権を確認。
//   本人 = 自分の email、または admin/経営。承認 = admin/経営 または team_role が manager/leader で
//   かつエントリの department と自分の department が一致する場合。

import { revalidatePath } from "next/cache";
import { engerAdmin } from "../supabase";
import { currentAccess } from "../accounts";

type TimecardActionResult = { ok: true } | { ok: false; error: string };

async function timecardMe() {
  const me = await currentAccess();
  if (!me?.email) return null;
  return me;
}

function canApprove(me: { role: string; teamRole: string | null; department: string | null }, entryDept: string | null): boolean {
  if (me.role === "admin") return true;
  const isLead = me.teamRole === "manager" || me.teamRole === "leader";
  if (!isLead) return false;
  if (!me.department) return false;
  // department が空のエントリは「部署未設定の人」。マネージャーは触れない（adminのみ）。
  if (!entryDept) return false;
  return me.department === entryDept;
}

/** 本人または管理者がエントリを upsert（編集モーダルから）。 */
export async function upsertTimeEntry(input: {
  userEmail: string;          // 対象ユーザー（通常は本人）
  workDate: string;            // YYYY-MM-DD
  plannedStart?: string | null;
  plannedEnd?: string | null;
  actualStart?: string | null;
  actualEnd?: string | null;
  breakMinutes?: number | null;
  note?: string | null;
  /** シフト外で働いた理由。承認済シフトと実績が異なるときに必要。 */
  deviationReason?: string | null;
}): Promise<TimecardActionResult> {
  let admin: ReturnType<typeof engerAdmin>;
  try { admin = engerAdmin(); } catch { return { ok: false, error: "サーバ設定エラー：SUPABASE_SERVICE_ROLE_KEY が未設定です" }; }
  const me = await timecardMe();
  if (!me) return { ok: false, error: "未ログインです" };
  const isSelf = me.email.toLowerCase() === input.userEmail.toLowerCase();
  const isAdmin = me.role === "admin";
  if (!isSelf && !isAdmin) return { ok: false, error: "他のメンバーのタイムカードを編集する権限がありません" };
  if (!/^\d{4}-\d{2}-\d{2}$/.test(input.workDate)) return { ok: false, error: "日付の形式が不正です" };

  // 既存行を取得（status / shift_status と user_name/department のキャッシュ更新のため）
  const existing: any = await admin.from("time_entries").select("id, status, shift_status, user_name, department")
    .eq("user_email", input.userEmail).eq("work_date", input.workDate).maybeSingle();
  // 予定（シフト）の編集制限：月締が申請中/承認済、またはシフトが申請中/承認済のときは本人ロック（admin のみ可）。
  //   ※ 実績（出退勤・休憩・メモ・シフト外理由）は申請中/承認済でも本人が編集できる（要望対応）。
  //     シフト承認後に実績を記録できないと運用できないため、実績は status に関わらず編集可とする。
  const monthLocked = !isAdmin && (existing.data?.status === "submitted" || existing.data?.status === "approved");

  // department は app_users から引く（初回作成時のキャッシュ）。失敗してもエントリ作成は続行。
  let department: string | null = existing.data?.department ?? null;
  let userName: string | null = existing.data?.user_name ?? null;
  if (!department || !userName) {
    try {
      const u: any = await admin.from("app_users").select("name, department").eq("email", input.userEmail).maybeSingle();
      if (!u.error && u.data) { department = department ?? (u.data.department ?? null); userName = userName ?? (u.data.name ?? null); }
    } catch { /* ignore */ }
  }

  const row: Record<string, any> = {
    user_email: input.userEmail,
    user_name: userName,
    department,
    work_date: input.workDate,
    updated_at: new Date().toISOString(),
  };
  // シフト（予定）：申請中/承認済（シフト or 月締）のときは本人は予定を変更できない（admin のみ）。
  const shiftStatus = existing.data?.shift_status as string | null | undefined;
  const shiftLocked = !isAdmin && (shiftStatus === "submitted" || shiftStatus === "approved");
  if ((shiftLocked || monthLocked) && (input.plannedStart !== undefined || input.plannedEnd !== undefined)) {
    return { ok: false, error: "申請中・承認済のシフト（予定）は本人では編集できません（管理者に差戻しを依頼してください）" };
  }

  if (input.plannedStart !== undefined) row.planned_start = input.plannedStart || null;
  if (input.plannedEnd   !== undefined) row.planned_end   = input.plannedEnd   || null;
  if (input.actualStart  !== undefined) row.actual_start  = input.actualStart  || null;
  if (input.actualEnd    !== undefined) row.actual_end    = input.actualEnd    || null;
  if (input.breakMinutes !== undefined) row.break_minutes = Math.max(0, Math.floor(Number(input.breakMinutes) || 0));
  if (input.note         !== undefined) row.note          = (input.note ?? "").trim() || null;
  // シフト外で働いた理由（任意項目）。空文字は null として保存。
  if (input.deviationReason !== undefined) row.deviation_reason = (input.deviationReason ?? "").trim() || null;

  // rejected の行を編集したら open に戻す（再申請できるように）
  if (existing.data?.status === "rejected" && !isAdmin) row.status = "open";
  // 差し戻されたシフトを編集したら open に戻す
  if (shiftStatus === "rejected" && !isAdmin && (input.plannedStart !== undefined || input.plannedEnd !== undefined)) {
    row.shift_status = "open";
    row.shift_reject_reason = null;
  }

  let r: any = await admin.from("time_entries").upsert(row, { onConflict: "user_email,work_date" });
  // 旧スキーマ（shift_status / deviation_reason 列無し）は列ドロップで再試行
  if (r.error && /shift_status|deviation_reason|column/i.test(r.error.message)) {
    const { shift_status: _s, shift_reject_reason: _r, deviation_reason: _d, ...rest } = row;
    r = await admin.from("time_entries").upsert(rest, { onConflict: "user_email,work_date" });
  }
  if (r.error) return { ok: false, error: r.error.message };
  revalidatePath("/timecard");
  return { ok: true };
}

/** 出勤打刻（actual_start を今に）。同日に既にあれば上書きしない（上書きしたいときは編集モーダルから）。 */
export async function clockIn(userEmail?: string): Promise<TimecardActionResult> {
  let admin: ReturnType<typeof engerAdmin>;
  try { admin = engerAdmin(); } catch { return { ok: false, error: "サーバ設定エラー：SUPABASE_SERVICE_ROLE_KEY が未設定です" }; }
  const me = await timecardMe();
  if (!me) return { ok: false, error: "未ログインです" };
  const target = (userEmail || me.email).toLowerCase();
  if (target !== me.email.toLowerCase() && me.role !== "admin") return { ok: false, error: "本人のみが打刻できます" };

  const now = new Date();
  const workDate = now.toLocaleDateString("sv-SE", { timeZone: "Asia/Tokyo" });
  const iso = now.toISOString();

  let existing: any = await admin.from("time_entries").select("id, actual_start, status, planned_start, planned_end, shift_status")
    .eq("user_email", target).eq("work_date", workDate).maybeSingle();
  // shift_status / planned 列が無い旧環境では従来通り（シフト申請チェックはスキップ）。
  let shiftCols = true;
  if (existing.error && /shift_status|planned_start|planned_end|column/i.test(existing.error.message ?? "")) {
    shiftCols = false;
    existing = await admin.from("time_entries").select("id, actual_start, status").eq("user_email", target).eq("work_date", workDate).maybeSingle();
  }

  // シフト申請ガード：本日のシフトが申請済（submitted/approved）で予定が入っていることを必須にする。
  //   ・未申請でタイムカードを押した場合はアラート（打刻不可）。
  //   ・シフト開始の30分以上前は打刻不可（例：7:00開始は6:30以降のみ。6:25はアラート）。
  if (shiftCols) {
    const plannedStart: string | null = existing.data?.planned_start ?? null;
    const shiftStatus: string | null = existing.data?.shift_status ?? null;
    const applied = !!plannedStart && (shiftStatus === "submitted" || shiftStatus === "approved");
    if (!applied) {
      return { ok: false, error: "本日のシフトが申請されていません。先に「シフト申請」から本日のシフトを申請・承認してから打刻してください。" };
    }
    const psMs = new Date(plannedStart).getTime();
    if (isFinite(psMs)) {
      const earlyMin = (psMs - now.getTime()) / 60000;
      if (earlyMin > 30) {
        const hm = new Date(plannedStart).toLocaleTimeString("ja-JP", { timeZone: "Asia/Tokyo", hour: "2-digit", minute: "2-digit", hour12: false });
        return { ok: false, error: `シフト開始（${hm}）の30分以上前は打刻できません。開始時刻の30分前以降に打刻してください。` };
      }
    }
  }

  if (existing.data) {
    if (existing.data.actual_start) return { ok: false, error: "本日はすでに出勤打刻済みです" };
    const r: any = await admin.from("time_entries").update({ actual_start: iso, updated_at: iso }).eq("id", existing.data.id);
    if (r.error) return { ok: false, error: r.error.message };
  } else {
    // department/user_name を引いてキャッシュ
    let department: string | null = null, userName: string | null = null;
    try {
      const u: any = await admin.from("app_users").select("name, department").eq("email", target).maybeSingle();
      if (!u.error && u.data) { department = u.data.department ?? null; userName = u.data.name ?? null; }
    } catch { /* ignore */ }
    const r: any = await admin.from("time_entries").insert({
      user_email: target, user_name: userName, department,
      work_date: workDate, actual_start: iso, created_at: iso, updated_at: iso,
    });
    if (r.error) return { ok: false, error: r.error.message };
  }
  revalidatePath("/timecard");
  return { ok: true };
}

/** 退勤打刻。 */
export async function clockOut(userEmail?: string): Promise<TimecardActionResult> {
  let admin: ReturnType<typeof engerAdmin>;
  try { admin = engerAdmin(); } catch { return { ok: false, error: "サーバ設定エラー：SUPABASE_SERVICE_ROLE_KEY が未設定です" }; }
  const me = await timecardMe();
  if (!me) return { ok: false, error: "未ログインです" };
  const target = (userEmail || me.email).toLowerCase();
  if (target !== me.email.toLowerCase() && me.role !== "admin") return { ok: false, error: "本人のみが打刻できます" };

  const now = new Date();
  const workDate = now.toLocaleDateString("sv-SE", { timeZone: "Asia/Tokyo" });
  const iso = now.toISOString();
  const existing: any = await admin.from("time_entries").select("id, actual_start, actual_end")
    .eq("user_email", target).eq("work_date", workDate).maybeSingle();
  if (!existing.data || !existing.data.actual_start) return { ok: false, error: "先に出勤打刻してください" };
  if (existing.data.actual_end) return { ok: false, error: "本日はすでに退勤打刻済みです" };
  const r: any = await admin.from("time_entries").update({ actual_end: iso, updated_at: iso }).eq("id", existing.data.id);
  if (r.error) return { ok: false, error: r.error.message };
  revalidatePath("/timecard");
  return { ok: true };
}

/** 月締め申請：当月の open エントリをすべて submitted に。 */
export async function submitMonthForApproval(userEmail: string, ym: string): Promise<TimecardActionResult & { count?: number }> {
  let admin: ReturnType<typeof engerAdmin>;
  try { admin = engerAdmin(); } catch { return { ok: false, error: "サーバ設定エラー：SUPABASE_SERVICE_ROLE_KEY が未設定です" }; }
  const me = await timecardMe();
  if (!me) return { ok: false, error: "未ログインです" };
  if (me.email.toLowerCase() !== userEmail.toLowerCase() && me.role !== "admin") return { ok: false, error: "本人のみが申請できます" };
  if (!/^\d{4}-\d{2}$/.test(ym)) return { ok: false, error: "対象月の形式が不正です" };

  const [y, m] = ym.split("-").map(Number);
  const start = `${y}-${String(m).padStart(2, "0")}-01`;
  const ny = m === 12 ? y + 1 : y, nm = m === 12 ? 1 : m + 1;
  const end = `${ny}-${String(nm).padStart(2, "0")}-01`;

  // シフト外で働いた日（承認済シフトと実績がずれている日）に deviation_reason が
  // 空のものがあれば、月締申請をブロックして本人に修正を促す。
  // shift_status / deviation_reason 列が未マイグレ環境ではチェックをスキップ。
  try {
    const monthRows: any = await admin.from("time_entries")
      .select("work_date, shift_status, planned_start, planned_end, actual_start, actual_end, deviation_reason")
      .eq("user_email", userEmail).gte("work_date", start).lt("work_date", end);
    if (!monthRows.error) {
      const { deviatesFromShift } = await import("../timecard");
      const missing: string[] = [];
      for (const e of (monthRows.data ?? []) as any[]) {
        if (deviatesFromShift(e) && !(e.deviation_reason ?? "").trim()) missing.push(e.work_date);
      }
      if (missing.length > 0) {
        return { ok: false, error: `シフト外で働いた日に理由が未入力です（${missing.length}日）。先頭：${missing[0]}。各日の編集画面で「シフト外で働いた理由」を入力してください。` };
      }
    }
  } catch { /* 列未追加環境では握りつぶす */ }

  const r: any = await admin.from("time_entries").update({ status: "submitted", updated_at: new Date().toISOString() })
    .eq("user_email", userEmail).gte("work_date", start).lt("work_date", end).in("status", ["open", "rejected"]).select("id");
  if (r.error) return { ok: false, error: r.error.message };
  revalidatePath("/timecard");
  return { ok: true, count: (r.data ?? []).length };
}

/** 承認（マネージャー/admin が submitted のエントリを approved に）。複数IDをまとめて。 */
export async function approveTimeEntries(ids: string[]): Promise<TimecardActionResult & { count?: number }> {
  let admin: ReturnType<typeof engerAdmin>;
  try { admin = engerAdmin(); } catch { return { ok: false, error: "サーバ設定エラー：SUPABASE_SERVICE_ROLE_KEY が未設定です" }; }
  const me = await timecardMe();
  if (!me) return { ok: false, error: "未ログインです" };
  if (!ids.length) return { ok: true, count: 0 };

  // 取得して権限チェック（自部署のみ）。
  const list: any = await admin.from("time_entries").select("id, department, status").in("id", ids);
  if (list.error) return { ok: false, error: list.error.message };
  const targets: string[] = [];
  for (const row of (list.data ?? []) as any[]) {
    if (row.status !== "submitted") continue;
    if (!canApprove(me as any, row.department ?? null)) continue;
    targets.push(row.id);
  }
  if (!targets.length) return { ok: false, error: "承認可能な対象がありません（権限・状態を確認）" };
  const r: any = await admin.from("time_entries").update({
    status: "approved", approver_email: me.email, approver_name: me.name ?? null,
    approved_at: new Date().toISOString(), reject_reason: null, updated_at: new Date().toISOString(),
  }).in("id", targets);
  if (r.error) return { ok: false, error: r.error.message };
  revalidatePath("/timecard");
  return { ok: true, count: targets.length };
}

/** 差し戻し。reason 必須。 */
export async function rejectTimeEntries(ids: string[], reason: string): Promise<TimecardActionResult & { count?: number }> {
  let admin: ReturnType<typeof engerAdmin>;
  try { admin = engerAdmin(); } catch { return { ok: false, error: "サーバ設定エラー：SUPABASE_SERVICE_ROLE_KEY が未設定です" }; }
  const me = await timecardMe();
  if (!me) return { ok: false, error: "未ログインです" };
  if (!ids.length) return { ok: true, count: 0 };
  const r0 = (reason ?? "").trim();
  if (!r0) return { ok: false, error: "差し戻し理由を入力してください" };

  const list: any = await admin.from("time_entries").select("id, department, status").in("id", ids);
  if (list.error) return { ok: false, error: list.error.message };
  const targets: string[] = [];
  for (const row of (list.data ?? []) as any[]) {
    if (row.status !== "submitted") continue;
    if (!canApprove(me as any, row.department ?? null)) continue;
    targets.push(row.id);
  }
  if (!targets.length) return { ok: false, error: "差し戻し可能な対象がありません" };
  const r: any = await admin.from("time_entries").update({
    status: "rejected", approver_email: me.email, approver_name: me.name ?? null,
    approved_at: null, reject_reason: r0, updated_at: new Date().toISOString(),
  }).in("id", targets);
  if (r.error) return { ok: false, error: r.error.message };
  revalidatePath("/timecard");
  return { ok: true, count: targets.length };
}

// ── シフト申請（予定）の承認フロー ───────────────────────────────
//   1) 本人がシフト申請タブで planned_start/end を入力
//   2) submitShiftForApproval で当月の予定だけある行を shift_status='submitted' に
//   3) approveShifts / rejectShifts でマネージャー/admin が承認・差戻し

/** 当月のシフト（予定）を一括で申請する。planned_start/end が入っている行のみ対象。 */
export async function submitShiftForApproval(userEmail: string, ym: string): Promise<TimecardActionResult & { count?: number }> {
  let admin: ReturnType<typeof engerAdmin>;
  try { admin = engerAdmin(); } catch { return { ok: false, error: "サーバ設定エラー：SUPABASE_SERVICE_ROLE_KEY が未設定です" }; }
  const me = await timecardMe();
  if (!me) return { ok: false, error: "未ログインです" };
  if (me.email.toLowerCase() !== userEmail.toLowerCase() && me.role !== "admin") return { ok: false, error: "本人のみが申請できます" };
  if (!/^\d{4}-\d{2}$/.test(ym)) return { ok: false, error: "対象月の形式が不正です" };

  const [y, m] = ym.split("-").map(Number);
  const start = `${y}-${String(m).padStart(2, "0")}-01`;
  const ny = m === 12 ? y + 1 : y, nm = m === 12 ? 1 : m + 1;
  const end = `${ny}-${String(nm).padStart(2, "0")}-01`;
  const now = new Date().toISOString();
  // open/rejected かつ planned 両方そろっている日を submitted へ。
  let r: any = await admin.from("time_entries").update({
    shift_status: "submitted", shift_submitted_at: now, shift_reject_reason: null, updated_at: now,
  })
    .eq("user_email", userEmail).gte("work_date", start).lt("work_date", end)
    .in("shift_status", ["open", "rejected"])
    .not("planned_start", "is", null).not("planned_end", "is", null)
    .select("id");
  if (r.error && /shift_status|shift_submitted_at|column/i.test(r.error.message)) {
    return { ok: false, error: "シフト申請の列が未追加です。supabase/timecard-shift.sql を実行してください。" };
  }
  if (r.error) return { ok: false, error: r.error.message };
  revalidatePath("/timecard");
  return { ok: true, count: (r.data ?? []).length };
}

/** シフト申請の承認（マネージャー/admin）。 */
export async function approveShifts(ids: string[]): Promise<TimecardActionResult & { count?: number }> {
  let admin: ReturnType<typeof engerAdmin>;
  try { admin = engerAdmin(); } catch { return { ok: false, error: "サーバ設定エラー：SUPABASE_SERVICE_ROLE_KEY が未設定です" }; }
  const me = await timecardMe();
  if (!me) return { ok: false, error: "未ログインです" };
  if (!ids.length) return { ok: true, count: 0 };
  const list: any = await admin.from("time_entries").select("id, department, shift_status").in("id", ids);
  if (list.error) return { ok: false, error: list.error.message };
  const targets: string[] = [];
  for (const row of (list.data ?? []) as any[]) {
    if (row.shift_status !== "submitted") continue;
    if (!canApprove(me as any, row.department ?? null)) continue;
    targets.push(row.id);
  }
  if (!targets.length) return { ok: false, error: "承認可能なシフトがありません（権限・状態を確認）" };
  const now = new Date().toISOString();
  const r: any = await admin.from("time_entries").update({
    shift_status: "approved", shift_approved_at: now,
    shift_approver_email: me.email, shift_approver_name: me.name ?? null,
    shift_reject_reason: null, updated_at: now,
  }).in("id", targets);
  if (r.error) return { ok: false, error: r.error.message };
  revalidatePath("/timecard");
  return { ok: true, count: targets.length };
}

/** シフトを差し戻し。 */
export async function rejectShifts(ids: string[], reason: string): Promise<TimecardActionResult & { count?: number }> {
  let admin: ReturnType<typeof engerAdmin>;
  try { admin = engerAdmin(); } catch { return { ok: false, error: "サーバ設定エラー：SUPABASE_SERVICE_ROLE_KEY が未設定です" }; }
  const me = await timecardMe();
  if (!me) return { ok: false, error: "未ログインです" };
  if (!ids.length) return { ok: true, count: 0 };
  const r0 = (reason ?? "").trim();
  if (!r0) return { ok: false, error: "差戻し理由を入力してください" };

  const list: any = await admin.from("time_entries").select("id, department, shift_status").in("id", ids);
  if (list.error) return { ok: false, error: list.error.message };
  const targets: string[] = [];
  for (const row of (list.data ?? []) as any[]) {
    if (row.shift_status !== "submitted") continue;
    if (!canApprove(me as any, row.department ?? null)) continue;
    targets.push(row.id);
  }
  if (!targets.length) return { ok: false, error: "差戻し可能なシフトがありません" };
  const now = new Date().toISOString();
  const r: any = await admin.from("time_entries").update({
    shift_status: "rejected", shift_reject_reason: r0,
    shift_approver_email: me.email, shift_approver_name: me.name ?? null,
    shift_approved_at: null, updated_at: now,
  }).in("id", targets);
  if (r.error) return { ok: false, error: r.error.message };
  revalidatePath("/timecard");
  return { ok: true, count: targets.length };
}

/** タイムカード対象ユーザーの ON/OFF を切り替え（設定画面・admin限定）。 */
export async function setTimecardEnabled(email: string, enabled: boolean): Promise<TimecardActionResult> {
  let admin: ReturnType<typeof engerAdmin>;
  try { admin = engerAdmin(); } catch { return { ok: false, error: "サーバ設定エラー：SUPABASE_SERVICE_ROLE_KEY が未設定です" }; }
  const me = await timecardMe();
  if (!me || me.role !== "admin") return { ok: false, error: "管理者のみ変更できます" };
  const r: any = await admin.from("app_users").update({ is_timecard_user: enabled }).eq("email", email);
  if (r.error) return { ok: false, error: r.error.message };
  revalidatePath("/settings");
  return { ok: true };
}
