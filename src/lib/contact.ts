// お問い合わせ（contact_messages）の純粋な型・判定ロジック。
//   サーバー/クライアント双方から import できるよう "use client" を付けない独立モジュールに置く。
//   （client コンポーネント由来の関数をサーバーで呼ぶと RSC のクライアント参照になり実行時エラーになるため）

export type ContactMsg = {
  id: string; company: string | null; name: string | null; email: string | null; phone: string | null;
  topic: string | null; role: string | null; message: string | null; source: string | null;
  status: string; created_at: string;
};

// 「意味のない文字列か（テスト/スパムの自動生成データ）」を判定。
//   - 日本語/空白を含まず、英数字だけが10文字以上連続する単一トークン → ランダム文字列とみなす
//   - メールアドレスは除外
function looksRandom(s?: string | null): boolean {
  if (!s) return false;
  const v = s.trim();
  if (v.length < 10) return false;
  if (/[ぁ-んァ-ヶ一-龠]/.test(v)) return false;       // 日本語があれば人の文章
  if (/\s/.test(v)) return false;                       // スペースがあれば文章っぽい
  if (/@/.test(v)) return false;                        // メールは別判定
  if (!/^[A-Za-z0-9._-]+$/.test(v)) return false;       // 記号混じりは対象外
  // 英大文字小文字が無秩序に混ざる（連続子音が多い）→ ランダム性が高い
  const letters = v.replace(/[^A-Za-z]/g, "");
  if (letters.length < 10) return false;
  const switches = letters.split("").filter((c, i, a) => i > 0 && (/[A-Z]/.test(c) !== /[A-Z]/.test(a[i - 1]))).length;
  return switches >= 4; // 大文字/小文字の切替が多い = 人名/単語ではない
}

/** この問い合わせがジャンク（テスト/自動生成）と思われるか。 */
export function isJunkContact(r: { company?: string | null; name?: string | null; message?: string | null }): boolean {
  const hits = [r.company, r.name, r.message].filter((x) => looksRandom(x)).length;
  return hits >= 2; // 会社/氏名/本文のうち2つ以上がランダム → ジャンク
}
