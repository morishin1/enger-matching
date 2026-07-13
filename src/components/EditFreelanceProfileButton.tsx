"use client";

// #367：フリーランス登録者詳細（DetailModal）の「プロフィールを編集」ボタン。
//   クリックで public.profiles の現在値を読み込んだ編集モーダルを開き、DX スタッフが
//   直接編集・保存できる（LP 側は profiles をライブ参照しているため保存＝即時反映）。
//   ・保存は updated_at 突合の楽観ロック。フリーランス本人が先に更新していたら保存を
//     拒否して再読込を促す（衝突時はフリーランス側優先）。
//   ・面談済み（agent_meeting_done_at）後は本人の LP 編集がロックされる。管理者
//     （viewerRole=admin）にはロック解除トグルを表示する。
import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { getFreelanceProfileForEdit, updateFreelanceProfile, setProfileEditUnlocked, type FreelanceProfileEdit } from "@/app/engineers/actions";

const fieldStyle: React.CSSProperties = { fontSize: 12.5, padding: "6px 8px", border: "1px solid var(--color-border-strong)", borderRadius: 8, background: "var(--color-surface)", fontFamily: "var(--font-sans)" };
const labelStyle: React.CSSProperties = { fontSize: 11, fontWeight: 600, color: "var(--color-ink-3)" };

function Field({ label, value, onChange, full, placeholder }: { label: string; value: string; onChange: (v: string) => void; full?: boolean; placeholder?: string }) {
  return (
    <label style={{ display: "flex", flexDirection: "column", gap: 4, gridColumn: full ? "1 / -1" : undefined }}>
      <span style={labelStyle}>{label}</span>
      <input type="text" value={value} placeholder={placeholder} onChange={(e) => onChange(e.target.value)} style={fieldStyle} />
    </label>
  );
}

function Select({ label, value, onChange, options }: { label: string; value: string; onChange: (v: string) => void; options: { value: string; label: string }[] }) {
  return (
    <label style={{ display: "flex", flexDirection: "column", gap: 4 }}>
      <span style={labelStyle}>{label}</span>
      <select value={value} onChange={(e) => onChange(e.target.value)} style={fieldStyle}>
        {options.map((o) => <option key={o.value} value={o.value}>{o.label}</option>)}
      </select>
    </label>
  );
}

// LP /api/profile/save と同じ選択肢（保存値互換）。
const WEEKLY_OPTS = [
  { value: "", label: "未設定" },
  { value: "1-2", label: "週1〜2日" },
  { value: "3-4", label: "週3〜4日" },
  { value: "5", label: "週5日" },
];
const REMOTE_OPTS = [
  { value: "", label: "未設定" },
  { value: "full_remote", label: "フルリモート希望" },
  { value: "hybrid", label: "一部リモート可" },
  { value: "onsite_ok", label: "出社可" },
];

type FormState = Record<string, string>;

export function EditFreelanceProfileButton({ engineerId, engineerName, viewerRole }: { engineerId: string; engineerName?: string | null; viewerRole?: string | null }) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [loading, setLoading] = useState(false);
  const [pending, start] = useTransition();
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);
  const [f, setF] = useState<FormState>({});
  const [expectedUpdatedAt, setExpectedUpdatedAt] = useState<string | null>(null);
  const [meetingDoneAt, setMeetingDoneAt] = useState<string | null>(null);
  const [editUnlocked, setEditUnlocked] = useState(false);
  const [lockBusy, setLockBusy] = useState(false);
  const set = (k: string) => (v: string) => setF((s) => ({ ...s, [k]: v }));
  const isAdmin = viewerRole === "admin";
  const locked = !!meetingDoneAt && !editUnlocked;

  const load = async () => {
    setLoading(true); setMsg(null);
    const res = await getFreelanceProfileForEdit(engineerId);
    setLoading(false);
    if (!res.ok || !res.profile) { setMsg({ ok: false, text: res.error || "読み込みに失敗しました" }); return; }
    const p = res.profile;
    setF({
      display_name: p.display_name ?? "",
      real_name_kanji: p.real_name_kanji ?? "",
      real_name_kana: p.real_name_kana ?? "",
      headline: p.headline ?? "",
      primary_language: p.primary_language ?? "",
      portfolio_url: p.portfolio_url ?? "",
      email: p.email ?? "",
      phone: p.phone ?? "",
      contact_line: p.contact_line ?? "",
      prefecture: p.prefecture ?? "",
      nearest_station: p.nearest_station ?? "",
      weekly_days: p.weekly_days ?? "",
      remote_pref: p.remote_pref ?? "",
      estimated_pay_low: p.estimated_pay_low != null ? String(p.estimated_pay_low) : "",
      estimated_pay_high: p.estimated_pay_high != null ? String(p.estimated_pay_high) : "",
    });
    setExpectedUpdatedAt(res.updated_at ?? null);
    setMeetingDoneAt(res.meeting_done_at ?? null);
    setEditUnlocked(!!res.edit_unlocked);
  };

  const openModal = () => { setOpen(true); void load(); };
  const close = () => { if (!pending && !lockBusy) { setOpen(false); setMsg(null); } };

  const submit = () => {
    setMsg(null);
    start(async () => {
      const fields: FreelanceProfileEdit = {
        display_name: f.display_name,
        real_name_kanji: f.real_name_kanji,
        real_name_kana: f.real_name_kana,
        headline: f.headline,
        primary_language: f.primary_language,
        portfolio_url: f.portfolio_url,
        email: f.email,
        phone: f.phone,
        contact_line: f.contact_line,
        prefecture: f.prefecture,
        nearest_station: f.nearest_station,
        weekly_days: f.weekly_days,
        remote_pref: f.remote_pref,
        estimated_pay_low: f.estimated_pay_low === "" ? null : Number(f.estimated_pay_low),
        estimated_pay_high: f.estimated_pay_high === "" ? null : Number(f.estimated_pay_high),
      };
      const res = await updateFreelanceProfile({ engineer_id: engineerId, expected_updated_at: expectedUpdatedAt, fields });
      if (res.ok) {
        setMsg({ ok: true, text: "保存しました（LP 側にも即時反映されます）" });
        router.refresh();
        // 続けて編集できるよう最新の updated_at を取り直す。
        void load();
      } else {
        setMsg({ ok: false, text: res.error || "保存に失敗しました" });
      }
    });
  };

  const toggleLock = async (next: boolean) => {
    setLockBusy(true); setMsg(null);
    const res = await setProfileEditUnlocked(engineerId, next);
    setLockBusy(false);
    if (res.ok) { setEditUnlocked(next); setMsg({ ok: true, text: next ? "本人編集ロックを解除しました" : "本人編集をロックしました" }); }
    else setMsg({ ok: false, text: res.error || "更新に失敗しました" });
  };

  return (
    <>
      <button type="button" className="btn btn-xs" onClick={openModal}
        style={{ display: "inline-flex", alignItems: "center", gap: 4, whiteSpace: "nowrap" }}>
        <span className="material-symbols-outlined" style={{ fontSize: 15, lineHeight: 1 }}>edit_note</span>
        プロフィールを編集
      </button>
      {open && (
        <div onClick={close} style={{ position: "fixed", inset: 0, background: "rgba(15,23,42,.45)", display: "grid", placeItems: "center", zIndex: 340, padding: 20 }}>
          <div onClick={(e) => e.stopPropagation()} className="card" style={{ width: "100%", maxWidth: 680, maxHeight: "88vh", overflowY: "auto", display: "flex", flexDirection: "column", gap: 12 }}>
            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
              <h3 style={{ margin: 0, fontSize: 16, fontWeight: 700 }}>プロフィールを編集{engineerName ? `（${engineerName}）` : ""}</h3>
              <button className="btn ghost btn-xs" onClick={close} disabled={pending || lockBusy}>閉じる</button>
            </div>
            <div className="muted" style={{ fontSize: 11.5 }}>
              ENGERフリーランス（LP）のプロフィール（public.profiles）を直接編集します。保存すると LP と DX の両方に即時反映されます。
              本人が先に更新していた場合は保存されません（フリーランス側優先）。
            </div>

            {/* #367②③：面談済み後の本人編集ロック状態と、管理者のみの解除トグル。 */}
            {meetingDoneAt && (
              <div style={{ display: "flex", alignItems: "center", gap: 10, flexWrap: "wrap", padding: "8px 12px", borderRadius: 8, border: `1px solid ${locked ? "#f0a29a" : "#a9d3b7"}`, background: locked ? "#fdf3f2" : "#f2faf5" }}>
                <span style={{ fontSize: 11.5, fontWeight: 700, padding: "2px 10px", borderRadius: 99, background: locked ? "#b42318" : "#067647", color: "#fff" }}>
                  {locked ? "本人編集ロック中" : "本人編集ロック解除中"}
                </span>
                <span className="muted" style={{ fontSize: 11.5 }}>
                  面談済みのため、フリーランス本人は LP でプロフィールを{locked ? "編集できません" : "編集できます（管理者が解除済み）"}。
                </span>
                {isAdmin ? (
                  <button type="button" className="btn ghost btn-xs" disabled={lockBusy} onClick={() => void toggleLock(locked)} style={{ marginLeft: "auto" }}>
                    {lockBusy ? "更新中…" : locked ? "🔓 ロックを解除" : "🔒 再ロック"}
                  </button>
                ) : (
                  <span className="muted" style={{ fontSize: 11, marginLeft: "auto" }}>解除は管理者のみ</span>
                )}
              </div>
            )}

            {loading ? (
              <div className="muted" style={{ fontSize: 13, padding: 20, textAlign: "center" }}>読み込み中…</div>
            ) : (
              <div style={{ display: "grid", gridTemplateColumns: "repeat(2, 1fr)", gap: 10 }}>
                <Field label="表示名" value={f.display_name ?? ""} onChange={set("display_name")} />
                <Field label="姓名（漢字）" value={f.real_name_kanji ?? ""} onChange={set("real_name_kanji")} />
                <Field label="姓名（フリガナ）" value={f.real_name_kana ?? ""} onChange={set("real_name_kana")} />
                <Field label="主要言語" value={f.primary_language ?? ""} onChange={set("primary_language")} />
                <Field label="ひとことヘッドライン" value={f.headline ?? ""} onChange={set("headline")} full />
                <Field label="連絡先メール" value={f.email ?? ""} onChange={set("email")} />
                <Field label="電話番号" value={f.phone ?? ""} onChange={set("phone")} />
                <Field label="LINE ID" value={f.contact_line ?? ""} onChange={set("contact_line")} />
                <Field label="ポートフォリオURL" value={f.portfolio_url ?? ""} onChange={set("portfolio_url")} />
                <Field label="都道府県" value={f.prefecture ?? ""} onChange={set("prefecture")} />
                <Field label="最寄駅" value={f.nearest_station ?? ""} onChange={set("nearest_station")} />
                <Select label="週稼働日数" value={f.weekly_days ?? ""} onChange={set("weekly_days")} options={WEEKLY_OPTS} />
                <Select label="リモート希望" value={f.remote_pref ?? ""} onChange={set("remote_pref")} options={REMOTE_OPTS} />
                <Field label="希望単価 下限（万円）" value={f.estimated_pay_low ?? ""} onChange={set("estimated_pay_low")} />
                <Field label="希望単価 上限（万円）" value={f.estimated_pay_high ?? ""} onChange={set("estimated_pay_high")} />
              </div>
            )}

            {msg && <div style={{ fontSize: 12.5, color: msg.ok ? "var(--color-success)" : "var(--color-danger)" }}>{msg.text}</div>}
            <div style={{ display: "flex", gap: 8, justifyContent: "flex-end" }}>
              <button className="btn ghost" onClick={close} disabled={pending || lockBusy}>キャンセル</button>
              <button className="btn brand" onClick={submit} disabled={pending || loading}>{pending ? "保存中…" : "保存"}</button>
            </div>
          </div>
        </div>
      )}
    </>
  );
}
