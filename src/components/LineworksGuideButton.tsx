"use client";

// 各社に配布する「LINE運用ガイド」。LINEグループに固定（ピン留め）する文面をワンクリックで
//   コピーでき、画面上でも整形表示する。取込ルール（#タグ＋テンプレ＋スキル必須）は
//   Webhook 側の品質ゲート（api/lineworks/webhook）と一致させること。
import { useState } from "react";
import { CopyButton } from "./CopyButton";
import { Icons } from "./icons";

// 案件／人材テンプレ（Botが返す案内・品質ゲートと同一フォーマット）。
const TPL_JOB = `#案件
役割：
必須スキル：（例 Java, AWS）
単価：
稼働開始：
リモート：
商流：`;

const TPL_CAND = `#人材
イニシャル：
スキル：（例 React, TypeScript）
経験年数：
単価：
稼働可能日：`;

// LINEグループに固定する配布用テキスト（全文）。
const PIN_TEXT = `━━━━━━━━━━━━━━
ENGER 案件・人材 共有ルール
━━━━━━━━━━━━━━
■ 投稿のしかた
・案件は「#案件」、人材は「#人材」を先頭に付けて、下のテンプレで投稿してください。
・タグの無い投稿は取り込まれません（雑談・相談はそのままでOK）。
・スキルは必須です（無いとマッチングできません）。

▼案件テンプレ
${TPL_JOB}

▼人材テンプレ
${TPL_CAND}

■ 取り込み後
・ルールを満たすと自動でマッチングし、合う候補をその場で返信します。
・情報が足りないときは「追記してください」と返信します。

■ おねがい
・氏名・連絡先は最小限に（イニシャルでOK）。
・単価・商流などの機密はこのグループ内のみでお願いします。`;

export function LineworksGuideButton({ compact = false }: { compact?: boolean }) {
  const [open, setOpen] = useState(false);
  return (
    <>
      <button type="button" className={"btn ghost" + (compact ? " btn-xs" : "")} onClick={() => setOpen(true)}
        title="各社に配布する LINE 運用ガイド（投稿ルール・テンプレ）を表示"
        style={{ display: "inline-flex", alignItems: "center", gap: 6, whiteSpace: "nowrap" }}>
        <span className="material-symbols-outlined" aria-hidden style={{ fontSize: compact ? 16 : 18, lineHeight: 1 }}>menu_book</span>
        運用ガイド
      </button>

      {open && (
        <div onClick={() => setOpen(false)} style={{ position: "fixed", inset: 0, background: "rgba(15,23,42,.45)", display: "grid", placeItems: "center", zIndex: 400, padding: 20 }}>
          <div onClick={(e) => e.stopPropagation()} className="card" style={{ width: "100%", maxWidth: 600, maxHeight: "86vh", overflowY: "auto", display: "flex", flexDirection: "column", gap: 14 }}>
            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", gap: 8 }}>
              <div style={{ display: "flex", gap: 10, alignItems: "flex-start", minWidth: 0 }}>
                <span style={{ lineHeight: 0, marginTop: 2 }}><Icons.line size={22} /></span>
                <div>
                  <h3 style={{ margin: 0, fontSize: 16, fontWeight: 800 }}>LINE 運用ガイド（各社配布用）</h3>
                  <div className="muted" style={{ fontSize: 12, marginTop: 3, lineHeight: 1.6 }}>各社の担当に共有し、LINEグループに固定（ピン留め）してご利用ください。</div>
                </div>
              </div>
              <button type="button" className="btn ghost btn-xs" onClick={() => setOpen(false)}>閉じる</button>
            </div>

            <div style={{ display: "flex", alignItems: "center", gap: 8, flexWrap: "wrap" }}>
              <CopyButton text={PIN_TEXT} label="全文をコピー（LINEに固定用）" />
              <span className="muted" style={{ fontSize: 11 }}>※ そのままグループに貼り付けて固定できます。</span>
            </div>

            {/* 対象・前提 */}
            <Section title="参加対象" icon="how_to_reg">
              <ul style={ulStyle}>
                <li><b>ENGER にアカウント登録した企業のみ</b>（担当が割り当てられます）。</li>
                <li>運用は<b>エンジャー担当 × 各社の個別グループ</b>で（機密保持のため、他社が混ざる共通グループは使いません）。</li>
              </ul>
            </Section>

            {/* 投稿ルール */}
            <Section title="投稿ルール" icon="rule">
              <ul style={ulStyle}>
                <li>案件は先頭に <Tag>#案件</Tag>、人材は <Tag>#人材</Tag> を付ける。</li>
                <li>下のテンプレに沿って記入。<b>スキルは必須</b>（無いとマッチングできません）。</li>
                <li><b>タグの無い投稿は取り込まれません</b>（雑談・相談はそのままでOK・Botは反応しません）。</li>
              </ul>
            </Section>

            {/* テンプレ */}
            <Section title="テンプレ" icon="content_paste">
              <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(240px, 1fr))", gap: 10 }}>
                <TemplateCard title="案件" body={TPL_JOB} />
                <TemplateCard title="人材" body={TPL_CAND} />
              </div>
            </Section>

            {/* 取込後・注意 */}
            <Section title="取り込み後・おねがい" icon="info">
              <ul style={ulStyle}>
                <li>ルールを満たすと<b>自動でマッチング</b>し、合う候補をその場で返信します。</li>
                <li>情報が足りないときは「<b>追記してください</b>」と返信します。</li>
                <li>氏名・連絡先は最小限に（イニシャルでOK）。単価・商流などの機密はこのグループ内のみ。</li>
              </ul>
            </Section>
          </div>
        </div>
      )}
    </>
  );
}

const ulStyle: React.CSSProperties = { margin: 0, paddingLeft: 18, display: "flex", flexDirection: "column", gap: 4, fontSize: 12.5, color: "var(--color-ink-2)", lineHeight: 1.7 };

function Section({ title, icon, children }: { title: string; icon: string; children: React.ReactNode }) {
  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 8, padding: "12px 14px", border: "1px solid var(--color-border)", borderRadius: 10, background: "var(--color-surface-inset)" }}>
      <div style={{ display: "flex", alignItems: "center", gap: 6 }}>
        <span className="material-symbols-outlined" aria-hidden style={{ fontSize: 18, color: "var(--color-brand-700)" }}>{icon}</span>
        <h4 style={{ margin: 0, fontSize: 13.5, fontWeight: 800 }}>{title}</h4>
      </div>
      {children}
    </div>
  );
}

function Tag({ children }: { children: React.ReactNode }) {
  return <span className="mono" style={{ fontSize: 11.5, fontWeight: 700, padding: "1px 6px", borderRadius: 6, background: "#06C75518", color: "#067647", border: "1px solid #06C75544" }}>{children}</span>;
}

function TemplateCard({ title, body }: { title: string; body: string }) {
  return (
    <div className="card" style={{ padding: 12, display: "flex", flexDirection: "column", gap: 6, border: "1px solid #bfe3cc", background: "#f0fbf5" }}>
      <div style={{ fontSize: 12, fontWeight: 800, color: "#067647", display: "inline-flex", alignItems: "center", gap: 6 }}>
        <span style={{ lineHeight: 0 }}><Icons.line size={14} /></span>{title}
      </div>
      <pre style={{ margin: 0, fontFamily: "inherit", whiteSpace: "pre-wrap", fontSize: 12, color: "var(--color-ink-2)", lineHeight: 1.6 }}>{body}</pre>
      <CopyButton text={body} label={`${title}テンプレをコピー`} />
    </div>
  );
}
