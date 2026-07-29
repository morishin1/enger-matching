// 構造化スキルシート（candidates.skill_sheet_data）の判定・整形ヘルパ。
//   ★このファイルはサーバー／クライアントの両方から呼ぶため "use client" を付けない。
//     ビューア本体（SkillSheetDataView.tsx）は "use client" が必要だが、そこに
//     判定関数を置くと、サーバーコンポーネント（マッチング画面）から呼んだ瞬間に
//     "Attempted to call hasSkillSheetData() from the server but ... is on the client"
//     で画面全体が落ちる。判定はここ、描画はコンポーネント側、と分けておくこと。

export type SheetProject = {
  name?: string; periodStart?: string; periodEnd?: string;
  industry?: string; jobtype?: string;
  tasks?: string; result?: string;
  role?: string; scale?: string; workstyle?: string;
  languages?: string; serverOs?: string; tools?: string;
  phases?: string[];
};

export const s = (v: unknown): string => (typeof v === "string" ? v.trim() : "");
export const arr = (v: unknown): string[] =>
  (Array.isArray(v) ? v.filter((x): x is string => typeof x === "string" && !!x.trim()) : []);

/** JSON からプロジェクト配列を取り出す（無い・壊れている場合は空）。 */
export function projectsOf(data: any): SheetProject[] {
  const raw = Array.isArray(data?.projects) ? data.projects : [];
  return raw.filter((p: any) => p && typeof p === "object")
    .filter((p: any) => s(p.name) || s(p.tasks) || s(p.result) || s(p.languages) || s(p.tools));
}

/** 表示できる中身があるか（ボタンの出し分けに使う）。 */
export function hasSkillSheetData(data: any): boolean {
  if (!data || typeof data !== "object") return false;
  return projectsOf(data).length > 0 || arr(data.skills).length > 0 || !!s(data.careerSummary);
}
