// 企業×先方担当者ごとの提案ファネル可視化。
//   ねらうべき相手（相性の良い担当）と、避けるべき相手（決まらない担当）を一覧で示す。
//   ・key person   : 提案2件+ × 稼働化率25%+ （信頼できる相手）
//   ・要見直し     : 提案3件+ × 稼働化0% × 失注1件+（提案の質か関係性に問題）
//   各行に提案/面談化率/稼働化率/平均単価/平均クロージング日数/失注主因/最終提案を表示。

import type { ContactFunnel } from "@/lib/company-funnel";

type Cat = "key" | "review" | "unknown";

function categorize(c: ContactFunnel): Cat {
  if (c.proposals >= 2 && c.winRate >= 25) return "key";
  if (c.proposals >= 3 && c.winRate === 0 && c.lost >= 1) return "review";
  return "unknown";
}

function daysAgo(iso: string | null | undefined): number {
  if (!iso) return 9999;
  return Math.max(0, Math.floor((Date.now() - new Date(iso).getTime()) / 86400000));
}

export function CompanyContactBoard({ contactsByCompany }: { contactsByCompany: Map<string, ContactFunnel[]> }) {
  // 全担当を1配列にflattenし、カテゴリ別に並べる。
  const all: ContactFunnel[] = [];
  for (const arr of contactsByCompany.values()) for (const c of arr) all.push(c);
  if (all.length === 0) return null;
  const key = all.filter((c) => categorize(c) === "key").sort((a, b) => b.winRate - a.winRate || b.proposals - a.proposals).slice(0, 12);
  const review = all.filter((c) => categorize(c) === "review").sort((a, b) => b.lost - a.lost || b.proposals - a.proposals).slice(0, 12);

  return (
    <div className="card" style={{ padding: 14 }}>
      <div style={{ display: "flex", alignItems: "center", gap: 10, marginBottom: 8, flexWrap: "wrap" }}>
        <h3 style={{ margin: 0, fontSize: 14, fontWeight: 800 }}>👤 担当者別の決定率（相性の根拠）</h3>
        <span className="muted" style={{ fontSize: 11 }}>過去12ヶ月 ・ proposals.client_contact で集計（未入力は対象外）</span>
      </div>

      <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 12 }} className="duo-grid">
        <Section title="🟢 相性の良い担当（キーパーソン）"
                 hint="提案2件+ かつ 稼働化率25%+。次回の提案を優先的に当てる。"
                 tone="good"
                 rows={key}
                 empty="該当なし。client_contact の入力を増やすと精度が上がります。" />
        <Section title="🔴 要見直し（決まらない担当）"
                 hint="提案3件+ で稼働化0% × 失注1件+。提案ペアや訴求を見直し。"
                 tone="bad"
                 rows={review}
                 empty="該当なし 👍" />
      </div>

      <div className="muted" style={{ fontSize: 10.5, marginTop: 10 }}>
        ※ 相手の担当(client_contact)が日報・提案に未入力だと集計対象外。提案登録時に client_contact をできるだけ入れる運用を推奨。
      </div>
    </div>
  );
}

function Section({ title, hint, tone, rows, empty }: { title: string; hint: string; tone: "good" | "bad"; rows: ContactFunnel[]; empty: string }) {
  const headBg = tone === "good" ? "#e7f7ee" : "#fdecef";
  const headFg = tone === "good" ? "#067647" : "#b42318";
  const bd = tone === "good" ? "#bfe3cc" : "#f7c5cf";
  return (
    <div style={{ border: `1px solid ${bd}`, borderRadius: 10 }}>
      <div style={{ padding: "8px 12px", background: headBg, color: headFg, borderTopLeftRadius: 10, borderTopRightRadius: 10, borderBottom: `1px solid ${bd}` }}>
        <div style={{ fontSize: 12.5, fontWeight: 800 }}>{title}</div>
        <div style={{ fontSize: 10.5, marginTop: 2 }}>{hint}</div>
      </div>
      <div style={{ padding: 8 }}>
        {rows.length === 0 ? (
          <div className="muted" style={{ padding: 8, fontSize: 12 }}>{empty}</div>
        ) : (
          <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
            {rows.map((c) => {
              const d = daysAgo(c.lastProposedAt);
              return (
                <div key={`${c.company}__${c.contact}`} style={{ padding: "8px 10px", border: "1px solid var(--color-border)", borderRadius: 8, background: "var(--color-surface)" }}>
                  <div style={{ display: "flex", alignItems: "baseline", justifyContent: "space-between", gap: 6, flexWrap: "wrap" }}>
                    <div style={{ minWidth: 0 }}>
                      <span style={{ fontSize: 12.5, fontWeight: 700 }}>{c.contact}</span>
                      <span className="muted" style={{ fontSize: 11, marginLeft: 6 }}>{c.company}</span>
                    </div>
                    <span className="mono" style={{ fontSize: 11, color: tone === "good" ? "#067647" : "#b42318", fontWeight: 800 }}>
                      稼働化率 {c.winRate}%
                    </span>
                  </div>
                  <div className="muted" style={{ fontSize: 10.5, marginTop: 3, lineHeight: 1.6 }}>
                    提案 <b style={{ color: "var(--color-ink-2)" }}>{c.proposals}</b> ・ 面談化 <b style={{ color: "var(--color-ink-2)" }}>{c.meetRate}%</b>
                    {c.avgRate != null && <> ・ 平均単価 <b style={{ color: "var(--color-ink-2)" }}>{c.avgRate}万</b></>}
                    {c.avgCloseDays != null && <> ・ クロージング <b style={{ color: "var(--color-ink-2)" }}>{c.avgCloseDays}日</b></>}
                    {c.lastProposedAt && <> ・ 最終提案 <b style={{ color: "var(--color-ink-2)" }}>{d}日前</b></>}
                  </div>
                  {tone === "bad" && c.topReasons.length > 0 && (
                    <div style={{ fontSize: 10.5, color: "#b42318", marginTop: 4 }}>
                      💔 主な失注理由：{c.topReasons.slice(0, 2).map((x) => `${x.reason}(${x.n})`).join(" / ")}
                    </div>
                  )}
                </div>
              );
            })}
          </div>
        )}
      </div>
    </div>
  );
}
