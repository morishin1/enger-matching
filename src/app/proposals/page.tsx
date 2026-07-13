import { ProposalsWorkspace } from "@/components/ProposalsWorkspace";
import { engerClient, dbConfigured } from "@/lib/supabase";
import { getStaff } from "@/lib/staff";
import { loadProposalOwners } from "@/lib/proposal-owners";
import { loadKpiMembers } from "@/lib/kpi-members";
import { getFeedbackMap, VERDICT_LABEL, type Verdict } from "@/lib/client-feedback";
import { currentAccess } from "@/lib/accounts";
import { canManageDept } from "@/lib/roles";
import { loadKpiClientProps } from "@/lib/kpi-embed";
import { loadReportsView } from "@/lib/reports-embed";
import { getCompanyRatings } from "@/lib/company-ratings";
import { normKey } from "@/lib/actions/_shared";
import { isCompanyVariantOf } from "@/lib/company-approval";

export const dynamic = "force-dynamic";

export default async function ProposalsPage({ searchParams }: { searchParams: Promise<{ period?: string; from?: string; to?: string; owner?: string }> }) {
  const sp = await searchParams;
  let proposals: any[] = [];
  let dbError: string | null = null;
  let needSetup = false;
  // 提案開始件数（created_at 基準）。ステージ移動の影響を受けず一貫してカウントする。
  let startStats = { today: 0, week: 0, month: 0, thirty: 0 };

  const [staff, proposalOwners, access, kpiMembers] = await Promise.all([getStaff(), loadProposalOwners(), currentAccess(), loadKpiMembers()]);
  // KPI推移タブ・日報タブの埋め込みデータ（/kpi・/reports と同等の集計を再利用）。
  const [kpiData, reportsView] = await Promise.all([
    loadKpiClientProps({ email: access?.email ?? "", name: access?.name ?? null, role: access?.role ?? "", teamRole: access?.teamRole ?? null, department: access?.department ?? null }, sp),
    loadReportsView(access ? { email: access.email, name: access.name, role: access.role, rawRole: access.rawRole, teamRole: access.teamRole, department: access.department } : null),
  ]);
  // 担当者（提案者・クロージング）の名前を追加/削除できるのは管理者のみ
  //   （保存 saveProposalOwners が admin 限定）。選択肢の編集は「設定」へ集約済み。
  // 承認操作の権限：admin / 経営部署（=admin昇格済） / マネージャー / リーダー。
  const canApprove = !access || access.role === "admin" || canManageDept(access.teamRole ?? null);
  const currentUserName = access?.name ?? null;
  const ownersInitial = proposalOwners ?? { proposers: staff.members, closers: staff.members };
  let history: any[] = [];
  let analyticsRows: any[] = [];
  let feedbackList: { verdict: Verdict; reason: string | null; c_init: string; job_title: string; company: string; updated_at: string }[] = [];
  if (dbConfigured) {
    try {
      const sb = engerClient();
      const base = "id, job_id, candidate_id, job_title, company, candidate_name, c_init, rate, score, stage, created_at, next_action";
      // ボード/承認に出す「進行中」ステージのみを取得（終了系=見送り/失注/稼働は失注分析タブで別途
      //   /api/proposals/list?mode=analytics から取る）。これで件数が 400→約100件に激減し、後続の
      //   案件/人材/企業マスタ IN も同じだけ軽くなる。TTFB 1.9s→800ms（索引追加）の残りの主因。
      const ACTIVE_STAGES = ["承認待ち", "所属確認", "提案中", "確認中", "面談", "合格"];
      const activeStage = (q: any) => q.in("stage", ACTIVE_STAGES);
      // 拡張カラム(架電進捗等)が無くても落ちないようフォールバック
      let res: any = await activeStage(sb.from("proposals")
        .select(`${base}, company_contact, cand_company, cand_company_contact, cand_contact, updated_at, stage_updated_at, progress_status, progress_updated_at, caller_status, proposer, partner, closer, client_contact, lost_reason, lost_phase, lost_reason_note, meeting_date, meeting_status, meeting_time, meeting_format, meeting_url, meeting_attendees, meeting_note, source, job_notify_status, cand_notify_status, job_action_type, cand_action_type, approver, approval_status, approved_at, reject_reason, cand_rating, job_rating, delete_requested_at, delete_reason, delete_requested_by`))
        .order("created_at", { ascending: false }).limit(400);
      // 連絡先の追加列（proposals-contacts.sql 未適用）だけが無い場合は、承認列は残したまま連絡先列のみ外して再試行。
      if (res.error && /company_contact|cand_company|cand_contact/i.test(res.error?.message ?? "")) {
        res = await activeStage(sb.from("proposals")
          .select(`${base}, updated_at, stage_updated_at, caller_status, proposer, partner, closer, client_contact, lost_reason, lost_phase, lost_reason_note, meeting_date, meeting_status, meeting_time, meeting_format, meeting_url, meeting_attendees, meeting_note, source, job_notify_status, cand_notify_status, job_action_type, cand_action_type, approver, approval_status, approved_at, reject_reason`))
          .order("created_at", { ascending: false }).limit(400);
      }
      if (res.error && /approver|approval_status|company_contact|cand_company|cand_contact|column/i.test(res.error?.message ?? "")) {
        // 承認チェック列が未マイグレ → 旧SELECTで再試行
        res = await activeStage(sb.from("proposals")
          .select(`${base}, updated_at, stage_updated_at, caller_status, proposer, partner, closer, client_contact, lost_reason, lost_phase, lost_reason_note, meeting_date, meeting_status, meeting_time, meeting_format, meeting_url, meeting_attendees, meeting_note, source, job_notify_status, cand_notify_status, job_action_type, cand_action_type`))
          .order("created_at", { ascending: false }).limit(400);
      }
      if (res.error) res = await activeStage(sb.from("proposals")
        .select(`${base}, updated_at, stage_updated_at, caller_status, proposer, partner, closer, client_contact, lost_reason, lost_phase, lost_reason_note, meeting_date, meeting_status, source, job_notify_status, cand_notify_status, job_action_type, cand_action_type`))
        .order("created_at", { ascending: false }).limit(400);
      if (res.error) res = await activeStage(sb.from("proposals")
        .select(`${base}, updated_at, stage_updated_at, caller_status, proposer, partner, closer, client_contact, lost_reason, lost_phase, lost_reason_note, meeting_date, meeting_status, source`))
        .order("created_at", { ascending: false }).limit(400);
      if (res.error) res = await activeStage(sb.from("proposals")
        .select(`${base}, updated_at, stage_updated_at, caller_status, proposer, partner, closer, client_contact, lost_reason, lost_phase, meeting_date, meeting_status, source`))
        .order("created_at", { ascending: false }).limit(400);
      if (res.error) res = await activeStage(sb.from("proposals")
        .select(`${base}, updated_at, stage_updated_at, caller_status, proposer, partner, closer, client_contact, lost_reason, lost_phase, meeting_date, meeting_status`))
        .order("created_at", { ascending: false }).limit(400);
      if (res.error) res = await activeStage(sb.from("proposals")
        .select(`${base}, updated_at, caller_status, proposer, partner, closer, client_contact, lost_reason, lost_phase, meeting_date, meeting_status`))
        .order("created_at", { ascending: false }).limit(400);
      // partner / updated_at 列が無い環境でも落ちないようフォールバック
      if (res.error) res = await activeStage(sb.from("proposals")
        .select(`${base}, caller_status, proposer, closer, client_contact, lost_reason, lost_phase, meeting_date, meeting_status`))
        .order("created_at", { ascending: false }).limit(400);
      if (res.error) res = await activeStage(sb.from("proposals").select(base)).order("created_at", { ascending: false }).limit(400);
      if (res.error) {
        needSetup = true;
      } else {
        const all = res.data ?? [];
        // 補助情報を 4 クエリ並列で取得（旧: 逐次 4 往復 → 新: 1 往復ぶんに短縮）。
        //   ① job_id → job_no/source_mail_url
        //   ② candidate_id → candidate_no/source_mail_url
        //   ③ job_title → outside_owner（営業担当）
        //   ④ company name → owner（営業担当）
        const jobIds   = Array.from(new Set(all.map((p: any) => p.job_id).filter(Boolean))) as string[];
        const candIds  = Array.from(new Set(all.map((p: any) => p.candidate_id).filter(Boolean))) as string[];
        const titles   = Array.from(new Set(all.map((p: any) => p.job_title).filter(Boolean))) as string[];
        const compNms  = Array.from(new Set(all.map((p: any) => p.company).filter(Boolean))) as string[];

        const nq = (rows: any[] | null) => rows ?? [];
        // 件数COUNT・企業フィードバックは後続のどの補助クエリにも依存しない（COUNTは日付集計、
        //   フィードバックは提案IDのみ）。本体取得直後に先行投入し、案件/人材/企業マスタの取得と
        //   並行させて1波ぶん短縮する。万一の reject でも未処理例外にならないよう .catch で握る
        //   （早期 kick off の落とし穴＝関数クラッシュを防ぐ）。month/thirty は同じ30日集計を共有。
        const nowMs = Date.now();
        const dayMs = 24 * 3600 * 1000;
        const startOfToday = new Date(); startOfToday.setHours(0, 0, 0, 0);
        const cnt = (iso: string) => sb.from("proposals").select("id", { count: "exact", head: true }).gte("created_at", iso);
        const auxP = Promise.all([
          getFeedbackMap(all.map((p: any) => p.id)),
          cnt(startOfToday.toISOString()),
          cnt(new Date(nowMs - 6 * dayMs).toISOString()),
          cnt(new Date(nowMs - 29 * dayMs).toISOString()),
        ]).catch(() => [{}, { count: 0 }, { count: 0 }, { count: 0 }] as any[]);

        // ① 案件: 元メール本文(detail)はボードでは取得しない（全件×長文で重い→モーダルを開いた時に
        //    /api/proposals/[id]/source で個別取得）。ここでは一覧表示に必要な軽い列だけ取る。
        const fetchJobs = async () => {
          if (!jobIds.length) return [];
          // #383：案件名(title)も取得し、提案レコードの案件名を「案件詳細の現在値」へ自動追随させる。
          let r: any = await sb.from("jobs").select("id, job_no, title, source_mail_url, source_mail_at, contact_email, is_closed, signup_source").in("id", jobIds).limit(2000);
          if (r.error) r = await sb.from("jobs").select("id, job_no, title, source_mail_url, is_closed, signup_source").in("id", jobIds).limit(2000);
          if (r.error) r = await sb.from("jobs").select("id, job_no, title, source_mail_url, is_closed").in("id", jobIds).limit(2000);
          if (r.error) r = await sb.from("jobs").select("id, job_no, source_mail_url").in("id", jobIds).limit(2000);
          return r.error ? [] : nq(r.data);
        };
        // ② 人材: 同上。note/exp(経歴・本文)はモーダルで個別取得する。所属会社名(source_company/company)は軽いので取る。
        const fetchCands = async () => {
          if (!candIds.length) return [];
          // #383：氏名(name)・イニシャル(initials)も取得し、提案レコードの人材名を「人材詳細の現在値」へ自動追随させる。
          let r: any = await sb.from("candidates").select("id, candidate_no, name, initials, source_mail_url, source_mail_at, contact_email, is_closed, source_company, company, signup_source").in("id", candIds).limit(2000);
          if (r.error) r = await sb.from("candidates").select("id, candidate_no, name, initials, source_mail_url, is_closed, source_company, company, signup_source").in("id", candIds).limit(2000);
          if (r.error) r = await sb.from("candidates").select("id, candidate_no, source_mail_url, is_closed, source_company, company").in("id", candIds).limit(2000);
          if (r.error) r = await sb.from("candidates").select("id, candidate_no, source_mail_url").in("id", candIds).limit(2000);
          return r.error ? [] : nq(r.data);
        };
        const [jn, cn, jr] = await Promise.all([
          fetchJobs(),
          fetchCands(),
          titles.length  ? sb.from("jobs").select("title, outside_owner").in("title", titles).limit(1000).then((r: any) => r.error ? [] : nq(r.data)) : Promise.resolve([]),
        ]);

        // 元メールリンクは fetchJobs/fetchCands が取得した保存値(source_mail_url)をそのまま使う。
        //   かつては attachLatestSourceMail で inbox_emails を走査して「直近メール」へ更新していたが、
        //   この走査がボード表示のたびに重く（回収でメールが増えると顕著）、提案管理が
        //   「読み込み中…」のまま開かない主因になっていた。ボード表示の経路からは外す。
        //   ※ リンク自体は保存値で機能する。常に最新メールへ寄せたい場合は、将来モーダルを開いた
        //     時だけ /api 経由で個別解決する（重い全件走査を毎回走らせない）。
        // 企業マスタ（営業担当 owner / 窓口担当 contact_name）を、案件側クライアント＋人材側所属会社の
        // 両方ぶんまとめて取得。詳細モーダルの「企業担当（窓口担当者）」を自動表示するのに使う。
        const candCompanyById: Record<string, string | null> = {};
        for (const c of cn as any[]) if (c?.id != null) candCompanyById[c.id] = c.source_company ?? c.company ?? null;
        const allCompNames = Array.from(new Set([
          ...compNms,
          ...Object.values(candCompanyById).filter(Boolean) as string[],
        ]));
        const companyRows = allCompNames.length
          ? await sb.from("companies").select("name, owner, owner_staff, contact_name, meeting_done, is_ng, caution, caution_count").in("name", allCompNames).limit(2000)
              .then((r: any) => r.error ? sb.from("companies").select("name, owner, contact_name").in("name", allCompNames).limit(2000).then((r2: any) => r2.error ? [] : nq(r2.data)) : nq(r.data))
          : [];
        // #287/#293：自社担当（owner_staff）は会社名の「完全一致」だけだと表記ゆれ（空白・記号・
        //   担当者付きの変種名など）で引けないことがある。企業を全件取得しておき、
        //   完全一致→trim一致→正規化キー一致→変種名（親会社名＋区切り）の順でマッチさせる。
        //   #293：企業ID（company_no）も同じ解決結果から取得する（owner_staff の有無に関わらず、
        //   企業マスタに一致する行があれば企業IDは表示する。自社担当は空欄なら空欄のまま＝仕様どおり）。
        let companyDirAll: { name: string; owner_staff: string | null; company_no: number | null }[] = [];
        try {
          let r: any = await sb.from("companies").select("name, owner_staff, company_no").limit(20000);
          if (r.error) r = await sb.from("companies").select("name, owner_staff").limit(20000);
          if (!r.error) companyDirAll = (r.data ?? []).filter((c: any) => c?.name).map((c: any) => ({ name: c.name, owner_staff: c.owner_staff ?? null, company_no: c.company_no ?? null }));
        } catch { /* companies 未整備は無視（自社担当・企業IDは空欄のまま） */ }
        // 会社の「提案適性ランク」用に、各社の成約(稼働)・失注(見送り/失注)実績を集計する。
        //   ランク: NG（取引NG）/ A（実績あり）/ C（失注多・提案注意）/ B（通常・新規）。
        const wonByCompany: Record<string, number> = {};
        const lostByCompany: Record<string, number> = {};
        if (allCompNames.length) {
          try {
            const rr: any = await sb.from("proposals").select("company, stage").in("company", allCompNames).limit(20000);
            for (const row of (rr.data ?? []) as any[]) {
              const nm = String(row.company ?? "").trim(); if (!nm) continue;
              const st = String(row.stage ?? "");
              if (st === "稼働" || st === "稼働決定") wonByCompany[nm] = (wonByCompany[nm] ?? 0) + 1;
              else if (st === "見送り" || st === "失注") lostByCompany[nm] = (lostByCompany[nm] ?? 0) + 1;
            }
          } catch { /* 集計失敗時はランク無し */ }
        }
        const ngByCompany: Record<string, boolean> = {};
        const cautionCountByCompany: Record<string, number> = {};
        for (const c of companyRows as any[]) if (c?.name) { ngByCompany[c.name] = !!c.is_ng; cautionCountByCompany[c.name] = Number(c.caution_count) || (c.caution ? 1 : 0); }
        const CAUTION_THRESHOLD = 3; // この回数以上の「取引注意」加点で「要注意会社」。
        // 会社評価★（失注時の案件★の会社平均）。提案詳細で会社の評価を表示する。
        const companyRatings = await getCompanyRatings().catch(() => ({} as Record<string, { avg: number; count: number }>));
        // 会社名 → 提案適性ランク（表示用）。
        const rankOf = (name: string | null | undefined): { grade: "NG" | "A" | "B" | "C"; label: string } | null => {
          const nm = String(name ?? "").trim(); if (!nm) return null;
          if (ngByCompany[nm]) return { grade: "NG", label: "取引NG（提案非推奨）" };
          const cc = cautionCountByCompany[nm] ?? 0;
          if (cc >= CAUTION_THRESHOLD) return { grade: "NG", label: `要注意会社（取引注意 ${cc}回）` };
          if (cc >= 1) return { grade: "C", label: `取引注意 ${cc}回（クローズ理由により加点）` };
          const won = wonByCompany[nm] ?? 0, lost = lostByCompany[nm] ?? 0;
          if (won >= 1) return { grade: "A", label: `実績あり（成約${won}・失注${lost}）` };
          if (lost >= 2) return { grade: "C", label: `提案注意（失注${lost}・成約0）` };
          if (lost >= 1) return { grade: "B", label: `様子見（失注${lost}・成約0）` };
          return { grade: "B", label: "新規/実績なし" };
        };

        try {
          const mJ: Record<string, { job_no: number; title: string | null; url: string | null; detail: string | null; closed: boolean; line: boolean }> = {};
          for (const j of jn as any[]) if (j?.id != null) mJ[j.id] = { job_no: j.job_no, title: (j.title ?? null), url: j.source_mail_url ?? null, detail: j.detail ?? null, closed: !!j.is_closed, line: String(j.signup_source ?? "") === "line" };
          const mC: Record<string, { candidate_no: number; name: string | null; initials: string | null; url: string | null; detail: string | null; closed: boolean; line: boolean }> = {};
          for (const c of cn as any[]) if (c?.id != null) mC[c.id] = { candidate_no: c.candidate_no, name: (c.name ?? null), initials: (c.initials ?? null), url: c.source_mail_url ?? null, detail: c.note ?? c.exp ?? null, closed: !!c.is_closed, line: String(c.signup_source ?? "") === "line" };
          const ownerByTitle: Record<string, string> = {};
          for (const j of jr as any[]) if (j?.outside_owner) ownerByTitle[j.title] = j.outside_owner;
          const ownerByCompany: Record<string, string> = {};
          const contactByCompany: Record<string, string> = {};
          const meetingDoneByCompany: Record<string, boolean> = {};
          for (const c of companyRows as any[]) {
            if (c?.owner) ownerByCompany[c.name] = c.owner;
            if (c?.contact_name) contactByCompany[c.name] = c.contact_name;
            if (c?.name) meetingDoneByCompany[c.name] = !!c.meeting_done;
          }
          // #287/#293：企業マスタの行（自社担当・企業ID）を会社名で引く名寄せ解決。
          //   完全一致 → trim一致 → 正規化キー一致（空白・記号を無視）→
          //   変種名（「株式会社トヨタ 営業部」→ 親「株式会社トヨタ」）の順で1つの企業マスタ行に解決し、
          //   その行から owner_staff と company_no（企業ID）を両方まとめて取り出す
          //   （＝同じ企業IDに紐づいたデータとして自社担当を連携表示する）。
          //   企業マスタの自社担当が空欄なら、詳細側も空欄のまま（仕様どおり）。
          type CompanyDirEntry = { owner_staff: string | null; company_no: number | null };
          const companyDirByName: Record<string, CompanyDirEntry> = {};
          const companyDirByTrim: Record<string, CompanyDirEntry> = {};
          const companyDirByNorm: Record<string, CompanyDirEntry> = {};
          for (const c of companyDirAll) {
            const nm = String(c.name).trim();
            if (!nm) continue;
            const entry: CompanyDirEntry = { owner_staff: (c.owner_staff ? String(c.owner_staff).trim() : "") || null, company_no: c.company_no ?? null };
            if (!companyDirByName[c.name]) companyDirByName[c.name] = entry;
            if (!companyDirByTrim[nm]) companyDirByTrim[nm] = entry;
            const nk = normKey(nm);
            if (nk && !companyDirByNorm[nk]) companyDirByNorm[nk] = entry;
          }
          const companyRowFor = (name?: string | null): CompanyDirEntry | null => {
            const raw = String(name ?? "");
            const n = raw.trim();
            if (!n) return null;
            if (companyDirByName[raw]) return companyDirByName[raw];       // 完全一致（従来）
            if (companyDirByTrim[n]) return companyDirByTrim[n];           // trim 一致
            const nk = normKey(n);
            if (nk && companyDirByNorm[nk]) return companyDirByNorm[nk];   // 正規化キー一致
            // 変種名：企業マスタの会社名が「親」として先頭に一致し、直後が区切りのとき引き継ぐ。
            for (const c of companyDirAll) {
              if (isCompanyVariantOf(String(c.name), n)) return { owner_staff: (c.owner_staff ? String(c.owner_staff).trim() : "") || null, company_no: c.company_no ?? null };
            }
            return null;
          };
          for (const p of all) {
            if (p.job_id && mJ[p.job_id])       {
              p.job_no = mJ[p.job_id].job_no; p.job_source_mail_url = mJ[p.job_id].url; p.job_detail = mJ[p.job_id].detail; p.job_closed = mJ[p.job_id].closed;
              // #383：案件名を案件詳細の現在値へ自動追随（案件が存在する限り最新のタイトルで表示）。
              const t = (mJ[p.job_id].title ?? "").trim();
              if (t) p.job_title = t;
            }
            if (p.candidate_id && mC[p.candidate_id]) {
              p.candidate_no = mC[p.candidate_id].candidate_no; p.cand_source_mail_url = mC[p.candidate_id].url; p.cand_detail = mC[p.candidate_id].detail; p.cand_closed = mC[p.candidate_id].closed;
              // #383：人材名・イニシャルを人材詳細の現在値へ自動追随。
              const nm = (mC[p.candidate_id].name ?? "").trim();
              const ini = (mC[p.candidate_id].initials ?? "").trim();
              if (nm) p.candidate_name = nm;
              if (ini) p.c_init = ini;
            }
            // LINE経由（案件 or 人材のどちらかが LINE登録、または提案自体が source='line'）。失注分析のLINEグラフ集計に使う。
            p.line_origin = String(p.source ?? "") === "line" || !!(p.job_id && mJ[p.job_id]?.line) || !!(p.candidate_id && mC[p.candidate_id]?.line);
            // 案件側/人材側のどちらが LINE 由来かを個別判定（名前の横にLINEアイコンを出す用）。
            //   ・案件/人材が signup_source='line' ならその側を LINE 表示。
            //   ・提案が source='line' で片側だけ LINE 明示なら、その側のみ（もう片側は非LINE）。
            //   ・提案が source='line' でどちらも未明示なら判別不能のため両側に表示。
            {
              const jLine = !!(p.job_id && mJ[p.job_id]?.line);
              const cLine = !!(p.candidate_id && mC[p.candidate_id]?.line);
              const src = String(p.source ?? "") === "line";
              p.job_line = jLine || (src && !cLine);
              p.cand_line = cLine || (src && !jLine);
            }
            p.company_owner = ownerByTitle[p.job_title] ?? ownerByCompany[p.company] ?? null;
            // 人材側 会社名（保存値 → 人材所属会社の順で自動表示）。
            const candCompany = p.cand_company ?? (p.candidate_id ? candCompanyById[p.candidate_id] : null) ?? null;
            p.cand_company = candCompany;
            // 承認済（＝企業マスタ「打ち合わせ済」ON）。案件 or 人材いずれかの会社が打合せ済なら承認済扱い。
            p.company_approved = !!(meetingDoneByCompany[p.company] || (candCompany && meetingDoneByCompany[candCompany]));
            // 会社の提案適性ランク（案件側＝クライアント会社／人材側＝所属会社）。
            p.company_rank = rankOf(p.company);
            p.cand_company_rank = rankOf(candCompany);
            // 企業担当（窓口担当者）は保存値が無ければ企業マスタの contact_name を自動表示。
            p.company_contact = p.company_contact ?? (p.company ? contactByCompany[p.company] : null) ?? null;
            p.cand_company_contact = p.cand_company_contact ?? (candCompany ? contactByCompany[candCompany] : null) ?? null;
            // 自社担当：企業マスタ（企業メニュー）の owner_staff をそのまま表示（空欄ならそのまま空欄）。
            //   案件側＝クライアント会社／人材側＝人材の所属会社。連携キーは会社名→企業ID。
            //   #287/#293：完全一致 → trim一致 → 正規化キー一致 → 変種名（親会社名＋区切り）の順で
            //   企業マスタの行を1つに解決し、その行の企業ID（company_no）と自社担当を併せて表示する。
            const jobCompanyRow = companyRowFor(p.company);
            const candCompanyRow = companyRowFor(candCompany);
            p.company_owner_staff = jobCompanyRow?.owner_staff ?? null;
            p.cand_company_owner_staff = candCompanyRow?.owner_staff ?? null;
            p.company_no = jobCompanyRow?.company_no ?? null;
            p.cand_company_no = candCompanyRow?.company_no ?? null;
            // 会社評価★（案件★の会社平均）。提案詳細のランクバッジ横に表示。
            p.company_star = (p.company ? companyRatings[p.company] : null) ?? null;
            p.cand_company_star = (candCompany ? companyRatings[candCompany] : null) ?? null;
            // LP（enger.jp）からのエンジニア直接応募は next_action に「エンジニア直接応募（LP）」が入る。
            //   営業起点の提案と区別できるよう lp_direct フラグを派生させ、ボード/リストでバッジ表示する。
            p.lp_direct = /直接応募/.test(String(p.next_action ?? ""));
          }
        } catch { /* 列未整備でも続行 */ }
        // 終了系は all に入らない（活性ステージで絞っているため）。
        // 旧: lostRows / lost の集計はここで作っていたが現在使われておらず、削除。
        // ボードは all をそのまま使う（all=進行中のみ）。
        proposals = all;
        // 提案履歴 / 失注分析 はタブを開いた時に /api/proposals/list で個別取得する遅延ロードに変更。
        //   従来は all（最大400件）から派生した history / analyticsRows を props でブラウザへ送っており、
        //   ボード(68)に加え履歴326+失注258ぶんの JSON が初期転送され、egress 急増（5GB/月のうち
        //   今日だけで923MB）と体感遅延の主因になっていた。初期転送をボードだけにし、履歴・失注は
        //   タブ open 時にフェッチする。
        history = [];
        analyticsRows = [];
        // 先行投入した 企業フィードバック＋件数COUNT を回収（重い案件/人材/企業マスタ取得と並行済み）。
        const [fbMap, tc, wc, c30] = await auxP as [Record<string, any>, { count: number | null }, { count: number | null }, { count: number | null }];
        feedbackList = all
          .filter((p: any) => fbMap[p.id])
          .map((p: any) => ({ verdict: fbMap[p.id].verdict, reason: fbMap[p.id].reason, c_init: p.c_init || "人材", job_title: p.job_title || "—", company: p.company || "—", updated_at: fbMap[p.id].updated_at }))
          .sort((a: any, b: any) => (a.updated_at < b.updated_at ? 1 : -1));
        // month/thirty は同じ「直近30日」集計(c30)を共有。
        startStats = { today: tc.count ?? 0, week: wc.count ?? 0, month: c30.count ?? 0, thirty: c30.count ?? 0 };
      }
    } catch (e) {
      dbError = e instanceof Error ? e.message : String(e);
    }
  } else {
    dbError = "Supabase の環境変数が未設定です";
  }

  return (
    <div className="page">
      {/* 統一ヘッダー（他メニューと同じ：カテゴリ→タイトル→説明）。
          新規登録ボタンは提案ボードのツールバー（AIコーチの隣）、選択肢編集は設定へ。 */}
      <div className="page-head">
        <div>
          <div className="meta">Proposals · 提案管理</div>
          <h1>提案管理</h1>
          <div className="sub">提案の進捗（KPI/KGI・承認・ボード・失注分析）をまとめて確認します。</div>
        </div>
      </div>
      {dbError &&<div className="card" style={{ borderColor: "var(--color-danger)", color: "var(--color-danger)" }}><b>DB:</b> {dbError}</div>}

      {needSetup && (
        <div className="card" style={{ background: "var(--color-brand-25)", borderColor: "var(--color-brand-100)" }}>
          <b>提案テーブルが未作成です。</b> 中央 Supabase の SQL Editor で <span className="mono">supabase/schema-matching.sql</span> を実行すると、提案管理・稼働管理が使えるようになります。
        </div>
      )}

      {!needSetup && (
        <>
          <ProposalsWorkspace
            proposals={proposals}
            history={history}
            analyticsRows={analyticsRows}
            members={staff.members}
            currentUserName={currentUserName}
            privileged={canApprove}
            kpiProps={kpiData?.kpi}
            teamActivity={kpiData?.teamActivity}
            teamFunnel={kpiData?.teamFunnel}
            stageTargets={kpiData?.stageTargets}
            stageTeamWeekly={kpiData?.stageTeamWeekly}
            kgiByMember={kpiData?.kgiByMember}
            roleByMember={kpiData?.roleByMember}
            kpiMembers={kpiMembers}
            kpiMemberSuggestions={staff.members}
            funnelRates={kpiData?.funnelRates}
            meetingEvents={kpiData?.meetingEvents}
            procurementEvents={kpiData?.procurementEvents}
            meetingReachedEvents={kpiData?.meetingReachedEvents}
            proposalReachedEvents={kpiData?.proposalReachedEvents}
            reportsView={reportsView}
            // 編集UI（ProposalOwnersEditor）と提案詳細の割当ドロップダウンで
            // 選択肢が食い違わないよう、同じ ownersInitial（未保存時は members に統一）を渡す。
            proposers={ownersInitial.proposers}
            closers={ownersInitial.closers}
            fallbackBanner={
              <div className="card" style={{ textAlign: "center", color: "var(--color-ink-4)", padding: 40 }}>
                まだ提案がありません。<b style={{ color: "var(--color-ink-2)" }}>マッチング</b>画面でペアを選び、「提案ボードに記録」を押すとここに表示されます。
              </div>
            }
          />
          {feedbackList.length > 0 && (
            <div className="card" style={{ marginTop: 14 }}>
              <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 12 }}>
                <h3 style={{ margin: 0, fontSize: 13.5, fontWeight: 700 }}>🗣 企業からの評価（ミスマッチ低減）</h3>
                <span className="muted" style={{ fontSize: 11.5 }}>{feedbackList.length} 件</span>
              </div>
              <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
                {feedbackList.slice(0, 12).map((f, i) => {
                  const tone = f.verdict === "want" ? { bg: "#e7f7ee", fg: "#067647" } : f.verdict === "mismatch" ? { bg: "#fdecef", fg: "#b42318" } : { bg: "#fff5e6", fg: "#b45309" };
                  return (
                    <div key={i} style={{ display: "flex", gap: 10, alignItems: "flex-start", padding: "9px 12px", border: "1px solid var(--color-border)", borderRadius: 10 }}>
                      <span style={{ flexShrink: 0, fontSize: 11.5, fontWeight: 700, padding: "3px 10px", borderRadius: 999, background: tone.bg, color: tone.fg }}>{VERDICT_LABEL[f.verdict]}</span>
                      <div style={{ minWidth: 0 }}>
                        <div style={{ fontSize: 12.5, fontWeight: 600 }}>{f.company}<span className="muted" style={{ fontWeight: 400 }}> ・ {f.c_init} ・ {f.job_title}</span></div>
                        {f.reason && <div className="muted" style={{ fontSize: 12, marginTop: 2 }}>「{f.reason}」</div>}
                      </div>
                    </div>
                  );
                })}
              </div>
              <div style={{ marginTop: 10, fontSize: 10.5, color: "var(--color-ink-4)" }}>※ ユーザー企業ポータルの「おすすめ人材」で企業が返した評価です。ミスマッチ理由を次の提案に反映しましょう。</div>
            </div>
          )}
        </>
      )}
    </div>
  );
}
