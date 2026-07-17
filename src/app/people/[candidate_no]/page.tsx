import Link from "@/components/AppLink";
import { redirect } from "next/navigation";
import { Icons } from "@/components/icons";
import { FlowSteps } from "@/components/FlowSteps";
import { MailButton } from "@/components/MailButton";
import { EditCandidateButton } from "@/components/EditEntryButton";
import { DeleteEntityButton } from "@/components/DeleteEntityButton";
import { CloseToggleButton } from "@/components/CloseToggleButton";
import { CandidateNoteEditor } from "@/components/CandidateNoteEditor";
import { CandidateAgeBandEditor } from "@/components/CandidateAgeBandEditor";
import { CandidateSkillsToolsEditor } from "@/components/CandidateSkillsToolsEditor";
import { IntroLinkButton } from "@/components/IntroLinkButton";
import { engerClient, engerAdmin, publicAdmin, dbConfigured } from "@/lib/supabase";
import { reSubject, gmailMessageUrl, gmailSearchUrl } from "@/lib/gmail";
import { getViewerScope } from "@/lib/tenant";
import { ClosedBadge } from "@/components/ClosedBadge";
import { CompanyLink } from "@/components/CompanyLink";
import { getApprovedCompanySet, isCompanyApproved } from "@/lib/company-approval";
import { classifyCandNationality, CAND_NAT_LABEL, CAND_NAT_TONE } from "@/lib/nationality";
import { attachLatestSourceMail } from "@/lib/source-mail";
import { isEngerFreelance } from "@/lib/candidate-source";
import { getMatchingRecordsFor } from "@/lib/matching-records";
import { MatchingRecordsCard } from "@/components/MatchingRecordsCard";

export const dynamic = "force-dynamic";

// 人材の国籍を 3 区分（日本国籍 / 外国籍 / 不明）のバッジで表示。原文は title に保持。
function NatBadge({ value }: { value?: string | null }) {
  const cat = classifyCandNationality(value);
  const tone = CAND_NAT_TONE[cat];
  return (
    <span title={value ?? undefined} style={{ fontSize: 11.5, fontWeight: 700, padding: "2px 10px", borderRadius: 99, background: tone.bg, color: tone.fg, border: `1px solid ${tone.bd}` }}>
      {CAND_NAT_LABEL[cat]}
    </span>
  );
}


export default async function SkillSheetPage({ params }: { params: Promise<{ candidate_no: string }> }) {
  // 個別詳細ページは社内(admin/agent)のみ。テナント隔離ロールは一覧ドロワーの匿名表示のみ。
  const scope = await getViewerScope();
  if (scope.isTenant) redirect("/people");

  const { candidate_no } = await params;
  const no = Number(candidate_no);
  let c: any = null;
  let dbError: string | null = null;
  let matchingRecords: Awaited<ReturnType<typeof getMatchingRecordsFor>> = [];
  // #372①：ENGERフリーランス由来の人材は、フリーランス側プロフィール(public.profiles.skills)の
  //   経験年数・担当工程をライブ表示する（人材マスタにはスキル名しか写らないため）。
  let profileSkillDetails: Array<{ name: string; years: string | null; processes: string[] }> = [];

  if (dbConfigured) {
    try {
      const sb = engerClient();
      const base = "id, candidate_no, name, initials, title, affiliation, source_company, company, skills, rate, salary_min, salary_max, avail, location, exp, status, remote_pref, age_band, nationality, skill_level, japanese_level, comm, note, is_focus";
      // #325/#330：tools・residence・登録元(signup_source/source_csv) は最初の取得だけに含める。
      //   未整備環境ではカラムエラーで下のフォールバック（これらを含まない版）に落ちる。
      let r: any = await sb.from("candidates").select(`${base}, tools, residence, industries, detail_note, signup_source, source_csv, is_closed, email, contact_email, rank, skill_sheet_url, source_mail_url`).eq("candidate_no", no).maybeSingle();
      if (r.error) r = await sb.from("candidates").select(`${base}, tools, residence, detail_note, signup_source, source_csv, is_closed, email, contact_email, rank, skill_sheet_url, source_mail_url`).eq("candidate_no", no).maybeSingle();
      if (r.error) r = await sb.from("candidates").select(`${base}, is_closed, email, contact_email, rank, skill_sheet_url, source_mail_url`).eq("candidate_no", no).maybeSingle();
      if (r.error) r = await sb.from("candidates").select(`${base}, email, contact_email, rank, skill_sheet_url`).eq("candidate_no", no).maybeSingle();
      if (r.error) r = await sb.from("candidates").select(base).eq("candidate_no", no).maybeSingle();
      c = r.data;
      // 元メールリンクを直近受信メールへ更新（同人材／同送信元の最新メールに飛ぶ）。
      if (c) await attachLatestSourceMail(sb, "candidate", [c]);
      // #333：この人材が対象の提案ボード記録（マッチングレコード）を取得。
      if (c?.id) matchingRecords = await getMatchingRecordsFor(sb, { candidateId: c.id });
      // #372①：E↔P 紐付け（freelance_candidate_links）経由でプロフィールのスキル詳細を取得。
      //   フリーランス側が更新・保存すれば常に最新が表示される（コピーではなくライブ参照）。
      if (c?.id && isEngerFreelance(c)) {
        try {
          const lk: any = await engerAdmin().from("freelance_candidate_links")
            .select("engineer_id").eq("candidate_id", c.id).maybeSingle();
          const engineerId = lk?.data?.engineer_id;
          if (engineerId) {
            // #387④：スキル詳細に加えて 経験業種・居住地・最寄駅・リモート希望・職種・ツール も
            //   ライブ参照し、「プロフィールを更新」なしで最新値を表示する（未整備環境は skills のみ）。
            let pr: any = await publicAdmin().from("profiles").select("skills, tools, industries, prefecture, nearest_station, remote_pref, desired_role").eq("id", engineerId).maybeSingle();
            if (pr.error) pr = await publicAdmin().from("profiles").select("skills").eq("id", engineerId).maybeSingle();
            const raw = Array.isArray(pr?.data?.skills) ? pr.data.skills : [];
            profileSkillDetails = raw
              .map((s: any) => ({
                name: String(s?.name ?? "").trim(),
                years: typeof s?.years === "string" && s.years ? s.years : null,
                processes: Array.isArray(s?.processes) ? s.processes.filter(Boolean).map(String) : [],
              }))
              .filter((s: any) => s.name);
            // #387②：年数・工程の入力があるスキルを先に（元の順序は維持）。
            profileSkillDetails = [
              ...profileSkillDetails.filter((s) => s.years || s.processes.length > 0),
              ...profileSkillDetails.filter((s) => !s.years && s.processes.length === 0),
            ];
            // #387④：表示値をライブ値で上書き（プロフィール側が空の項目は既存表示を維持）。
            const lp: any = pr?.data ?? {};
            const liveIndustries = (Array.isArray(lp.industries) ? (lp.industries as any[]) : [])
              .map((x) => { const n = String(x?.name ?? "").trim(); if (!n) return ""; const y = String(x?.years ?? "").trim(); return y ? `${n}（${y}）` : n; })
              .filter(Boolean).join(", ");
            if (liveIndustries) c.industries = liveIndustries;
            if (String(lp.prefecture ?? "").trim()) c.residence = String(lp.prefecture).trim();
            if (String(lp.nearest_station ?? "").trim()) c.location = String(lp.nearest_station).trim();
            if (String(lp.remote_pref ?? "").trim()) {
              const rp = String(lp.remote_pref).trim();
              c.remote_pref = rp === "full_remote" ? "フルリモート希望" : rp === "hybrid" ? "一部リモート可" : rp === "onsite_ok" ? "出社可" : rp;
            }
            if (String(lp.desired_role ?? "").trim()) c.title = String(lp.desired_role).trim();
            const liveTools = Array.isArray(lp.tools) ? (lp.tools as any[]).map((t) => String(t).trim()).filter(Boolean) : [];
            if (liveTools.length > 0) c.tools = liveTools;
          }
        } catch { /* 紐付け・プロフィール未取得でも人材詳細の表示は継続 */ }
      }
    } catch (e) {
      dbError = e instanceof Error ? e.message : String(e);
    }
  }

  if (!c) {
    return (
      <div className="page">
        <div className="card">{dbError ? <span style={{ color: "var(--color-danger)" }}>DB: {dbError}</span> : "人材が見つかりませんでした。"} <Link href="/people">← 人材一覧へ</Link></div>
      </div>
    );
  }

  const introMail = {
    subject: reSubject(`【ご経歴のご案内】${c.name} 様`),
    body: [
      `お世話になっております。ENGER でございます。`,
      `下記人材のご経歴をご案内いたします。ご返信にてご関心の有無をお聞かせください。`,
      ``,
      `氏名：${c.name}（${c.title ?? "—"}）`,
      `所属：${c.affiliation ?? c.source_company ?? "—"}`,
      `経験：${c.exp ?? "—"} / 希望単価：${c.rate ?? "応相談"}`,
      `スキル：${(c.skills ?? []).join(" / ") || "—"}`,
      ``,
      `何卒よろしくお願いいたします。`,
    ].join("\n"),
  };

  // 元メール（Gmail）リンク。source_mail_url が gmail 形式ならメッセージ直リンク、
  // それ以外は URL そのまま。何も無ければ氏名・所属会社で Gmail 検索にフォールバック。
  const origMailUrl =
    gmailMessageUrl(c.source_mail_url)
    || c.source_mail_url
    || gmailSearchUrl([c.name, c.source_company || c.company].filter(Boolean).join(" "));

  const candCompany = (c.source_company || c.company) ?? null;
  const candApproved = isCompanyApproved(await getApprovedCompanySet(), candCompany);

  return (
    <div className="page">
      <div className="page-head">
        <div>
          <div className="meta">Skill Sheet · スキルシート</div>
          {/* #267①：人材名（イニシャル）を必ず表示。name が空でも initials で補完し、両方あって異なる場合は併記する。 */}
          <h1>{c.name || c.initials || `人材#${c.candidate_no}`}{c.initials && c.name && c.initials !== c.name ? <span style={{ fontSize: 16, fontWeight: 600, color: "var(--color-ink-3)" }}>（{c.initials}）</span> : null} <span className="mono" style={{ fontSize: 14, color: "var(--color-ink-4)", fontWeight: 400 }}>P-{String(c.candidate_no).padStart(5, "0")}</span> {c.is_closed && <ClosedBadge />}</h1>
          <div className="sub">{(() => { const co = c.source_company || c.company; const com = co && c.affiliation ? `${co}（${c.affiliation}）` : (co || c.affiliation); return [c.title, com].filter(Boolean).join(" · ") || "—"; })()}</div>
        </div>
        <div style={{ display: "flex", gap: 8, flexShrink: 0, alignItems: "center", flexWrap: "wrap" }}>
          {!c.is_closed && <Link href={`/matching?person=${c.candidate_no}`} className="btn brand" style={{ textDecoration: "none" }}><Icons.matching /><span>マッチング</span></Link>}
          {origMailUrl && <a href={origMailUrl} target="_blank" rel="noreferrer" className="btn ghost" style={{ textDecoration: "none" }}>↗ 元メール</a>}
          {c.skill_sheet_url && <a href={c.skill_sheet_url} target="_blank" rel="noreferrer" className="btn ghost" style={{ textDecoration: "none" }}>スキルシートを開く</a>}
          {/* 紹介リンク：ログイン経由でこの人材詳細に直行するURLをコピー（アカウントを持つ相手向け）。 */}
          <IntroLinkButton path={`/people/${c.candidate_no}`} />
          <MailButton to={c.email ?? c.contact_email} subject={introMail.subject} body={introMail.body} label="メールで紹介" block />
          <EditCandidateButton candidate={c} />
          <CloseToggleButton kind="candidates" idValue={c.candidate_no} isClosed={!!c.is_closed} />
          <DeleteEntityButton kind="candidates" idValue={c.candidate_no} label={c.name ?? undefined} />
          <Link href="/people" className="btn ghost" style={{ textDecoration: "none" }}>← 一覧</Link>
        </div>
      </div>

      <FlowSteps current="data" sub="人材詳細（スキルシート）" />

      {/* #325①/#330①：スキル・ツールの編集フォームは ENGERフリーランスの人材のみ表示。 */}
      {isEngerFreelance(c) && (
        <div className="card">
          <div style={{ fontSize: 11, letterSpacing: ".08em", textTransform: "uppercase", color: "var(--color-ink-4)", fontWeight: 600, marginBottom: 10 }}>スキル・ツール</div>
          {/* #387①：このブロックの「スキル」は「経験業種」に変更（candidates.industries を編集）。
              スキルの紐づけはここから解除（スキル詳細＝本人登録・一覧ドロワーの「スキル詳細」で管理）。 */}
          <CandidateSkillsToolsEditor candidateNo={c.candidate_no} variant="industries" initialIndustries={String(c.industries ?? "")} initialSkills={Array.isArray(c.skills) ? c.skills : []} initialTools={Array.isArray(c.tools) ? c.tools : []} />
          {/* #372①：フリーランス側プロフィールの経験年数・担当工程をスキルごとに1行で表示。
              フリーランスが更新・保存すると常に最新が反映される（profiles.skills のライブ参照）。 */}
          {profileSkillDetails.length > 0 && (
            <div style={{ marginTop: 12, borderTop: "1px dashed var(--color-border)", paddingTop: 10 }}>
              <div style={{ fontSize: 11, fontWeight: 600, color: "var(--color-ink-4)", marginBottom: 6 }}>
                スキル詳細（フリーランス本人の登録：経験年数・担当工程）
              </div>
              <div style={{ display: "flex", flexDirection: "column", gap: 4 }}>
                {/* #387②：年数・工程の入力があるスキルを先に表示（並び替えはデータ取得側）。
                    未入力スキルは「（年数・工程は未入力）」の文言を出さずタグのみ表示。 */}
                {profileSkillDetails.map((s) => (
                  <div key={s.name} style={{ display: "flex", alignItems: "baseline", gap: 8, fontSize: 12.5, flexWrap: "wrap", padding: "3px 0", borderBottom: "1px solid var(--color-surface-inset)" }}>
                    <span className="tag brand" style={{ fontSize: 11, flexShrink: 0 }}>{s.name}</span>
                    {s.years && <span style={{ color: "var(--color-ink-2)" }}>経験 {s.years}</span>}
                    {s.processes.length > 0 && <span className="muted" style={{ fontSize: 11.5 }}>担当工程：{s.processes.join("・")}</span>}
                  </div>
                ))}
              </div>
            </div>
          )}
        </div>
      )}

      {/* #330③：ENGERフリーランス以外の人材はスキルを「プロフィール」の上にタグで表示。 */}
      {!isEngerFreelance(c) && Array.isArray(c.skills) && c.skills.length > 0 && (
        <div className="card" style={{ display: "flex", gap: 6, flexWrap: "wrap" }}>
          {(c.skills as string[]).map((s) => <span key={s} className="tag brand" style={{ fontSize: 12 }}>{s}</span>)}
        </div>
      )}

      <div className="card">
        <div style={{ fontSize: 11, letterSpacing: ".08em", textTransform: "uppercase", color: "var(--color-ink-4)", fontWeight: 600, marginBottom: 6 }}>プロフィール</div>
        {(() => {
          // #347：ドロワーと同じ配置。① ステータス｜ランク｜希望単価 ② 年齢（年代）｜国籍
          //   ③ 稼働開始予定日｜リモート希望｜経験。
          const cell = (label: string, value: React.ReactNode) => (
            <div key={label} style={{ display: "flex", alignItems: "baseline", gap: 6, fontSize: 13, minWidth: 0 }}>
              <span className="muted" style={{ fontSize: 12, flexShrink: 0, whiteSpace: "nowrap" }}>{label}：</span>
              <span style={{ color: "var(--color-ink)", whiteSpace: "pre-wrap", wordBreak: "break-word", minWidth: 0 }}>{value}</span>
            </div>
          );
          const expVal = c.exp ? (/^\d+$/.test(String(c.exp).trim()) ? `${String(c.exp).trim()}年` : c.exp) : "";
          const company = candCompany
            ? <span style={{ display: "inline-flex", alignItems: "center", gap: 6, flexWrap: "wrap" }}><CompanyLink name={candCompany} approved={candApproved} badge badgeSize="sm" />{c.affiliation ? <span className="muted" style={{ fontSize: 12 }}>（{c.affiliation}）</span> : null}</span>
            : (c.affiliation ?? "");
          const rows: [string, React.ReactNode][][] = [
            [["ステータス", c.status ?? ""], ["ランク", c.rank ?? ""], ["希望単価", c.rate ?? (c.salary_min || c.salary_max ? `${c.salary_min ?? ""}〜${c.salary_max ?? ""}万円` : "")]],
            [["年齢（年代）", <CandidateAgeBandEditor candidateNo={c.candidate_no} initial={c.age_band ?? ""} />], ["国籍", c.nationality ? <NatBadge value={c.nationality} /> : ""]],
            [["稼働開始予定日", c.avail ?? ""], ["リモート希望", c.remote_pref ?? ""], ["経験", expVal]],
            // #446①：location は最寄り駅を保存している欄のため、表示名を「勤務地」→「最寄り駅」に変更。
            [["最寄り駅", c.location ?? ""], ["居住地", c.residence ?? ""]],
            // #372②：日本語・コミュ力・スキルレベルの欄は使っていないため削除。
            [["所属", company]],
            // #372②：本人メールは表示しない（連絡先は所属経由の contact_email のみ）。紹介メール送信は従来どおり。
            [["連絡先", c.contact_email ?? ""]],
          ];
          return rows.map((row, i) => (
            <div key={i} style={{ display: "grid", gridTemplateColumns: `repeat(${row.length}, minmax(0, 1fr))`, gap: 12, padding: "9px 0", borderBottom: "1px solid var(--color-border)" }}>
              {row.map(([label, value]) => cell(label, value))}
            </div>
          ));
        })()}
        {/* #347⑤：メール原文の上に「人材詳細」の入力フォーム。#347④：旧「備考」はメール原文に改称。 */}
        <CandidateNoteEditor candidateNo={c.candidate_no} initial={c.detail_note ?? ""} field="detail_note" label="人材詳細"
          placeholder="人材のポイント・補足などを入力（保存でこの人材の人材詳細に反映されます）" />
        <CandidateNoteEditor candidateNo={c.candidate_no} initial={c.note ?? ""} field="note" label="メール原文"
          placeholder="取込メールの本文など（保存でこの人材のメール原文に反映されます）" />
      </div>

      {/* #333：この人材が対象の提案ボード記録（マッチングレコード）一覧（リンク付き）。 */}
      <MatchingRecordsCard records={matchingRecords} />
    </div>
  );
}
