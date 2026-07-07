import { CandidateImportButton, CandidateNewButton } from "@/components/CsvTools";
import { MatchingPeerTabsServer } from "@/components/MatchingPeerTabsServer";
import { EntityTable } from "@/components/EntityTable";
import { PeopleTable } from "@/components/PeopleTable";
import { UrlPeriodChips } from "@/components/UrlPeriodChips";
import { asClientPeriod, periodStartMs, periodEndMs, hasCustomRange, customStartMs, customEndMs, CLIENT_PERIOD_KEYS, type ClientPeriod } from "@/lib/period";
import { engerClient, dbConfigured } from "@/lib/supabase";
import { getViewerScope, maskCandidates } from "@/lib/tenant";
import { CAND_FLOW_OPTIONS } from "@/lib/flow";
import { getApprovedCompanySet, isCompanyApproved } from "@/lib/company-approval";
import { CAND_NAT_UNKNOWN_SQL_KEYS } from "@/lib/nationality";
import { attachLatestSourceMail } from "@/lib/source-mail";

export const dynamic = "force-dynamic";

const PAGE_SIZE = 20;

/** ?focus=<UUID|candidate_no> で渡された人材を別途 fetch（ページング・フィルタを跨いでも開けるように）。
 *  LINE登録ページや別所からの「人材詳細を開く」リンクで、現ページに該当行が居なくてもドロワーを表示できる。 */
async function fetchFocusCandidate(focus?: string | null): Promise<any | null> {
  const v = String(focus ?? "").trim();
  if (!v || !dbConfigured) return null;
  try {
    const sb = engerClient();
    const cols = "id, candidate_no, name, initials, title, affiliation, source_company, company, skills, rate, salary_min, salary_max, avail, location, exp, status, remote_pref, nationality, age_band, rank, note, email, contact_email, contact_name, source_mail_url, skill_sheet_url, is_focus, is_closed, signup_source, created_at";
    const isUuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(v);
    const isNum  = /^\d+$/.test(v);
    let r: any;
    if (isUuid)      r = await sb.from("candidates").select(cols).eq("id", v).maybeSingle();
    else if (isNum)  r = await sb.from("candidates").select(cols).eq("candidate_no", Number(v)).maybeSingle();
    else             return null;
    if (r.error || !r.data) return null;
    return r.data;
  } catch { return null; }
}

const FRESH_OPTIONS = [
  { value: "新着", label: "新着" },
  { value: "3日以内", label: "3日以内" },
  { value: "4〜14日前", label: "4〜14日前" },
  { value: "それ以前", label: "それ以前" },
];
const RANK_OPTIONS = [
  { value: "A", label: "A（90万円〜）" },
  { value: "B", label: "B（70〜89万円）" },
  { value: "C", label: "C（〜69万円）" },
];
const SKILL_SHEET_OPTIONS = [
  { value: "あり", label: "あり" },
  { value: "なし", label: "なし" },
];
// 登録元フィルタ（LINE登録タブ廃止に伴い、人材一覧で LINE/通常 を絞り込めるように）。
const SIGNUP_SOURCE_OPTIONS = [
  { value: "line", label: "LINE登録" },
  { value: "line_works", label: "LINE WORKS" },
  { value: "enger", label: "ENGERフリーランス" },
  { value: "normal", label: "通常（CSV/手動/メール）" },
];
// ENGERフリーランス(LP)由来とみなす signup_source の値（保存揺れを吸収）。
const ENGER_SOURCES = ["enger", "enger_lp", "engerjp"];
// リモート希望（自由テキスト）を 3 区分に正規化したフィルタ。
// value はカテゴリキー、label は表示テキスト。実データは ilike バケットで判定（下記 applyRemote）。
// ※ 分類の優先順位は PeopleTable.remotePrefLabel と必ず一致させること。
const REMOTE_OPTIONS = [
  { value: "remote", label: "フルリモート希望" },
  { value: "hybrid", label: "一部リモート希望" },
  { value: "onsite", label: "出社可" },
];
// 国籍は 3 区分の固定フィルタ。外国籍は「日本以外の国籍が入っている」を表すため、literal 一致ではなく
// 「値あり かつ 日本を含まない」で判定（将来 data に具体的な国名が入っても拾えるように）。
const NATIONALITY_OPTIONS = [
  { value: "japan", label: "日本国籍" },
  { value: "foreign", label: "外国籍" },
  { value: "unknown", label: "不明" },
];
// 所属区分フィルタ：新マトリックス（5カテゴリ）固定リスト＋同義語の包含マッチ。
const CAND_AFF_TO_LABELS: Record<string, string[]> = {
  self_emp:    ["エイト社員"],
  self_bp:     ["BP", "弊社所属フリーランス"],  // #261：新表記＋旧データ（BP）両方をヒットさせる
  vendor1_emp: ["一社下社員"],
  vendor1_fl:  ["一社下FL", "一社下フリーランス"],
  vendor2plus: ["二社下以降"],
};

// 鮮度ラベル → created_at の範囲（PeopleTable の freshnessLabel と同じ境界）
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
// 注：人材の単価は rate（自由テキスト）が主のため、構造化された salary_min/max のみ対象（近似）。
const rankOr = (band: string): string | null => {
  switch (band) {
    case "A": return "salary_max.gte.90,and(salary_max.is.null,salary_min.gte.90)";
    case "B": return "and(salary_max.gte.70,salary_max.lt.90),and(salary_max.is.null,salary_min.gte.70,salary_min.lt.90)";
    case "C": return "salary_max.lt.70,and(salary_max.is.null,salary_min.lt.70)";
    default: return null;
  }
};

export default async function PeoplePage({ searchParams }: { searchParams: Promise<{ q?: string; page?: string; f_status?: string; f_title?: string; f_remote?: string; f_skill_sheet?: string; f_affiliation?: string; f_nationality?: string; f_rank?: string; f_approved?: string; f_signup_source?: string; f_no_proposal?: string; focus?: string; period?: string; from?: string; to?: string }> }) {
  const sp = await searchParams;
  const { q: initialQuery, focus: focusId } = sp;
  const scope = await getViewerScope();
  let people: any[] = [];
  let total = 0;
  let pageCount = 1;
  let titleOptionVals: string[] = [];
  let affiliationOptionVals: string[] = [];
  let dbError: string | null = null;

  const needle = (initialQuery ?? "").trim();
  const page = Math.max(1, parseInt(sp.page ?? "1", 10) || 1);
  const fStatus = sp.f_status ?? "";
  const fTitle = sp.f_title ?? "";
  const fRemote = sp.f_remote ?? "";
  const fSkillSheet = sp.f_skill_sheet ?? "";
  const fAffiliation = sp.f_affiliation ?? "";
  const fNationality = sp.f_nationality ?? "";
  const fRank = sp.f_rank ?? "";
  // 承認状況フィルタ：approved=所属企業が打合せ済のみ / unapproved=未承認のみ。空=すべて。
  const fApproved = sp.f_approved ?? "";
  const fSignupSource = sp.f_signup_source ?? "";
  // 「提案あり」除外フィルタ：提案実績のある人材（has_proposal）を一覧から除外する。
  const fNoProposal = sp.f_no_proposal === "1";
  // 期間セレクタ（統一デザイン）。登録日(created_at)で一覧を絞り込む。既定=全期間。
  //   全期間チップのカレンダー（from/to）指定があれば、その任意期間で絞り込む。
  const mPeriod = asClientPeriod(sp.period, "all");
  const mCustom = hasCustomRange(sp.from, sp.to);
  const periodGte = mCustom ? (sp.from ? new Date(customStartMs(sp.from)).toISOString() : null) : (mPeriod === "all" ? null : new Date(periodStartMs(mPeriod)).toISOString());
  const periodLt = mCustom ? (sp.to ? new Date(customEndMs(sp.to)).toISOString() : null) : (mPeriod === "all" || periodEndMs(mPeriod) === Number.POSITIVE_INFINITY ? null : new Date(periodEndMs(mPeriod)).toISOString());
  const periodFiltering = mCustom || mPeriod !== "all";
  let periodCounts: Partial<Record<ClientPeriod, number | null>> = {};
  // パートナー企業：自社(owner_company)＋共有(shared)のみ。他社は匿名化。列が無ければ何も見せない(fail-closed)。
  if (scope.isTenant) {
    if (dbConfigured && scope.ownerKey) {
      try {
        const sb = engerClient();
        // note / email / contact_email / source_mail_url / skill_sheet_url / rank はドロワー（モーダル）で
        //   ・備考の表示（要望⑥）・元メールボタン（要望①）・スキルシートボタンなどに使う。
        const cols = "id, candidate_no, name, initials, title, affiliation, source_company, company, skills, rate, salary_min, salary_max, avail, location, exp, status, remote_pref, nationality, age_band, rank, note, email, contact_email, contact_name, source_mail_url, skill_sheet_url, is_focus, created_at, owner_company, shared";
        const ownedRes: any = await sb.from("candidates").select(cols).eq("owner_company", scope.ownerKey).order("candidate_no", { ascending: false }).limit(1000);
        const sharedRes: any = await sb.from("candidates").select(cols).eq("shared", true).order("candidate_no", { ascending: false }).limit(1000);
        if (ownedRes.error || sharedRes.error) { dbError = "テナント分離用の列が未整備です（supabase/partner-tenant.sql を実行してください）"; }
        else {
          const map = new Map<number, any>();
          for (const r of [...(ownedRes.data ?? []), ...(sharedRes.data ?? [])]) if (r.candidate_no != null) map.set(r.candidate_no, r);
          const rows = [...map.values()].filter((r) => r.owner_company === scope.ownerKey || r.shared === true);
          people = maskCandidates(rows, scope.ownerKey, scope.meetingDone);
          total = people.length;
        }
      } catch (e) { dbError = e instanceof Error ? e.message : String(e); }
    } else if (!scope.ownerKey) {
      dbError = "会社情報が未設定です。管理者にお問い合わせください。";
    }
  } else if (dbConfigured) {
    try {
      const sb = engerClient();
      // ドロワー（モーダル）表示の備考・元メール・スキルシートに必要な列を含める。
      const baseCols = "id, candidate_no, name, initials, title, affiliation, source_company, company, skills, rate, salary_min, salary_max, avail, location, exp, status, remote_pref, nationality, age_band, rank, note, email, contact_email, contact_name, source_mail_url, skill_sheet_url, is_focus, created_at";
      const from = (page - 1) * PAGE_SIZE;
      const to = from + PAGE_SIZE - 1;
      const fresh = fStatus ? freshRange(fStatus) : null;
      const rOr = fRank ? rankOr(fRank) : null;

      // 承認状況フィルタ：所属企業（source_company / company のいずれか）が打合せ済（承認）かで絞る。
      //   旧実装は承認済み企業「名」の巨大な in() を URL に2列分展開しており、企業数が多い・特殊文字を含む
      //   と PostgREST クエリが失敗し、承認済み/未承認の両方が常に0件になっていた（複数件あるのに両方空＝
      //   クエリ失敗の証左）。対策として、承認済みの candidate_no を事前に解決し、整数の in()/not.in() で
      //   安全に絞る。判定は isCompanyApproved（バリアント承認のカスケード込み）を使い、バッジと完全一致させる。
      let approvedNos: number[] = [];
      let approvalReady = false;
      if (fApproved) {
        try {
          const approvedSet = await getApprovedCompanySet();
          if (approvedSet.size) {
            // 所属企業の判定に必要な軽量3列のみを取得し、承認済みの candidate_no を集める。
            //   ★ PostgREST の max-rows（既定1000）で頭打ちにならないよう range でページ送りして全件走査する。
            //     以前は .limit(20000) でも 1000 件で打ち切られ、1000件目以降の承認済み人材が
            //     「未承認」フィルタに漏れていた（バッジは各行個別判定のため承認済み表示になり不一致）。
            const PAGE = 1000;
            let useTrashFilter = true;
            for (let off = 0; off <= 200000; off += PAGE) {
              let r: any = useTrashFilter
                ? await sb.from("candidates").select("candidate_no, source_company, company").is("deleted_at", null).order("candidate_no", { ascending: true }).range(off, off + PAGE - 1)
                : await sb.from("candidates").select("candidate_no, source_company, company").order("candidate_no", { ascending: true }).range(off, off + PAGE - 1);
              if (r.error && useTrashFilter) { useTrashFilter = false; off -= PAGE; continue; } // deleted_at 列が無い旧環境は外して再試行
              if (r.error) break;
              const rows = (r.data ?? []) as any[];
              for (const row of rows) {
                if (row.candidate_no == null) continue;
                if (isCompanyApproved(approvedSet, row.source_company || row.company)) approvedNos.push(row.candidate_no);
              }
              if (rows.length < PAGE) break; // 最終ページ
            }
          }
          approvalReady = true; // approvedSet が空でも「承認済み0件」として正しく機能させる
        } catch { /* 取得失敗時はフィルタ無効（全件表示にフォールバック） */ }
      }
      const applyApproved = (qb: any) => {
        if (!fApproved || !approvalReady) return qb;
        if (fApproved === "approved") return approvedNos.length ? qb.in("candidate_no", approvedNos) : qb.eq("candidate_no", -1);
        if (fApproved === "unapproved") return approvedNos.length ? qb.not("candidate_no", "in", `(${approvedNos.join(",")})`) : qb;
        return qb;
      };

      // 「提案あり」除外：提案実績のある candidate_id を事前に集め、id の not.in で一覧から外す。
      //   ページング前に DB 側で除外しないと件数・ページ数がズレるため、ここで解決する（承認フィルタと同方針）。
      let proposedIds: string[] = [];
      if (fNoProposal) {
        try {
          const pr: any = await sb.from("proposals").select("candidate_id").not("candidate_id", "is", null).limit(20000);
          if (!pr.error) proposedIds = Array.from(new Set((pr.data ?? []).map((r: any) => r.candidate_id).filter(Boolean)));
        } catch { /* proposals 未整備時は除外せず全件表示にフォールバック */ }
      }
      const applyNoProposal = (qb: any) => (fNoProposal && proposedIds.length) ? qb.not("id", "in", `(${proposedIds.join(",")})`) : qb;

      // 検索＋フィルタを 1 本のクエリに集約。skill_sheet フィルタは skill_sheet_url 列に依存するため別引数で制御。
      //   withSourceCsv：source_csv 列が無い環境のフォールバック時は false（登録元=ENGER の判定条件から外す）。
      const buildBase = (selectCols: string, withSheetFilter: boolean, includeTrashFilter = true, hideClosed = false, withSourceCsv = true, withSkills = true) => {
        let qb: any = sb.from("candidates").select(selectCols, { count: "exact" });
        // ゴミ箱（deleted_at not null）は一覧に出さない。未マイグレ環境では includeTrashFilter=false で外す。
        if (includeTrashFilter) qb = qb.is("deleted_at", null);
        // クローズ済は一覧の初期表示から外す（検索時のみ表示）。
        if (hideClosed) qb = qb.eq("is_closed", false);
        if (needle) {
          // #329：or 値に , . ( ) が混ざると PostgREST の or 構文を壊すため除去してから %..% 化する。
          const like = `%${needle.replace(/[%_,.()]/g, (m) => (m === "%" || m === "_" ? "\\" + m : " ")).trim()}%`;
          // ID 検索：「45」「P-45」「P-00045」「#45」のいずれでも candidate_no で一致させる。
          const idm = needle.match(/^(?:p[-\s]*|#)?(\d+)$/i);
          const numOr = idm ? `,candidate_no.eq.${parseInt(idm[1], 10)}` : "";
          // #314：スキル（skills は text[]）でも検索できるよう ::text キャストして ILIKE。
          //   #329：ただし環境によっては or 内の ::text キャストが拒否され or 全体が失敗し、
          //   名前・IDを含む全検索が0件になる事故が起きていた。withSkills=false のフォールバック
          //   （下の実行部）で skills を外して再試行し、名前・ID検索を必ず生かす。
          const skillsOr = withSkills ? `,skills::text.ilike.${like}` : "";
          qb = qb.or(`name.ilike.${like},source_company.ilike.${like},company.ilike.${like}${skillsOr}${numOr}`);
        }
        if (fTitle) qb = qb.eq("title", fTitle);
        // 登録元（LINE登録 / ENGERフリーランス / 通常）。
        //   LINE: signup_source='line' / ENGER: enger 系 / 通常: それ以外（null含む）。
        if (fSignupSource === "line") qb = qb.eq("signup_source", "line");
        else if (fSignupSource === "line_works") qb = qb.eq("signup_source", "line_works");
        else if (fSignupSource === "enger") {
          // #276②：ENGERフリーランスは signup_source だけだと誰もヒットしない（人材マスタ登録経由は
          //   signup_source が空のまま）。一覧バッジ（PeopleTable.isEnger）と同じ判定に合わせ、
          //   source_csv=freelance／所属会社テキスト=ENGERフリーランス でもヒットさせる。
          const parts = [
            `signup_source.in.(${ENGER_SOURCES.join(",")})`,
            "company.ilike.ENGERフリーランス",
            "source_company.ilike.ENGERフリーランス",
          ];
          if (withSourceCsv) parts.push("source_csv.ilike.freelance");
          qb = qb.or(parts.join(","));
        }
        else if (fSignupSource === "normal") qb = qb.or(`signup_source.is.null,and(signup_source.neq.line,signup_source.neq.line_works,signup_source.not.in.(${ENGER_SOURCES.join(",")}))`);
        // リモート希望は自由テキストのため ilike バケットで判定（PeopleTable.remotePrefLabel と同じ優先順位）
        if (fRemote === "remote") {
          qb = qb.ilike("remote_pref", "%フル%");
        } else if (fRemote === "hybrid") {
          qb = qb.or("remote_pref.ilike.%リモート%,remote_pref.ilike.%在宅%").not("remote_pref", "ilike", "%フル%");
        } else if (fRemote === "onsite") {
          qb = qb.or("remote_pref.ilike.%出社%,remote_pref.ilike.%常駐%")
            .not("remote_pref", "ilike", "%リモート%").not("remote_pref", "ilike", "%在宅%").not("remote_pref", "ilike", "%フル%");
        }
        if (fAffiliation) {
          if (fAffiliation === "unknown") qb = qb.or("affiliation.is.null,affiliation.eq.");
          else {
            const labels = CAND_AFF_TO_LABELS[fAffiliation] ?? [];
            if (labels.length > 0) qb = qb.in("affiliation", labels);
          }
        }
        // 国籍は 3 区分（NATIONALITY_OPTIONS）。
        //   外国籍＝値あり ∧ 日本を含まない ∧「不明」に倒す語（不問/未確認/不明 等）を含まない。
        //   ※ 「不明」系の語を除外しないと、バッジ上は「不明」の人材が外国籍フィルタに紛れ込む。
        if (fNationality === "japan") {
          qb = qb.ilike("nationality", "%日本%");
        } else if (fNationality === "foreign") {
          qb = qb.not("nationality", "is", null).neq("nationality", "").not("nationality", "ilike", "%日本%");
          for (const kw of CAND_NAT_UNKNOWN_SQL_KEYS) qb = qb.not("nationality", "ilike", `%${kw}%`);
        } else if (fNationality === "unknown") {
          // 空/NULL に加え、「不明」に倒す語を含む値も「不明」に含める（外国籍と整合）。
          const ors = ["nationality.is.null", "nationality.eq."];
          for (const kw of CAND_NAT_UNKNOWN_SQL_KEYS) ors.push(`nationality.ilike.%${kw}%`);
          qb = qb.or(ors.join(","));
        }
        if (rOr) qb = qb.or(rOr);
        if (fresh?.gte) qb = qb.gte("created_at", fresh.gte);
        if (fresh?.lt) qb = qb.lt("created_at", fresh.lt);
        if (periodGte) qb = qb.gte("created_at", periodGte);
        if (periodLt) qb = qb.lt("created_at", periodLt);
        if (withSheetFilter && fSkillSheet) {
          qb = fSkillSheet === "あり"
            ? qb.not("skill_sheet_url", "is", null).neq("skill_sheet_url", "")
            : qb.or("skill_sheet_url.is.null,skill_sheet_url.eq.");
        }
        qb = applyApproved(qb);
        qb = applyNoProposal(qb);
        return qb;
      };
      const order = (qb: any) => qb.order("candidate_no", { ascending: false }).range(from, to);

      const hideClosed = !needle; // 検索時はクローズ済も表示し、未検索の一覧では隠す。
      // #257-1：signup_source はフォールバック変種にも含める（欠けると「ENGERフリーランス」バッジが
      //   一覧から消えるデグレになるため）。source_csv も登録元判定の補助に取得する。
      let res: any = await order(buildBase(`${baseCols}, is_closed, rank, email, contact_email, source_mail_url, skill_sheet_url, signup_source, source_csv`, true, true, hideClosed));
      if (res.error && /deleted_at|is_closed|column/i.test(res.error.message)) {
        res = await order(buildBase(`${baseCols}, rank, email, contact_email, source_mail_url, skill_sheet_url, signup_source, source_csv`, true, false));
      }
      if (res.error && /signup_source|source_csv|column/i.test(res.error.message)) {
        res = await order(buildBase(`${baseCols}, rank, email, contact_email, source_mail_url, skill_sheet_url`, true, false, false, false));
      }
      // #329：ここまでで残ったエラーは or 内 skills::text キャスト拒否の可能性が高い。
      //   skills を外して再試行し、名前・会社・ID による検索を必ず生かす（スキル部分一致だけ諦める）。
      if (res.error && needle) {
        res = await order(buildBase(`${baseCols}, is_closed, rank, email, contact_email, source_mail_url, skill_sheet_url, signup_source, source_csv`, true, true, hideClosed, true, false));
        if (res.error && /deleted_at|is_closed|signup_source|source_csv|column/i.test(res.error.message ?? "")) {
          res = await order(buildBase(baseCols, false, false, false, false, false));
        }
      }
      if (res.error) res = await order(buildBase(baseCols, false, true, false, false, false)); // skill_sheet_url 列が無い環境では当該フィルタは無効
      people = res.data ?? [];
      total = res.count ?? people.length;
      pageCount = Math.max(1, Math.ceil(total / PAGE_SIZE));

      // 期間チップの件数（登録日ベース・表示対象の基本可視性のみ。テキストフィルタは無視＝旧サマリと同義）。
      try {
        const countFor = async (p: ClientPeriod, noTrash = false): Promise<number | null> => {
          let qb: any = sb.from("candidates").select("candidate_no", { count: "exact", head: true });
          if (!noTrash) qb = qb.is("deleted_at", null);
          if (p !== "all") {
            qb = qb.gte("created_at", new Date(periodStartMs(p)).toISOString());
            if (periodEndMs(p) !== Number.POSITIVE_INFINITY) qb = qb.lt("created_at", new Date(periodEndMs(p)).toISOString());
          }
          const r: any = await qb;
          if (r.error) {
            if (!noTrash && /deleted_at|column/i.test(r.error.message ?? "")) return countFor(p, true);
            return null;
          }
          return r.count ?? null;
        };
        const vals = await Promise.all(CLIENT_PERIOD_KEYS.map((k) => countFor(k)));
        periodCounts = Object.fromEntries(CLIENT_PERIOD_KEYS.map((k, i) => [k, vals[i]])) as Partial<Record<ClientPeriod, number | null>>;
      } catch { /* 件数取得失敗は無視 */ }

      // 承認(打合せ済)バッジ用に、各行へ所属企業(source_company/company)の承認状態を付与。
      try {
        const approvedSet = await getApprovedCompanySet();
        for (const p of people) (p as any).company_approved = isCompanyApproved(approvedSet, p.source_company || p.company);
      } catch { /* 承認集合の取得失敗は無視（バッジ非表示） */ }

      // 「提案あり」タグ用：この人材に紐づく提案が1件でもあるかを付与（誤削除防止の目印）。
      try {
        const ids = people.map((p: any) => p.id).filter(Boolean) as string[];
        if (ids.length > 0) {
          const pr: any = await sb.from("proposals").select("candidate_id").in("candidate_id", ids).limit(5000);
          if (!pr.error) {
            const set = new Set<string>((pr.data ?? []).map((r: any) => r.candidate_id).filter(Boolean));
            for (const p of people) (p as any).has_proposal = set.has((p as any).id);
          }
        }
      } catch { /* proposals 未整備でも無視 */ }

      // 「元メール」リンクを直近受信メールへ更新（同人材／同送信元の最新メールに飛ぶ）。
      await attachLatestSourceMail(sb, "candidate", people);

      // フィルタ用の選択肢（職種・所属区分の distinct）。リモート・国籍は固定区分（REMOTE_OPTIONS / NATIONALITY_OPTIONS）。
      try {
        const optRes: any = await sb.from("candidates").select("title, affiliation").limit(5000);
        const titleSet = new Set<string>(), affSet = new Set<string>();
        for (const r of optRes.data ?? []) {
          if (r.title) titleSet.add(r.title);
          if (r.affiliation) affSet.add(r.affiliation);
        }
        titleOptionVals = [...titleSet].sort((a, b) => a.localeCompare(b, "ja"));
        affiliationOptionVals = [...affSet].sort((a, b) => a.localeCompare(b, "ja"));
      } catch { /* 列が無ければ動的選択肢なしで継続 */ }
    } catch (e) {
      dbError = e instanceof Error ? e.message : String(e);
    }
  } else {
    dbError = "Supabase の環境変数が未設定です";
  }

  // PeopleTable（社内・サーバ駆動）に渡すフィルタの現在値と選択肢
  const peopleFilters = { status: fStatus, title: fTitle, remote: fRemote, skill_sheet: fSkillSheet, affiliation: fAffiliation, nationality: fNationality, rank: fRank, approved: fApproved, signup_source: fSignupSource, no_proposal: fNoProposal ? "1" : "" };
  const peopleFilterOptions = {
    status: FRESH_OPTIONS,
    title: titleOptionVals.map((v) => ({ value: v, label: v })),
    remote: REMOTE_OPTIONS,
    skill_sheet: SKILL_SHEET_OPTIONS,
    affiliation: [...CAND_FLOW_OPTIONS, { value: "unknown", label: "未設定" }],
    nationality: NATIONALITY_OPTIONS,
    rank: RANK_OPTIONS,
    approved: [{ value: "approved", label: "承認済みのみ" }, { value: "unapproved", label: "未承認のみ" }],
    signup_source: SIGNUP_SOURCE_OPTIONS,
  };

  return (
    <div className="page">
      {/* タブを最上段に置く（LINEと同じ配置。タブ移動時に段差が出ないようにする）。
          絞り込み中はアクティブタブの件数を絞り込み結果(total)と連動させる。 */}
      {!scope.isTenant && (() => {
        const filtered = !!(needle || fStatus || fTitle || fRemote || fSkillSheet || fAffiliation || fNationality || fRank || fApproved || fSignupSource || fNoProposal || periodFiltering);
        return <MatchingPeerTabsServer activeCount={filtered ? total : undefined} rightSlot={<UrlPeriodChips basePath="/people" counts={periodCounts} />} />;
      })()}

      {/* page-head: ボタンが多いため、タイトル列に flex:1 / minWidth:0 を与えてつぶれないようにする。 */}
      <div className="page-head" style={{ flexWrap: "wrap" }}>
        <div style={{ flex: "1 1 240px", minWidth: 0 }}>
          <div className="meta">People · 人材マスタ（実データ）</div>
          <h1>人材</h1>
        </div>
        {/* ボタンは「新規登録 / CSV取込 / ゴミ箱」の3つに統一（マッチング系メニュー共通）。 */}
        <div style={{ display: "flex", gap: 8, flexShrink: 0, alignItems: "center", flexWrap: "wrap", justifyContent: "flex-end" }}>
          <CandidateNewButton />
          {!scope.isTenant && <CandidateImportButton />}
          {!scope.isTenant && <a href="/trash?tab=candidates" className="btn ghost" style={{ textDecoration: "none", fontSize: 12 }} title="削除した人材の復元 / 6/1以前を一括ゴミ箱へ"><span className="material-symbols-outlined" style={{ fontSize: 16, verticalAlign: "-3px" }}>delete</span> ゴミ箱</a>}
        </div>
      </div>

      {scope.isTenant && (
        <div className="card" style={{ background: "#eef2ff", borderColor: "#c7d2fe", fontSize: 12.5, color: "var(--color-ink-2)" }}>
          <b>パートナー表示</b>：自社で登録した人材と、共有された人材のみ表示しています。<b>他社の人材は氏名・連絡先を伏せた匿名表示（イニシャル＋スキル＋単価）</b>です。
        </div>
      )}

      {dbError && <div className="card" style={{ borderColor: "var(--color-danger)", color: "var(--color-danger)" }}><b>DB:</b> {dbError}</div>}

      {scope.isTenant ? (
        // パートナー（テナント隔離）：自社＋共有のみの限定データをクライアント側で表示（従来通り）
        <EntityTable kind="people" rows={people} total={total} initialQuery={initialQuery} partner meetingDone={scope.meetingDone}
          agentContact={{ line: process.env.NEXT_PUBLIC_AGENT_LINE_URL, email: process.env.NEXT_PUBLIC_AGENT_EMAIL, phone: process.env.NEXT_PUBLIC_AGENT_PHONE }} />
      ) : (
        // 社内：フィルタ・ページングをサーバ側で処理（1ページ20件・URL同期）
        //   focus=<UUID|candidate_no> が指定されたときは、現ページに居なくてもドロワーを開けるよう
        //   サーバ側で別途 fetch して initialDetail として渡す（LINE登録ページからの遷移用）。
        <PeopleTable rows={people} page={page} pageCount={pageCount} total={total} pageSize={PAGE_SIZE}
          query={needle} filters={peopleFilters} filterOptions={peopleFilterOptions} initialDetail={await fetchFocusCandidate(focusId)} />
      )}
    </div>
  );
}
