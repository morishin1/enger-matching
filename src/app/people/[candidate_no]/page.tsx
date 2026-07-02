import Link from "@/components/AppLink";
import { redirect } from "next/navigation";
import { Icons } from "@/components/icons";
import { FlowSteps } from "@/components/FlowSteps";
import { MailButton } from "@/components/MailButton";
import { EditCandidateButton } from "@/components/EditEntryButton";
import { DeleteEntityButton } from "@/components/DeleteEntityButton";
import { CloseToggleButton } from "@/components/CloseToggleButton";
import { CandidateNoteEditor } from "@/components/CandidateNoteEditor";
import { engerClient, dbConfigured } from "@/lib/supabase";
import { reSubject, gmailMessageUrl, gmailSearchUrl } from "@/lib/gmail";
import { getViewerScope } from "@/lib/tenant";
import { ClosedBadge } from "@/components/ClosedBadge";
import { CompanyLink } from "@/components/CompanyLink";
import { getApprovedCompanySet, isCompanyApproved } from "@/lib/company-approval";
import { classifyCandNationality, CAND_NAT_LABEL, CAND_NAT_TONE } from "@/lib/nationality";
import { attachLatestSourceMail } from "@/lib/source-mail";

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

const Row = ({ label, value }: { label: string; value?: React.ReactNode }) =>
  value ? (
    <div style={{ display: "grid", gridTemplateColumns: "120px 1fr", gap: 12, padding: "9px 0", borderBottom: "1px solid var(--color-border)", fontSize: 13 }}>
      <div className="muted" style={{ fontSize: 12 }}>{label}</div>
      <div style={{ color: "var(--color-ink)" }}>{value}</div>
    </div>
  ) : null;

export default async function SkillSheetPage({ params }: { params: Promise<{ candidate_no: string }> }) {
  // 個別詳細ページは社内(admin/agent)のみ。テナント隔離ロールは一覧ドロワーの匿名表示のみ。
  const scope = await getViewerScope();
  if (scope.isTenant) redirect("/people");

  const { candidate_no } = await params;
  const no = Number(candidate_no);
  let c: any = null;
  let dbError: string | null = null;

  if (dbConfigured) {
    try {
      const sb = engerClient();
      const base = "candidate_no, name, initials, title, affiliation, source_company, company, skills, rate, salary_min, salary_max, avail, location, exp, status, remote_pref, age_band, nationality, skill_level, japanese_level, comm, note, is_focus";
      let r: any = await sb.from("candidates").select(`${base}, is_closed, email, contact_email, rank, skill_sheet_url, source_mail_url`).eq("candidate_no", no).maybeSingle();
      if (r.error) r = await sb.from("candidates").select(`${base}, email, contact_email, rank, skill_sheet_url`).eq("candidate_no", no).maybeSingle();
      if (r.error) r = await sb.from("candidates").select(base).eq("candidate_no", no).maybeSingle();
      c = r.data;
      // 元メールリンクを直近受信メールへ更新（同人材／同送信元の最新メールに飛ぶ）。
      if (c) await attachLatestSourceMail(sb, "candidate", [c]);
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
          <MailButton to={c.email ?? c.contact_email} subject={introMail.subject} body={introMail.body} label="メールで紹介" block />
          <EditCandidateButton candidate={c} />
          <CloseToggleButton kind="candidates" idValue={c.candidate_no} isClosed={!!c.is_closed} />
          <DeleteEntityButton kind="candidates" idValue={c.candidate_no} label={c.name ?? undefined} />
          <Link href="/people" className="btn ghost" style={{ textDecoration: "none" }}>← 一覧</Link>
        </div>
      </div>

      <FlowSteps current="data" sub="人材詳細（スキルシート）" />

      {c.skills?.length > 0 && (
        <div className="card">
          <div style={{ fontSize: 11, letterSpacing: ".08em", textTransform: "uppercase", color: "var(--color-ink-4)", fontWeight: 600, marginBottom: 10 }}>スキル</div>
          <div style={{ display: "flex", gap: 6, flexWrap: "wrap" }}>
            {(c.skills ?? []).map((s: string) => <span key={s} className="tag brand" style={{ fontSize: 12 }}>{s}</span>)}
          </div>
        </div>
      )}

      <div className="card">
        <div style={{ fontSize: 11, letterSpacing: ".08em", textTransform: "uppercase", color: "var(--color-ink-4)", fontWeight: 600, marginBottom: 6 }}>プロフィール</div>
        <Row label="ステータス" value={c.status} />
        <Row label="ランク" value={c.rank} />
        <Row label="経験" value={c.exp} />
        <Row label="希望単価" value={c.rate ?? (c.salary_min || c.salary_max ? `${c.salary_min ?? ""}〜${c.salary_max ?? ""}万円` : null)} />
        <Row label="稼働開始" value={c.avail} />
        <Row label="勤務地" value={c.location} />
        <Row label="リモート希望" value={c.remote_pref} />
        <Row label="年齢層" value={c.age_band} />
        <Row label="国籍" value={<NatBadge value={c.nationality} />} />
        <Row label="日本語" value={c.japanese_level} />
        <Row label="コミュ力" value={c.comm} />
        <Row label="スキルレベル" value={c.skill_level} />
        <Row label="所属" value={candCompany
          ? <span style={{ display: "inline-flex", alignItems: "center", gap: 6, flexWrap: "wrap" }}><CompanyLink name={candCompany} approved={candApproved} badge badgeSize="sm" />{c.affiliation ? <span className="muted" style={{ fontSize: 12 }}>（{c.affiliation}）</span> : null}</span>
          : (c.affiliation ?? null)} />
        <Row label="連絡先" value={c.email ?? c.contact_email} />
        {/* #276③：備考は常設のインライン編集欄に（ENGERフリーランス経由の人材＝note空でも書き込める）。 */}
        <CandidateNoteEditor candidateNo={c.candidate_no} initial={c.note ?? ""} />
      </div>
    </div>
  );
}
