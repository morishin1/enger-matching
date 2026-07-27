"use client";

// エンド開拓「今日の追記」パネル。毎日の運用をこの1枚で完結させる:
//   ① 今日のテーマを見る → ② 調査プロンプトをコピーして手元の Claude に貼る（Web検索で企業を調べる）
//   → ③ 返ってきたCSVをそのまま貼って取込（社名・ドメインで重複は自動スキップ）
//   取込結果（追加/スキップの内訳）をその場に出すので、毎日どれだけ積み上がったかが分かる。
import { useActionState, useEffect, useRef, useState } from "react";
import { CopyButton } from "@/components/CopyButton";
import { importProspectsCsv, type ImportState } from "@/app/prospecting/actions";
import type { DailyTheme } from "@/lib/prospecting";

const card = { background: "#fff", borderRadius: 18, boxShadow: "0 24px 70px rgba(15,36,64,.18)", border: "1px solid #e5e7eb" } as const;
const input = { fontFamily: "inherit", fontSize: 13, padding: "10px 12px", borderRadius: 11, border: "1px solid #d0d5dd", background: "#fff", color: "#101828", width: "100%", boxSizing: "border-box" } as const;
const btn = { fontFamily: "inherit", fontSize: 12, fontWeight: 800, padding: "9px 14px", borderRadius: 10, border: 0, background: "#0b5cab", color: "#fff", cursor: "pointer" } as const;
const stepLabel = { display: "inline-flex", alignItems: "center", gap: 6, fontSize: 12, fontWeight: 900, color: "#0F2440" } as const;

export function ProspectDailyAppend({ theme, date, prompt, counts, todayCount, defaultSource }: {
  theme: DailyTheme;
  date: string;
  prompt: string;
  counts: { date: string; label: string; count: number }[];
  todayCount: number;
  defaultSource: string;
}) {
  const [state, action, pending] = useActionState<ImportState, FormData>(importProspectsCsv, null);
  const max = Math.max(1, ...counts.map((c) => c.count));

  // ① クリック1回で Claude を開く（プロンプトは入力済みの状態で新規チャットが開く）。
  //    日本語はURLエンコードで約9倍に膨らむため、8KB（一般的なサーバのURL上限）を超えたらコピー運用に倒す。
  const claudeUrl = `https://claude.ai/new?q=${encodeURIComponent(prompt)}`;
  const claudeUrlUsable = claudeUrl.length <= 8000;

  // ② クリック1回で取込（クリップボードの中身をそのまま解析して送信）。
  const formRef = useRef<HTMLFormElement>(null);
  const textRef = useRef<HTMLTextAreaElement>(null);
  const [clipError, setClipError] = useState<string | null>(null);

  // 取込に成功したら入力欄を空にする（次の貼り付けで混ざらないように）。
  useEffect(() => { if (state?.ok && textRef.current) textRef.current.value = ""; }, [state]);

  const pasteAndImport = async () => {
    try {
      const text = await navigator.clipboard.readText();
      if (!text.trim()) { setClipError("クリップボードが空です。Claude の回答をコピーしてからもう一度押してください。"); return; }
      if (textRef.current) textRef.current.value = text;
      setClipError(null);
      formRef.current?.requestSubmit();
    } catch {
      setClipError("クリップボードを読み取れませんでした。下の欄に貼り付けて（⌘/Ctrl+V）「リストに追記」を押してください。");
    }
  };

  return (
    <section style={{ ...card, padding: 18 }}>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", gap: 12, flexWrap: "wrap" }}>
        <div>
          <h2 style={{ margin: 0, fontSize: 17, display: "flex", alignItems: "center", gap: 7 }}>
            <span className="material-symbols-outlined" style={{ fontSize: 20, color: "#0b5cab" }}>event_repeat</span>
            今日の追記
          </h2>
          <p style={{ margin: "6px 0 0", fontSize: 12, color: "#667085" }}>{date}（{theme.weekday}）のテーマ：<b style={{ color: "#101828" }}>{theme.label}</b></p>
        </div>
        <div style={{ textAlign: "right" }}>
          <div style={{ fontSize: 10, fontWeight: 800, color: "#667085" }}>本日の追記</div>
          <div style={{ fontSize: 24, fontWeight: 900, color: todayCount > 0 ? "#047857" : "#b42318" }}>{todayCount}<span style={{ fontSize: 12, marginLeft: 2 }}>社</span></div>
        </div>
      </div>

      {/* 直近7日の追記件数（毎日積み上がっているかの確認） */}
      <div style={{ display: "flex", gap: 6, alignItems: "flex-end", height: 56, marginTop: 12, padding: "0 2px" }}>
        {counts.map((c) => (
          <div key={c.date} style={{ flex: 1, display: "grid", gap: 3, justifyItems: "center" }}>
            <div style={{ fontSize: 10, fontWeight: 800, color: "#475467" }}>{c.count || ""}</div>
            <div title={`${c.label} ${c.count}社`} style={{ width: "100%", height: Math.max(3, Math.round((c.count / max) * 30)), borderRadius: 4, background: c.count ? "#0b5cab" : "#e4e7ec" }} />
            <div style={{ fontSize: 9.5, color: "#98a2b3" }}>{c.label}</div>
          </div>
        ))}
      </div>

      <div style={{ display: "grid", gap: 12, marginTop: 14 }}>
        <div style={{ background: "#f8fafc", border: "1px solid #eaecf0", borderRadius: 14, padding: 13 }}>
          <div style={stepLabel}><Num n={1} />Claude で今日のテーマを調べる</div>
          <p style={{ margin: "6px 0 8px", fontSize: 11.5, color: "#667085", lineHeight: 1.7 }}>
            ボタンを押すと、調査プロンプトを入力した状態で Claude が開きます（送信を押すだけ）。Web 検索でエンジニアを募集中の企業を調べ、そのまま取り込める CSV が返ります。氏名・個人連絡先はプロンプトにも出力にも含めません。
          </p>
          <div style={{ display: "flex", gap: 8, alignItems: "center", flexWrap: "wrap" }}>
            {claudeUrlUsable && (
              <a href={claudeUrl} target="_blank" rel="noopener noreferrer"
                style={{ ...btn, textDecoration: "none", display: "inline-flex", alignItems: "center", gap: 6 }}>
                <span className="material-symbols-outlined" style={{ fontSize: 16 }}>open_in_new</span>
                Claude で調べる
              </a>
            )}
            <CopyButton text={prompt} label="プロンプトだけコピー" />
          </div>
          <details style={{ marginTop: 8 }}>
            <summary style={{ fontSize: 11.5, color: "#0b5cab", cursor: "pointer", fontWeight: 700 }}>プロンプトを表示</summary>
            <pre style={{ whiteSpace: "pre-wrap", fontFamily: "inherit", fontSize: 11, lineHeight: 1.7, color: "#344054", marginTop: 8 }}>{prompt}</pre>
          </details>
        </div>

        <form ref={formRef} action={action} style={{ background: "#f8fafc", border: "1px solid #eaecf0", borderRadius: 14, padding: 13, display: "grid", gap: 8 }}>
          <div style={stepLabel}><Num n={2} />Claude の回答をコピーして、ボタンひとつで取り込む</div>
          <p style={{ margin: 0, fontSize: 11.5, color: "#667085", lineHeight: 1.7 }}>
            <b>回答をまるごとコピーして大丈夫です</b>（前後の説明文は自動で捨て、表の部分だけ取り込みます）。重複は社名・URLで自動スキップ。
          </p>
          <div style={{ display: "flex", gap: 8, alignItems: "center", flexWrap: "wrap" }}>
            <button type="button" onClick={pasteAndImport} disabled={pending}
              style={{ ...btn, opacity: pending ? .6 : 1, display: "inline-flex", alignItems: "center", gap: 6 }}>
              <span className="material-symbols-outlined" style={{ fontSize: 16 }}>content_paste_go</span>
              {pending ? "取込中…" : "クリップボードから取り込む"}
            </button>
            <span style={{ fontSize: 11, color: "#98a2b3" }}>うまくいかないときは下の欄に貼り付け →</span>
          </div>
          {clipError && <Banner tone="warn">{clipError}</Banner>}
          <details>
            <summary style={{ fontSize: 11.5, color: "#0b5cab", cursor: "pointer", fontWeight: 700 }}>手で貼り付ける／形式を確認する</summary>
            <div style={{ display: "grid", gap: 8, marginTop: 8 }}>
              <p style={{ margin: 0, fontSize: 11.5, color: "#667085" }}>
                企業名,採用ページURL,企業URL,業種,所在地,ランク,シグナル,発見元,メモ（従来形式・Excel のタブ区切り貼り付けも自動判別）
              </p>
              <textarea ref={textRef} name="csv" rows={7} style={{ ...input, fontSize: 12 }} placeholder={"企業名,採用ページURL,企業URL,業種,所在地,ランク,シグナル,発見元,メモ\n株式会社サンプル,https://example.com/recruit,https://example.com,SaaS,東京都渋谷区,A,資金調達;複数職種募集,PR TIMES,Java中途3名"} />
              <input name="source_list" defaultValue={defaultSource} placeholder="出所（リスト名）" style={input} />
              <button disabled={pending} style={{ ...btn, opacity: pending ? .6 : 1, justifySelf: "start" }}>{pending ? "取込中…" : "リストに追記"}</button>
            </div>
          </details>
          {state && <ImportResult state={state} />}
        </form>
      </div>
    </section>
  );
}

function Num({ n }: { n: number }) {
  return <span style={{ width: 18, height: 18, borderRadius: 999, background: "#0b5cab", color: "#fff", fontSize: 11, display: "grid", placeItems: "center" }}>{n}</span>;
}

function ImportResult({ state }: { state: NonNullable<ImportState> }) {
  if (!state.ok) return <Banner tone="error">取込できませんでした：{state.error}</Banner>;
  const detail = [
    state.skippedExisting ? `既にリストにある ${state.skippedExisting}社` : "",
    state.skippedCompany ? `企業管理に登録済み ${state.skippedCompany}社` : "",
    state.skippedInBatch ? `CSV内の重複 ${state.skippedInBatch}社` : "",
  ].filter(Boolean).join(" / ");
  return (
    <div style={{ display: "grid", gap: 6 }}>
      <Banner tone={state.added > 0 ? "ok" : "warn"}>
        {state.added}社を追記しました（スキップ {state.skipped}社{detail ? `：${detail}` : ""}）
      </Banner>
      {state.warning && <Banner tone="warn">{state.warning}</Banner>}
      {state.addedNames.length > 0 && (
        <div style={{ fontSize: 11, color: "#475467", lineHeight: 1.7 }}>
          追加：{state.addedNames.slice(0, 12).join("、")}{state.addedNames.length > 12 ? ` ほか${state.addedNames.length - 12}社` : ""}
        </div>
      )}
    </div>
  );
}

function Banner({ tone, children }: { tone: "ok" | "warn" | "error"; children: React.ReactNode }) {
  const c = tone === "ok" ? { bg: "#ecfdf3", bd: "#abefc6", fg: "#027a48" } : tone === "warn" ? { bg: "#fffaeb", bd: "#fedf89", fg: "#b54708" } : { bg: "#fef3f2", bd: "#fecdca", fg: "#b42318" };
  return <div style={{ background: c.bg, border: `1px solid ${c.bd}`, color: c.fg, borderRadius: 10, padding: "8px 10px", fontSize: 12, fontWeight: 700 }}>{children}</div>;
}
