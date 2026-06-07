import { ExportButton, JobImportButton, JobNewButton, JobBulkExtractButton, JobGmailBulkButton } from "@/components/CsvTools";
import { MatchingPeerTabsServer } from "@/components/MatchingPeerTabsServer";
import { EntityTable } from "@/components/EntityTable";
import { JobsTable } from "@/components/JobsTable";
import { PendingClientJobs, type PendingJob } from "@/components/PendingClientJobs";
import { EntityGrowthLine } from "@/components/EntityGrowthLine";
import { NextStepLink } from "@/components/NextStepLink";
import { engerClient, dbConfigured } from "@/lib/supabase";
import { getStaff } from "@/lib/staff";
import { getEntityDelta } from "@/lib/import-stats";
import { getViewerScope, maskJobs } from "@/lib/tenant";

export const dynamic = "force-dynamic";

const JOB_EXPORT_HEADERS = [
  { key: "job_no", label: "案件番号" }, { key: "title", label: "案件名" }, { key: "client_name", label: "クライアント" },
  { key: "role_label", label: "職種" }, { key: "skillsCsv", label: "スキル" }, { key: "salary_min", label: "単価下限" },
  { key: "salary_max", label: "単価上限" }, { key: "remoteLabel", label: "リモート" },
];

const remoteLabel = (r: string | null) =>
  r === "full_remote" ? "フルリモート" : r === "partial_remote" ? "一部リモート" : r === "onsite" ? "出社" : (r || "—");

const PAGE_SIZE = 20;

// リモート（固定の選択肢）。表示は日本語、値は DB の remote_type 生値。
const REMOTE_OPTIONS = [
  { value: "full_remote", label: "フルリモート" },
  { value: "partial_remote", label: "一部リモート" },
  { value: "onsite", label: "出社" },
];
// ステータス（鮮度：作成日からの経過日数）
const FRESH_OPTIONS = [
  { value: "新着", label: "新着" },
  { value: "3日以内", label: "3日以内" },
  { value: "4〜14日前", label: "4〜14日前" },
  { value: "それ以前", label: "それ以前" },
];
// 単価ランク帯: A=90万〜 / B=70〜89万 / C=〜69万
const RANK_OPTIONS = [
  { value: "A", label: "A（90万円〜）" },
  { value: "B", label: "B（70〜89万円）" },
  { value: "C", label: "C（〜69万円）" },
];

// 鮮度ラベル → created_at の範囲（クライアント側の freshnessLabel と同じ境界）
const freshRange = (label: string): { gte?: string; lt?: string } | null => {
  const now = Date.now(), day = 86400000;
  const iso = (ms: number) => new Date(ms).toISOString();
  switch (label) {
    case "新着": return { gte: iso(now - day) };
    case "3日以内": return { gte: iso(now - 4 * day), lt: iso(now - day) };
    case "4〜14日前": return { gte: iso(now - 15 * day), lt: iso(now - 4 * day) };
    case "それ以前": return { lt: iso(now - 15 * day) };
    default: return null;
  }
};

// ランク帯 → salary_max（無ければ salary_min）に対する PostgREST or 条件
const rankOr = (band: string): string | null => {
  switch (band) {
    case "A": return "salary_max.gte.90,and(salary_max.is.null,salary_min.gte.90)";
    case "B": return "and(salary_max.gte.70,salary_max.lt.90),and(salary_max.is.null,salary_min.gte.70,salary_min.lt.90)";
    case "C": return "salary_max.lt.70,and(salary_max.is.null,salary_min.lt.70)";
    default: return null;
  }
};

export default async function JobsPage({ searchParams }: { searchParams: Promise<{ client?: string; show?: string; q?: string; page?: string; f_status?: string; f_role?: string; f_remote?: string; f_flow?: string; f_rank?: string; f_outside_owner?: string }> }) {
  const sp = await searchParams;
  const { client, show, q } = sp;
  const showAll = show === "all"; // 非公開（過去インポートで隠れている案件）も表示
  const needle = (q ?? client ?? "").trim();
  const page = Math.max(1, parseInt(sp.page ?? "1", 10) || 1);
  // サーバ側フィルタ（URL の f_* と対応）
  const fStatus = sp.f_status ?? "";
  const fRole = sp.f_role ?? "";
  const fRemote = sp.f_remote ?? "";
  const fFlow = sp.f_flow ?? "";
  const fRank = sp.f_rank ?? "";
  const fOwner = sp.f_outside_owner ?? "";
  const scope = await getViewerScope();
  let jobs: any[] = [];
  let total = 0;
  let pageCount = 1;
  let roleOptionVals: string[] = [];
  let flowOptionVals: string[] = [];
  let dbError: string | null = null;

  // パートナー企業：自社(owner_company)＋共有(shared)のみ。他社は匿名化。列が無ければ何も見せない(fail-closed)。
  if (scope.isTenant) {
    if (dbConfigured && scope.ownerKey) {
      try {
        const sb = engerClient();
        const cols = "job_no, title, client_name, role_label, salary_min, salary_max, remote_type, rank, skills, is_focus, flow_note, work_location, status, detail, created_at, is_published, owner_company, shared";
        const ownedRes: any = await sb.from("jobs").select(cols).eq("owner_company", scope.ownerKey).order("job_no", { ascending: false }).limit(1000);
        const sharedRes: any = await sb.from("jobs").select(cols).eq("shared", true).eq("is_published", true).order("job_no", { ascending: false }).limit(1000);
        if (ownedRes.error || sharedRes.error) { dbError = "テナント分離用の列が未整備です（supabase/partner-tenant.sql を実行してください）"; }
        else {
          const map = new Map<number, any>();
          for (const r of [...(ownedRes.data ?? []), ...(sharedRes.data ?? [])]) if (r.job_no != null) map.set(r.job_no, r);
          // 二重の安全網：app側でも「自社 or 共有」に限定してから匿名化
          const rows = [...map.values()].filter((r) => r.owner_company === scope.ownerKey || r.shared === true);
          jobs = maskJobs(rows, scope.ownerKey, scope.meetingDone);
          total = jobs.length;
        }
      } catch (e) { dbError = e instanceof Error ? e.message : String(e); }
    } else if (!scope.ownerKey) {
      dbError = "会社情報が未設定です。管理者にお問い合わせください。";
    }
  } else if (dbConfigured) {
    try {
      const sb = engerClient();
      const baseCols = "job_no, title, client_name, role_label, salary_min, salary_max, remote_type, rank, skills, is_focus, flow_note, work_location, status, detail, created_at, is_published";
      const from = (page - 1) * PAGE_SIZE;
      const to = from + PAGE_SIZE - 1;
      const fresh = fStatus ? freshRange(fStatus) : null;
      const rOr = fRank ? rankOr(fRank) : null;

      // 検索＋フィルタを 1 本のクエリに集約（outside_owner フィルタだけは列の有無に依存するため別関数）
      const buildBase = (selectCols: string) => {
        let qb: any = sb.from("jobs").select(selectCols, { count: "exact" });
        if (!showAll) qb = qb.eq("is_published", true);
        if (needle) {
          const like = `%${needle.replace(/[%_]/g, (m) => "\\" + m)}%`;
          const numOr = /^\d+$/.test(needle) ? `,job_no.eq.${parseInt(needle, 10)}` : "";
          qb = qb.or(`title.ilike.${like},client_name.ilike.${like}${numOr}`);
        }
        if (fRole) qb = qb.eq("role_label", fRole);
        if (fRemote) qb = qb.eq("remote_type", fRemote);
        if (fFlow) qb = fFlow === "不明" ? qb.or("flow_note.is.null,flow_note.eq.") : qb.eq("flow_note", fFlow);
        if (rOr) qb = qb.or(rOr);
        if (fresh?.gte) qb = qb.gte("created_at", fresh.gte);
        if (fresh?.lt) qb = qb.lt("created_at", fresh.lt);
        return qb;
      };
      const withOwner = (qb: any) =>
        fOwner ? (fOwner === "未設定" ? qb.is("outside_owner", null) : qb.eq("outside_owner", fOwner)) : qb;
      const order = (qb: any) => qb.order("job_no", { ascending: false }).range(from, to);

      let listRes: any = await order(withOwner(buildBase(`${baseCols}, outside_owner, contact_email, contact_name, source_mail_url`)));
      if (listRes.error) listRes = await order(withOwner(buildBase(`${baseCols}, outside_owner`)));
      if (listRes.error) listRes = await order(buildBase(baseCols)); // outside_owner 列が無い環境では担当フィルタは無効
      jobs = listRes.data ?? [];
      total = listRes.count ?? jobs.length;
      pageCount = Math.max(1, Math.ceil(total / PAGE_SIZE));

      // フィルタ用の選択肢（職種・商流の distinct）。一覧の絞り込みとは独立に全体から収集。
      try {
        let oq: any = sb.from("jobs").select("role_label, flow_note");
        if (!showAll) oq = oq.eq("is_published", true);
        const optRes: any = await oq.limit(5000);
        const roleSet = new Set<string>(), flowSet = new Set<string>();
        for (const r of optRes.data ?? []) {
          if (r.role_label) roleSet.add(r.role_label);
          if (r.flow_note) flowSet.add(r.flow_note);
        }
        roleOptionVals = [...roleSet].sort((a, b) => a.localeCompare(b, "ja"));
        flowOptionVals = [...flowSet].sort((a, b) => a.localeCompare(b, "ja"));
      } catch { /* 列が無ければ動的選択肢なしで継続 */ }
    } catch (e) {
      dbError = e instanceof Error ? e.message : String(e);
    }
  } else {
    dbError = "Supabase の環境変数が未設定です（.env.local / Vercel env）";
  }

  // 企業掲載の承認待ち案件（社内のみ。パートナーには見せない）
  let pendingClientJobs: PendingJob[] = [];
  if (dbConfigured && !scope.isTenant) {
    try {
      const sb = engerClient();
      const { data } = await sb.from("jobs")
        .select("job_no, title, client_name, role_label, salary_min, salary_max, contract_types, description, posted_by_email, created_at")
        .eq("posted_by_client", true).eq("review_status", "pending")
        .order("created_at", { ascending: false }).limit(50);
      pendingClientJobs = (data ?? []) as PendingJob[];
    } catch { /* 列未追加なら無視 */ }
  }

  // エンド担当の選択肢（アウトサイド、無ければ全担当者）。パートナーには社内担当者名を渡さない。
  const staff = scope.isTenant ? { rows: [] as any[] } : await getStaff();
  const outsideNames = staff.rows.filter((s: any) => s.position === "outside").map((s: any) => s.name);
  const ownerOptions = outsideNames.length ? outsideNames : staff.rows.map((s: any) => s.name);
  const growth = scope.isTenant ? { total: jobs.length, last7: 0 } as any : await getEntityDelta("jobs");

  // JobsTable（社内・サーバ駆動）に渡すフィルタの現在値と選択肢
  const jobFilters = { status: fStatus, role: fRole, remote: fRemote, flow: fFlow, rank: fRank, outside_owner: fOwner };
  const jobFilterOptions = {
    status: FRESH_OPTIONS,
    role: roleOptionVals.map((v) => ({ value: v, label: v })),
    remote: REMOTE_OPTIONS,
    flow: ["不明", ...flowOptionVals].map((v) => ({ value: v, label: v })),
    rank: RANK_OPTIONS,
    outside_owner: ["未設定", ...ownerOptions].map((v) => ({ value: v, label: v })),
  };

  return (
    <div className="page">
      {/* page-head: ボタンが多いため、タイトル列に flex:1 / minWidth:0 を与えてつぶれないようにし、
          ボタン列は flex-wrap で必要に応じて折り返す（狭幅で h1 が縦に潰れるレイアウト崩れの対策）。 */}
      <div className="page-head" style={{ flexWrap: "wrap" }}>
        <div style={{ flex: "1 1 240px", minWidth: 0 }}>
          <div className="meta">Jobs · 案件マスタ（実データ）</div>
          <h1>案件</h1>
          <EntityGrowthLine unit="件" delta={growth} />
        </div>
        <div style={{ display: "flex", gap: 8, flexShrink: 0, alignItems: "center", flexWrap: "wrap", justifyContent: "flex-end" }}>
          {!scope.isTenant && <NextStepLink href="/matching" label="マッチングで人材を探す" hint="案件×人材のマッチング画面へ" />}
          {!scope.isTenant && (
            <a href={showAll ? "/jobs" : "/jobs?show=all"} className="btn ghost" style={{ textDecoration: "none", fontSize: 12 }}
              title={showAll ? "公開中の案件のみ表示" : "非公開（過去インポートで一覧に出ていない案件）も含めて表示"}>
              {showAll ? "公開中のみ表示" : "非公開も表示"}
            </a>
          )}
          {!scope.isTenant && <ExportButton filename="案件一覧.csv" headers={JOB_EXPORT_HEADERS} rows={jobs.map((j) => ({ ...j, skillsCsv: (j.skills ?? []).join(" / "), remoteLabel: remoteLabel(j.remote_type) }))} />}
          <JobNewButton />
          {!scope.isTenant && <JobGmailBulkButton />}
          {!scope.isTenant && <JobBulkExtractButton />}
          {!scope.isTenant && <JobImportButton />}
        </div>
      </div>

      {!scope.isTenant && <MatchingPeerTabsServer />}

      {scope.isTenant && (
        <div className="card" style={{ background: "#eef2ff", borderColor: "#c7d2fe", fontSize: 12.5, color: "var(--color-ink-2)" }}>
          <b>パートナー表示</b>：自社で登録した案件と、共有された案件のみ表示しています。<b>他社の案件はクライアント名・連絡先を伏せた匿名表示</b>です。
        </div>
      )}
      {!scope.isTenant && showAll && (
        <div className="card" style={{ background: "var(--color-brand-25)", borderColor: "var(--color-brand-100)", fontSize: 12.5 }}>
          <b>非公開を含めて表示中。</b> 公開フラグ（is_published）が立っていない案件も表示しています。手動登録で同名案件が「重複」になる場合、ここに隠れた既存案件が原因です。該当案件を開いて編集・再公開できます。
        </div>
      )}

      {dbError && (
        <div className="card" style={{ borderColor: "var(--color-danger)", color: "var(--color-danger)" }}>
          <b>DB接続エラー：</b> {dbError}
        </div>
      )}

      {!scope.isTenant && <PendingClientJobs jobs={pendingClientJobs} />}

      {scope.isTenant ? (
        // パートナー（テナント隔離）：自社＋共有のみの限定データをクライアント側で表示（従来通り）
        <EntityTable kind="jobs" rows={jobs} total={total} initialQuery={needle || undefined} outsideOptions={ownerOptions} partner meetingDone={scope.meetingDone}
          agentContact={{ line: process.env.NEXT_PUBLIC_AGENT_LINE_URL, email: process.env.NEXT_PUBLIC_AGENT_EMAIL, phone: process.env.NEXT_PUBLIC_AGENT_PHONE }} />
      ) : (
        // 社内：フィルタ・ページングをサーバ側で処理（1ページ20件・URL同期）
        <JobsTable rows={jobs} page={page} pageCount={pageCount} total={total} pageSize={PAGE_SIZE}
          query={needle} filters={jobFilters} filterOptions={jobFilterOptions} outsideOptions={ownerOptions} meetingDone={scope.meetingDone} />
      )}
    </div>
  );
}
