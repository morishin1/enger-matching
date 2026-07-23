"use client";

import { useMemo, useState, type FormEvent, type CSSProperties } from "react";
import { logPrPost } from "@/app/pr/actions";
import { uploadPrCard } from "@/app/pr/card-actions";

type Sample = { skills: string[]; rate: string; remote: string; role: string };
type Job = { no: string; role: string; title: string; skills: string[]; rate: string; remote: string };

// X（Twitter）流入計測のUTM。LP(enger.jp)側は utm_source=x を見て signup_source='x' を記録し、
//   dx の「X流入レポート」で 登録→面談→成約 まで突合できるようにする。
//   utm_content で「どの投稿（登録数/案件/市場価値）」が効いたかを判別する。
function withUtm(base: string, content: string) {
  const q = new URLSearchParams({ utm_source: "x", utm_medium: "social", utm_campaign: "pr", utm_content: content });
  return `${base}${base.includes("?") ? "&" : "?"}${q.toString()}`;
}
// 登録導線はスキルシート登録に統一（Xからの主要導線）。utmは #702 のX流入計測に合わせて維持。
const SIGNUP = withUtm("https://enger.jp/skill-sheet", "count");
const TOP = withUtm("https://enger.jp", "value");
const JOBS = withUtm("https://enger.jp/jobs", "jobs");

function xIntent(text: string, url: string) {
  const u = new URLSearchParams({ text, url });
  return `https://twitter.com/intent/tweet?${u.toString()}`;
}

// 案件カード投稿：個別案件ページ /job/<No> を投稿する（そのページの動的OGP＝案件カードが自動添付される）。
const jobUrl = (no: string) => withUtm(`https://enger.jp/job/${no}`, "job");
// ハッシュタグ用にスキル名を英数字化（例「Spring Boot」→「SpringBoot」）。空なら除外。
const tagize = (s: string) => s.replace(/[^0-9A-Za-zぁ-んァ-ヶ一-龠]/g, "");
function jobPostText(j: Job): string {
  const head = [j.remote, j.role].filter(Boolean).join("・") || "フリーランスエンジニア案件";
  const skillLine = j.skills.length ? `${j.skills.slice(0, 3).join("・")} をお使いの方へ。` : "";
  const rateLine = j.rate ? `想定単価 ${j.rate}。` : "";
  const tags = ["#フリーランス", "#エンジニア案件", ...(j.skills[0] && tagize(j.skills[0]) ? [`#${tagize(j.skills[0])}案件`] : [])];
  return `【案件】${head}\n${[skillLine, rateLine].filter(Boolean).join("")}\nあなたとのマッチ度を30秒で確認👇\n${tags.join(" ")}`;
}

export function PrComposer({ engTotal, jobsPub, sample, jobs }: { engTotal: number; jobsPub: number; sample: Sample[]; jobs: Job[] }) {
  // 注目案件（匿名）の一文
  const sampleLine = useMemo(() => {
    if (!sample.length) return "フルリモート・高単価のエンジニア案件を多数掲載中。";
    return sample.map((s) => [s.remote, s.skills.join("/"), s.rate].filter(Boolean).join(" ")).filter(Boolean).slice(0, 2).join("／");
  }, [sample]);

  const templates = useMemo(() => ([
    {
      id: "count",
      title: "登録数アピール",
      url: SIGNUP,
      text: `ENGERにエンジニアが${engTotal.toLocaleString("ja-JP")}名登録🎉\nGitHub連携で3分、あなたの市場価値と“合う案件”が見えるダッシュボードへ。\n登録は完全無料・カード登録なし。\n#エンジニア #フリーランスエンジニア #ITエンジニア`,
    },
    {
      id: "jobs",
      title: "今週の新着案件",
      url: JOBS,
      text: `【ENGER 注目案件】公開中${jobsPub.toLocaleString("ja-JP")}件\n${sampleLine}\nスキルに合う案件をマッチ度順で。まずは無料登録から👇\n#エンジニア募集 #SES #業務委託`,
    },
    {
      id: "value",
      title: "市場価値診断",
      url: TOP,
      text: `あなたの“市場価値”、知っていますか？\nGitHubを連携するだけで、想定単価レンジと合う案件をその場で診断。\n3分・無料でできます。\n#エンジニア #キャリア #年収`,
    },
  ]), [engTotal, jobsPub, sampleLine]);

  const [drafts, setDrafts] = useState<Record<string, string>>(Object.fromEntries(templates.map((t) => [t.id, t.text])));
  const [msg, setMsg] = useState<string | null>(null);

  // 案件カード投稿：選択中の案件と、その編集中の本文。
  const [jobNo, setJobNo] = useState<string>(jobs[0]?.no ?? "");
  const selectedJob = useMemo(() => jobs.find((j) => j.no === jobNo) ?? null, [jobs, jobNo]);
  const [jobDrafts, setJobDrafts] = useState<Record<string, string>>({});
  const jobText = selectedJob ? (jobDrafts[selectedJob.no] ?? jobPostText(selectedJob)) : "";

  const copy = async (text: string) => {
    try { await navigator.clipboard.writeText(text); setMsg("投稿文をコピーしました"); } catch { setMsg("コピーに失敗しました"); }
    setTimeout(() => setMsg(null), 2000);
  };

  // ---- カードで投稿（画像アップロード）----
  const [cardBusy, setCardBusy] = useState(false);
  const [cardErr, setCardErr] = useState<string | null>(null);
  const [card, setCard] = useState<{ shareUrl: string; imageUrl: string } | null>(null);
  const [cardText, setCardText] = useState(
    "フリーランスエンジニア向けの案件を毎日更新中🔥\n高単価×リモートの案件多数。あなたに合う案件をAIがマッチング。\n登録無料・面談/参画までサポート。\n#エンジニア #フリーランスエンジニア #案件",
  );

  async function submitCard(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const fd = new FormData(e.currentTarget);
    setCardErr(null);
    setCardBusy(true);
    try {
      const res = await uploadPrCard(fd);
      if (res.ok) setCard({ shareUrl: res.shareUrl, imageUrl: res.imageUrl });
      else setCardErr(res.error);
    } catch {
      setCardErr("アップロードに失敗しました。ネットワークを確認して再度お試しください。");
    } finally {
      setCardBusy(false);
    }
  }

  const fieldStyle: CSSProperties = {
    fontSize: 13,
    padding: "9px 11px",
    border: "1px solid var(--color-border-strong)",
    borderRadius: 8,
    background: "var(--color-surface)",
    color: "var(--color-ink)",
  };

  return (
    <>
      <div className="card" style={{ background: "var(--color-brand-25)", borderColor: "var(--color-brand-100)", fontSize: 12.5, lineHeight: 1.8, marginBottom: 16 }}>
        💡 使い方：文面を編集 → <b>「Xに投稿」</b>でX投稿画面が開きます（画像はリンク先(enger.jp)のOGPカードが自動添付）。担当者・運営の発信で、エンジニア登録の母数を増やしましょう。
      </div>
      {msg && <div style={{ fontSize: 12.5, color: "#067647", marginBottom: 10 }}>{msg}</div>}

      {/* ---- カードで投稿（画像アップロード）---- */}
      <div className="card" style={{ marginBottom: 16 }}>
        <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 4, flexWrap: "wrap" }}>
          <h3 style={{ margin: 0, fontSize: 14, fontWeight: 800 }}>カードで投稿（画像アップロード）</h3>
          <span className="muted" style={{ fontSize: 11 }}>
            Canva等で作ったカード → 共有URL発行 → Xにカードが表示され、タップで登録ページへ
          </span>
        </div>
        {!card ? (
          <form onSubmit={submitCard} style={{ display: "flex", flexDirection: "column", gap: 10, marginTop: 8 }}>
            <input type="file" name="image" accept="image/*" required style={{ fontSize: 13 }} />
            <label style={{ fontSize: 12, color: "var(--color-ink-2)" }}>
              遷移先：
              <select name="target" defaultValue="skillsheet" style={{ ...fieldStyle, marginLeft: 6 }}>
                <option value="skillsheet">スキルシート登録（enger.jp/skill-sheet）</option>
                <option value="jobs">案件一覧（enger.jp/jobs）</option>
                <option value="signup">無料登録（enger.jp/signup）</option>
                <option value="top">トップ（enger.jp）</option>
              </select>
            </label>
            <input type="text" name="title" placeholder="カードのタイトル（任意・OGP見出し）" style={fieldStyle} />
            <input type="text" name="description" placeholder="説明文（任意・OGP説明）" style={fieldStyle} />
            <div>
              <button type="submit" className="btn brand" disabled={cardBusy}>
                {cardBusy ? "アップロード中…" : "アップロードして共有URLを発行"}
              </button>
            </div>
            {cardErr && <div style={{ fontSize: 12, color: "#b42318", lineHeight: 1.7 }}>{cardErr}</div>}
          </form>
        ) : (
          <div style={{ display: "flex", flexDirection: "column", gap: 10, marginTop: 8 }}>
            <div style={{ fontSize: 12, color: "#067647" }}>
              ✓ 共有URLを発行しました。下の本文で「Xに投稿」すると、このカードが表示されます。
            </div>
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img
              src={card.imageUrl}
              alt="アップロードしたカード"
              style={{ maxWidth: 320, width: "100%", borderRadius: 10, border: "1px solid var(--color-border)" }}
            />
            <div style={{ fontSize: 11, color: "var(--color-ink-3)", wordBreak: "break-all" }}>共有URL：{card.shareUrl}</div>
            <textarea
              value={cardText}
              onChange={(e) => setCardText(e.target.value)}
              rows={4}
              style={{ width: "100%", fontFamily: "var(--font-sans)", fontSize: 13, lineHeight: 1.7, color: "var(--color-ink)", padding: 12, border: "1px solid var(--color-border-strong)", borderRadius: 10, resize: "vertical", boxSizing: "border-box", background: "var(--color-surface)" }}
            />
            <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
              <a
                className="btn brand"
                href={xIntent(cardText, card.shareUrl)}
                target="_blank"
                rel="noopener"
                onClick={() => { logPrPost("card"); setMsg("PR投稿を記録しました（ダッシュボードに反映）"); setTimeout(() => setMsg(null), 2500); }}
                style={{ textDecoration: "none", display: "inline-flex", alignItems: "center", gap: 6 }}
              >
                𝕏 このカードでXに投稿
              </a>
              <button type="button" className="btn ghost" onClick={() => copy(card.shareUrl)}>共有URLをコピー</button>
              <button type="button" className="btn ghost" onClick={() => { setCard(null); setCardErr(null); }}>別のカードをアップロード</button>
            </div>
          </div>
        )}
      </div>

      <div style={{ display: "flex", flexDirection: "column", gap: 14 }}>
        {templates.map((t) => {
          const text = drafts[t.id] ?? t.text;
          return (
            <div key={t.id} className="card">
              <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 8, flexWrap: "wrap" }}>
                <h3 style={{ margin: 0, fontSize: 14, fontWeight: 800 }}>{t.title}</h3>
                <span className="muted" style={{ fontSize: 11 }}>リンク先：{t.url}</span>
                <span className="muted" style={{ fontSize: 11, marginLeft: "auto" }}>{text.length} 文字</span>
              </div>
              <textarea
                value={text}
                onChange={(e) => setDrafts((d) => ({ ...d, [t.id]: e.target.value }))}
                rows={5}
                style={{ width: "100%", fontFamily: "var(--font-sans)", fontSize: 13, lineHeight: 1.7, color: "var(--color-ink)", padding: 12, border: "1px solid var(--color-border-strong)", borderRadius: 10, resize: "vertical", boxSizing: "border-box", background: "var(--color-surface)" }}
              />
              <div style={{ display: "flex", gap: 8, marginTop: 8, flexWrap: "wrap" }}>
                <a className="btn brand" href={xIntent(text, t.url)} target="_blank" rel="noopener" onClick={() => { logPrPost(t.id); setMsg("PR投稿を記録しました（ダッシュボードに反映）"); setTimeout(() => setMsg(null), 2500); }} style={{ textDecoration: "none", display: "inline-flex", alignItems: "center", gap: 6 }}>𝕏 Xに投稿</a>
                <button type="button" className="btn ghost" onClick={() => copy(text)}>本文をコピー</button>
              </div>
            </div>
          );
        })}
      </div>

      {jobs.length > 0 && (
        <div className="card" style={{ marginTop: 14 }}>
          <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 8, flexWrap: "wrap" }}>
            <h3 style={{ margin: 0, fontSize: 14, fontWeight: 800 }}>案件カード投稿</h3>
            <span className="muted" style={{ fontSize: 11 }}>案件ごとの画像カードが自動で付きます（リンク先 /job/&lt;No&gt; のOGP）</span>
          </div>
          <div style={{ display: "flex", gap: 8, alignItems: "center", flexWrap: "wrap", marginBottom: 8 }}>
            <select value={jobNo} onChange={(e) => setJobNo(e.target.value)}
              style={{ fontSize: 13, padding: "8px 10px", border: "1px solid var(--color-border-strong)", borderRadius: 8, background: "var(--color-surface)", color: "var(--color-ink)", maxWidth: "100%" }}>
              {jobs.map((j) => (
                <option key={j.no} value={j.no}>No.{j.no}｜{[j.remote, j.role, j.rate].filter(Boolean).join(" / ")}</option>
              ))}
            </select>
            {selectedJob && <span className="muted" style={{ fontSize: 11, wordBreak: "break-all" }}>リンク先：{jobUrl(selectedJob.no)}</span>}
          </div>
          {selectedJob && (
            <>
              {/* 投稿前に、Xへ自動表示される案件カードの実画像をプレビュー（選択で切り替わる） */}
              <div style={{ marginBottom: 10 }}>
                <div className="muted" style={{ fontSize: 11, marginBottom: 4 }}>この画像がX投稿に自動表示されます（選び直すと切り替わります）</div>
                <img
                  key={selectedJob.no}
                  src={`https://enger.jp/og/job/${selectedJob.no}.png`}
                  alt={`案件カード No.${selectedJob.no}`}
                  loading="lazy"
                  style={{ width: "100%", maxWidth: 520, aspectRatio: "1200 / 630", objectFit: "contain", borderRadius: 10, border: "1px solid var(--color-border)", display: "block", background: "#0b2a52" }}
                />
              </div>
              <textarea
                value={jobText}
                onChange={(e) => setJobDrafts((d) => ({ ...d, [selectedJob.no]: e.target.value }))}
                rows={5}
                style={{ width: "100%", fontFamily: "var(--font-sans)", fontSize: 13, lineHeight: 1.7, color: "var(--color-ink)", padding: 12, border: "1px solid var(--color-border-strong)", borderRadius: 10, resize: "vertical", boxSizing: "border-box", background: "var(--color-surface)" }}
              />
              <div style={{ display: "flex", gap: 8, marginTop: 8, flexWrap: "wrap", alignItems: "center" }}>
                <a className="btn brand" href={xIntent(jobText, jobUrl(selectedJob.no))} target="_blank" rel="noopener"
                  onClick={() => { logPrPost("job"); setMsg("案件カード投稿を記録しました（ダッシュボードに反映）"); setTimeout(() => setMsg(null), 2500); }}
                  style={{ textDecoration: "none", display: "inline-flex", alignItems: "center", gap: 6 }}>𝕏 Xに投稿</a>
                <button type="button" className="btn ghost" onClick={() => copy(jobText)}>本文をコピー</button>
                <a className="btn ghost" href={`https://enger.jp/og/job/${selectedJob.no}.png`} target="_blank" rel="noopener" style={{ textDecoration: "none" }}>カード画像を確認</a>
                <span className="muted" style={{ fontSize: 11, marginLeft: "auto" }}>{jobText.length} 文字</span>
              </div>
            </>
          )}
        </div>
      )}

      <div className="card" style={{ marginTop: 16, fontSize: 12, color: "var(--color-ink-3)", lineHeight: 1.8 }}>
        <b>運用のコツ</b>：①週2〜3回、登録数の節目・新着案件・市場価値ネタを使い分け。②エンジニア本人の「市場価値カード」シェア（enger.jp/dashboard・/card）が最も拡散します。③ハッシュタグは案件領域に合わせて調整。
      </div>
    </>
  );
}
