"use client";

// マッチング系メニュー（マッチング/案件/人材/フリーランス/LINE）共通のクイックアクセス。
//   ① LINE WORKS … LINE で来た情報を ENGER のマッチングへつなげ、即レスする運用の入口。
//   ② フリーランスチャット … 企業×フリーランスの担当仲介チャット（/chat）への入口。
//   どちらもボタンを押すと「操作説明モーダル」を表示し、最後に実際の遷移ボタンを置く。
import { useState } from "react";
import Link from "@/components/AppLink";
import { Icons } from "@/components/icons";

// LINE WORKS の Web クライアント URL。ワークスペース固有 URL があれば
//   環境変数 NEXT_PUBLIC_LINEWORKS_URL で上書きする（未設定なら共通 Web クライアント）。
const LINEWORKS_URL = process.env.NEXT_PUBLIC_LINEWORKS_URL || "https://talk.worksmobile.com/";

export function QuickAccessButtons({ compact = false }: { compact?: boolean }) {
  const [modal, setModal] = useState<null | "lineworks" | "chat">(null);
  const btn = "btn ghost" + (compact ? " btn-xs" : "");

  return (
    <>
      <div style={{ display: "inline-flex", gap: 8, alignItems: "center", flexWrap: "wrap" }}>
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
          sub="LINE で来た相談を ENGER のマッチングにつなげ、その場で返信するための運用です。"
          steps={[
            { t: "① LINE WORKS で受ける", d: "各営業は自分の LINE WORKS アカウントで、LINE から来た案件・人材の相談を受け取ります。Bot のいるトークに投稿すると、ENGER 側に「送信先トーク」として記憶されます。" },
            { t: "② コピーして ENGER に登録", d: "相談内容（案件文面 / 人材スキル）をコピーし、ENGER の「LINE/メール貼り付け」（人材を登録 / 案件を登録）に貼り付けると、AI が項目を解釈して登録します。" },
            { t: "③ マッチングで候補を選ぶ", d: "登録した案件・人材は自動でスコアリングされ、マッチング画面でスキル一致順に候補が並びます。最適なペアを選びます。" },
            { t: "④ 「LINEに送る」で即レス", d: "マッチング画面の「LINEに送る」を押すと、選んだ人材×案件のマッチ結果が、記憶済みの LINE WORKS トークへそのまま送信されます。" },
            { t: "⑤ そのまま会話を継続", d: "LINE タブの「トーク」で、Bot 経由のやり取りを ENGER 内から確認・返信できます。LINE WORKS を開いて直接返信することも可能です。" },
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
    </>
  );
}

function GuideModal({
  onClose, icon, title, sub, steps, action,
}: {
  onClose: () => void;
  icon: React.ReactNode;
  title: string;
  sub: string;
  steps: { t: string; d: string }[];
  action: { href: string; label: string; external: boolean };
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

        <ol style={{ margin: 0, padding: 0, listStyle: "none", display: "flex", flexDirection: "column", gap: 10 }}>
          {steps.map((s, i) => (
            <li key={i} style={{ display: "flex", flexDirection: "column", gap: 3, padding: "10px 12px", border: "1px solid var(--color-border)", borderRadius: 10, background: "var(--color-surface-inset)" }}>
              <div style={{ fontSize: 13, fontWeight: 800, color: "var(--color-ink)" }}>{s.t}</div>
              <div style={{ fontSize: 12, color: "var(--color-ink-2)", lineHeight: 1.7 }}>{s.d}</div>
            </li>
          ))}
        </ol>

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
