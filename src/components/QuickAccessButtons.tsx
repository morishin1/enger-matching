"use client";

// マッチング系メニュー（マッチング/案件/人材/フリーランス/LINE）共通のクイックアクセス。
//   ① LINE WORKS … LINE で来た情報を ENGER のマッチングへつなげ、即レスする運用の入口。
//   ② フリーランスチャット … 企業×フリーランスの担当仲介チャット（/chat）への入口。
//   どちらもボタンを押すと「操作説明モーダル」を表示し、最後に実際の遷移ボタンを置く。
import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import Link from "@/components/AppLink";
import { Icons } from "@/components/icons";
import { autoIngestFromGmail } from "@/lib/actions";

// LINE WORKS の Web クライアント URL。ワークスペース固有 URL があれば
//   環境変数 NEXT_PUBLIC_LINEWORKS_URL で上書きする（未設定なら共通 Web クライアント）。
const LINEWORKS_URL = process.env.NEXT_PUBLIC_LINEWORKS_URL || "https://talk.worksmobile.com/";

export function QuickAccessButtons({ compact = false, canImport = false }: { compact?: boolean; canImport?: boolean }) {
  const [modal, setModal] = useState<null | "lineworks" | "chat">(null);
  const router = useRouter();
  const [busy, start] = useTransition();
  const [importMsg, setImportMsg] = useState<string | null>(null);
  const btn = "btn ghost" + (compact ? " btn-xs" : "");

  // Gmail 自動取込：同期 → AI分類 → 案件/人材を自動登録（直近1日・1回あたり少量）。
  const runImport = () => {
    if (busy) return;
    if (typeof window !== "undefined" && !window.confirm("Gmailの新着（直近1日）を同期し、AI（低コストのHaiku）が案件/人材メールを判別して自動登録します。実行しますか？")) return;
    setImportMsg("Gmail取込中…（同期 → AI判別 → 自動登録。30秒〜1分ほどかかります）");
    start(async () => {
      try {
        const r = await autoIngestFromGmail();
        if (!r.ok) { setImportMsg(`取込失敗: ${r.error ?? "不明なエラー"}`); return; }
        setImportMsg(`✓ 同期${r.synced ?? 0}・AI抽出${r.extracted ?? 0}・案件${r.autoJobs ?? 0}・人材${r.autoCandidates ?? 0}・要確認${r.needsReview ?? 0}${r.errors ? `・エラー${r.errors}` : ""}`);
        router.refresh();
      } catch (e) {
        setImportMsg(`取込失敗: ${e instanceof Error ? e.message : String(e)}`);
      } finally {
        setTimeout(() => setImportMsg(null), 20000);
      }
    });
  };

  return (
    <>
      <div style={{ display: "inline-flex", gap: 8, alignItems: "center", flexWrap: "wrap" }}>
        {canImport && (
          // Gmail を意識したデザイン：白ベース＋薄いボーダー＋4色のGmailロゴ（Googleボタン風）。
          <button type="button" onClick={runImport} disabled={busy}
            className={compact ? "btn-xs" : ""}
            title="Gmailの新着（直近1日）を同期し、AI（低コストのHaiku）が案件/人材メールを判別して自動登録します。"
            style={{
              display: "inline-flex", alignItems: "center", gap: 7, whiteSpace: "nowrap", cursor: busy ? "wait" : "pointer",
              background: "var(--color-surface)", border: "1px solid var(--color-border-strong)", borderRadius: 8,
              padding: compact ? "4px 10px" : "7px 14px", fontSize: compact ? 12 : 13, fontWeight: 700,
              color: "var(--color-ink-2)", boxShadow: "0 1px 2px rgba(60,64,67,.12)", fontFamily: "inherit",
              opacity: busy ? 0.7 : 1,
            }}>
            <span style={{ lineHeight: 0, display: "inline-flex" }}><Icons.gmail size={compact ? 15 : 17} /></span>
            {busy ? "取込中…" : "Gmail取込"}
          </button>
        )}
        <button type="button" className={btn} onClick={() => setModal("lineworks")}
          title="LINE WORKS の使い方（LINE→ENGER→即レス）を表示" style={{ display: "inline-flex", alignItems: "center", gap: 6, whiteSpace: "nowrap" }}>
          <span style={{ lineHeight: 0, display: "inline-flex" }}><Icons.line size={compact ? 16 : 18} /></span>
          LINE WORKS
        </button>
        <button type="button" className={btn} onClick={() => setModal("chat")}
          title="フリーランスチャット（企業×フリーランスの担当仲介）の使い方を表示" style={{ display: "inline-flex", alignItems: "center", gap: 6, whiteSpace: "nowrap" }}>
          <span className="material-symbols-outlined" aria-hidden style={{ fontSize: compact ? 17 : 19, lineHeight: 1 }}>forum</span>
          フリーランスチャット
        </button>
      </div>

      {modal === "lineworks" && (
        <GuideModal
          onClose={() => setModal(null)}
          icon={<span style={{ lineHeight: 0, display: "inline-flex" }}><Icons.line size={22} /></span>}
          title="LINE WORKS で即レスする流れ"
          sub="LINE で来た案件・人材を ENGER のマッチングにつなげ、その場で返信するための運用です。"
          diagram={<LineworksFlow />}
          steps={[
            { t: "① LINE で「#タグ＋テンプレ」投稿", d: "各社の担当が、先頭に「#案件」または「#人材」を付け、テンプレ（役割/スキル/単価/稼働 など）に沿って投稿します。タグの無い雑談・相談には Bot は反応しません。" },
            { t: "② 品質ゲートを通過したものだけ取込", d: "タグが付き、スキルなど最低限の情報が揃った投稿だけを ENGER が取り込みます（情報不足はテンプレ記入を依頼）。低品質データの混入と無駄な AI 消費を防ぎます。" },
            { t: "③ ENGER に自動登録・AI整形", d: "通過した投稿は AI が項目を解釈して案件／人材として自動登録（signup_source=line_works）。スキル一致で自動スコアリングされます。" },
            { t: "④ マッチングで候補を選ぶ", d: "マッチング画面でスキル一致順に候補が並びます。最適な人材×案件のペアを選びます。" },
            { t: "⑤ 「LINEに送る」で即レス", d: "選んだマッチ結果を、記憶済みの LINE WORKS トークへそのまま送信。LINE タブの「トーク」から会話を継続できます。" },
          ]}
          action={{ href: LINEWORKS_URL, label: "LINE WORKS を開く", external: true }}
        />
      )}

      {modal === "chat" && (
        <GuideModal
          onClose={() => setModal(null)}
          icon={<span className="material-symbols-outlined" aria-hidden style={{ fontSize: 22, color: "var(--color-brand-700)" }}>forum</span>}
          title="フリーランスチャットの使い方"
          sub="企業とフリーランスの間に担当が入り、連絡先を伏せたままスレッドで会話します。"
          steps={[
            { t: "① スカウト後にスレッドが作られる", d: "人材へスカウト・提案が動くと、その案件×人材のスレッドがチャットに作られます。" },
            { t: "② 担当が仲介して会話", d: "企業・フリーランスの連絡先は伏せたまま、担当が間に入ってメッセージを取り次ぎます。既読は参加者ごとに表示されます。" },
            { t: "③ 面談・調整につなげる", d: "やり取りの中で面談日程や条件をまとめ、提案管理（提案ボード）の進捗に反映します。" },
          ]}
          action={{ href: "/chat", label: "フリーランスチャットを開く", external: false }}
        />
      )}

      {/* Gmail取込の進捗/結果トースト（右下・自動で消える） */}
      {importMsg && (
        <div style={{ position: "fixed", right: 16, bottom: 16, zIndex: 500, maxWidth: 380, background: "var(--color-surface)", border: "1px solid var(--color-border)", borderRadius: 12, boxShadow: "0 6px 24px rgba(0,0,0,.14)", padding: "12px 14px" }}>
          <div style={{ display: "flex", gap: 8, alignItems: "flex-start" }}>
            <span className="material-symbols-outlined" aria-hidden style={{ fontSize: 18, color: "var(--color-brand-700)" }}>mark_email_read</span>
            <div style={{ minWidth: 0, fontSize: 12.5, lineHeight: 1.6, color: "var(--color-ink)" }}>{importMsg}</div>
            <button type="button" className="btn ghost btn-xs" onClick={() => setImportMsg(null)} style={{ marginLeft: "auto", flexShrink: 0 }}>×</button>
          </div>
        </div>
      )}
    </>
  );
}

// LINE WORKS 即レス運用の流れ図（横並び・狭幅で折り返す）。
function LineworksFlow() {
  const LINE = "#06C755", GATE = "#e0a317", BRAND = "#0095D9";
  const Node = ({ icon, label, color }: { icon: string; label: string; color: string }) => (
    <div style={{ flex: "1 1 92px", minWidth: 88, display: "flex", flexDirection: "column", alignItems: "center", gap: 4, textAlign: "center", padding: "10px 6px", borderRadius: 10, border: `1px solid ${color}55`, background: `${color}14` }}>
      <span className="material-symbols-outlined" aria-hidden style={{ fontSize: 22, color }}>{icon}</span>
      <span style={{ fontSize: 11, fontWeight: 700, lineHeight: 1.4, color: "var(--color-ink)" }}>{label}</span>
    </div>
  );
  const Arrow = () => (
    <span className="material-symbols-outlined" aria-hidden style={{ fontSize: 18, color: "var(--color-ink-4)", alignSelf: "center" }}>arrow_forward</span>
  );
  return (
    <div style={{ display: "flex", alignItems: "stretch", gap: 6, flexWrap: "wrap", padding: 12, border: "1px solid var(--color-border)", borderRadius: 12, background: "var(--color-surface-inset)" }}>
      <Node icon="forum" label="LINEで投稿 #タグ＋テンプレ" color={LINE} />
      <Arrow />
      <Node icon="filter_alt" label="品質ゲート タグ・スキル必須" color={GATE} />
      <Arrow />
      <Node icon="auto_awesome" label="ENGER取込 AI整形" color={BRAND} />
      <Arrow />
      <Node icon="compare_arrows" label="マッチング スキル一致" color={BRAND} />
      <Arrow />
      <Node icon="send" label="LINEに送る 即レス" color={LINE} />
    </div>
  );
}

function GuideModal({
  onClose, icon, title, sub, steps, action, diagram,
}: {
  onClose: () => void;
  icon: React.ReactNode;
  title: string;
  sub: string;
  steps: { t: string; d: string }[];
  action: { href: string; label: string; external: boolean };
  diagram?: React.ReactNode;
}) {
  return (
    <div onClick={onClose} style={{ position: "fixed", inset: 0, background: "rgba(15,23,42,.45)", display: "grid", placeItems: "center", zIndex: 400, padding: 20 }}>
      <div onClick={(e) => e.stopPropagation()} className="card" style={{ width: "100%", maxWidth: 560, maxHeight: "85vh", overflowY: "auto", display: "flex", flexDirection: "column", gap: 14 }}>
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", gap: 8 }}>
          <div style={{ display: "flex", gap: 10, alignItems: "flex-start", minWidth: 0 }}>
            <span style={{ marginTop: 2 }}>{icon}</span>
            <div style={{ minWidth: 0 }}>
              <h3 style={{ margin: 0, fontSize: 16, fontWeight: 800 }}>{title}</h3>
              <div className="muted" style={{ fontSize: 12, marginTop: 3, lineHeight: 1.6 }}>{sub}</div>
            </div>
          </div>
          <button type="button" className="btn ghost btn-xs" onClick={onClose}>閉じる</button>
        </div>

        {diagram}

        <ol style={{ margin: 0, padding: 0, listStyle: "none", display: "flex", flexDirection: "column", gap: 10 }}>
          {steps.map((s, i) => (
            <li key={i} style={{ display: "flex", flexDirection: "column", gap: 3, padding: "10px 12px", border: "1px solid var(--color-border)", borderRadius: 10, background: "var(--color-surface-inset)" }}>
              <div style={{ fontSize: 13, fontWeight: 800, color: "var(--color-ink)" }}>{s.t}</div>
              <div style={{ fontSize: 12, color: "var(--color-ink-2)", lineHeight: 1.7 }}>{s.d}</div>
            </li>
          ))}
        </ol>

        {/* action 行は diagram の有無に関わらず最後に置く */}
        <div style={{ display: "flex", justifyContent: "flex-end", gap: 8, alignItems: "center" }}>
          {action.external ? (
            <a href={action.href} target="_blank" rel="noreferrer" className="btn" style={{ textDecoration: "none", display: "inline-flex", alignItems: "center", gap: 6 }}>
              <span className="material-symbols-outlined" style={{ fontSize: 18, lineHeight: 1 }}>open_in_new</span>
              {action.label}
            </a>
          ) : (
            <Link href={action.href} className="btn" style={{ textDecoration: "none", display: "inline-flex", alignItems: "center", gap: 6 }} onClick={onClose}>
              <span className="material-symbols-outlined" style={{ fontSize: 18, lineHeight: 1 }}>arrow_forward</span>
              {action.label}
            </Link>
          )}
        </div>
      </div>
    </div>
  );
}
