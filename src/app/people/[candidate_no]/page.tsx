import Link from "@/components/AppLink";
import { redirect } from "next/navigation";
import { Icons } from "@/components/icons";
import { FlowSteps } from "@/components/FlowSteps";
import { MailButton } from "@/components/MailButton";
import { EditCandidateButton } from "@/components/EditEntryButton";
import { DeleteEntityButton } from "@/components/DeleteEntityButton";
import { CloseToggleButton } from "@/components/CloseToggleButton";
import { CandidateNoteEditor } from "@/components/CandidateNoteEditor";
import { CandidateSkillsToolsEditor } from "@/components/CandidateSkillsToolsEditor";
import { IntroLinkButton } from "@/components/IntroLinkButton";
import { engerClient, dbConfigured } from "@/lib/supabase";
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

  if (dbConfigured) {
    try {
      const sb = engerClient();
      const base = "id, candidate_no, name, initials, title, affiliation, source_company, company, skills, rate, salary_min, salary_max, avail, location, exp, status, remote_pref, age_band, nationality, skill_level, japanese_level, comm, note, is_focus";
      // #325/#330：tools・residence・登録元(signup_source/source_csv) は最初の取得だけに含める。
      //   未整備環境ではカラムエラーで下のフォールバック（これらを含まない版）に落ちる。
      let r: any = await sb.from("candidates").select(`${base}, tools, residence, detail_note, signup_source, source_csv, is_closed, email, contact_email, rank, skill_sheet_url, source_mail_url`).eq("candidate_no", no).maybeSingle();
      if (r.error) r = await sb.from("candidates").select(`${base}, is_closed, email, contact_email, rank, skill_sheet_url, source_mail_url`).eq("candidate_no", no).maybeSingle();
      if (r.error) r = await sb.from("candidates").select(`${base}, email, contact_email, rank, skill_sheet_url`).eq("candidate_no", no).maybeSingle();
      if (r.error) r = await sb.from("candidates").select(base).eq("candidate_no", no).maybeSingle();
      c = r.data;
      // 元メールリンクを直近受信メールへ更新（同人材／同送信元の最新メールに飛ぶ）。
      if (c) await attachLatestSourceMail(sb, "candidate", [c]);
      // #333：この人材が対象の提案ボード記録（マッチングレコード）を取得。
      if (c?.id) matchingRecords = await getMatchingRecordsFor(sb, { candidateId: c.id });
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
          <CandidateSkillsToolsEditor candidateNo={c.candidate_no} initialSkills={Array.isArray(c.skills) ? c.skills : []} initialTools={Array.isArray(c.tools) ? c.tools : []} />
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
            [["年齢（年代）", c.age_band ?? ""], ["国籍", c.nationality ? <NatBadge value={c.nationality} /> : ""]],
            [["稼働開始予定日", c.avail ?? ""], ["リモート希望", c.remote_pref ?? ""], ["経験", expVal]],
            [["勤務地", c.location ?? ""], ["居住地", c.residence ?? ""]],
            [["日本語", c.japanese_level ?? ""], ["コミュ力", c.comm ?? ""], ["スキルレベル", c.skill_level ?? ""]],
            [["所属", company]],
            [["連絡先", c.email ?? c.contact_email ?? ""]],
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
