import Link from "@/components/AppLink";
import { Icons } from "@/components/icons";
import { MailButton } from "@/components/MailButton";
import { engerClient, dbConfigured } from "@/lib/supabase";
import { listEngineers, freelanceShortId } from "@/lib/engineers";
import { resolveEngineerProfileNames } from "@/lib/chat";
import { classifyCandNationality, CAND_NAT_LABEL } from "@/lib/nationality";
import { companyIdLabel } from "@/lib/companies";
import { candidateIdLabel, jobIdLabel, parseEntityId } from "@/lib/entity-ids";

// #360②：検索結果に付ける「提案済み」バッジ。
function ProposedBadge() {
  return (
    <span className="tag" style={{ fontSize: 9.5, fontWeight: 700, background: "#e8ebef", color: "#5b6675", border: "1px solid #d3d9e0", whiteSpace: "nowrap" }}>✓ 提案済み</span>
  );
}

// #767：名前・案件名の「下」に出すID行（一覧の人材ID／案件ID列と同じ表記）。
function IdLine({ children }: { children: React.ReactNode }) {
  return <div className="mono" style={{ fontSize: 10.5, color: "var(--color-ink-4)", marginTop: 1 }}>{children}</div>;
}

// #767：検索結果の1行に「ラベル：値」を中黒でつなげて出す。
//   ラベルを付けるのは、値だけ並べると何の項目か分からず「所属会社が出ていない」ように見えるため。
//   空の項目は行ごと出さない（「所属会社：—」の羅列を避ける）。
function Fields({ items }: { items: [string, unknown][] }) {
  const shown = items
    .map(([label, v]) => [label, String(v ?? "").trim()] as const)
    .filter(([, v]) => v !== "");
  if (shown.length === 0) return <div className="muted" style={{ fontSize: 10.5 }}>—</div>;
  // 折返し対策：
  //   ・1項目を inline-block にして「最寄／り駅」のように項目の途中で改行されないようにする。
  //   ・中黒は項目の後ろに入れる（項目ごと次の行へ送られたとき、行頭が「·」から始まらない）。
  return (
    <div className="muted" style={{ fontSize: 10.5, lineHeight: 1.7 }}>
      {shown.map(([label, v], i) => (
        <span key={label} style={{ display: "inline-block" }}>
          <span style={{ fontWeight: 600, whiteSpace: "nowrap" }}>{label}：</span>{v}
          {i < shown.length - 1 && <span style={{ opacity: 0.45, margin: "0 5px" }}>·</span>}
        </span>
      ))}
    </div>
  );
}

export const dynamic = "force-dynamic";
export const maxDuration = 60;

// ひらがな→カタカナ（フリガナ検索をどちらの表記でも当てる）。
const toKatakana = (s: string) => s.replace(/[ぁ-ゖ]/g, (ch) => String.fromCharCode(ch.charCodeAt(0) + 0x60));

const remoteLabel = (r: string | null) =>
  r === "full_remote" ? "フルリモート" : r === "partial_remote" ? "一部リモート" : r === "onsite" ? "出社" : (r || "—");
const salaryLabel = (lo: number | null, hi: number | null) =>
  lo && hi ? (lo === hi ? `¥${lo}万` : `¥${lo}〜${hi}万`) : hi ? `〜¥${hi}万` : lo ? `¥${lo}万〜` : "スキル見合い";
// 国籍は分類してからラベル化。「不明」は行に出さない（#360①）。
const candNatLabel = (v: string | null | undefined) => {
  const c = classifyCandNationality(v);
  return c !== "unknown" ? CAND_NAT_LABEL[c] : null;
};

export default async function SearchPage({ searchParams }: { searchParams: Promise<{ q?: string }> }) {
  const { q = "" } = await searchParams;
  const term = q.trim();
  const safe = term.replace(/[%,()]/g, " ").trim(); // ilike/or 用にサニタイズ

  // #767：企業も企業ID（C-00001）で引けるようにするため、企業行に company_no を持たせる。
  let jobs: any[] = [], people: any[] = [], companies: { name: string; active_jobs: number; job_count: number; company_no: number | null }[] = [];
  let freelancers: { id: string; shortId: string; label: string; sub: string }[] = [];
  let dbError: string | null = null;
  // #360②：提案済みの案件/人材（id）。検索結果に「提案済み」マークを付ける。
  const proposedJobIds = new Set<string>();
  const proposedCandIds = new Set<string>();

  if (term && dbConfigured) {
    try {
      const sb = engerClient();
      const like = `%${safe}%`;
      // 番号での直打ち検索。純数字に加え、接頭辞付き（人材 P-17013 / 案件 No.45509 / 企業 C-00001 等）も拾う。
      //   #767：企業ID（C-…）を追加。判定は lib/entity-ids に集約した（表示ラベルと同じ場所）。
      const idq = parseEntityId(safe);
      const asInt = idq?.no ?? null;
      const idWantCand = idq?.cand ?? false;
      const idWantJob = idq?.job ?? false;
      const idWantCompany = idq?.company ?? false;
      // #329：skills は text[] のため ::text キャストして ILIKE するが、環境によっては or 内の
      //   ::text キャストが拒否され or 全体が失敗（案件も人材も0件）する。skills を含まない基本 or を
      //   別途用意し、フル(or+skills)がエラーなら基本 or で再試行して名前・案件名・ID検索を必ず生かす。
      const skillsOr = `,skills::text.ilike.${like}`;
      const orJob = [
        `title.ilike.${like}`,
        `client_name.ilike.${like}`,
        `role_label.ilike.${like}`,
        `flow_note.ilike.${like}`,
        `detail.ilike.${like}`,
      ].join(",");
      const orCand = [
        `name.ilike.${like}`,
        `initials.ilike.${like}`,
        `title.ilike.${like}`,
        `source_company.ilike.${like}`,
        `company.ilike.${like}`,
        `affiliation.ilike.${like}`,
        `note.ilike.${like}`,
      ].join(",");

      // メイン検索（テキスト ilike）。非公開も含めて拾うため is_published 制約は外す。
      //   id は #360②「提案済み」マーク（proposals.job_id/candidate_id との突合）に使う。
      const jobCols = "id, job_no, title, client_name, role_label, remote_type, salary_min, salary_max, is_published";
      // #276①：検索結果の人材行にも通常一覧と同じ操作ボタン（マッチング/元メール/スキルシート）を
      //   出すため、必要な列を追加。列が無い旧環境ではベース列にフォールバック。
      // #360①：年代(age_band)・国籍(nationality)・所属会社(company)も表示するため取得。
      // #767：最寄り駅(location)・居住地(residence)も追加。
      //   この2列が無い環境でも「操作ボタン用の列（source_mail_url 等）」まで巻き添えで
      //   落とさないよう、縮退の段を1つ挟む（geo なし → さらにベース列）。
      const candColsGeo = ", location, residence";
      const candColsFull = "id, candidate_no, name, initials, title, affiliation, source_company, company, age_band, nationality, rate, source_mail_url, skill_sheet_url, is_closed";
      const candColsBase = "id, candidate_no, name, initials, title, affiliation, source_company, company, age_band, nationality, rate";
      let candCols = candColsFull + candColsGeo;
      let [jr, cr, co] = await Promise.all([
        sb.from("jobs").select(jobCols).or(orJob + skillsOr).order("created_at", { ascending: false }).limit(20),
        sb.from("candidates").select(candCols).or(orCand + skillsOr).order("created_at", { ascending: false }).limit(20),
        sb.rpc("company_overview"),
      ]);
      // #329：skills::text キャスト拒否で失敗したら skills を外して再試行（名前・案件名・ID を生かす）。
      if ((jr as any).error) {
        jr = await sb.from("jobs").select(jobCols).or(orJob).order("created_at", { ascending: false }).limit(20) as any;
      }
      // 人材：まず skills を外して再試行（キャスト拒否対策）、さらにダメなら取得列を段階的に縮退。
      if ((cr as any).error) {
        cr = await sb.from("candidates").select(candCols).or(orCand).order("created_at", { ascending: false }).limit(20) as any;
      }
      if ((cr as any).error) {
        candCols = candColsFull; // #767：最寄り駅・居住地の列が無い環境
        cr = await sb.from("candidates").select(candCols).or(orCand).order("created_at", { ascending: false }).limit(20) as any;
      }
      if ((cr as any).error) {
        candCols = candColsBase;
        cr = await sb.from("candidates").select(candCols).or(orCand).order("created_at", { ascending: false }).limit(20) as any;
      }
      // ID/番号の直打ち（数値入力時）。重複は後段で uniq する
      if (asInt != null) {
        const [jr2, cr2] = await Promise.all([
          idWantJob ? sb.from("jobs").select(jobCols).eq("job_no", asInt).limit(5) : Promise.resolve({ data: [] } as any),
          idWantCand ? sb.from("candidates").select(candCols).eq("candidate_no", asInt).limit(5) : Promise.resolve({ data: [] } as any),
        ]);
        const seenJ = new Set<number>((jr.data ?? []).map((j: any) => j.job_no));
        const seenC = new Set<number>((cr.data ?? []).map((c: any) => c.candidate_no));
        jr = { ...jr, data: [...(jr2.data ?? []).filter((j: any) => !seenJ.has(j.job_no)), ...(jr.data ?? [])] } as any;
        cr = { ...cr, data: [...(cr2.data ?? []).filter((c: any) => !seenC.has(c.candidate_no)), ...(cr.data ?? [])] } as any;
      }
      jobs = jr.data ?? [];
      people = cr.data ?? [];

      // 企業：company_overview（案件の集計）に企業マスタの企業ID（company_no）を名寄せして混ぜる。
      //   #767：企業名だけでなく企業ID（C-00001 / 1 / 00001）でも当たるようにする。
      //   ・案件がまだ1件も無い登録企業は company_overview に出てこないので、
      //     マスタ側で名前かIDに当たった行を後ろに足す（「対象がヒットする」を満たすため）。
      //   ・company_no 列が無い環境では名前だけで従来どおり動く（fail-soft）。
      const nkey = (s?: string | null) => String(s ?? "").replace(/^[\s　]+|[\s　]+$/g, "");
      let regCompanies: { name: string; company_no: number | null }[] = [];
      try {
        let cm: any = await sb.from("companies").select("name, company_no");
        if (cm.error) cm = await sb.from("companies").select("name");
        if (!cm.error) {
          regCompanies = (cm.data ?? []).map((r: any) => ({
            name: String(r.name ?? ""),
            company_no: r.company_no == null ? null : Number(r.company_no),
          }));
        }
      } catch { /* 企業マスタ未整備でも案件集計だけで続行 */ }
      const noByName = new Map<string, number>();
      for (const r of regCompanies) if (r.company_no != null && nkey(r.name)) noByName.set(nkey(r.name), r.company_no);

      const needleCo = safe.toLowerCase();
      const hitCompany = (name: string, no: number | null) =>
        (needleCo !== "" && name.toLowerCase().includes(needleCo)) || (idWantCompany && no != null && no === asInt);

      const allCo = (Array.isArray(co.data) ? co.data : []) as any[];
      const picked = allCo
        .map((c) => ({ ...c, company_no: noByName.get(nkey(c.name)) ?? null }))
        .filter((c) => hitCompany(String(c.name ?? ""), c.company_no));
      const seenCo = new Set(picked.map((c) => nkey(c.name)));
      for (const r of regCompanies) {
        const k = nkey(r.name);
        if (!k || seenCo.has(k)) continue;
        if (!hitCompany(r.name, r.company_no)) continue;
        seenCo.add(k);
        picked.push({ name: r.name, active_jobs: 0, job_count: 0, company_no: r.company_no });
      }
      companies = picked.slice(0, 20);

      // #360②：検索結果の案件・人材に「提案済み」マークを付けるため、提案レコードの有無を引く。
      //   proposals は job_id / candidate_id（UUID）で紐づくので、検索結果の id で照合する（.in で軽量）。
      try {
        const jobIds = jobs.map((j: any) => j.id).filter(Boolean);
        const candIds = people.map((p: any) => p.id).filter(Boolean);
        const [pj, pc] = await Promise.all([
          jobIds.length ? sb.from("proposals").select("job_id").in("job_id", jobIds).limit(5000) : Promise.resolve({ data: [] } as any),
          candIds.length ? sb.from("proposals").select("candidate_id").in("candidate_id", candIds).limit(5000) : Promise.resolve({ data: [] } as any),
        ]);
        for (const r of (pj.data ?? []) as any[]) if (r.job_id) proposedJobIds.add(String(r.job_id));
        for (const r of (pc.data ?? []) as any[]) if (r.candidate_id) proposedCandIds.add(String(r.candidate_id));
      } catch { /* proposals 未整備でもマーク無しで続行 */ }
    } catch (e) {
      dbError = e instanceof Error ? e.message : String(e);
    }

    // #255：ENGERフリーランス（public.profiles）も横断検索。
    //   E番号（E-XXXXX・部分一致可）／姓名（漢字・カタカナ、ひらがな入力もカナに寄せて部分一致）／
    //   表示名・GitHub名・メールでもヒットさせる。profiles 未接続でも他の結果は出す（fail-soft）。
    try {
      const needle = safe.toLowerCase();
      const needleKana = toKatakana(safe);
      // "E-xxx" / "exxx" 形式は E番号のプレフィックス検索として扱う。
      const em = /^e[\s\-‐ー]*([0-9a-fA-F]{1,5})$/i.exec(safe);
      const eHex = em ? em[1].toUpperCase() : null;
      const { rows } = await listEngineers();
      if (rows.length > 0) {
        const names = await resolveEngineerProfileNames(rows.map((r) => r.id));
        for (const r of rows) {
          const sid = freelanceShortId(r.id); // E-XXXXX
          const nm = names.get(r.id);
          const hay = [r.display_name, r.github_login, r.name, r.email, nm?.kanji, nm?.kana, nm?.initials]
            .filter(Boolean).map((s) => String(s)).join(" ");
          const hit =
            (eHex != null && sid.replace("E-", "").startsWith(eHex)) ||
            (!eHex && needle.length >= 1 && (
              sid.toLowerCase().includes(needle) ||
              hay.toLowerCase().includes(needle) ||
              (needleKana !== safe && toKatakana(hay).includes(needleKana)) ||
              toKatakana(hay).includes(needleKana)
            ));
          if (!hit) continue;
          const label = nm?.kanji || r.display_name || r.github_login || r.name || "（表示名なし）";
          const sub = [sid, nm?.kana, nm?.initials && `イニシャル ${nm.initials}`, r.primary_language].filter(Boolean).join(" · ");
          freelancers.push({ id: r.id, shortId: sid, label, sub });
          if (freelancers.length >= 20) break;
        }
      }
    } catch { /* profiles 未接続でも続行 */ }
  }

  const total = jobs.length + people.length + companies.length + freelancers.length;

  return (
    <div className="page">
      <div className="page-head">
        <div style={{ maxWidth: 760 }}>
          <div className="meta">Search · 検索</div>
          <h1>「{term || "—"}」の検索結果</h1>
          {/* #767：IDでも引けることを結果画面でも案内する（打ち方が分からないと使われないため）。 */}
          <div className="sub">案件・人材・企業を横断して検索します。名前のほか、人材ID（P-17013）・案件ID（No.45509）・企業ID（C-00001）でも検索できます。</div>
        </div>
      </div>

      {dbError && <div className="card" style={{ borderColor: "var(--color-danger)", color: "var(--color-danger)" }}><b>DB:</b> {dbError}</div>}
      {term === "" && <div className="card" style={{ color: "var(--color-ink-4)" }}>検索語を入力してください。</div>}
      {term !== "" && total === 0 && !dbError && <div className="card" style={{ textAlign: "center", color: "var(--color-ink-4)", padding: 40 }}>「{term}」に一致する結果がありません。</div>}

      {jobs.length > 0 && (
        <div className="card flush">
          <div style={{ padding: "14px 18px", borderBottom: "1px solid var(--color-border)", display: "flex", justifyContent: "space-between", alignItems: "center" }}>
            <div style={{ fontSize: 14, fontWeight: 700 }}>案件</div><span className="tag brand">{jobs.length}件</span>
          </div>
          {jobs.map((j) => (
            <div key={j.job_no} style={{ display: "grid", gridTemplateColumns: "1fr auto", gap: 10, alignItems: "center", padding: "12px 18px", borderBottom: "1px solid var(--color-border)" }}>
              {/* 案件名クリックは詳細画面へ（マッチングはボタンから）。 */}
              <Link href={`/jobs/${j.job_no}`} style={{ textDecoration: "none", color: "inherit", minWidth: 0 }}>
                {/* #767：案件IDは案件名の「下」に出す（行頭の #番号 はここへ移動）。 */}
                <div style={{ fontSize: 12.5, fontWeight: 600, color: "var(--color-ink)", display: "flex", alignItems: "center", gap: 6, flexWrap: "wrap" }}>{j.title}{j.is_published === false && <span className="tag" style={{ fontSize: 9.5 }}>非公開</span>}{j.id && proposedJobIds.has(String(j.id)) && <ProposedBadge />}</div>
                <IdLine>案件ID {jobIdLabel(j.job_no) ?? "—"}</IdLine>
                <Fields items={[
                  ["クライアント", j.client_name],
                  ["職種", j.role_label],
                  ["リモート", j.remote_type ? remoteLabel(j.remote_type) : null], // 未設定は行に出さない
                  ["単価", salaryLabel(j.salary_min, j.salary_max)],
                ]} />
              </Link>
              <Link href={`/matching?job=${j.job_no}`} className="btn brand btn-xs" style={{ textDecoration: "none" }}><Icons.matching /><span>マッチング</span></Link>
            </div>
          ))}
        </div>
      )}

      {people.length > 0 && (
        <div className="card flush">
          <div style={{ padding: "14px 18px", borderBottom: "1px solid var(--color-border)", display: "flex", justifyContent: "space-between", alignItems: "center" }}>
            <div style={{ fontSize: 14, fontWeight: 700 }}>人材</div><span className="tag brand">{people.length}名</span>
          </div>
          {people.map((p) => (
            <div key={p.candidate_no} style={{ display: "grid", gridTemplateColumns: "1fr auto", gap: 10, alignItems: "center", padding: "12px 18px", borderBottom: "1px solid var(--color-border)" }}>
              <Link href={`/people/${p.candidate_no}`} style={{ textDecoration: "none", color: "inherit", minWidth: 0 }}>
                {/* #267①：人材名（イニシャル）を必ず表示（name 空は initials 補完・異なる場合は併記）。 */}
                {/* #767：人材IDは人材名の「下」に出す（行頭の #番号 はここへ移動）。 */}
                <div style={{ fontSize: 12.5, fontWeight: 600, color: "var(--color-ink)", display: "flex", alignItems: "center", gap: 6, flexWrap: "wrap" }}>{p.name || p.initials || "—"}{p.name && p.initials && p.name !== p.initials ? <span className="muted">（{p.initials}）</span> : null}{p.id && proposedCandIds.has(String(p.id)) && <ProposedBadge />}</div>
                <IdLine>人材ID {candidateIdLabel(p.candidate_no) ?? "—"}</IdLine>
                {/* #360①：職種・所属会社・年代・国籍・単価。#767：最寄り駅・居住地も追加（空欄の項目は出さない）。 */}
                <Fields items={[
                  ["職種", p.title],
                  ["所属会社", p.source_company || p.company],
                  ["年代", p.age_band],
                  ["国籍", candNatLabel(p.nationality)],
                  ["単価", p.rate],
                  ["最寄り駅", p.location],
                  ["居住地", p.residence],
                ]} />
              </Link>
              {/* #276①：通常の人材一覧（PeopleTable）と同じ操作ボタンを表示。
                  マッチング（クローズ済は非表示）／元メール（URLあるときのみ）／スキルシート（URLあるときのみ）。 */}
              <div style={{ display: "flex", gap: 6, alignItems: "center" }}>
                {!p.is_closed && <Link href={`/matching?person=${p.candidate_no}`} className="btn btn-xs" title="マッチング" aria-label="マッチング" style={{ textDecoration: "none", background: "#DC143C", borderColor: "#DC143C", color: "#fff" }}><span className="material-symbols-outlined" style={{ fontSize: 18, lineHeight: 1 }}>auto_awesome</span></Link>}
                {p.source_mail_url && <MailButton url={p.source_mail_url} />}
                {p.skill_sheet_url && <a href={p.skill_sheet_url} target="_blank" rel="noopener noreferrer" className="btn btn-xs" title="スキルシートを開く" aria-label="スキルシート" style={{ textDecoration: "none", background: "#0095D9", borderColor: "#0095D9", color: "#fff" }}><span className="material-symbols-outlined" style={{ fontSize: 18, lineHeight: 1 }}>description</span></a>}
              </div>
            </div>
          ))}
        </div>
      )}

      {/* #255：ENGERフリーランス（E番号・漢字/カナ氏名の部分一致）。クリックで一覧に検索語を引き継ぐ。 */}
      {freelancers.length > 0 && (
        <div className="card flush">
          <div style={{ padding: "14px 18px", borderBottom: "1px solid var(--color-border)", display: "flex", justifyContent: "space-between", alignItems: "center" }}>
            <div style={{ fontSize: 14, fontWeight: 700, display: "inline-flex", alignItems: "center", gap: 6 }}><Icons.engerFreelance size={16} />フリーランス（ENGER登録者）</div><span className="tag brand">{freelancers.length}名</span>
          </div>
          {freelancers.map((f) => (
            <Link key={f.id} href={`/engineers?q=${encodeURIComponent(f.shortId)}`} style={{ textDecoration: "none", color: "inherit", display: "grid", gridTemplateColumns: "1fr auto", gap: 10, alignItems: "center", padding: "12px 18px", borderBottom: "1px solid var(--color-border)" }}>
              <div style={{ minWidth: 0 }}>
                <div style={{ fontSize: 12.5, fontWeight: 600, color: "var(--color-ink)" }}><span className="muted mono" style={{ marginRight: 6 }}>{f.shortId}</span>{f.label}</div>
                <div className="muted" style={{ fontSize: 10.5 }}>{f.sub}</div>
              </div>
              <span className="btn ghost btn-xs">一覧で開く</span>
            </Link>
          ))}
        </div>
      )}

      {companies.length > 0 && (
        <div className="card flush">
          <div style={{ padding: "14px 18px", borderBottom: "1px solid var(--color-border)", display: "flex", justifyContent: "space-between", alignItems: "center" }}>
            <div style={{ fontSize: 14, fontWeight: 700 }}>企業</div><span className="tag brand">{companies.length}社</span>
          </div>
          {companies.map((c) => (
            <Link key={c.name} href={`/jobs?client=${encodeURIComponent(c.name)}`} style={{ textDecoration: "none", color: "inherit", display: "grid", gridTemplateColumns: "1fr auto", gap: 10, alignItems: "center", padding: "12px 18px", borderBottom: "1px solid var(--color-border)" }}>
              <div style={{ minWidth: 0 }}>
                <div style={{ fontSize: 12.5, fontWeight: 600, color: "var(--color-ink)" }}>{c.name}</div>
                {/* #767：企業IDでも検索できるようにしたので、当たったIDが分かるよう社名の下に出す。 */}
                {companyIdLabel(c.company_no) && <IdLine>企業ID {companyIdLabel(c.company_no)}</IdLine>}
                <div className="muted" style={{ fontSize: 10.5 }}>進行中 {c.active_jobs}件 / 全 {c.job_count}件</div>
              </div>
              <span className="btn ghost btn-xs">案件を見る</span>
            </Link>
          ))}
        </div>
      )}
    </div>
  );
}
