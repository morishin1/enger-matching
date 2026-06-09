// ゴミ箱（人材・案件）。
//   ・タブで「人材／案件」を切替
//   ・各行に「復元」「完全削除」（完全削除は admin のみ）
//   ・上部に「6/1以前を一括ゴミ箱へ」入口（一覧ページの方ではなく、ここから操作する想定）
//   サイドバーからは直接アクセスせず、案件/人材一覧ページから「ゴミ箱」リンクで来る運用。

import Link from "next/link";
import { redirect } from "next/navigation";
import { engerClient, engerAdmin, dbConfigured } from "@/lib/supabase";
import { currentAccess } from "@/lib/accounts";
import { TrashClient } from "@/components/TrashClient";

export const dynamic = "force-dynamic";

type Tab = "jobs" | "candidates";

export default async function TrashPage({ searchParams }: { searchParams: Promise<{ tab?: string }> }) {
  const access = await currentAccess();
  if (!access) redirect("/login?next=/trash");
  const isAdmin = access.role === "admin";
  const sp = await searchParams;
  const tab: Tab = sp.tab === "candidates" ? "candidates" : "jobs";

  let jobsTrash: any[] = [];
  let candsTrash: any[] = [];
  let needSetup = false;

  if (dbConfigured) {
    try {
      // ゴミ箱は admin（service role）で読む。公開クライアントだと RLS が deleted_at
      //   付きの行を隠す設定の場合に「0件」になる事故があるため（人材で発生）。
      let sb: ReturnType<typeof engerClient>;
      try { sb = engerAdmin(); } catch { sb = engerClient(); }
      const j: any = await sb.from("jobs")
        .select("job_no, title, client_name, created_at, deleted_at")
        .not("deleted_at", "is", null).order("deleted_at", { ascending: false }).limit(1000);
      // 人材は列構成の差異（initials/source_company が無い環境）でも落ちないようフォールバック。
      let c: any = await sb.from("candidates")
        .select("candidate_no, name, initials, source_company, company, created_at, deleted_at")
        .not("deleted_at", "is", null).order("deleted_at", { ascending: false }).limit(1000);
      if (c.error) c = await sb.from("candidates")
        .select("candidate_no, name, company, created_at, deleted_at")
        .not("deleted_at", "is", null).order("deleted_at", { ascending: false }).limit(1000);
      if (c.error) c = await sb.from("candidates")
        .select("candidate_no, name, created_at, deleted_at")
        .not("deleted_at", "is", null).order("deleted_at", { ascending: false }).limit(1000);
      if (j.error && /deleted_at|column/i.test(j.error.message)) needSetup = true;
      else { jobsTrash = j.data ?? []; candsTrash = c.error ? [] : (c.data ?? []); }
    } catch { /* ignore */ }
  }

  return (
    <div className="page">
      <div className="page-head">
        <div style={{ maxWidth: 820 }}>
          <div className="meta">Trash · ゴミ箱</div>
          <h1>ゴミ箱</h1>
          <div className="sub">削除した案件・人材はここに入ります。<b>復元</b>すれば一覧に戻り、<b>完全削除</b>はもう戻せません{isAdmin ? "" : "（管理者のみ）"}。</div>
        </div>
      </div>

      {needSetup && (
        <div className="card" style={{ background: "var(--color-brand-25)", borderColor: "var(--color-brand-100)" }}>
          <b>ゴミ箱機能の準備が未完了です。</b> Supabase SQL Editor で <span className="mono">supabase/trash.sql</span> を実行してください。
        </div>
      )}

      {!needSetup && (
        <>
          <div role="tablist" style={{ display: "flex", gap: 2, borderBottom: "1px solid var(--color-border)", marginBottom: 14 }}>
            <Link href="/trash?tab=jobs" role="tab" aria-selected={tab === "jobs"}
              style={tabStyle(tab === "jobs")}>案件（{jobsTrash.length}）</Link>
            <Link href="/trash?tab=candidates" role="tab" aria-selected={tab === "candidates"}
              style={tabStyle(tab === "candidates")}>人材（{candsTrash.length}）</Link>
          </div>

          <TrashClient kind={tab} rows={tab === "jobs" ? jobsTrash : candsTrash} isAdmin={isAdmin} />
        </>
      )}
    </div>
  );
}

function tabStyle(on: boolean): React.CSSProperties {
  return {
    padding: "10px 18px",
    borderBottom: on ? "3px solid var(--color-brand-600)" : "3px solid transparent",
    color: on ? "var(--color-brand-700)" : "var(--color-ink-2)",
    fontWeight: on ? 800 : 600, fontSize: 14, textDecoration: "none",
  };
}
