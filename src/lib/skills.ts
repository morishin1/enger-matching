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
  // ── SES頻出（業務系・エンタープライズ・インフラ）─────────────────────────────
  //   案件本文や経歴に出やすい技術を網羅し、必須スキル照合の取りこぼしを減らす。
  { canon: "office365",   label: "Microsoft 365", aliases: ["office365", "office 365", "microsoft365", "microsoft 365", "m365", "msオフィス365", "オフィス365"] },
  { canon: "activedirectory", label: "Active Directory", aliases: ["activedirectory", "active directory", "ad", "アクティブディレクトリ"] },
  { canon: "sharepoint",  label: "SharePoint", aliases: ["sharepoint", "シェアポイント"] },
  { canon: "teams",       label: "Microsoft Teams", aliases: ["msteams", "microsoftteams", "ms teams"] },
  { canon: "powerplatform", label: "Power Platform", aliases: ["powerplatform", "power platform", "powerautomate", "power automate", "powerbi", "power bi", "powerapps", "power apps"] },
  { canon: "sap",         label: "SAP", aliases: ["sap", "サップ"] },
  { canon: "abap",        label: "ABAP", aliases: ["abap", "アバップ"] },
  { canon: "salesforce",  label: "Salesforce", aliases: ["salesforce", "sfdc", "セールスフォース", "apex"] },
  { canon: "servicenow",  label: "ServiceNow", aliases: ["servicenow", "サービスナウ"] },
  { canon: "hulft",       label: "HULFT", aliases: ["hulft", "ハルフト"] },
  { canon: "cobol",       label: "COBOL", aliases: ["cobol", "コボル"] },
  { canon: "vba",         label: "VBA", aliases: ["vba", "ブイビーエー", "excelマクロ", "エクセルマクロ"] },
  { canon: "vb",          label: "VB.NET", aliases: ["vb.net", "vb net", "visualbasic", "visual basic", "ブイビー"] },
  { canon: "as400",       label: "AS/400", aliases: ["as400", "as/400", "ibmi", "ibm i", "system i"] },
  { canon: "mainframe",   label: "メインフレーム", aliases: ["mainframe", "汎用機", "メインフレーム", "z/os", "zos"] },
  { canon: "vmware",      label: "VMware", aliases: ["vmware", "vsphere", "esxi", "ブイエムウェア"] },
  { canon: "hyperv",      label: "Hyper-V", aliases: ["hyperv", "hyper-v", "ハイパーv"] },
  { canon: "cisco",       label: "Cisco", aliases: ["cisco", "シスコ", "ccna", "ccnp"] },
  { canon: "juniper",     label: "Juniper", aliases: ["juniper", "ジュニパー"] },
  { canon: "fortigate",   label: "FortiGate", aliases: ["fortigate", "fortinet", "フォーティ"] },
  { canon: "paloalto",    label: "Palo Alto", aliases: ["paloalto", "palo alto", "paloaltonetworks"] },
  { canon: "f5",          label: "F5 BIG-IP", aliases: ["f5", "bigip", "big-ip", "big ip"] },
  { canon: "splunk",      label: "Splunk", aliases: ["splunk", "スプランク"] },
  { canon: "zabbix",      label: "Zabbix", aliases: ["zabbix", "ザビックス"] },
  { canon: "datadog",     label: "Datadog", aliases: ["datadog", "データドッグ"] },
  { canon: "newrelic",    label: "New Relic", aliases: ["newrelic", "new relic"] },
  { canon: "snowflake",   label: "Snowflake", aliases: ["snowflake", "スノーフレーク"] },
  { canon: "bigquery",    label: "BigQuery", aliases: ["bigquery", "ビッグクエリ"] },
  { canon: "redshift",    label: "Amazon Redshift", aliases: ["redshift", "amazon redshift"] },
  { canon: "db2",         label: "DB2", aliases: ["db2", "ibmdb2"] },
  { canon: "mariadb",     label: "MariaDB", aliases: ["mariadb", "マリアdb"] },
  { canon: "elasticsearch", label: "Elasticsearch", aliases: ["elasticsearch", "elastic search", "elk", "elkstack"] },
  { canon: "kafka",       label: "Apache Kafka", aliases: ["kafka", "apachekafka", "apache kafka"] },
  { canon: "rabbitmq",    label: "RabbitMQ", aliases: ["rabbitmq", "rabbit mq"] },
  { canon: "jenkins",     label: "Jenkins", aliases: ["jenkins", "ジェンキンス"] },
  { canon: "githubactions", label: "GitHub Actions", aliases: ["githubactions", "github actions", "gha"] },
  { canon: "gitlab",      label: "GitLab", aliases: ["gitlab", "gitlabci", "gitlab ci"] },
  { canon: "circleci",    label: "CircleCI", aliases: ["circleci", "circle ci"] },
  { canon: "selenium",    label: "Selenium", aliases: ["selenium", "セレニウム"] },
  { canon: "playwright",  label: "Playwright", aliases: ["playwright"] },
  { canon: "cypress",     label: "Cypress", aliases: ["cypress", "サイプレス"] },
  { canon: "jest",        label: "Jest", aliases: ["jest"] },
  { canon: "junit",       label: "JUnit", aliases: ["junit"] },
  { canon: "rspec",       label: "RSpec", aliases: ["rspec"] },
  // 業務系言語（COBOL系・スクリプト系）
  { canon: "perl",        label: "Perl", aliases: ["perl", "パール"] },
  { canon: "shell",       label: "Shell Script", aliases: ["shellscript", "shell script", "bash", "zsh", "シェル"] },
  { canon: "powershell",  label: "PowerShell", aliases: ["powershell", "power shell", "ps1"] },
  { canon: "scala",       label: "Scala", aliases: ["scala", "スカラ"] },
  { canon: "rust",        label: "Rust", aliases: ["rust", "ラスト"] },
  // セキュリティ／ガバナンス
  { canon: "iso27001",    label: "ISO27001", aliases: ["iso27001", "iso 27001", "isms"] },
  { canon: "pci",         label: "PCI DSS", aliases: ["pcidss", "pci dss", "pci-dss"] },
  { canon: "waf",         label: "WAF", aliases: ["waf"] },
  { canon: "siem",        label: "SIEM", aliases: ["siem"] },
  // AI/LLM 周辺
  { canon: "openai",      label: "OpenAI API", aliases: ["openai", "open ai", "chatgptapi", "chatgpt api"] },
  { canon: "claude",      label: "Claude", aliases: ["claude", "クロード", "anthropic"] },
  { canon: "langchain",   label: "LangChain", aliases: ["langchain"] },
  { canon: "rag",         label: "RAG", aliases: ["rag", "retrieval augmented generation"] },
  { canon: "pinecone",    label: "Pinecone", aliases: ["pinecone"] },
  { canon: "llamaindex",  label: "LlamaIndex", aliases: ["llamaindex", "llama index"] },
  // ── クラウド個別サービス・モバイル（内包関係で取りこぼしを救済する対象）──────
  { canon: "ec2",            label: "Amazon EC2", aliases: ["amazonec2", "amazon ec2"] },
  { canon: "s3",             label: "Amazon S3", aliases: ["amazons3", "amazon s3"] },
  { canon: "rds",            label: "Amazon RDS", aliases: ["amazonrds", "amazon rds"] },
  { canon: "lambda",         label: "AWS Lambda", aliases: ["awslambda", "aws lambda"] },
  { canon: "dynamodb",       label: "DynamoDB", aliases: ["amazondynamodb", "dynamo"] },
  { canon: "ecs",            label: "Amazon ECS", aliases: ["amazonecs", "aws ecs"] },
  { canon: "eks",            label: "Amazon EKS", aliases: ["amazoneks", "aws eks"] },
  { canon: "cloudformation", label: "CloudFormation", aliases: ["awscloudformation", "aws cloudformation"] },
  { canon: "reactnative",    label: "React Native", aliases: ["react native"] },
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

// ── スキルの内包関係（取りこぼし低減）──────────────────────────────────
//   子 → 親：その子スキルを持っていれば親スキルの要件も満たすとみなす（逆は不成立）。
//   例: Spring→Java / Rails→Ruby / React→JavaScript / EC2→AWS / React Native→React。
//   ※ 広く誤一致しないよう、確立した関係のみを保守的に列挙する。
const IMPLIES_RAW: Record<string, string[]> = {
  // フレームワーク → 言語
  spring: ["java"], rails: ["ruby"], laravel: ["php"],
  django: ["python"], flask: ["python"], fastapi: ["python"],
  // フロント／JS系（フレームワークは基盤言語/ライブラリを内包）
  next: ["react"], nuxt: ["vue"], react: ["javascript"], vue: ["javascript"],
  angular: ["typescript"], node: ["javascript"], typescript: ["javascript"],
  reactnative: ["react"],
  // AWS 個別サービス → AWS（EKS は Kubernetes も内包）
  ec2: ["aws"], s3: ["aws"], rds: ["aws"], lambda: ["aws"], dynamodb: ["aws"],
  ecs: ["aws"], eks: ["aws", "kubernetes"], cloudformation: ["aws"], redshift: ["aws"],
  // その他クラウド／DB 互換
  bigquery: ["googlecloud"], mariadb: ["mysql"],
};

// 有向グラフの推移閉包（自身は含まない）。
const closureFrom = (graph: Record<string, string[]>): Record<string, Set<string>> => {
  const out: Record<string, Set<string>> = {};
  const visit = (c: string, acc: Set<string>) => {
    for (const n of graph[c] ?? []) if (!acc.has(n)) { acc.add(n); visit(n, acc); }
  };
  for (const c of Object.keys(graph)) { const acc = new Set<string>(); visit(c, acc); out[c] = acc; }
  return out;
};
const PARENTS = closureFrom(IMPLIES_RAW);                 // canon → 内包する親canon
const CHILDREN = closureFrom((() => {                     // canon → 子孫canon（親の逆引き）
  const rev: Record<string, string[]> = {};
  for (const [child, parents] of Object.entries(IMPLIES_RAW)) for (const p of parents) (rev[p] ??= []).push(child);
  return rev;
})());

/** canon が内包する親 canon 集合（推移閉包・自身は含まない）。 */
export function skillParents(s: string): Set<string> { return PARENTS[canon(s)] ?? new Set<string>(); }

/** 保有スキル配列を「canon＋内包する親canon」へ展開した集合（要件充足判定用）。
 *   例: ["Spring","Amazon EC2"] → {spring, java, ec2, aws} */
export function expandSkillSet(skills: (string | null | undefined)[] | null | undefined): Set<string> {
  const set = new Set<string>();
  for (const s of skills ?? []) {
    const c = canon(String(s ?? "")); if (!c) continue;
    set.add(c);
    for (const p of PARENTS[c] ?? []) set.add(p);
  }
  return set;
}

/** スキル検索(overlaps)の取りこぼし低減用：元スキル＋関連スキルの表示ラベル配列。
 *   direction "parents"  … 保有→要件探索（人材→案件：保有スキルの親も検索語に含める）
 *   direction "children" … 要件→保有探索（案件→人材：要求スキルの子孫も検索語に含める） */
export function relatedSearchLabels(skills: (string | null | undefined)[] | null | undefined, direction: "parents" | "children"): string[] {
  const out = new Set<string>();
  const map = direction === "parents" ? PARENTS : CHILDREN;
  for (const s of skills ?? []) {
    const v = String(s ?? "").trim(); if (!v) continue;
    out.add(v); // 原表記は DB 保存表記に合わせてそのまま残す
    for (const r of map[canon(v)] ?? []) out.add(skillLabel(r));
  }
  return Array.from(out);
}

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

/** 任意のテキスト中にスキル名（label/canon/aliases/原表記）が出てくるか判定する正規表現を返す。
 *   経歴・PR・スキルシート要約など、`skills[]` 配列に未登録でも本文に書かれているスキルを
 *   照合する用途（必須スキル充足の取りこぼし救済・多重チェックの第2軸）。
 *
 *   注意:
 *   ・短い ASCII 語（"go"/"r"/"c" 等）は \b に相当する境界で囲み、"django" や "react" の
 *     部分一致で誤検出しないようにする。
 *   ・日本語・記号入りラベルは原則そのまま部分一致でよい（長くて固有性が高い）。
 *   ・正規表現のメタ文字はエスケープして安全に組み立てる。
 *   ・登録外スキルでも原表記でフォールバックする（独自技術名の取りこぼし防止）。 */
export function skillMentionRegex(skill: string): RegExp | null {
  const c = canon(skill);
  const entry = REGISTRY.find((e) => e.canon === c);
  const orig = String(skill ?? "").trim();
  const terms = new Set<string>();
  if (entry) {
    terms.add(entry.label);
    terms.add(entry.canon);
    for (const a of entry.aliases ?? []) terms.add(a);
  }
  if (orig) terms.add(orig);
  const escapeRe = (t: string) => t.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const isShortAscii = (t: string) => /^[a-zA-Z0-9+#.]{1,3}$/.test(t);
  const parts: string[] = [];
  for (const t of terms) {
    const v = t.trim();
    if (!v) continue;
    const e = escapeRe(v);
    parts.push(isShortAscii(v) ? `(?:^|[^A-Za-z0-9])${e}(?:$|[^A-Za-z0-9])` : e);
  }
  if (parts.length === 0) return null;
  return new RegExp(parts.join("|"), "i");
}
