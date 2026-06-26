import { ExportButton, JobImportButton, JobNewButton, JobBulkExtractButton, JobGmailBulkButton } from "@/components/CsvTools";
import { MatchingPeerTabsServer } from "@/components/MatchingPeerTabsServer";
import { EntityTable } from "@/components/EntityTable";
import { currentAccess } from "@/lib/accounts";
import { JobsTable } from "@/components/JobsTable";
import { PendingClientJobs, type PendingJob } from "@/components/PendingClientJobs";
import { EntityGrowthLine } from "@/components/EntityGrowthLine";
import { NextStepLink } from "@/components/NextStepLink";
import { engerClient, dbConfigured } from "@/lib/supabase";
import { getStaff } from "@/lib/staff";
import { getEntityDelta } from "@/lib/import-stats";
import { getViewerScope, maskJobs } from "@/lib/tenant";
import { JOB_NAT_SQL_KEYS } from "@/lib/nationality";
import { JOB_FLOW_OPTIONS } from "@/lib/flow";
import { getApprovedCompanySet, isCompanyApproved } from "@/lib/company-approval";
import { attachLatestSourceMail } from "@/lib/source-mail";

export const dynamic = "force-dynamic";

const JOB_EXPORT_HEADERS = [
  { key: "job_no", label: "案件番号" }, { key: "title", label: "案件名" }, { key: "client_name", label: "クライアント" },
  { key: "role_label", label: "職種" }, { key: "skillsCsv", label: "スキル" }, { key: "salary_min", label: "単価下限" },
  { key: "salary_max", label: "単価上限" }, { key: "remoteLabel", label: "リモート" },
];

const remoteLabel = (r: string | null) =>
  r === "full_remote" ? "フルリモート" : r === "partial_remote" ? "一部リモート" : r === "onsite" ? "出社" : (r || "—");

const PAGE_SIZE = 20;

/** ?focus=<UUID|job_no> で渡された案件を別途 fetch（ページング・フィルタを跨いでも開けるように）。
 *  LINE登録ページや別所からの「案件詳細を開く」リンクで、現ページに該当行が居なくてもドロワーを表示できる。 */
async function fetchFocusJob(focus?: string | null): Promise<any | null> {
  const v = String(focus ?? "").trim();
  if (!v || !dbConfigured) return null;
  try {
    const sb = engerClient();
    const cols = "id, job_no, title, client_name, role_label, salary_min, salary_max, remote_type, rank, skills, is_focus, flow_note, work_location, status, detail, contact_name, contact_email, source_mail_url, start_date, is_closed, signup_source, created_at, is_published";
    const isUuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(v);
    const isNum  = /^\d+$/.test(v);
    let r: any;
    if (isUuid)      r = await sb.from("jobs").select(cols).eq("id", v).maybeSingle();
    else if (isNum)  r = await sb.from("jobs").select(cols).eq("job_no", Number(v)).maybeSingle();
    else             return null;
    if (r.error || !r.data) return null;
    return r.data;
  } catch { return null; }
}

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
// 国籍要件（案件本文から ilike 近似）。外国籍NG（=日本国籍のみ）を見落とさないため。
const NATIONALITY_OPTIONS = [
  { value: "jp_only", label: "日本国籍のみ" },
  { value: "open", label: "国籍不問" },
  { value: "unknown", label: "不明" },
];
// 商流フィルタは新マトリックスの固定カテゴリ。
//   ・各カテゴリは「正規ラベル」と同義語ラベルにマッチする（DBの自由文との突合用）。
//   ・案件「貴社一社正社員まで」と「貴社一社先正社員まで」は同義語として統合（jp_to_1_seishain）。
const FLOW_CAT_TO_LABELS: Record<string, string[]> = {
  jp_to_self:          ["貴社まで"],
  jp_to_self_seishain: ["貴社正社員まで"],
  jp_to_1:             ["貴社一社まで"],
  jp_to_1_seishain:    ["貴社一社正社員まで", "貴社一社先正社員まで"],
  jp_to_2:             ["貴社二社まで"],
  jp_to_2_seishain:    ["貴社二社正社員まで"],
  any:                 ["商流不問"],
};
const escapeLike = (s: string) => s.replace(/[%_]/g, (m) => "\\" + m);

// 商流制限の粗フィルタ（あり/なし）。flow_note は自由文のため ilike で近似。
//   none(制限なし)       = 商流不問の記載がある
//   restricted(制限あり) = 記載があり かつ 不問/不明 ではない（何らかの商流制限）
const applyFlowLimit = (qb: any, v: string) => {
  if (v === "none") return qb.ilike("flow_note", "%不問%");
  if (v === "restricted") return qb
    .not("flow_note", "is", null).neq("flow_note", "")
    .not("flow_note", "ilike", "%不問%").not("flow_note", "ilike", "%不明%");
  return qb;
};
const ilikeOr = (keys: readonly string[], fields: string[]) =>
  fields.flatMap((f) => keys.map((k) => `${f}.ilike.%${escapeLike(k)}%`)).join(",");

// 鮮度ラベル → created_at の範囲（クライアント側の freshnessLabel と同じ境界）
// 登録元フィルタ（LINE登録タブ廃止に伴い、案件一覧で LINE/通常 を絞り込めるように）。
const SIGNUP_SOURCE_OPTIONS = [
  { value: "line", label: "LINE登録" },
  { value: "normal", label: "通常（CSV/手動/メール）" },
];
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

export default async function JobsPage({ searchParams }: { searchParams: Promise<{ client?: string; show?: string; q?: string; page?: string; f_status?: string; f_role?: string; f_remote?: string; f_flow?: string; f_flow_limit?: string; f_rank?: string; f_outside_owner?: string; f_nationality?: string; f_approved?: string; f_signup_source?: string; f_no_proposal?: string; focus?: string }> }) {
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
  // 商流制限の粗い切り分け：restricted=制限あり / none=制限なし(商流不問)。空=すべて。
  const fFlowLimit = sp.f_flow_limit ?? "";
  const fRank = sp.f_rank ?? "";
  const fOwner = sp.f_outside_owner ?? "";
  const fNat = sp.f_nationality ?? "";
  // 承認状況フィルタ：approved=打合せ済企業のみ / unapproved=未承認のみ。空=すべて。
  const fApproved = sp.f_approved ?? "";
  const fSignupSource = sp.f_signup_source ?? "";
  // 「提案あり」除外フィルタ：提案実績のある案件（has_proposal）を一覧から除外する。
  const fNoProposal = sp.f_no_proposal === "1";
  const scope = await getViewerScope();
  // CSV書き出しは admin もしくはバックオフィス職能のみ許可（情報持ち出し防止）
  const access = await currentAccess();
  const canExportCsv = !access || access.role === "admin" || (access.functions ?? []).includes("バックオフィス");
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
        // id / contact_email / source_mail_url はドロワーでの focus 自動オープン・メール/元メールボタンに使う。
        const cols = "id, job_no, title, client_name, role_label, salary_min, salary_max, remote_type, rank, skills, is_focus, flow_note, work_location, status, detail, contact_name, contact_email, source_mail_url, start_date, created_at, is_published, owner_company, shared";
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
      // ドロワー（モーダル）表示の元メール・窓口メールに使う列を含める。
      const baseCols = "id, job_no, title, client_name, role_label, salary_min, salary_max, remote_type, rank, skills, is_focus, flow_note, work_location, status, detail, contact_name, contact_email, source_mail_url, start_date, created_at, is_published";
      const from = (page - 1) * PAGE_SIZE;
      const to = from + PAGE_SIZE - 1;
      const fresh = fStatus ? freshRange(fStatus) : null;
      const rOr = fRank ? rankOr(fRank) : null;

      // 承認状況フィルタ：client_name が打合せ済（承認）企業かで絞る。
      //   旧実装は承認済み企業「名」を or(...not.in...) 文字列に展開しており、対象が多い・特殊文字を
      //   含むと PostgREST クエリが失敗する潜在リスクがあった（人材一覧で同型の不具合が発生）。
      //   対策として、承認済みの job_no を事前に解決し、整数の in()/not.in() で安全に絞る。
      //   判定は isCompanyApproved（バリアント承認のカスケード込み）を使い、一覧バッジと一致させる。
      let approvedJobNos: number[] = [];
      let approvalReady = false;
      if (fApproved) {
        try {
          const approvedSet = await getApprovedCompanySet();
          if (approvedSet.size) {
            // ★ PostgREST の max-rows（既定1000）で頭打ちにならないよう range でページ送りして全件走査する。
            //   以前は .limit(20000) でも 1000 件で打ち切られ、1000件目以降の承認済み案件が
            //   「未承認」フィルタに漏れていた（バッジは各行個別判定のため承認済み表示になり不一致）。
            const PAGE = 1000;
            let useTrashFilter = true;
            for (let off = 0; off <= 200000; off += PAGE) {
              let r: any = useTrashFilter
                ? await sb.from("jobs").select("job_no, client_name").is("deleted_at", null).order("job_no", { ascending: true }).range(off, off + PAGE - 1)
                : await sb.from("jobs").select("job_no, client_name").order("job_no", { ascending: true }).range(off, off + PAGE - 1);
              if (r.error && useTrashFilter) { useTrashFilter = false; off -= PAGE; continue; } // deleted_at 列が無い旧環境は外して再試行
              if (r.error) break;
              const rows = (r.data ?? []) as any[];
              for (const row of rows) {
                if (row.job_no == null) continue;
                if (isCompanyApproved(approvedSet, row.client_name)) approvedJobNos.push(row.job_no);
              }
              if (rows.length < PAGE) break; // 最終ページ
            }
          }
          approvalReady = true;
        } catch { /* 取得失敗時はフィルタ無効（全件表示にフォールバック） */ }
      }
      const applyApproved = (qb: any) => {
        if (!fApproved || !approvalReady) return qb;
        if (fApproved === "approved") return approvedJobNos.length ? qb.in("job_no", approvedJobNos) : qb.eq("job_no", -1);
        if (fApproved === "unapproved") return approvedJobNos.length ? qb.not("job_no", "in", `(${approvedJobNos.join(",")})`) : qb;
        return qb;
      };

      // 「提案あり」除外：提案実績のある job_id を事前に集め、id の not.in で一覧から外す。
      //   ページング前に DB 側で除外しないと件数・ページ数がズレるため、ここで解決する（承認フィルタと同方針）。
      let proposedJobIds: string[] = [];
      if (fNoProposal) {
        try {
          const pr: any = await sb.from("proposals").select("job_id").not("job_id", "is", null).limit(20000);
          if (!pr.error) proposedJobIds = Array.from(new Set((pr.data ?? []).map((r: any) => r.job_id).filter(Boolean)));
        } catch { /* proposals 未整備時は除外せず全件表示にフォールバック */ }
      }
      const applyNoProposal = (qb: any) => (fNoProposal && proposedJobIds.length) ? qb.not("id", "in", `(${proposedJobIds.join(",")})`) : qb;

      // 検索＋フィルタを 1 本のクエリに集約（outside_owner フィルタだけは列の有無に依存するため別関数）
      const buildBase = (selectCols: string, hideClosed = false) => {
        let qb: any = sb.from("jobs").select(selectCols, { count: "exact" });
        // ゴミ箱（deleted_at not null）は一覧に出さない。列が無い旧環境ではフォールバックで is() を外す。
        qb = qb.is("deleted_at", null);
        // クローズ済は一覧の初期表示から外す（検索時のみ表示）。
        if (hideClosed) qb = qb.eq("is_closed", false);
        if (!showAll) qb = qb.eq("is_published", true);
        if (needle) {
          const like = `%${needle.replace(/[%_]/g, (m) => "\\" + m)}%`;
          // ID 検索：「123」「No.123」「No.00123」「#123」のいずれでも job_no で一致させる。
          const idm = needle.match(/^(?:no\.?\s*|#)?(\d+)$/i);
          const numOr = idm ? `,job_no.eq.${parseInt(idm[1], 10)}` : "";
          qb = qb.or(`title.ilike.${like},client_name.ilike.${like}${numOr}`);
        }
        if (fRole) qb = qb.eq("role_label", fRole);
        if (fSignupSource === "line") qb = qb.eq("signup_source", "line");
        else if (fSignupSource === "normal") qb = qb.or("signup_source.is.null,signup_source.neq.line");
        if (fRemote) qb = qb.eq("remote_type", fRemote);
        if (fFlow) {
          if (fFlow === "unknown") qb = qb.or("flow_note.is.null,flow_note.eq.");
          else {
            const labels = FLOW_CAT_TO_LABELS[fFlow] ?? [];
            if (labels.length > 0) qb = qb.in("flow_note", labels);
          }
        }
        if (fFlowLimit) qb = applyFlowLimit(qb, fFlowLimit);
        if (rOr) qb = qb.or(rOr);
        // 国籍要件（案件本文の ilike 近似）。jp_only/open は該当語を含む、unknown は言及語を一切含まない。
        //   unknown は本文が空(null)も含めたいので「is.null または 言及語をすべて含まない」で field 毎に絞る。
        if (fNat === "jp_only") qb = qb.or(ilikeOr(JOB_NAT_SQL_KEYS.jp_only, ["detail", "title"]));
        else if (fNat === "open") qb = qb.or(ilikeOr(JOB_NAT_SQL_KEYS.open, ["detail", "title"]));
        else if (fNat === "unknown") {
          const noMention = (field: string) =>
            `${field}.is.null,and(${JOB_NAT_SQL_KEYS.mention.map((k) => `${field}.not.ilike.%${escapeLike(k)}%`).join(",")})`;
          qb = qb.or(noMention("detail")).or(noMention("title"));
        }
        if (fresh?.gte) qb = qb.gte("created_at", fresh.gte);
        if (fresh?.lt) qb = qb.lt("created_at", fresh.lt);
        qb = applyApproved(qb);
        qb = applyNoProposal(qb);
        return qb;
      };
      const withOwner = (qb: any) =>
        fOwner ? (fOwner === "未設定" ? qb.is("outside_owner", null) : qb.eq("outside_owner", fOwner)) : qb;
      const order = (qb: any) => qb.order("job_no", { ascending: false }).range(from, to);

      // deleted_at 列が未マイグレ環境では .is("deleted_at", null) がエラーになるので、
      // フォールバックで buildBase 内のフィルタを取り除いた版を作る。
      const buildBaseNoTrash = (selectCols: string) => {
        let qb: any = sb.from("jobs").select(selectCols, { count: "exact" });
        if (!showAll) qb = qb.eq("is_published", true);
        if (needle) {
          const like = `%${needle.replace(/[%_]/g, (m) => "\\" + m)}%`;
          // ID 検索：「123」「No.123」「No.00123」「#123」のいずれでも job_no で一致させる。
          const idm = needle.match(/^(?:no\.?\s*|#)?(\d+)$/i);
          const numOr = idm ? `,job_no.eq.${parseInt(idm[1], 10)}` : "";
          qb = qb.or(`title.ilike.${like},client_name.ilike.${like}${numOr}`);
        }
        if (fRole) qb = qb.eq("role_label", fRole);
        if (fSignupSource === "line") qb = qb.eq("signup_source", "line");
        else if (fSignupSource === "normal") qb = qb.or("signup_source.is.null,signup_source.neq.line");
        if (fRemote) qb = qb.eq("remote_type", fRemote);
        if (fFlow) {
          if (fFlow === "unknown") qb = qb.or("flow_note.is.null,flow_note.eq.");
          else {
            const labels = FLOW_CAT_TO_LABELS[fFlow] ?? [];
            if (labels.length > 0) qb = qb.in("flow_note", labels);
          }
        }
        if (fFlowLimit) qb = applyFlowLimit(qb, fFlowLimit);
        if (rOr) qb = qb.or(rOr);
        if (fNat === "jp_only") qb = qb.or(ilikeOr(JOB_NAT_SQL_KEYS.jp_only, ["detail", "title"]));
        else if (fNat === "open") qb = qb.or(ilikeOr(JOB_NAT_SQL_KEYS.open, ["detail", "title"]));
        if (fresh?.gte) qb = qb.gte("created_at", fresh.gte);
        if (fresh?.lt) qb = qb.lt("created_at", fresh.lt);
        qb = applyApproved(qb);
        qb = applyNoProposal(qb);
        return qb;
      };
      const hideClosed = !needle; // 検索時はクローズ済も表示し、未検索の一覧では隠す。
      let listRes: any = await order(withOwner(buildBase(`${baseCols}, is_closed, outside_owner, contact_email, contact_name, source_mail_url, signup_source`, hideClosed)));
      if (listRes.error && /deleted_at|is_closed|column/i.test(listRes.error.message)) {
        listRes = await order(withOwner(buildBaseNoTrash(`${baseCols}, outside_owner, contact_email, contact_name, source_mail_url`)));
      }
      if (listRes.error) listRes = await order(withOwner(buildBase(`${baseCols}, outside_owner`)));
      if (listRes.error) listRes = await order(buildBase(baseCols)); // outside_owner 列が無い環境では担当フィルタは無効
      jobs = listRes.data ?? [];
      total = listRes.count ?? jobs.length;
      pageCount = Math.max(1, Math.ceil(total / PAGE_SIZE));
      // 承認(打合せ済)バッジ用に、各行へ client_name の承認状態を付与。
      try {
        const approvedSet = await getApprovedCompanySet();
        for (const j of jobs) (j as any).client_approved = isCompanyApproved(approvedSet, j.client_name);
      } catch { /* 承認集合の取得失敗は無視（バッジ非表示） */ }

      // 「提案あり」タグ用：この案件に紐づく提案が1件でもあるかを付与（誤削除防止の目印）。
      try {
        const ids = jobs.map((j: any) => j.id).filter(Boolean) as string[];
        if (ids.length > 0) {
          const pr: any = await sb.from("proposals").select("job_id").in("job_id", ids).limit(5000);
          if (!pr.error) {
            const set = new Set<string>((pr.data ?? []).map((r: any) => r.job_id).filter(Boolean));
            for (const j of jobs) (j as any).has_proposal = set.has((j as any).id);
          }
        }
      } catch { /* proposals 未整備でも無視 */ }

      // 「元メール」リンクを直近受信メールへ更新（同案件／同送信元の最新メールに飛ぶ）。
      await attachLatestSourceMail(sb, "job", jobs);

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
  const jobFilters = { status: fStatus, role: fRole, remote: fRemote, flow: fFlow, flow_limit: fFlowLimit, rank: fRank, outside_owner: fOwner, nationality: fNat, approved: fApproved, signup_source: fSignupSource, no_proposal: fNoProposal ? "1" : "" };
  const jobFilterOptions = {
    status: FRESH_OPTIONS,
    role: roleOptionVals.map((v) => ({ value: v, label: v })),
    remote: REMOTE_OPTIONS,
    nationality: NATIONALITY_OPTIONS,
    flow: [...JOB_FLOW_OPTIONS, { value: "unknown", label: "不明" }],
    rank: RANK_OPTIONS,
    outside_owner: ["未設定", ...ownerOptions].map((v) => ({ value: v, label: v })),
    approved: [{ value: "approved", label: "承認済みのみ" }, { value: "unapproved", label: "未承認のみ" }],
    signup_source: SIGNUP_SOURCE_OPTIONS,
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
          {!scope.isTenant && canExportCsv && <ExportButton filename="案件一覧.csv" headers={JOB_EXPORT_HEADERS} rows={jobs.map((j) => ({ ...j, skillsCsv: (j.skills ?? []).join(" / "), remoteLabel: remoteLabel(j.remote_type) }))} />}
          {!scope.isTenant && <a href="/trash?tab=jobs" className="btn ghost" style={{ textDecoration: "none", fontSize: 12 }} title="削除した案件の復元 / 6/1以前を一括ゴミ箱へ"><span className="material-symbols-outlined" style={{ fontSize: 16, verticalAlign: "-3px" }}>delete</span> ゴミ箱</a>}
          <JobNewButton />
          {!scope.isTenant && <JobGmailBulkButton />}
          {!scope.isTenant && <JobBulkExtractButton />}
          {!scope.isTenant && <JobImportButton />}
        </div>
      </div>

      {/* 絞り込み中はアクティブタブの件数を絞り込み結果(total)と連動させる。
          検索・各フィルタのいずれかが効いている時だけ activeCount を渡す。 */}
      {!scope.isTenant && (() => {
        const filtered = !!(needle || fStatus || fRole || fRemote || fFlow || fFlowLimit || fRank || fOwner || fNat || fApproved || fSignupSource || fNoProposal || showAll);
        return <MatchingPeerTabsServer activeCount={filtered ? total : undefined} />;
      })()}

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
        //   focus=<UUID|job_no> が指定されたときは、現ページに居なくてもドロワーを開けるよう
        //   サーバ側で別途 fetch して initialDetail として渡す（LINE登録ページからの遷移用）。
        <JobsTable rows={jobs} page={page} pageCount={pageCount} total={total} pageSize={PAGE_SIZE}
          query={needle} filters={jobFilters} filterOptions={jobFilterOptions} outsideOptions={ownerOptions} meetingDone={scope.meetingDone}
          initialDetail={await fetchFocusJob(sp.focus)} />
      )}
    </div>
  );
}
