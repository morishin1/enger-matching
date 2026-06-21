"use client";

// 人材／案件の個別ページの「✎ 編集」ボタン。クリックでモーダルを開き、既存の値を
// 初期値としてフォームに展開。送信時は updateCandidateById / updateJobById を呼ぶ。
// 重複検出のキー(人材=氏名、案件=案件名×クライアント名)は編集可だが、
// 変更時に「重複検出のキーが変わります」という注意書きを出す。
import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { updateCandidateById, updateJobById } from "@/lib/actions";

const fieldStyle: React.CSSProperties = { fontSize: 12.5, padding: "6px 8px", border: "1px solid var(--color-border-strong)", borderRadius: 8, background: "var(--color-surface)", fontFamily: "var(--font-sans)" };
const labelStyle: React.CSSProperties = { fontSize: 11, fontWeight: 600, color: "var(--color-ink-3)" };
const warnStyle: React.CSSProperties = { fontSize: 10, color: "var(--color-warn, #b45309)", marginTop: 2 };

function Field({ label, value, onChange, full, placeholder, warn }: { label: string; value?: string; onChange: (v: string) => void; full?: boolean; placeholder?: string; warn?: string }) {
  return (
    <label style={{ display: "flex", flexDirection: "column", gap: 4, gridColumn: full ? "1 / -1" : undefined }}>
      <span style={labelStyle}>{label}</span>
      <input type="text" value={value ?? ""} placeholder={placeholder} onChange={(e) => onChange(e.target.value)} style={fieldStyle} />
      {warn && <span style={warnStyle}>※ {warn}</span>}
    </label>
  );
}

// 重複検出キー用：初期は read-only。「🔓 ロック解除」で編集可になり警告を表示。
// 誤編集による重複は防ぎつつ、誤字修正など必要時には変更できる。
function LockedField({ label, value, onChange, full, lockNote }: { label: string; value?: string; onChange: (v: string) => void; full?: boolean; lockNote: string }) {
  const [unlocked, setUnlocked] = useState(false);
  return (
    <label style={{ display: "flex", flexDirection: "column", gap: 4, gridColumn: full ? "1 / -1" : undefined }}>
      <span style={labelStyle}>{label} {!unlocked && <span style={{ color: "var(--color-ink-4)", fontWeight: 500 }}>（重複防止のため保護中）</span>}</span>
      <div style={{ display: "flex", gap: 6 }}>
        <input
          type="text" value={value ?? ""}
          readOnly={!unlocked}
          onChange={(e) => onChange(e.target.value)}
          style={{ ...fieldStyle, flex: 1, background: unlocked ? "var(--color-surface)" : "var(--color-surface-inset)", color: unlocked ? "var(--color-ink)" : "var(--color-ink-3)" }}
        />
        <button type="button" onClick={() => setUnlocked((v) => !v)}
          className="btn ghost btn-xs"
          style={{ whiteSpace: "nowrap", color: unlocked ? "var(--color-warn, #b45309)" : "var(--color-ink-3)" }}>
          {unlocked ? "🔒 ロック" : "🔓 ロック解除"}
        </button>
      </div>
      {unlocked && <span style={warnStyle}>⚠ {lockNote}</span>}
    </label>
  );
}
function Select({ label, value, onChange, options }: { label: string; value?: string; onChange: (v: string) => void; options: { value: string; label: string }[] }) {
  return (
    <label style={{ display: "flex", flexDirection: "column", gap: 4 }}>
      <span style={labelStyle}>{label}</span>
      <select value={value ?? ""} onChange={(e) => onChange(e.target.value)} style={fieldStyle}>
        {options.map((o) => <option key={o.value} value={o.value}>{o.label}</option>)}
      </select>
    </label>
  );
}
function Textarea({ label, value, onChange }: { label: string; value?: string; onChange: (v: string) => void }) {
  return (
    <label style={{ display: "flex", flexDirection: "column", gap: 4, gridColumn: "1 / -1" }}>
      <span style={labelStyle}>{label}</span>
      <textarea value={value ?? ""} rows={4} onChange={(e) => onChange(e.target.value)} style={{ ...fieldStyle, resize: "vertical", padding: "8px" }} />
    </label>
  );
}

type FormState = Record<string, string>;

// 人材のリモート希望（3 区分）。人材一覧の表示・フィルタ（PeopleTable.remotePrefLabel /
// people/page.tsx REMOTE_OPTIONS）と連動するよう、保存値はそのまま分類できる正規化テキストにする。
//   フルリモート希望 → フル / 一部リモート可 → リモート / 出社可 → 出社
const CAND_REMOTE_OPTS = [
  { value: "", label: "未設定" },
  { value: "フルリモート希望", label: "フルリモート希望" },
  { value: "一部リモート可", label: "一部リモート可希望" },
  { value: "出社可", label: "出社可" },
];
// 既存の自由文 remote_pref を 3 区分の初期値へ寄せる（一覧の分類優先順位と一致させる）。
function remoteBucket(raw?: string | null): string {
  const s = (raw ?? "").trim();
  if (!s) return "";
  if (/フル/.test(s)) return "フルリモート希望";
  if (/リモート|在宅/.test(s)) return "一部リモート可";
  if (/出社|常駐/.test(s)) return "出社可";
  return ""; // 未分類は未設定（3 択に正規化）
}

export function EditCandidateButton({ candidate }: { candidate: any }) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [pending, start] = useTransition();
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);
  const c = candidate ?? {};
  const initial: FormState = {
    name: c.name ?? "",
    title: c.title ?? "",
    source_company: c.source_company ?? c.company ?? "",
    affiliation: c.affiliation ?? "",
    skills: Array.isArray(c.skills) ? c.skills.join(", ") : "",
    rate: c.rate ?? "",
    exp: c.exp ?? "",
    avail: c.avail ?? "",
    location: c.location ?? "",
    remote_pref: remoteBucket(c.remote_pref),
    status: c.status ?? "",
    skill_sheet_url: c.skill_sheet_url ?? "",
    email: c.email ?? "",
    contact_email: c.contact_email ?? "",
    source_mail_url: c.source_mail_url ?? "",
    flow_depth: c.flow_depth == null ? "" : String(c.flow_depth),
  };
  const [f, setF] = useState<FormState>(initial);
  const set = (k: string) => (v: string) => setF((s) => ({ ...s, [k]: v }));
  const close = () => { if (!pending) { setOpen(false); setMsg(null); setF(initial); } };

  const submit = () => {
    setMsg(null);
    if (!f.name.trim()) { setMsg({ ok: false, text: "氏名は必須です" }); return; }
    start(async () => {
      const res = await updateCandidateById(Number(c.candidate_no), {
        name: f.name,
        title: f.title,
        company: f.source_company,
        // source_company は actions 側で同期される
        affiliation: f.affiliation,
        skills: f.skills ? f.skills.split(/[,、\/／]+/).map((s) => s.trim()).filter(Boolean) : [],
        rate: f.rate,
        exp: f.exp,
        avail: f.avail,
        location: f.location,
        remote_pref: f.remote_pref,
        status: f.status,
        skill_sheet_url: f.skill_sheet_url,
        email: f.email,
        contact_email: f.contact_email,
        source_mail_url: f.source_mail_url,
        flow_depth: f.flow_depth === "" ? null : Number(f.flow_depth),
      } as any);
      if (res.ok) { setMsg({ ok: true, text: "保存しました" }); router.refresh(); setTimeout(close, 800); }
      else setMsg({ ok: false, text: res.error || "保存に失敗しました" });
    });
  };

  return (
    <>
      <button type="button" className="btn ghost" onClick={() => setOpen(true)}>✎ 編集</button>
      {open && (
        <div onClick={close} style={{ position: "fixed", inset: 0, background: "rgba(15,23,42,.45)", display: "grid", placeItems: "center", zIndex: 300, padding: 20 }}>
          <div onClick={(e) => e.stopPropagation()} className="card" style={{ width: "100%", maxWidth: 720, maxHeight: "88vh", overflowY: "auto", display: "flex", flexDirection: "column", gap: 12 }}>
            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
              <h3 style={{ margin: 0, fontSize: 16, fontWeight: 700 }}>人材を編集（P-{String(c.candidate_no ?? 0).padStart(5, "0")}）</h3>
              <button className="btn ghost btn-xs" onClick={close} disabled={pending}>閉じる</button>
            </div>
            <div style={{ display: "grid", gridTemplateColumns: "repeat(2, 1fr)", gap: 10 }}>
              <LockedField label="氏名 *" value={f.name} onChange={set("name")} lockNote="重複検出キー。変更すると別人材として扱われる可能性があります" />
              <Field label="職種" value={f.title} onChange={set("title")} />
              <LockedField label="所属会社" value={f.source_company} onChange={set("source_company")} lockNote="所属が変わると重複判定や絞り込みに影響します" />
              <Select label="所属区分" value={f.affiliation} onChange={set("affiliation")} options={[
                { value: "", label: "未設定" },
                { value: "エイト社員",   label: "エイト社員（自社正社員）" },
                { value: "BP",          label: "BP（自社のBP/FL）" },
                { value: "一社下社員",   label: "一社下社員" },
                { value: "一社下FL",    label: "一社下FL" },
                { value: "二社下以降",  label: "二社下以降" },
              ]} />
              <Field label="保有スキル（カンマ区切り）" value={f.skills} onChange={set("skills")} full />
              <Field label="希望単価" value={f.rate} onChange={set("rate")} />
              <Field label="経験年数" value={f.exp} onChange={set("exp")} />
              <Field label="稼働開始" value={f.avail} onChange={set("avail")} />
              <Field label="最寄駅" value={f.location} onChange={set("location")} />
              <Select label="リモート希望" value={f.remote_pref} onChange={set("remote_pref")} options={CAND_REMOTE_OPTS} />
              <Field label="ステータス" value={f.status} onChange={set("status")} />
              <Field label="スキルシートURL" value={f.skill_sheet_url} onChange={set("skill_sheet_url")} full />
              <Field label="本人メール" value={f.email} onChange={set("email")} />
              <Field label="所属窓口メール（返信先）" value={f.contact_email} onChange={set("contact_email")} />
              <Field label="元メールURL／Gmail メッセージ ID" value={f.source_mail_url} onChange={set("source_mail_url")} full />
            </div>
            {msg && <div style={{ fontSize: 12.5, color: msg.ok ? "var(--color-success)" : "var(--color-danger)" }}>{msg.text}</div>}
            <div style={{ display: "flex", gap: 8, justifyContent: "flex-end" }}>
              <button className="btn ghost" onClick={close} disabled={pending}>キャンセル</button>
              <button className="btn brand" onClick={submit} disabled={pending}>{pending ? "保存中…" : "保存"}</button>
            </div>
          </div>
        </div>
      )}
    </>
  );
}

const REMOTE_OPTS = [
  { value: "", label: "未指定（一部リモート扱い）" },
  { value: "full_remote", label: "フルリモート" },
  { value: "partial_remote", label: "一部リモート" },
  { value: "onsite", label: "出社必須" },
];

export function EditJobButton({ job }: { job: any }) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [pending, start] = useTransition();
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);
  const j = job ?? {};
  const initial: FormState = {
    title: j.title ?? "",
    client_name: j.client_name ?? "",
    role_label: j.role_label ?? "",
    skills: Array.isArray(j.skills) ? j.skills.join(", ") : "",
    salary_min: j.salary_min != null ? String(j.salary_min) : "",
    salary_max: j.salary_max != null ? String(j.salary_max) : "",
    remote_type: j.remote_type ?? "",
    flow_note: j.flow_note ?? "",
    accept_flow_depth: j.accept_flow_depth == null ? "" : String(j.accept_flow_depth),
    work_location: j.work_location ?? "",
    start_date: j.start_date ?? "",
    detail: j.detail ?? "",
    status: j.status ?? "",
    contact_name: j.contact_name ?? "",
    contact_email: j.contact_email ?? "",
    source_mail_url: j.source_mail_url ?? "",
  };
  const [f, setF] = useState<FormState>(initial);
  const set = (k: string) => (v: string) => setF((s) => ({ ...s, [k]: v }));
  const close = () => { if (!pending) { setOpen(false); setMsg(null); setF(initial); } };
  const numOf = (s: string) => { const n = parseFloat((s || "").replace(/[^\d.]/g, "")); return Number.isFinite(n) ? n : null; };

  const submit = () => {
    setMsg(null);
    if (!f.title.trim()) { setMsg({ ok: false, text: "案件名は必須です" }); return; }
    start(async () => {
      const res = await updateJobById(Number(j.job_no), {
        title: f.title,
        client_name: f.client_name,
        role_label: f.role_label,
        skills: f.skills ? f.skills.split(/[,、\/／・]+/).map((s) => s.trim()).filter(Boolean) : [],
        salary_min: numOf(f.salary_min),
        salary_max: numOf(f.salary_max),
        remote_type: f.remote_type,
        flow_note: f.flow_note,
        accept_flow_depth: f.accept_flow_depth === "" ? null : Number(f.accept_flow_depth),
        work_location: f.work_location,
        start_date: f.start_date,
        detail: f.detail,
        status: f.status,
        contact_name: f.contact_name,
        contact_email: f.contact_email,
        source_mail_url: f.source_mail_url,
      } as any);
      if (res.ok) { setMsg({ ok: true, text: "保存しました" }); router.refresh(); setTimeout(close, 800); }
      else setMsg({ ok: false, text: res.error || "保存に失敗しました" });
    });
  };

  return (
    <>
      <button type="button" className="btn ghost" onClick={() => setOpen(true)}>✎ 編集</button>
      {open && (
        <div onClick={close} style={{ position: "fixed", inset: 0, background: "rgba(15,23,42,.45)", display: "grid", placeItems: "center", zIndex: 300, padding: 20 }}>
          <div onClick={(e) => e.stopPropagation()} className="card" style={{ width: "100%", maxWidth: 720, maxHeight: "88vh", overflowY: "auto", display: "flex", flexDirection: "column", gap: 12 }}>
            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
              <h3 style={{ margin: 0, fontSize: 16, fontWeight: 700 }}>案件を編集（No.{String(j.job_no ?? 0).padStart(5, "0")}）</h3>
              <button className="btn ghost btn-xs" onClick={close} disabled={pending}>閉じる</button>
            </div>
            <div style={{ display: "grid", gridTemplateColumns: "repeat(2, 1fr)", gap: 10 }}>
              <LockedField label="案件名 *" value={f.title} onChange={set("title")} full lockNote="重複検出キー（title × client_name）。変更すると同じ案件が二重登録される可能性があります" />
              <LockedField label="クライアント名" value={f.client_name} onChange={set("client_name")} lockNote="重複検出キー。変更すると重複判定が崩れます" />
              <Field label="募集職種" value={f.role_label} onChange={set("role_label")} />
              <Field label="必要スキル（カンマ区切り）" value={f.skills} onChange={set("skills")} full />
              <Field label="単価下限（万）" value={f.salary_min} onChange={set("salary_min")} />
              <Field label="単価上限（万）" value={f.salary_max} onChange={set("salary_max")} />
              <Select label="リモート可否" value={f.remote_type} onChange={set("remote_type")} options={REMOTE_OPTS} />
              <Select label="商流（受入上限）" value={f.flow_note} onChange={set("flow_note")} options={[
                { value: "",                  label: "不明" },
                { value: "貴社まで",            label: "貴社まで" },
                { value: "貴社正社員まで",       label: "貴社正社員まで" },
                { value: "貴社一社まで",         label: "貴社一社まで" },
                { value: "貴社一社正社員まで",    label: "貴社一社正社員まで" },
                { value: "貴社二社まで",         label: "貴社二社まで" },
                { value: "貴社二社正社員まで",    label: "貴社二社正社員まで" },
                { value: "商流不問",             label: "商流不問" },
              ]} />
              <Field label="勤務地" value={f.work_location} onChange={set("work_location")} />
              <Field label="稼働開始希望日" value={f.start_date} onChange={set("start_date")} placeholder="例：2026/06/01" />
              <Field label="ステータス" value={f.status} onChange={set("status")} />
              <Field label="窓口担当者名" value={f.contact_name} onChange={set("contact_name")} />
              <Field label="窓口メール（返信先）" value={f.contact_email} onChange={set("contact_email")} />
              <Field label="元メールURL／Gmail メッセージ ID" value={f.source_mail_url} onChange={set("source_mail_url")} full />
              <Textarea label="案件詳細" value={f.detail} onChange={set("detail")} />
            </div>
            {msg && <div style={{ fontSize: 12.5, color: msg.ok ? "var(--color-success)" : "var(--color-danger)" }}>{msg.text}</div>}
            <div style={{ display: "flex", gap: 8, justifyContent: "flex-end" }}>
              <button className="btn ghost" onClick={close} disabled={pending}>キャンセル</button>
              <button className="btn brand" onClick={submit} disabled={pending}>{pending ? "保存中…" : "保存"}</button>
            </div>
          </div>
        </div>
      )}
    </>
  );
}
