// LINE 登録：LINE 経由で接点ができた人材・案件を「人材一覧と同じ行レイアウト」で並べる集約ビュー。
//   ・データ源は proposals テーブルの source='line'。実体は通常の提案と同じで、
//     提案管理(/proposals)にもそのまま入る（フロー・動きはメール提案と同一）。
//   ・本ページは LINE 経由の人材／案件を素早く確認するための入口。提案カンバンは出さず、
//     人材ページと同じ「P-番号 / 新着バッジ / 名前 / 会社 / 未承認 / スキル / 登録日」行で揃える。
//   ・新規入力（LINE貼り付け）は既存の NewProposalButton をそのまま使う（フォーマット解釈は AI が吸収）。
import Link from "next/link";
import { Icons } from "@/components/icons";
import { engerClient, dbConfigured } from "@/lib/supabase";
import { MatchingPeerTabs } from "@/components/MatchingTabs";
import { NewProposalButton } from "@/components/NewProposalButton";
import { CopyButton } from "@/components/CopyButton";
import { LineTabs } from "@/components/LineTabs";
import { getSidebarCounts } from "@/lib/counts";

export const dynamic = "force-dynamic";

// 人材一覧と同じ鮮度バッジの分類。色は globals.css の .fresh[data-tone] と一致させる。
function freshnessLabel(d: string | null): "新着" | "3日以内" | "4〜14日前" | "それ以前" {
  if (!d) return "それ以前";
  const dt = new Date(d);
  if (isNaN(dt.getTime())) return "それ以前";
  const days = Math.floor((Date.now() - dt.getTime()) / 86400000);
  if (days <= 0) return "新着";
  if (days <= 3) return "3日以内";
  if (days <= 14) return "4〜14日前";
  return "それ以前";
}
function importDateTime(d: string | null) {
  if (!d) return null;
  const dt = new Date(d);
  if (isNaN(dt.getTime())) return null;
  return `${dt.getMonth() + 1}/${dt.getDate()} ${String(dt.getHours()).padStart(2, "0")}:${String(dt.getMinutes()).padStart(2, "0")}`;
}
function Fresh({ d }: { d: string | null }) {
  const label = freshnessLabel(d);
  const tone = label === "新着" ? "new" : label === "3日以内" ? "soon" : label === "4〜14日前" ? "mid" : "old";
  const dt = importDateTime(d);
  return (
    <span style={{ display: "inline-flex", flexDirection: "column", gap: 2, alignItems: "flex-start" }}>
      <span className="fresh" data-tone={tone}><span className="dot" />{label}</span>
      {dt && <span className="muted" style={{ fontSize: 10.5, lineHeight: 1.2 }} title="取込（インポート）日時">{dt}</span>}
    </span>
  );
}
const fmtDate = (d?: string | null) => {
  if (!d) return "—";
  const dt = new Date(d);
  if (isNaN(dt.getTime())) return "—";
  return `${dt.getFullYear()}/${String(dt.getMonth() + 1).padStart(2, "0")}/${String(dt.getDate()).padStart(2, "0")}`;
};

export default async function LinePage() {
  const counts = await getSidebarCounts();
  let needSetup = false;

  // LINE 提案を起点に、関連する候補者(candidates)と案件(jobs)を引き、人材一覧と同じ列で表示する。
  //   ・小規模データ前提（LINE 経由は通常少数）：1往復で proposals を取り、candidate_id / job_id を
  //     in() で引いて結合する。
  //   ・proposals.source 列が未整備のときは空集合で案内バナーを出す（バッジ無しで続行）。
  let candidates: any[] = [];
  let jobs: any[] = [];
  if (dbConfigured) {
    try {
      const sb = engerClient();
      const r: any = await sb.from("proposals").select("id, job_id, candidate_id, source, created_at").eq("source", "line").order("created_at", { ascending: false }).limit(500);
      if (r.error && /source|column/i.test(r.error.message ?? "")) {
        needSetup = true;
      } else if (!r.error) {
        const rows: any[] = r.data ?? [];
        const candIds = Array.from(new Set(rows.map((p) => p.candidate_id).filter(Boolean))) as string[];
        const jobIds = Array.from(new Set(rows.map((p) => p.job_id).filter(Boolean))) as string[];
        if (candIds.length) {
          // 人材一覧と同じ表示項目（人材ID／登録日／氏名／所属／会社／承認状況／スキル）。
          //   ・最低限の列で SELECT し、欠落カラムがある環境では段階的フォールバック。
          let cr: any = await sb.from("candidates").select("id, candidate_no, name, initials, c_init, affiliation, source_company, company, company_approved, created_at, skills").in("id", candIds);
          if (cr.error) cr = await sb.from("candidates").select("id, candidate_no, name, affiliation, source_company, company, created_at, skills").in("id", candIds);
          candidates = (cr.error ? [] : (cr.data ?? [])).sort((a: any, b: any) => (b.created_at ?? "").localeCompare(a.created_at ?? ""));
        }
        if (jobIds.length) {
          let jr: any = await sb.from("jobs").select("id, job_no, title, client_name, created_at, skills").in("id", jobIds);
          if (jr.error) jr = await sb.from("jobs").select("id, job_no, title, client_name, created_at").in("id", jobIds);
          jobs = (jr.error ? [] : (jr.data ?? [])).sort((a: any, b: any) => (b.created_at ?? "").localeCompare(a.created_at ?? ""));
        }
      }
    } catch { /* ignore: 表示は空で続行 */ }
  }

  const activeCount = jobs.length + candidates.length;

  return (
    <div className="page" style={{ display: "flex", flexDirection: "column", gap: 14 }}>
      <MatchingPeerTabs counts={counts} activeCount={activeCount} />

      <div style={{ display: "flex", alignItems: "center", gap: 12, flexWrap: "wrap" }}>
        <h1 style={{ margin: 0, fontSize: 22, fontWeight: 800, display: "inline-flex", alignItems: "center", gap: 8 }}>
          <span style={{ lineHeight: 0 }}><Icons.line size={26} /></span>
          LINE登録
        </h1>
        <span className="muted" style={{ fontSize: 12.5 }}>
          LINE 経由で接点ができた人材・案件を一覧表示します（フローはメール提案と同じ。提案は提案管理にも入ります）。新規は「LINE/メール貼り付け」で素早く取り込み。
        </span>
        <div style={{ marginLeft: "auto" }}>
          <NewProposalButton />
        </div>
      </div>

      {needSetup && (
        <div className="card" style={{ background: "#fff6e0", border: "1px solid #fde9b0", color: "#9a7b12", padding: 14, fontSize: 13 }}>
          proposals.source 列が未整備のため、まだ LINE 登録の集約は使えません。マイグレーション <code>proposals-source.sql</code> を適用してください。
        </div>
      )}

      {/* 人材 / 案件 をタブで分割（要望）。サーバ側で両方描画し display で出し分け。 */}
      <LineTabs
        peopleCount={candidates.length}
        jobsCount={jobs.length}
        people={
      <section style={{ display: "flex", flexDirection: "column", gap: 8 }}>
        <SectionHeader title="LINE 経由の人材" n={candidates.length} />
        {candidates.length === 0 ? (
          <EmptyBox text="まだ LINE 経由の人材はありません。" />
        ) : (
          <div className="card flush" style={{ overflowX: "auto" }}>
            <table className="tbl tbl-compact" style={{ minWidth: 880 }}>
              <thead>
                <tr style={{ fontSize: 11, color: "var(--color-ink-4)" }}>
                  <th style={{ width: 84, textAlign: "left" }}>人材ID</th>
                  <th style={{ width: 104, textAlign: "left" }}>ステータス</th>
                  <th style={{ textAlign: "left" }}>氏名</th>
                  <th style={{ textAlign: "left", width: 220 }}>会社</th>
                  <th style={{ textAlign: "left", width: 110 }}>承認</th>
                  <th style={{ textAlign: "left" }}>スキル</th>
                  <th style={{ textAlign: "left", width: 110 }}>登録日</th>
                </tr>
              </thead>
              <tbody>
                {candidates.map((p) => (
                  <tr key={p.id}>
                    <td>
                      <span className="mono" style={{ fontSize: 11, color: "var(--color-ink-4)" }}>P-{String(p.candidate_no ?? 0).padStart(5, "0")}</span>
                    </td>
                    <td><Fresh d={p.created_at} /></td>
                    <td>
                      <div style={{ display: "flex", gap: 10, alignItems: "center" }}>
                        <div className="ava">{p.initials || p.c_init || (p.name ?? "?").charAt(0)}</div>
                        <div style={{ minWidth: 0 }}>
                          <div className="pri" style={{ color: "var(--color-brand-700)", display: "flex", alignItems: "center", gap: 6 }}>
                            <Link href={`/people?focus=${encodeURIComponent(p.id)}`} style={{ color: "inherit", textDecoration: "none", fontWeight: 700 }}>{p.name ?? "—"}</Link>
                            <span title="LINE 経由" style={{ lineHeight: 0, flexShrink: 0 }}><Icons.line size={13} /></span>
                          </div>
                          {p.affiliation && <div className="muted" style={{ fontSize: 10.5, marginTop: 1 }}>{p.affiliation}</div>}
                        </div>
                      </div>
                    </td>
                    <td>
                      {(p.source_company || p.company)
                        ? <span style={{ fontSize: 12, color: "var(--color-ink-2)", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap", display: "block" }} title={p.source_company || p.company}>{p.source_company || p.company}</span>
                        : <span className="muted" style={{ fontSize: 12 }}>—</span>}
                    </td>
                    <td>
                      <span className="pill" style={{ fontSize: 10.5, fontWeight: 700, padding: "2px 8px", borderRadius: 99,
                        background: p.company_approved ? "#e7f7ee" : "#fdecef",
                        color: p.company_approved ? "#067647" : "#b42318",
                        border: `1px solid ${p.company_approved ? "#bfe3cc" : "#f7c5cf"}` }}>
                        {p.company_approved ? "承認済" : "未承認"}
                      </span>
                    </td>
                    <td><SkillTags skills={p.skills} /></td>
                    <td><span className="muted" style={{ fontSize: 11 }}>{fmtDate(p.created_at)}</span></td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>
        }
        jobs={
      <section style={{ display: "flex", flexDirection: "column", gap: 8 }}>
        <SectionHeader title="LINE 経由の案件" n={jobs.length} />
        {jobs.length === 0 ? (
          <EmptyBox text="まだ LINE 経由の案件はありません。" />
        ) : (
          <div className="card flush" style={{ overflowX: "auto" }}>
            <table className="tbl tbl-compact" style={{ minWidth: 760 }}>
              <thead>
                <tr style={{ fontSize: 11, color: "var(--color-ink-4)" }}>
                  <th style={{ width: 84, textAlign: "left" }}>案件ID</th>
                  <th style={{ width: 104, textAlign: "left" }}>ステータス</th>
                  <th style={{ textAlign: "left" }}>案件名</th>
                  <th style={{ textAlign: "left", width: 220 }}>クライアント</th>
                  <th style={{ textAlign: "left" }}>スキル</th>
                  <th style={{ textAlign: "left", width: 110 }}>登録日</th>
                </tr>
              </thead>
              <tbody>
                {jobs.map((j) => (
                  <tr key={j.id}>
                    <td><span className="mono" style={{ fontSize: 11, color: "var(--color-ink-4)" }}>J-{String(j.job_no ?? 0).padStart(5, "0")}</span></td>
                    <td><Fresh d={j.created_at} /></td>
                    <td>
                      <div style={{ display: "flex", alignItems: "center", gap: 6 }}>
                        <Link href={`/jobs?focus=${encodeURIComponent(j.id)}`} style={{ color: "var(--color-brand-700)", textDecoration: "none", fontWeight: 700 }}>{j.title ?? "—"}</Link>
                        <span title="LINE 経由" style={{ lineHeight: 0, flexShrink: 0 }}><Icons.line size={13} /></span>
                      </div>
                    </td>
                    <td>
                      {j.client_name
                        ? <span style={{ fontSize: 12, color: "var(--color-ink-2)", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap", display: "block" }} title={j.client_name}>{j.client_name}</span>
                        : <span className="muted" style={{ fontSize: 12 }}>—</span>}
                    </td>
                    <td><SkillTags skills={j.skills} /></td>
                    <td><span className="muted" style={{ fontSize: 11 }}>{fmtDate(j.created_at)}</span></td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>
        }
      />

      {/* LINE 文面テンプレ */}
      <section style={{ display: "flex", flexDirection: "column", gap: 8 }}>
        <h2 style={{ margin: 0, fontSize: 15, fontWeight: 800, color: "var(--color-ink-2)" }}>LINE 返信テンプレ（簡易）</h2>
        <p className="muted" style={{ margin: 0, fontSize: 11.5 }}>
          メール文面より短く・絵文字で柔らかく。氏名や案件名は手で差し替えてからコピー。
        </p>
        <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(280px, 1fr))", gap: 10 }}>
          <TemplateCard
            title="初回お礼（案件受領）"
            body={`〇〇さん、LINEありがとうございます！✨\n案件確認しました。社内で人材を当てて、明日までに候補をお送りします🙌\n稼働開始の希望時期だけ教えてください！`}
          />
          <TemplateCard
            title="人材紹介の前置き"
            body={`〇〇案件にぴったりな方をご紹介させてください💁‍♂️\n・スキル / 単価 / 稼働 / 居住地\n気になる箇所があれば LINE で気軽に聞いてください🙏`}
          />
          <TemplateCard
            title="面談調整のお願い"
            body={`良かったらまず 15分の面談をお願いします🙇‍♂️\n候補日：①〇/〇 〇時 / ②〇/〇 〇時 / ③〇/〇 〇時\nご都合の良い時間を返信ください！`}
          />
        </div>
      </section>
    </div>
  );
}

function SectionHeader({ title, n }: { title: string; n: number }) {
  return (
    <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
      <span style={{ lineHeight: 0 }}><Icons.line size={16} /></span>
      <h2 style={{ margin: 0, fontSize: 15, fontWeight: 800, color: "var(--color-ink-2)" }}>{title}</h2>
      <span className="muted" style={{ fontSize: 11.5 }}>{n} 件</span>
    </div>
  );
}

function EmptyBox({ text }: { text: string }) {
  return <div className="card" style={{ padding: 20, textAlign: "center", color: "var(--color-ink-4)", fontSize: 12.5 }}>{text}</div>;
}

function SkillTags({ skills }: { skills?: unknown }) {
  const ss = Array.isArray(skills) ? (skills as string[]).filter(Boolean) : [];
  if (ss.length === 0) return <span className="muted" style={{ fontSize: 11.5 }}>—</span>;
  const top = ss.slice(0, 3);
  const rest = ss.length - top.length;
  return (
    <div style={{ display: "flex", flexWrap: "wrap", gap: 4 }}>
      {top.map((s) => <span key={s} className="tag" style={{ fontSize: 11 }}>{s}</span>)}
      {rest > 0 && <span className="muted" style={{ fontSize: 11 }}>+{rest}</span>}
    </div>
  );
}

function TemplateCard({ title, body }: { title: string; body: string }) {
  return (
    <div className="card" style={{ padding: 12, display: "flex", flexDirection: "column", gap: 6, border: "1px solid #bfe3cc", background: "#f0fbf5" }}>
      <div style={{ fontSize: 12, fontWeight: 800, color: "#067647", display: "inline-flex", alignItems: "center", gap: 6 }}>
        <span style={{ lineHeight: 0 }}><Icons.line size={14} /></span>{title}
      </div>
      <pre style={{ margin: 0, fontFamily: "inherit", whiteSpace: "pre-wrap", fontSize: 12, color: "var(--color-ink-2)", lineHeight: 1.6 }}>{body}</pre>
      <CopyButton text={body} />
    </div>
  );
}
