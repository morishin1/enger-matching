// スキル正規化の“正典”辞書（取込・マッチング・注力定義で共通利用）。
//   - canon(s)        : 比較用の正規トークン（小文字・記号除去・同義語寄せ）
//   - skillLabel(s)   : 表示用の正規ラベル（例 "react"→"React"）
//   - normalizeSkills : 配列/カンマ文字列 → 表示ラベル配列（canonで重複排除）
// GAS抽出側の正規形ともこの辞書を“唯一の正典”として揃える。

type Entry = { canon: string; label: string; aliases?: string[] };

const REGISTRY: Entry[] = [
  { canon: "react", label: "React", aliases: ["reactjs", "react.js", "リアクト"] },
  { canon: "next", label: "Next.js", aliases: ["nextjs", "next.js", "ネクストjs", "ネクスト"] },
  { canon: "vue", label: "Vue.js", aliases: ["vuejs", "vue.js", "ビュー"] },
  { canon: "nuxt", label: "Nuxt", aliases: ["nuxtjs", "nuxt.js"] },
  { canon: "angular", label: "Angular", aliases: ["angularjs"] },
  { canon: "node", label: "Node.js", aliases: ["nodejs", "node.js"] },
  { canon: "typescript", label: "TypeScript", aliases: ["ts", "タイプスクリプト"] },
  { canon: "javascript", label: "JavaScript", aliases: ["js", "ジャバスクリプト", "ジャヴァスクリプト"] },
  { canon: "go", label: "Go", aliases: ["golang", "go言語"] },
  { canon: "python", label: "Python", aliases: ["パイソン"] },
  { canon: "java", label: "Java", aliases: ["ジャバ", "ジャヴァ"] },
  { canon: "php", label: "PHP", aliases: ["ピーエイチピー"] },
  { canon: "ruby", label: "Ruby", aliases: ["ルビー"] },
  { canon: "rails", label: "Ruby on Rails", aliases: ["rubyonrails", "ror", "レイルズ", "ruby on rails"] },
  { canon: "laravel", label: "Laravel", aliases: ["ララベル"] },
  { canon: "django", label: "Django", aliases: ["ジャンゴ"] },
  { canon: "flask", label: "Flask" },
  { canon: "fastapi", label: "FastAPI" },
  { canon: "spring", label: "Spring", aliases: ["springboot", "spring boot", "スプリング"] },
  { canon: "net", label: ".NET", aliases: ["dotnet", ".net", "ドットネット", "aspnet", "asp.net"] },
  { canon: "c#", label: "C#", aliases: ["csharp", "c＃", "シーシャープ"] },
  { canon: "c++", label: "C++", aliases: ["cplusplus", "シープラ", "シープラスプラス"] },
  { canon: "c", label: "C言語", aliases: ["c言語"] },
  { canon: "kotlin", label: "Kotlin", aliases: ["jetpackcompose", "コトリン"] },
  { canon: "swift", label: "Swift", aliases: ["swiftui", "スウィフト"] },
  { canon: "flutter", label: "Flutter", aliases: ["フラッター"] },
  { canon: "aws", label: "AWS", aliases: ["amazonwebservices", "エーダブリューエス"] },
  { canon: "googlecloud", label: "Google Cloud", aliases: ["gcp", "googlecloudplatform"] },
  { canon: "azure", label: "Azure", aliases: ["microsoftazure"] },
  { canon: "kubernetes", label: "Kubernetes", aliases: ["k8s", "クバネティス", "クーベネティス"] },
  { canon: "docker", label: "Docker", aliases: ["ドッカー"] },
  { canon: "terraform", label: "Terraform", aliases: ["テラフォーム"] },
  { canon: "ansible", label: "Ansible" },
  { canon: "linux", label: "Linux" },
  { canon: "postgresql", label: "PostgreSQL", aliases: ["postgres", "postgre", "ポスグレ"] },
  { canon: "mysql", label: "MySQL" },
  { canon: "oracle", label: "Oracle", aliases: ["oracledb"] },
  { canon: "sqlserver", label: "SQL Server", aliases: ["mssql"] },
  { canon: "mongodb", label: "MongoDB", aliases: ["mongo"] },
  { canon: "redis", label: "Redis" },
  { canon: "graphql", label: "GraphQL" },
  { canon: "sql", label: "SQL" },
  { canon: "tensorflow", label: "TensorFlow" },
  { canon: "pytorch", label: "PyTorch" },
];

/** 比較用の素正規化（小文字・空白/記号の一部除去）。 */
const norm = (s: string) => String(s ?? "").toLowerCase().replace(/\s+/g, "").replace(/[.．・/／]/g, "");

// 別名 → canon、canon → 表示ラベル
const SYN: Record<string, string> = {};
const LABEL: Record<string, string> = {};
for (const e of REGISTRY) {
  LABEL[e.canon] = e.label;
  SYN[norm(e.canon)] = e.canon;
  SYN[norm(e.label)] = e.canon;
  for (const a of e.aliases ?? []) SYN[norm(a)] = e.canon;
}

/** 比較用の正規トークン（同義語寄せ込み）。 */
export const canon = (s: string): string => { const n = norm(s); return SYN[n] ?? n; };

/** 表示用の正規ラベル。辞書未登録はトリムした原表記を保持（独自技術名を壊さない）。 */
export const skillLabel = (s: string): string => {
  const c = canon(s);
  return LABEL[c] ?? String(s ?? "").trim();
};

export { norm as normToken };

/** 配列/カンマ区切り文字列 → 表示ラベル配列（canonで重複排除・空除去）。 */
export function normalizeSkills(input: string[] | string | null | undefined): string[] {
  const arr = Array.isArray(input)
    ? input
    : String(input ?? "").split(/[,、，/／・\n]+/);
  const seen = new Set<string>();
  const out: string[] = [];
  for (const raw of arr) {
    const t = String(raw ?? "").trim();
    if (!t) continue;
    const c = canon(t);
    if (seen.has(c)) continue;
    seen.add(c);
    out.push(skillLabel(t));
  }
  return out;
}

/** 2配列の一致スキル数（canon比較）。 */
export const overlapCount = (a?: string[] | null, b?: string[] | null): number => {
  const bs = new Set((b ?? []).map(canon));
  return (a ?? []).filter((s) => bs.has(canon(s))).length;
};
