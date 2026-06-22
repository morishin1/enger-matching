// LINE 登録（要望②）：LINE 経由で接点ができた人材・案件・提案を1ページに集約。
//   ・データ源は proposals テーブルの source='line'。
//   ・LINE で来たやり取りを優先的に確認/フォローする画面として、提案管理とは別の入口にする。
//   ・新規入力（LINE貼り付け）は既存の NewProposalButton をそのまま使う（フォーマット解釈は AI が吸収）。
import Link from "next/link";
import { engerClient, dbConfigured } from "@/lib/supabase";
import { MatchingPeerTabs } from "@/components/MatchingTabs";
import { NewProposalButton } from "@/components/NewProposalButton";
import { ProposalBoard } from "@/components/ProposalBoard";
import { CopyButton } from "@/components/CopyButton";
import { getSidebarCounts } from "@/lib/counts";
import { loadProposalOwners } from "@/lib/proposal-owners";
import { getStaff } from "@/lib/staff";

export const dynamic = "force-dynamic";

const daysAgo = (iso?: string | null) => {
  if (!iso) return null;
  const d = (Date.now() - new Date(iso).getTime()) / 86400000;
  return Math.floor(d);
};

export default async function LinePage() {
  const [counts, staff, owners] = await Promise.all([getSidebarCounts(), getStaff(), loadProposalOwners()]);
  let proposals: any[] = [];
  let lineJobs = new Map<string, { id: string; title: string | null; company: string | null; latest: string | null; n: number }>();
  let lineCands = new Map<string, { id: string; init: string | null; name: string | null; latest: string | null; n: number }>();
  let needSetup = false;
  if (dbConfigured) {
    try {
      const sb = engerClient();
      const base = "id, job_id, candidate_id, job_title, company, candidate_name, c_init, rate, score, stage, created_at, next_action, source, updated_at, stage_updated_at, caller_status, proposer, closer, client_contact, meeting_date, meeting_status";
      let res: any = await sb.from("proposals").select(base).eq("source", "line").order("created_at", { ascending: false }).limit(400);
      if (res.error && /source|column/i.test(res.error.message ?? "")) {
        // source 列未追加環境では空表示にして案内
        needSetup = true;
      } else if (!res.error) {
        proposals = res.data ?? [];
        for (const p of proposals) {
          if (p.job_id) {
            const cur = lineJobs.get(p.job_id) ?? { id: p.job_id, title: p.job_title, company: p.company, latest: p.created_at, n: 0 };
            cur.n += 1;
            if (!cur.latest || (p.created_at && p.created_at > cur.latest)) cur.latest = p.created_at;
            lineJobs.set(p.job_id, cur);
          }
          if (p.candidate_id) {
            const cur = lineCands.get(p.candidate_id) ?? { id: p.candidate_id, init: p.c_init, name: p.candidate_name, latest: p.created_at, n: 0 };
            cur.n += 1;
            if (!cur.latest || (p.created_at && p.created_at > cur.latest)) cur.latest = p.created_at;
            lineCands.set(p.candidate_id, cur);
          }
        }
      }
    } catch { /* ignore: 表示は空で続行 */ }
  }

  const jobs = Array.from(lineJobs.values()).sort((a, b) => (b.latest ?? "").localeCompare(a.latest ?? ""));
  const cands = Array.from(lineCands.values()).sort((a, b) => (b.latest ?? "").localeCompare(a.latest ?? ""));
  const activeCount = jobs.length + cands.length;

  return (
    <div className="page" style={{ display: "flex", flexDirection: "column", gap: 14 }}>
      <MatchingPeerTabs counts={counts} activeCount={activeCount} />

      <div style={{ display: "flex", alignItems: "center", gap: 12, flexWrap: "wrap" }}>
        <h1 style={{ margin: 0, fontSize: 22, fontWeight: 800, display: "inline-flex", alignItems: "center", gap: 8 }}>
          <span style={{
            display: "inline-flex", alignItems: "center", justifyContent: "center",
            width: 28, height: 28, borderRadius: 8, background: "#06C755", color: "#fff", fontSize: 16,
          }}>💬</span>
          LINE登録
        </h1>
        <span className="muted" style={{ fontSize: 12.5 }}>
          LINE 経由で接点ができた案件・人材・提案をまとめて確認できます。新規は「LINE/メール貼り付け」で素早く取り込み。
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

      {/* サマリ */}
      <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(180px, 1fr))", gap: 10 }}>
        <Summary label="LINE 提案（合計）" value={proposals.length} />
        <Summary label="LINE 経由の案件" value={jobs.length} />
        <Summary label="LINE 経由の人材" value={cands.length} />
        <Summary label="進行中（見送り/失注以外）" value={proposals.filter((p) => !["見送り", "失注"].includes(p.stage)).length} />
      </div>

      {/* LINE 提案ボード */}
      {proposals.length > 0 && (
        <section style={{ display: "flex", flexDirection: "column", gap: 8 }}>
          <h2 style={{ margin: 0, fontSize: 15, fontWeight: 800, color: "var(--color-ink-2)" }}>LINE 提案ボード</h2>
          <ProposalBoard
            proposals={proposals}
            members={staff.members}
            proposers={owners?.proposers ?? staff.members}
            closers={owners?.closers ?? staff.members}
          />
        </section>
      )}

      {/* 案件・人材リスト（クリックで個別画面へ） */}
      <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(320px, 1fr))", gap: 14 }}>
        <ListCard
          title="LINE 経由の案件"
          empty="まだ LINE 経由の案件はありません。"
          rows={jobs.map((j) => ({
            id: j.id,
            label: j.title || "（タイトル未設定）",
            sub: j.company || "—",
            tail: j.n > 1 ? `${j.n} 件` : null,
            since: daysAgo(j.latest),
            href: `/jobs?focus=${encodeURIComponent(j.id)}`,
          }))}
        />
        <ListCard
          title="LINE 経由の人材"
          empty="まだ LINE 経由の人材はありません。"
          rows={cands.map((c) => ({
            id: c.id,
            label: c.init ? `${c.init}${c.name ? ` / ${c.name}` : ""}` : (c.name || "（イニシャル未設定）"),
            sub: null,
            tail: c.n > 1 ? `${c.n} 件` : null,
            since: daysAgo(c.latest),
            href: `/people?focus=${encodeURIComponent(c.id)}`,
          }))}
        />
      </div>

      {/* LINE 文面テンプレ（最低限の雛形を1つ表示し、コピー導線を提供） */}
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

function Summary({ label, value }: { label: string; value: number }) {
  return (
    <div className="card" style={{ padding: 12, display: "flex", flexDirection: "column", gap: 4 }}>
      <span className="muted" style={{ fontSize: 11 }}>{label}</span>
      <span style={{ fontSize: 22, fontWeight: 800, color: "var(--color-ink)" }}>{value.toLocaleString("ja-JP")}</span>
    </div>
  );
}

function ListCard({ title, rows, empty }: {
  title: string;
  rows: { id: string; label: string; sub: string | null; tail: string | null; since: number | null; href: string }[];
  empty: string;
}) {
  return (
    <div className="card" style={{ padding: 0, overflow: "hidden", display: "flex", flexDirection: "column" }}>
      <div style={{ padding: "10px 14px", borderBottom: "1px solid var(--color-border)", display: "flex", alignItems: "center", gap: 8, background: "#f0fbf5" }}>
        <span style={{ width: 8, height: 8, borderRadius: 99, background: "#06C755" }} />
        <span style={{ fontSize: 13, fontWeight: 800 }}>{title}</span>
        <span className="muted" style={{ marginLeft: "auto", fontSize: 11 }}>{rows.length} 件</span>
      </div>
      {rows.length === 0 ? (
        <div className="muted" style={{ padding: 14, fontSize: 12 }}>{empty}</div>
      ) : (
        <ul style={{ listStyle: "none", margin: 0, padding: 0 }}>
          {rows.slice(0, 30).map((r) => (
            <li key={r.id} style={{ borderTop: "1px solid var(--color-border-soft)" }}>
              <Link href={r.href} style={{ display: "flex", alignItems: "center", gap: 8, padding: "10px 14px", textDecoration: "none", color: "inherit" }}>
                <span style={{ flex: 1, display: "flex", flexDirection: "column", gap: 1, minWidth: 0 }}>
                  <span style={{ fontSize: 12.5, fontWeight: 700, whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>{r.label}</span>
                  {r.sub && <span className="muted" style={{ fontSize: 11 }}>{r.sub}</span>}
                </span>
                {r.tail && <span className="badge" style={{ fontSize: 10 }}>{r.tail}</span>}
                {r.since != null && <span className="muted" style={{ fontSize: 10 }}>{r.since}日前</span>}
              </Link>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

function TemplateCard({ title, body }: { title: string; body: string }) {
  return (
    <div className="card" style={{ padding: 12, display: "flex", flexDirection: "column", gap: 6, border: "1px solid #bfe3cc", background: "#f0fbf5" }}>
      <div style={{ fontSize: 12, fontWeight: 800, color: "#067647", display: "inline-flex", alignItems: "center", gap: 6 }}>
        <span>💬</span>{title}
      </div>
      <pre style={{ margin: 0, fontFamily: "inherit", whiteSpace: "pre-wrap", fontSize: 12, color: "var(--color-ink-2)", lineHeight: 1.6 }}>{body}</pre>
      <CopyButton text={body} />
    </div>
  );
}

