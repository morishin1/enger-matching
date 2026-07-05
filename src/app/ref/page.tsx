import type { Metadata } from "next";
import { getRefSession, bumpRefView, loadReferralPortal, REF_MAX_FAILED_ATTEMPTS, type RefVerdict } from "@/lib/referral";
import { refPortalLogin, refPortalLogout, reactReferralMatch } from "@/lib/referral-actions";

/** 良い/わるい判定ボタン（または判定済み表示）。両方向のマッチ行で共通利用。 */
function VerdictButtons({ kind, candidateNo, jobNo, verdict }: { kind: "cand_job" | "job_cand"; candidateNo: number; jobNo: number; verdict: RefVerdict }) {
  const btn = (v: "want" | "pass", label: string, active: boolean) => (
    <form action={reactReferralMatch} style={{ display: "inline" }}>
      <input type="hidden" name="kind" value={kind} />
      <input type="hidden" name="candidate_no" value={candidateNo} />
      <input type="hidden" name="job_no" value={jobNo} />
      <input type="hidden" name="verdict" value={v} />
      <button type="submit" style={{ fontFamily: "inherit", fontSize: 12, fontWeight: 700, padding: "7px 13px", borderRadius: 9, cursor: "pointer", whiteSpace: "nowrap",
        border: v === "want" ? 0 : "1px solid #d0d5dd",
        background: v === "want" ? (active ? "#065f46" : "#047857") : (active ? "#475467" : "#fff"),
        color: v === "want" ? "#fff" : (active ? "#fff" : "#475467"), opacity: active ? 1 : undefined }}>
        {label}
      </button>
    </form>
  );
  if (verdict === "want") return <span style={{ display: "inline-flex", alignItems: "center", gap: 8 }}><span style={{ fontSize: 12, fontWeight: 800, color: "#047857" }}>✓ 進めたい（受付済み）</span>{btn("pass", "取り消して見送る", false)}</span>;
  if (verdict === "pass") return <span style={{ display: "inline-flex", alignItems: "center", gap: 8 }}><span style={{ fontSize: 12, fontWeight: 700, color: "#98a2b3" }}>見送り済み</span>{btn("want", "やはり進めたい", false)}</span>;
  return <span style={{ display: "inline-flex", gap: 8 }}>{btn("want", "👍 進めたい", false)}{btn("pass", "👎 見送り", false)}</span>;
}

export const dynamic = "force-dynamic";

// 紹介元ポータル（会員登録なしの簡易ログイン）。検索エンジンには載せない。
export const metadata: Metadata = {
  title: "紹介元ポータル｜ENGER",
  robots: { index: false, follow: false },
};

const NAVY = "#0F2440";
const card = { background: "#fff", borderRadius: 16, boxShadow: "0 24px 70px rgba(0,0,0,.35)" } as const;
const inp = { fontFamily: "inherit", fontSize: 14, padding: "11px 13px", borderRadius: 10, border: "1px solid #d0d5dd", width: "100%", background: "#fff", color: "#101828" } as const;

function Shell({ children, wide = false }: { children: React.ReactNode; wide?: boolean }) {
  return (
    <div style={{ minHeight: "100vh", background: `linear-gradient(160deg, ${NAVY}, #0a1830)`, padding: "40px 16px 64px", color: "#101828" }}>
      <div style={{ maxWidth: wide ? 860 : 420, margin: "0 auto" }}>
        <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 18 }}>
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img src="/enger-logo.png" alt="ENGER" style={{ height: 26, width: "auto", objectFit: "contain", filter: "brightness(0) invert(1)" }} />
          <span style={{ fontSize: 11, fontWeight: 700, padding: "2px 8px", borderRadius: 99, background: "rgba(255,255,255,.14)", color: "#fff", border: "1px solid rgba(255,255,255,.25)" }}>紹介元ポータル</span>
        </div>
        {children}
      </div>
    </div>
  );
}

export default async function RefPortalPage({ searchParams }: { searchParams: Promise<{ err?: string; req?: string }> }) {
  const sp = await searchParams;
  const partner = await getRefSession();

  // ---- 未ログイン：簡易ログイン（ID＋パスコード） ----
  if (!partner) {
    const err = sp.err === "locked"
      ? `ログインに${REF_MAX_FAILED_ATTEMPTS}回失敗したためロックされました。ENGER担当までパスコードの再発行をご依頼ください。`
      : sp.err === "login" ? "ID またはパスコードが正しくありません。"
      : sp.err === "input" ? "ID とパスコードを入力してください。"
      : sp.err === "session" ? "セッションが切れました。もう一度ログインしてください。"
      : null;
    return (
      <Shell>
        <div style={{ ...card, padding: "34px 30px", display: "flex", flexDirection: "column", gap: 14 }}>
          <div style={{ textAlign: "center" }}>
            <div style={{ width: 52, height: 52, margin: "0 auto 12px", borderRadius: 14, background: "#ecfdf5", color: "#047857", display: "grid", placeItems: "center" }}>
              <span className="material-symbols-outlined" style={{ fontSize: 26 }}>handshake</span>
            </div>
            <h1 style={{ margin: 0, fontSize: 18, fontWeight: 800 }}>紹介元ポータル ログイン</h1>
            <p style={{ margin: "6px 0 0", fontSize: 12.5, color: "#667085" }}>ENGER担当からお渡しした ID とパスコードを入力してください。</p>
          </div>
          {err && <div style={{ fontSize: 12.5, color: "#b42318", background: "#fdecef", border: "1px solid #f4b7bf", borderRadius: 10, padding: "9px 12px" }}>{err}</div>}
          <form action={refPortalLogin} style={{ display: "flex", flexDirection: "column", gap: 11 }}>
            <input name="login_id" type="text" required maxLength={32} placeholder="ID（例: REF-1234）" autoComplete="username" style={inp} />
            <input name="passcode" type="password" required maxLength={64} placeholder="パスコード" autoComplete="current-password" style={inp} />
            <button type="submit" style={{ fontFamily: "inherit", fontSize: 14, fontWeight: 700, padding: "11px", borderRadius: 10, border: 0, cursor: "pointer", background: "#047857", color: "#fff" }}>ログイン</button>
          </form>
          <p style={{ margin: 0, fontSize: 11, color: "#98a2b3", lineHeight: 1.7 }}>ご紹介いただいた人材と、その人材にマッチする案件のみ表示されます。ID・パスコードをお持ちでない場合は ENGER 担当までご連絡ください。</p>
        </div>
      </Shell>
    );
  }

  // ---- ログイン済み：紹介した人材 × マッチする案件 ----
  await bumpRefView(partner);
  const { cands: cards, jobs: jobCards } = await loadReferralPortal(partner);

  return (
    <Shell wide>
      <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 12, marginBottom: 14, flexWrap: "wrap" }}>
        <div style={{ color: "#fff" }}>
          <div style={{ fontSize: 17, fontWeight: 800 }}>{partner.company_name} 様</div>
          <div style={{ fontSize: 12, opacity: .8, marginTop: 2 }}>ご紹介いただいた人材・案件と、マッチするお相手の一覧です。「👍 進めたい」を押すと担当が動きます。</div>
        </div>
        <form action={refPortalLogout}>
          <button type="submit" style={{ fontFamily: "inherit", fontSize: 12, fontWeight: 700, padding: "7px 14px", borderRadius: 9, border: "1px solid rgba(255,255,255,.35)", background: "rgba(255,255,255,.1)", color: "#fff", cursor: "pointer" }}>ログアウト</button>
        </form>
      </div>

      {(sp.req === "ok" || sp.req === "want") && (
        <div style={{ background: "#ecfdf5", border: "1px solid #a7f3d0", color: "#047857", borderRadius: 12, padding: "11px 14px", fontSize: 13, fontWeight: 700, marginBottom: 14 }}>
          「進めたい」を受け付けました。ENGERの進行管理に登録し、担当よりご連絡いたします。
        </div>
      )}
      {sp.req === "pass" && (
        <div style={{ background: "#f8fafc", border: "1px solid #e2e8f0", color: "#475467", borderRadius: 12, padding: "11px 14px", fontSize: 13, fontWeight: 700, marginBottom: 14 }}>
          「見送り」を記録しました。ご判断はマッチング精度の向上に活用されます。
        </div>
      )}

      {cards.length === 0 && jobCards.length === 0 ? (
        <div style={{ ...card, padding: 26, fontSize: 13.5, color: "#475467", lineHeight: 1.8 }}>
          ご紹介いただいた人材・案件はまだ登録されていません。スキルの分かる情報や募集要項を ENGER 担当までお送りください。登録が完了するとこちらに表示されます。
        </div>
      ) : (
        <div style={{ display: "flex", flexDirection: "column", gap: 16 }}>
          {cards.length > 0 && <div style={{ color: "#fff", fontSize: 13, fontWeight: 800, marginBottom: -6 }}>ご紹介いただいた人材 × マッチする案件</div>}
          {cards.map((c) => (
            <div key={c.candidate_no} style={{ ...card, padding: 22 }}>
              <div style={{ display: "flex", alignItems: "baseline", gap: 10, flexWrap: "wrap" }}>
                <span style={{ fontSize: 16, fontWeight: 800 }}>{c.initials}</span>
                {c.title && <span style={{ fontSize: 12.5, color: "#475467" }}>{c.title}</span>}
                <span style={{ fontSize: 12, fontWeight: 700, color: "#047857" }}>{c.rate}</span>
                {c.avail && <span style={{ fontSize: 11.5, color: "#667085" }}>稼働：{c.avail}</span>}
                <span style={{ marginLeft: "auto", fontSize: 10.5, color: "#98a2b3" }}>P-{String(c.candidate_no).padStart(5, "0")}</span>
              </div>
              {c.skills.length > 0 && (
                <div style={{ display: "flex", gap: 6, flexWrap: "wrap", marginTop: 8 }}>
                  {c.skills.map((s) => <span key={s} style={{ fontSize: 11, fontWeight: 600, padding: "2px 9px", borderRadius: 99, background: "#f2f4f7", color: "#344054" }}>{s}</span>)}
                </div>
              )}

              <div style={{ marginTop: 14, fontSize: 11.5, fontWeight: 700, letterSpacing: ".04em", color: "#047857" }}>マッチする案件（{c.jobs.length}件）</div>
              {c.jobs.length === 0 ? (
                <div style={{ fontSize: 12.5, color: "#667085", marginTop: 6 }}>現在マッチする募集中の案件はありません。新しい案件が入り次第こちらに表示されます。</div>
              ) : (
                <div style={{ display: "flex", flexDirection: "column", gap: 8, marginTop: 8 }}>
                  {c.jobs.map((j) => (
                    <div key={j.job_no} style={{ display: "flex", gap: 12, alignItems: "center", flexWrap: "wrap", border: "1px solid #eaecf0", borderRadius: 12, padding: "12px 14px" }}>
                      <div style={{ minWidth: 0, flex: "1 1 260px" }}>
                        <div style={{ fontSize: 13.5, fontWeight: 700, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{j.title}</div>
                        <div style={{ fontSize: 11.5, color: "#667085", marginTop: 2 }}>
                          {[j.role_label, j.salary, j.remote, j.start ? `開始 ${j.start}` : null].filter(Boolean).join(" · ")}
                          <span style={{ marginLeft: 8, color: "#98a2b3" }}>No.{String(j.job_no).padStart(5, "0")}</span>
                        </div>
                        {j.matchedSkills.length > 0 && (
                          <div style={{ fontSize: 10.5, color: "#047857", marginTop: 3 }}>一致スキル：{j.matchedSkills.join(" / ")}</div>
                        )}
                      </div>
                      <span title="マッチ度" style={{ fontSize: 12, fontWeight: 800, padding: "4px 10px", borderRadius: 99, background: j.score >= 75 ? "#ecfdf5" : "#f8fafc", color: j.score >= 75 ? "#047857" : "#475467", border: "1px solid #eaecf0" }}>{j.score}点</span>
                      <VerdictButtons kind="cand_job" candidateNo={c.candidate_no} jobNo={j.job_no} verdict={j.verdict} />
                    </div>
                  ))}
                </div>
              )}
            </div>
          ))}

          {/* 逆方向：ご紹介いただいた案件 × マッチする人材（匿名）。
              人材は氏名・連絡先を出さない（イニシャル＋スキル＋単価。担当が仲介）。 */}
          {jobCards.length > 0 && <div style={{ color: "#fff", fontSize: 13, fontWeight: 800, margin: "6px 0 -6px" }}>ご紹介いただいた案件 × マッチする人材</div>}
          {jobCards.map((j) => (
            <div key={j.job_no} style={{ ...card, padding: 22 }}>
              <div style={{ display: "flex", alignItems: "baseline", gap: 10, flexWrap: "wrap" }}>
                <span style={{ fontSize: 16, fontWeight: 800 }}>{j.title}</span>
                {j.role_label && <span style={{ fontSize: 12.5, color: "#475467" }}>{j.role_label}</span>}
                <span style={{ fontSize: 12, fontWeight: 700, color: "#047857" }}>{j.salary}</span>
                {j.remote && <span style={{ fontSize: 11.5, color: "#667085" }}>{j.remote}</span>}
                <span style={{ marginLeft: "auto", fontSize: 10.5, color: "#98a2b3" }}>No.{String(j.job_no).padStart(5, "0")}</span>
              </div>
              {j.skills.length > 0 && (
                <div style={{ display: "flex", gap: 6, flexWrap: "wrap", marginTop: 8 }}>
                  {j.skills.map((s) => <span key={s} style={{ fontSize: 11, fontWeight: 600, padding: "2px 9px", borderRadius: 99, background: "#f2f4f7", color: "#344054" }}>{s}</span>)}
                </div>
              )}

              <div style={{ marginTop: 14, fontSize: 11.5, fontWeight: 700, letterSpacing: ".04em", color: "#047857" }}>マッチする人材（{j.candidates.length}名・匿名）</div>
              {j.candidates.length === 0 ? (
                <div style={{ fontSize: 12.5, color: "#667085", marginTop: 6 }}>現在マッチする人材はいません。新しい人材が登録され次第こちらに表示されます。</div>
              ) : (
                <div style={{ display: "flex", flexDirection: "column", gap: 8, marginTop: 8 }}>
                  {j.candidates.map((c) => (
                    <div key={c.candidate_no} style={{ display: "flex", gap: 12, alignItems: "center", flexWrap: "wrap", border: "1px solid #eaecf0", borderRadius: 12, padding: "12px 14px" }}>
                      <div style={{ minWidth: 0, flex: "1 1 260px" }}>
                        <div style={{ fontSize: 13.5, fontWeight: 700 }}>{c.initials}{c.title ? <span style={{ fontWeight: 500, color: "#475467" }}>（{c.title}）</span> : null}</div>
                        <div style={{ fontSize: 11.5, color: "#667085", marginTop: 2 }}>
                          {[c.rate, c.avail ? `稼働 ${c.avail}` : null].filter(Boolean).join(" · ")}
                          <span style={{ marginLeft: 8, color: "#98a2b3" }}>P-{String(c.candidate_no).padStart(5, "0")}</span>
                        </div>
                        {c.matchedSkills.length > 0 && (
                          <div style={{ fontSize: 10.5, color: "#047857", marginTop: 3 }}>一致スキル：{c.matchedSkills.join(" / ")}</div>
                        )}
                      </div>
                      <span title="マッチ度" style={{ fontSize: 12, fontWeight: 800, padding: "4px 10px", borderRadius: 99, background: c.score >= 75 ? "#ecfdf5" : "#f8fafc", color: c.score >= 75 ? "#047857" : "#475467", border: "1px solid #eaecf0" }}>{c.score}点</span>
                      <VerdictButtons kind="job_cand" candidateNo={c.candidate_no} jobNo={j.job_no} verdict={c.verdict} />
                    </div>
                  ))}
                </div>
              )}
            </div>
          ))}
        </div>
      )}

      <p style={{ margin: "18px 4px 0", fontSize: 11, color: "rgba(255,255,255,.55)", lineHeight: 1.8 }}>
        ※ 相手方の企業名・人材の氏名/連絡先は ENGER 担当が仲介のうえご案内します。「👍 進めたい」を押すと担当に通知され、ENGERの進行管理に登録されます。「👎 見送り」のご判断もマッチング精度の向上に使われます。
      </p>
    </Shell>
  );
}
