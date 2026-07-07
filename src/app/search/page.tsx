import Link from "@/components/AppLink";
import { Icons } from "@/components/icons";
import { MailButton } from "@/components/MailButton";
import { engerClient, dbConfigured } from "@/lib/supabase";
import { listEngineers, freelanceShortId } from "@/lib/engineers";
import { resolveEngineerProfileNames } from "@/lib/chat";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

// ひらがな→カタカナ（フリガナ検索をどちらの表記でも当てる）。
const toKatakana = (s: string) => s.replace(/[ぁ-ゖ]/g, (ch) => String.fromCharCode(ch.charCodeAt(0) + 0x60));

const remoteLabel = (r: string | null) =>
  r === "full_remote" ? "フルリモート" : r === "partial_remote" ? "一部リモート" : r === "onsite" ? "出社" : (r || "—");
const salaryLabel = (lo: number | null, hi: number | null) =>
  lo && hi ? (lo === hi ? `¥${lo}万` : `¥${lo}〜${hi}万`) : hi ? `〜¥${hi}万` : lo ? `¥${lo}万〜` : "スキル見合い";

export default async function SearchPage({ searchParams }: { searchParams: Promise<{ q?: string }> }) {
  const { q = "" } = await searchParams;
  const term = q.trim();
  const safe = term.replace(/[%,()]/g, " ").trim(); // ilike/or 用にサニタイズ

  let jobs: any[] = [], people: any[] = [], companies: { name: string; active_jobs: number; job_count: number }[] = [];
  let freelancers: { id: string; shortId: string; label: string; sub: string }[] = [];
  let dbError: string | null = null;

  if (term && dbConfigured) {
    try {
      const sb = engerClient();
      const like = `%${safe}%`;
      // 番号での直打ち検索。純数字に加え、接頭辞付き（人材 P-17013 / 案件 No.45509 / J-123 等）も拾う。
      //   接頭辞 P… → 人材(candidate_no)、それ以外の接頭辞(No/J 等) → 案件(job_no)、
      //   接頭辞なし(純数字) → 両方を検索（番号空間が異なるため誤ヒットは少ない）。
      const idm = safe.match(/^([A-Za-z]{0,4})[\s\-#.．_]*(\d{1,9})$/);
      const asInt = idm ? Number(idm[2]) : null;
      const idPfx = (idm?.[1] ?? "").toUpperCase();
      const idWantCand = asInt != null && (idPfx === "" || idPfx.startsWith("P"));
      const idWantJob = asInt != null && (idPfx === "" || !idPfx.startsWith("P"));
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
      const jobCols = "job_no, title, client_name, role_label, remote_type, salary_min, salary_max, is_published";
      // #276①：検索結果の人材行にも通常一覧と同じ操作ボタン（マッチング/元メール/スキルシート）を
      //   出すため、必要な列を追加。列が無い旧環境ではベース列にフォールバック。
      let candCols = "candidate_no, name, initials, title, affiliation, source_company, rate, source_mail_url, skill_sheet_url, is_closed";
      const candColsBase = "candidate_no, name, initials, title, affiliation, source_company, rate";
      let [jr, cr, co] = await Promise.all([
        sb.from("jobs").select(jobCols).or(orJob + skillsOr).order("created_at", { ascending: false }).limit(20),
        sb.from("candidates").select(candCols).or(orCand + skillsOr).order("created_at", { ascending: false }).limit(20),
        sb.rpc("company_overview"),
      ]);
      // #329：skills::text キャスト拒否で失敗したら skills を外して再試行（名前・案件名・ID を生かす）。
      if ((jr as any).error) {
        jr = await sb.from("jobs").select(jobCols).or(orJob).order("created_at", { ascending: false }).limit(20) as any;
      }
      // 人材：まず skills を外して再試行（キャスト拒否対策）、さらにダメなら取得列も基本列へ縮退。
      if ((cr as any).error) {
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
      const allCo = (Array.isArray(co.data) ? co.data : []) as any[];
      companies = allCo.filter((c) => (c.name ?? "").toLowerCase().includes(safe.toLowerCase())).slice(0, 20);
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
          <div className="sub">案件・人材・企業を横断して検索します。上部の検索バーから何度でも検索できます。</div>
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
                <div style={{ fontSize: 12.5, fontWeight: 600, color: "var(--color-ink)" }}><span className="muted tnum" style={{ marginRight: 6 }}>#{j.job_no}</span>{j.title}{j.is_published === false && <span className="tag" style={{ fontSize: 9.5, marginLeft: 6 }}>非公開</span>}</div>
                <div className="muted" style={{ fontSize: 10.5 }}>{j.client_name ?? "—"} · {j.role_label ?? ""} · {remoteLabel(j.remote_type)} · {salaryLabel(j.salary_min, j.salary_max)}</div>
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
                <div style={{ fontSize: 12.5, fontWeight: 600, color: "var(--color-ink)" }}><span className="muted tnum" style={{ marginRight: 6 }}>#{p.candidate_no}</span>{p.name || p.initials || "—"}{p.name && p.initials && p.name !== p.initials ? <span className="muted">（{p.initials}）</span> : null}</div>
                <div className="muted" style={{ fontSize: 10.5 }}>{p.title ?? "—"} · {p.affiliation ?? p.source_company ?? ""} · {p.rate ?? ""}</div>
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
