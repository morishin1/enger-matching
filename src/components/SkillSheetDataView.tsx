"use client";

// 0725：構造化スキルシート（candidates.skill_sheet_data）のビューア。
//   enger.jp（/signup・/skill-sheet/excel）と coo.enger.jp のスキルシート入力を
//   同じ JSON 形（coo SkillSheetInput 互換）で保持しているため、1つのビューアで表示する。
//   人材一覧のアクション列・詳細ドロワー・マッチング画面から開く。
//   フィールドはすべて任意（旧データ・部分入力に耐える）。
import { useEffect, useState } from "react";

type SheetProject = {
  name?: string; periodStart?: string; periodEnd?: string;
  industry?: string; jobtype?: string;
  tasks?: string; result?: string;
  role?: string; scale?: string; workstyle?: string;
  languages?: string; serverOs?: string; tools?: string;
  phases?: string[];
};

const s = (v: unknown): string => (typeof v === "string" ? v.trim() : "");
const arr = (v: unknown): string[] => (Array.isArray(v) ? v.filter((x): x is string => typeof x === "string" && !!x.trim()) : []);

function month(v?: string): string {
  const m = String(v ?? "").match(/^(\d{4})-(\d{2})/);
  return m ? `${m[1]}/${m[2]}` : String(v ?? "").trim();
}
function period(p: SheetProject): string {
  const a = month(p.periodStart);
  const b = s(p.periodEnd) ? month(p.periodEnd) : (a ? "現在" : "");
  return a || b ? `${a}${a || b ? " 〜 " : ""}${b}` : "";
}

/** JSON からプロジェクト配列を取り出す（無い・壊れている場合は空）。 */
function projectsOf(data: any): SheetProject[] {
  const raw = Array.isArray(data?.projects) ? data.projects : [];
  return raw.filter((p: any) => p && typeof p === "object")
    .filter((p: any) => s(p.name) || s(p.tasks) || s(p.result) || s(p.languages) || s(p.tools));
}

/** 表示できる中身があるか（ボタンの出し分けに使う）。 */
export function hasSkillSheetData(data: any): boolean {
  if (!data || typeof data !== "object") return false;
  return projectsOf(data).length > 0 || arr(data.skills).length > 0 || !!s(data.careerSummary);
}

const CELL: React.CSSProperties = { padding: "7px 9px", borderBottom: "1px solid var(--color-border)", fontSize: 12.5, verticalAlign: "top", whiteSpace: "pre-wrap", wordBreak: "break-word" };
const HEAD: React.CSSProperties = { ...CELL, background: "var(--color-surface-2, #f3f6fa)", fontWeight: 700, fontSize: 11.5, whiteSpace: "nowrap" };

export function SkillSheetDataButton({ data, label, compact }: { data: any; label?: string; compact?: boolean }) {
  const [open, setOpen] = useState(false);
  useEffect(() => {
    if (!open) return;
    const h = (e: KeyboardEvent) => { if (e.key === "Escape") setOpen(false); };
    window.addEventListener("keydown", h);
    return () => window.removeEventListener("keydown", h);
  }, [open]);
  if (!hasSkillSheetData(data)) return null;

  const d: any = data ?? {};
  const projects = projectsOf(d);
  const skills = arr(d.skills);
  // coo 由来のフィールド（あれば表示）
  const strength = s(d.strength);
  const humanSkills = s(d.humanSkills);
  const meta = [
    s(d.title) && `職種：${s(d.title)}`,
    s(d.ageBand) && `年代：${s(d.ageBand)}`,
    s(d.prefecture) && `居住地：${s(d.prefecture)}`,
    s(d.station) && `最寄駅：${s(d.station)}`,
    s(d.rate) && `希望単価：${s(d.rate)}`,
    s(d.weeklyHours) && `稼働：${s(d.weeklyHours)}`,
    s(d.remote) && `リモート：${s(d.remote)}`,
    s(d.status) && `開始：${s(d.status)}`,
  ].filter(Boolean) as string[];

  return (
    <>
      {compact ? (
        <button type="button" className="btn btn-xs" onClick={() => setOpen(true)} title="登録スキルシート（入力内容）を表示" aria-label="登録スキルシート"
          style={{ background: "#0f766e", borderColor: "#0f766e", color: "#fff" }}>
          <span className="material-symbols-outlined" style={{ fontSize: 18, lineHeight: 1 }}>contact_page</span>
        </button>
      ) : (
        <button type="button" className="btn ghost" onClick={() => setOpen(true)}>
          <span className="material-symbols-outlined" style={{ fontSize: 17, lineHeight: 1 }}>contact_page</span>
          <span>{label ?? "登録スキルシート"}</span>
        </button>
      )}

      {open && (
        <div onClick={() => setOpen(false)} style={{ position: "fixed", inset: 0, zIndex: 420, background: "rgba(15,23,42,.5)", display: "grid", placeItems: "center", padding: 18 }}>
          <div onClick={(e) => e.stopPropagation()} className="card" role="dialog" aria-modal="true"
            style={{ width: "100%", maxWidth: 860, maxHeight: "88vh", overflowY: "auto", display: "flex", flexDirection: "column", gap: 12, padding: 18 }}>
            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", gap: 8 }}>
              <div style={{ minWidth: 0 }}>
                <div className="meta" style={{ fontSize: 10, letterSpacing: ".08em", textTransform: "uppercase", color: "var(--color-ink-4)", fontWeight: 600 }}>REGISTERED SKILL SHEET · 登録スキルシート</div>
                <h3 style={{ margin: "2px 0 0", fontSize: 16, fontWeight: 800 }}>
                  {s(d.name) || "（氏名未入力）"}{s(d.title) ? <span className="muted" style={{ fontSize: 12.5, fontWeight: 500 }}>　{s(d.title)}</span> : null}
                </h3>
              </div>
              <button className="btn ghost btn-xs" onClick={() => setOpen(false)}>閉じる</button>
            </div>

            {meta.length > 0 && (
              <div className="muted" style={{ fontSize: 12, lineHeight: 1.8 }}>{meta.join("　/　")}</div>
            )}

            {s(d.careerSummary) && (
              <div className="card" style={{ padding: 10 }}>
                <div className="muted" style={{ fontSize: 11, fontWeight: 700, marginBottom: 4 }}>職務要約</div>
                <div style={{ fontSize: 13, whiteSpace: "pre-wrap", lineHeight: 1.8 }}>{s(d.careerSummary)}</div>
              </div>
            )}
            {(strength || humanSkills) && (
              <div className="card" style={{ padding: 10 }}>
                {strength && <div style={{ fontSize: 12.5, marginBottom: humanSkills ? 6 : 0 }}><b>得意分野：</b>{strength}</div>}
                {humanSkills && <div style={{ fontSize: 12.5, whiteSpace: "pre-wrap" }}><b>自己PR：</b>{humanSkills}</div>}
              </div>
            )}
            {skills.length > 0 && (
              <div style={{ display: "flex", gap: 6, flexWrap: "wrap" }}>
                {skills.map((sk) => <span key={sk} className="tag brand" style={{ fontSize: 12 }}>{sk}</span>)}
              </div>
            )}

            {projects.length > 0 && (
              <div>
                <div className="muted" style={{ fontSize: 11, fontWeight: 700, marginBottom: 6 }}>職務経歴（{projects.length}件）</div>
                <div style={{ overflowX: "auto" }}>
                  <table style={{ borderCollapse: "collapse", width: "100%", minWidth: 720 }}>
                    <thead>
                      <tr>
                        <th style={HEAD}>期間</th>
                        <th style={HEAD}>案件・業務内容</th>
                        <th style={HEAD}>ポジション/規模</th>
                        <th style={HEAD}>スキル・環境・ツール</th>
                        <th style={HEAD}>担当領域</th>
                      </tr>
                    </thead>
                    <tbody>
                      {projects.map((p, i) => {
                        const tag = [s(p.industry), s(p.jobtype)].filter(Boolean).join("・");
                        const tech = [s(p.languages), s(p.serverOs), s(p.tools)].filter(Boolean).join("\n");
                        return (
                          <tr key={i}>
                            <td style={{ ...CELL, whiteSpace: "nowrap" }}>{period(p) || "—"}</td>
                            <td style={CELL}>
                              {(tag || s(p.name)) && (
                                <div style={{ fontWeight: 700, marginBottom: s(p.tasks) || s(p.result) ? 4 : 0 }}>
                                  {tag ? `【${tag}】` : ""}{s(p.name)}
                                </div>
                              )}
                              {s(p.tasks) && <div>{s(p.tasks)}</div>}
                              {s(p.result) && <div style={{ marginTop: 4, color: "#067647" }}><b>実績・成果：</b>{s(p.result)}</div>}
                              {s(p.workstyle) && <div className="muted" style={{ marginTop: 3, fontSize: 11.5 }}>働き方：{s(p.workstyle)}</div>}
                            </td>
                            <td style={CELL}>{[s(p.role), s(p.scale)].filter(Boolean).join("\n") || "—"}</td>
                            <td style={CELL}>{tech || "—"}</td>
                            <td style={CELL}>{arr(p.phases).join("・") || "—"}</td>
                          </tr>
                        );
                      })}
                    </tbody>
                  </table>
                </div>
              </div>
            )}
          </div>
        </div>
      )}
    </>
  );
}
