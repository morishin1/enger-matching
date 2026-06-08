// 担当者名のゆるい一致判定。
//   提案の proposer/closer は自由テキスト（フルネーム「藤本理仁」/ 略称「藤本」が混在しうる）。
//   アカウント表示名（フルネーム）と提案の担当名を、前方一致で寛容に突き合わせる。
//   例: ownerMatches("藤本理仁", "藤本") === true
//   ※ 苗字が衝突する運用は想定しない（提案者リストは区別可能な名前で運用する前提）。

const norm = (s?: string | null) => (s ?? "").replace(/[\s　]+/g, "").toLowerCase();

/** memberName（フルネーム）と value（提案の担当名）が同一人物とみなせるか。 */
export function ownerMatches(memberName?: string | null, value?: string | null): boolean {
  const a = norm(memberName), b = norm(value);
  if (!a || !b) return false;
  return a === b || a.startsWith(b) || b.startsWith(a);
}
