"use client";

// 案件NO / 人材NO を入力して直接マッチング画面（その対象を起点）へ飛ぶ。
//   /matching?job=<job_no> / /matching?person=<candidate_no> へ遷移。
// 新規登録した案件・人材を、注力フラグ等に依らずすぐにマッチングしたいときに使う。
import { useState } from "react";
import { useRouter } from "next/navigation";

export function JumpToMatching() {
  const router = useRouter();
  const [job, setJob] = useState("");
  const [person, setPerson] = useState("");

  const numOf = (v: string) => {
    const n = parseInt((v || "").replace(/[^\d]/g, ""), 10);
    return Number.isFinite(n) && n > 0 ? n : null;
  };
  const goJob = () => { const n = numOf(job); if (n) router.push(`/matching?job=${n}`); };
  const goPerson = () => { const n = numOf(person); if (n) router.push(`/matching?person=${n}`); };

  const inputStyle: React.CSSProperties = { fontSize: 13, padding: "7px 10px", border: "1px solid var(--color-border-strong)", borderRadius: 8, background: "var(--color-surface)", width: 130 };

  return (
    <div className="card" style={{ display: "flex", gap: 16, flexWrap: "wrap", alignItems: "center", padding: "12px 16px" }}>
      <span style={{ fontSize: 12.5, fontWeight: 700, color: "var(--color-ink-3)" }}>番号から直接マッチング</span>
      <form onSubmit={(e) => { e.preventDefault(); goJob(); }} style={{ display: "flex", gap: 6, alignItems: "center" }}>
        <label style={{ fontSize: 12, color: "var(--color-ink-3)" }}>案件NO</label>
        <input type="text" inputMode="numeric" placeholder="例：123" value={job} onChange={(e) => setJob(e.target.value)} style={inputStyle} />
        <button type="submit" className="btn brand btn-xs" disabled={!numOf(job)}>この案件で人材を探す</button>
      </form>
      <form onSubmit={(e) => { e.preventDefault(); goPerson(); }} style={{ display: "flex", gap: 6, alignItems: "center" }}>
        <label style={{ fontSize: 12, color: "var(--color-ink-3)" }}>人材NO</label>
        <input type="text" inputMode="numeric" placeholder="例：456" value={person} onChange={(e) => setPerson(e.target.value)} style={inputStyle} />
        <button type="submit" className="btn brand btn-xs" disabled={!numOf(person)}>この人材で案件を探す</button>
      </form>
      <span className="muted" style={{ fontSize: 10.5 }}>※ 一覧のID（No.XXXXX / P-XXXXX）の数字部分。注力に入っていなくても直接マッチング可</span>
    </div>
  );
}
