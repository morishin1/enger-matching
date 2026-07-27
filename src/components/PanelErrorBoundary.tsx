"use client";

// 画面の一部分だけを守るエラーバウンダリ。
//   1つのカード（ランキング／案件サマリ／候補詳細 など）で例外が起きても、
//   画面全体を落とさずそのカードだけをエラー表示に差し替える。
//   ・利用者：他の部分は今までどおり使える（マッチング結果が「何も見えない」状態を避ける）
//   ・調査　：どのカードで落ちたかが一目で分かり、クライアント側の例外なら本文もそのまま出る
//     （サーバー側の例外は本番だと本文が伏せられるため、エラーIDを表示する）
import React from "react";

type Props = { label: string; children: React.ReactNode };
type State = { error: (Error & { digest?: string }) | null };

export class PanelErrorBoundary extends React.Component<Props, State> {
  state: State = { error: null };

  static getDerivedStateFromError(error: Error & { digest?: string }): State {
    return { error };
  }

  componentDidCatch(error: unknown, info: unknown) {
    console.error(`[panel:${this.props.label}]`, error, info);
  }

  render() {
    const e = this.state.error;
    if (!e) return this.props.children;
    const detail = [e.message, e.digest ? `エラーID: ${e.digest}` : ""].filter(Boolean).join(" / ");
    return (
      <div className="card" style={{ padding: 16, background: "#fff6e0", border: "1px solid #fde9b0", color: "#92400e" }}>
        <div style={{ fontWeight: 800, fontSize: 13, marginBottom: 6 }}>⚠ {this.props.label}を表示できませんでした</div>
        <div style={{ fontSize: 12.5, lineHeight: 1.8 }}>
          この部分だけ表示を止めています。画面の他の部分はそのまま使えます。<br />
          直らない場合は、下の文言をそのまま管理者にお知らせください。
        </div>
        {detail && (
          <div className="mono" style={{ marginTop: 8, fontSize: 11.5, background: "#fff", border: "1px solid #fde9b0", borderRadius: 8, padding: "8px 10px", wordBreak: "break-all" }}>
            {detail}
          </div>
        )}
      </div>
    );
  }
}
