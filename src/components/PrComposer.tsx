"use client";

import { useMemo, useState } from "react";
import { logPrPost } from "@/app/pr/actions";

type Sample = { skills: string[]; rate: string; remote: string; role: string };
type Job = { no: string; role: string; title: string; skills: string[]; rate: string; remote: string };

// X（Twitter）流入計測のUTM。LP(enger.jp)側は utm_source=x を見て signup_source='x' を記録し、
//   dx の「X流入レポート」で 登録→面談→成約 まで突合できるようにする。
//   utm_content で「どの投稿（登録数/案件/市場価値）」が効いたかを判別する。
function withUtm(base: string, content: string) {
  const q = new URLSearchParams({ utm_source: "x", utm_medium: "social", utm_campaign: "pr", utm_content: content });
  return `${base}${base.includes("?") ? "&" : "?"}${q.toString()}`;
}
const SIGNUP = withUtm("https://enger.jp/signup", "count");
const TOP = withUtm("https://enger.jp", "value");
const JOBS = withUtm("https://enger.jp/jobs", "jobs");

function xIntent(text: string, url: string) {
  const u = new URLSearchParams({ text, url });
  return `https://twitter.com/intent/tweet?${u.toString()}`;
}

// 案件カード投稿：個別案件ページ /job/<No> を投稿する（そのページの動的OGP＝案件カードが自動添付される）。
//   d=2|3 でカードのデザイン（ライト/サンセット）を切替（/job 側が og:image に引き継ぐ）。
const DESIGNS = [
  { id: "1", label: "ネイビー", bg: "linear-gradient(135deg,#07142b,#0b2a52,#0f3a64)" },
  { id: "2", label: "ライト", bg: "linear-gradient(135deg,#f8fafc,#e9eff7,#dbe6f3)" },
  { id: "3", label: "サンセット", bg: "linear-gradient(135deg,#1c1917,#431407,#7c2d12)" },
] as const;
const designQ = (d: string) => (d === "2" || d === "3" ? `d=${d}` : "");
const jobUrl = (no: string, d = "1") => {
  const u = withUtm(`https://enger.jp/job/${no}`, "job");
  const q = designQ(d);
  return q ? `${u}&${q}` : u;
};
const jobCardPng = (no: string, d = "1") => {
  const q = designQ(d);
  return `https://enger.jp/og/job/${no}.png${q ? `?${q}` : ""}`;
};
// オリジナル投稿：/share（自由文サムネを og:image に持つ着地ページ）を投稿する。
const customPng = (t: string, s: string, d: string) =>
  `https://enger.jp/og/custom.png?${new URLSearchParams({ t, ...(s ? { s } : {}), ...(designQ(d) ? { d } : {}) })}`;
const shareUrl = (t: string, s: string, d: string) => {
  const q = new URLSearchParams({ t, ...(s ? { s } : {}), ...(designQ(d) ? { d } : {}), utm_source: "x", utm_medium: "social", utm_campaign: "pr", utm_content: "custom" });
  return `https://enger.jp/share?${q.toString()}`;
};
// ハッシュタグ提案：投稿本文のキーワードから機械的に候補を出す（instant・API不要）。
const TAG_RULES: Array<[RegExp, string]> = [
  [/java(?!script)/i, "#Java案件"], [/typescript/i, "#TypeScript"], [/javascript/i, "#JavaScript"],
  [/react/i, "#React"], [/next\.?js/i, "#Nextjs"], [/vue/i, "#Vue"], [/python/i, "#Python"],
  [/\bgo\b|golang/i, "#Go"], [/php/i, "#PHP"], [/ruby|rails/i, "#Rails"], [/swift|kotlin|ios|android/i, "#アプリ開発"],
  [/aws/i, "#AWS"], [/azure/i, "#Azure"], [/gcp/i, "#GCP"], [/sre|インフラ|サーバ/i, "#インフラエンジニア"],
  [/\bpm\b|pmo|マネージャ|マネジメント/i, "#PM"], [/生成ai|\bai\b|機械学習|llm|データ分析/i, "#AI"],
  [/フルリモート|リモート|在宅/i, "#リモートワーク"], [/高単価|単価/i, "#高単価案件"],
  [/副業/i, "#副業"], [/キャリア|年収|市場価値/i, "#エンジニア転職"], [/募集|案件/i, "#エンジニア募集"],
];
function suggestTags(text: string): string[] {
  const base = ["#フリーランス", "#エンジニア"];
  const hits = TAG_RULES.filter(([re]) => re.test(text)).map(([, tag]) => tag);
  return Array.from(new Set([...base, ...hits])).filter((t) => !text.includes(t)).slice(0, 6);
}
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

  // 案件カード投稿：選択中の案件・カードデザインと、その編集中の本文。
  const [jobNo, setJobNo] = useState<string>(jobs[0]?.no ?? "");
  const [design, setDesign] = useState<string>("1");
  const selectedJob = useMemo(() => jobs.find((j) => j.no === jobNo) ?? null, [jobs, jobNo]);
  const [jobDrafts, setJobDrafts] = useState<Record<string, string>>({});
  const jobText = selectedJob ? (jobDrafts[selectedJob.no] ?? jobPostText(selectedJob)) : "";

  // オリジナル投稿（テンプレ以外の自由投稿）：本文・サムネ見出し/補足・デザイン。
  const [origText, setOrigText] = useState("");
  const [origTitle, setOrigTitle] = useState("");
  const [origSub, setOrigSub] = useState("");
  const [origDesign, setOrigDesign] = useState("1");
  const [origPreview, setOrigPreview] = useState<string | null>(null);
  const thumbTitle = (origTitle.trim() || origText.split(/\r?\n/)[0] || "").slice(0, 48);
  const genThumb = (d = origDesign) => {
    if (!thumbTitle) { setMsg("サムネ見出し（または本文1行目）を入力してください"); setTimeout(() => setMsg(null), 2500); return; }
    setOrigPreview(customPng(thumbTitle, origSub.trim().slice(0, 70), d));
  };
  const applyTags = () => {
    const tags = suggestTags(origText);
    if (tags.length === 0) { setMsg("追加できるハッシュタグはありません（本文に含まれています）"); setTimeout(() => setMsg(null), 2500); return; }
    setOrigText((t) => `${t.replace(/\s+$/, "")}\n${tags.join(" ")}`);
  };

  const copy = async (text: string) => {
    try { await navigator.clipboard.writeText(text); setMsg("投稿文をコピーしました"); } catch { setMsg("コピーに失敗しました"); }
    setTimeout(() => setMsg(null), 2000);
  };

  return (
    <>
      <div className="card" style={{ background: "var(--color-brand-25)", borderColor: "var(--color-brand-100)", fontSize: 12.5, lineHeight: 1.8, marginBottom: 16 }}>
        💡 使い方：文面を編集 → <b>「Xに投稿」</b>でX投稿画面が開きます（画像はリンク先(enger.jp)のOGPカードが自動添付）。担当者・運営の発信で、エンジニア登録の母数を増やしましょう。
      </div>
      {msg && <div style={{ fontSize: 12.5, color: "#067647", marginBottom: 10 }}>{msg}</div>}

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
            {selectedJob && <span className="muted" style={{ fontSize: 11, wordBreak: "break-all" }}>リンク先：{jobUrl(selectedJob.no, design)}</span>}
          </div>
          {selectedJob && (
            <>
              {/* 投稿前に、Xへ自動表示される案件カードの実画像をプレビュー（案件・デザインの選択で切り替わる） */}
              <div style={{ marginBottom: 10 }}>
                <div className="muted" style={{ fontSize: 11, marginBottom: 4 }}>この画像がX投稿に自動表示されます（案件・デザインを選び直すと切り替わります）</div>
                <img
                  key={`${selectedJob.no}-${design}`}
                  src={jobCardPng(selectedJob.no, design)}
                  alt={`案件カード No.${selectedJob.no}`}
                  loading="lazy"
                  style={{ width: "100%", maxWidth: 520, aspectRatio: "1200 / 630", objectFit: "contain", borderRadius: 10, border: "1px solid var(--color-border)", display: "block", background: "#0b2a52" }}
                />
                {/* デザインパターンの選択（タイムラインで見分けが付くよう配色を切替） */}
                <div style={{ display: "flex", gap: 8, marginTop: 8, alignItems: "center", flexWrap: "wrap" }}>
                  <span className="muted" style={{ fontSize: 11 }}>デザイン：</span>
                  {DESIGNS.map((dd) => (
                    <button key={dd.id} type="button" onClick={() => setDesign(dd.id)}
                      title={`${dd.label}デザインに切替`}
                      style={{ display: "inline-flex", alignItems: "center", gap: 6, padding: "5px 10px", borderRadius: 8, cursor: "pointer",
                        border: design === dd.id ? "2px solid var(--color-brand-600, #0b5cab)" : "1px solid var(--color-border-strong)",
                        background: "var(--color-surface)", fontSize: 12, fontWeight: design === dd.id ? 800 : 500 }}>
                      <span aria-hidden style={{ width: 26, height: 15, borderRadius: 4, background: dd.bg, display: "inline-block", border: "1px solid rgba(0,0,0,.12)" }} />
                      {dd.label}
                    </button>
                  ))}
                </div>
              </div>
              <textarea
                value={jobText}
                onChange={(e) => setJobDrafts((d) => ({ ...d, [selectedJob.no]: e.target.value }))}
                rows={5}
                style={{ width: "100%", fontFamily: "var(--font-sans)", fontSize: 13, lineHeight: 1.7, color: "var(--color-ink)", padding: 12, border: "1px solid var(--color-border-strong)", borderRadius: 10, resize: "vertical", boxSizing: "border-box", background: "var(--color-surface)" }}
              />
              <div style={{ display: "flex", gap: 8, marginTop: 8, flexWrap: "wrap", alignItems: "center" }}>
                <a className="btn brand" href={xIntent(jobText, jobUrl(selectedJob.no, design))} target="_blank" rel="noopener"
                  onClick={() => { logPrPost("job"); setMsg("案件カード投稿を記録しました（ダッシュボードに反映）"); setTimeout(() => setMsg(null), 2500); }}
                  style={{ textDecoration: "none", display: "inline-flex", alignItems: "center", gap: 6 }}>𝕏 Xに投稿</a>
                <button type="button" className="btn ghost" onClick={() => copy(jobText)}>本文をコピー</button>
                <a className="btn ghost" href={jobCardPng(selectedJob.no, design)} target="_blank" rel="noopener" style={{ textDecoration: "none" }}>カード画像を確認</a>
                <span className="muted" style={{ fontSize: 11, marginLeft: "auto" }}>{jobText.length} 文字</span>
              </div>
            </>
          )}
        </div>
      )}

      {/* オリジナル投稿：テンプレ以外の自由投稿。内容に合わせたサムネ生成＋ハッシュタグ提案つき。 */}
      <div className="card" style={{ marginTop: 14 }}>
        <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 8, flexWrap: "wrap" }}>
          <h3 style={{ margin: 0, fontSize: 14, fontWeight: 800 }}>オリジナル投稿</h3>
          <span className="muted" style={{ fontSize: 11 }}>お客様との信頼づくり向けの自由投稿。内容に合わせたサムネ画像とハッシュタグを付けられます</span>
        </div>
        <textarea
          value={origText}
          onChange={(e) => setOrigText(e.target.value)}
          rows={5}
          placeholder={"投稿本文を自由に入力（例：導入事例、稼働開始のご報告、イベント告知、キャリアのヒント など）"}
          style={{ width: "100%", fontFamily: "var(--font-sans)", fontSize: 13, lineHeight: 1.7, color: "var(--color-ink)", padding: 12, border: "1px solid var(--color-border-strong)", borderRadius: 10, resize: "vertical", boxSizing: "border-box", background: "var(--color-surface)" }}
        />
        <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 8, marginTop: 8 }}>
          <input value={origTitle} onChange={(e) => setOrigTitle(e.target.value)} placeholder="サムネ見出し（未入力なら本文1行目・48字まで）"
            style={{ fontSize: 12.5, padding: "9px 11px", border: "1px solid var(--color-border-strong)", borderRadius: 8, background: "var(--color-surface)", color: "var(--color-ink)" }} />
          <input value={origSub} onChange={(e) => setOrigSub(e.target.value)} placeholder="サムネ補足（任意・70字まで）"
            style={{ fontSize: 12.5, padding: "9px 11px", border: "1px solid var(--color-border-strong)", borderRadius: 8, background: "var(--color-surface)", color: "var(--color-ink)" }} />
        </div>
        <div style={{ display: "flex", gap: 8, marginTop: 8, alignItems: "center", flexWrap: "wrap" }}>
          <span className="muted" style={{ fontSize: 11 }}>サムネのデザイン：</span>
          {DESIGNS.map((dd) => (
            <button key={dd.id} type="button" onClick={() => { setOrigDesign(dd.id); if (origPreview) genThumb(dd.id); }}
              style={{ display: "inline-flex", alignItems: "center", gap: 6, padding: "5px 10px", borderRadius: 8, cursor: "pointer",
                border: origDesign === dd.id ? "2px solid var(--color-brand-600, #0b5cab)" : "1px solid var(--color-border-strong)",
                background: "var(--color-surface)", fontSize: 12, fontWeight: origDesign === dd.id ? 800 : 500 }}>
              <span aria-hidden style={{ width: 26, height: 15, borderRadius: 4, background: dd.bg, display: "inline-block", border: "1px solid rgba(0,0,0,.12)" }} />
              {dd.label}
            </button>
          ))}
          <button type="button" className="btn ghost btn-xs" onClick={() => genThumb()}>サムネを生成／更新</button>
          <button type="button" className="btn ghost btn-xs" onClick={applyTags} title="本文のキーワードからハッシュタグを提案して末尾に追加">#ハッシュタグを提案</button>
        </div>
        {origPreview && (
          <div style={{ marginTop: 10 }}>
            <div className="muted" style={{ fontSize: 11, marginBottom: 4 }}>この画像がX投稿に自動表示されます（リンク先 /share のOGP）</div>
            <img key={origPreview} src={origPreview} alt="オリジナル投稿サムネ" loading="lazy"
              style={{ width: "100%", maxWidth: 520, aspectRatio: "1200 / 630", objectFit: "contain", borderRadius: 10, border: "1px solid var(--color-border)", display: "block", background: "#0b2a52" }} />
          </div>
        )}
        <div style={{ display: "flex", gap: 8, marginTop: 10, flexWrap: "wrap", alignItems: "center" }}>
          {origText.trim() && thumbTitle ? (
            <a className="btn brand" href={xIntent(origText, shareUrl(thumbTitle, origSub.trim().slice(0, 70), origDesign))} target="_blank" rel="noopener"
              onClick={() => { logPrPost("custom"); setMsg("オリジナル投稿を記録しました（ダッシュボードに反映）"); setTimeout(() => setMsg(null), 2500); }}
              style={{ textDecoration: "none", display: "inline-flex", alignItems: "center", gap: 6 }}>𝕏 Xに投稿</a>
          ) : (
            <span className="muted" style={{ fontSize: 12 }}>本文を入力すると投稿できます</span>
          )}
          <button type="button" className="btn ghost" onClick={() => copy(origText)} disabled={!origText.trim()}>本文をコピー</button>
          <span className="muted" style={{ fontSize: 11, marginLeft: "auto" }}>{origText.length} 文字</span>
        </div>
      </div>

      <div className="card" style={{ marginTop: 16, fontSize: 12, color: "var(--color-ink-3)", lineHeight: 1.8 }}>
        <b>運用のコツ</b>：①週2〜3回、登録数の節目・新着案件・市場価値ネタを使い分け。②エンジニア本人の「市場価値カード」シェア（enger.jp/dashboard・/card）が最も拡散します。③ハッシュタグは案件領域に合わせて調整。
      </div>
    </>
  );
}
