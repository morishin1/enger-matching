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
