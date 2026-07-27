import type { Metadata } from "next";
import { addProspect, recordProspectActivity, promoteProspectToCompany, updateProspectStatus } from "./actions";
import { dailyAddedCounts, dailyResearchPrompt, dailyTheme, hourlyAngle, jstDateKey, loadProspectingData, prospectingMetrics, todayAttackProspects, PROSPECT_RANKS, PROSPECT_STATUSES, type DailyTheme, type Prospect } from "@/lib/prospecting";
import { ProspectDailyAppend } from "@/components/ProspectDailyAppend";
import { PillTabs } from "@/components/PillTabs";
import { SimpleRangeYearMonthBar } from "@/components/SimpleRangeYearMonthBar";
import { hasCustomRange, inCustomRange } from "@/lib/period";

export const dynamic = "force-dynamic";

export const metadata: Metadata = {
  title: "エンド開拓｜ENGER",
  robots: { index: false, follow: false },
};

const NAVY = "#0F2440";
const card = { background: "#fff", borderRadius: 18, boxShadow: "0 24px 70px rgba(15,36,64,.18)", border: "1px solid #e5e7eb" } as const;
const input = { fontFamily: "inherit", fontSize: 13, padding: "10px 12px", borderRadius: 11, border: "1px solid #d0d5dd", background: "#fff", color: "#101828", width: "100%" } as const;
const btn = { fontFamily: "inherit", fontSize: 12, fontWeight: 800, padding: "8px 12px", borderRadius: 10, border: 0, background: "#0b5cab", color: "#fff", cursor: "pointer" } as const;
type FormAction = (formData: FormData) => void | Promise<void>;
const addProspectFormAction = addProspect as unknown as FormAction;
const recordProspectActivityFormAction = recordProspectActivity as unknown as FormAction;
const promoteProspectToCompanyFormAction = promoteProspectToCompany as unknown as FormAction;
const updateProspectStatusFormAction = updateProspectStatus as unknown as FormAction;

export default async function ProspectingPage({ searchParams }: { searchParams: Promise<{ tab?: string; owner?: string; source?: string; status?: string; from?: string; to?: string }> }) {
  const sp = await searchParams;
  const tab = sp.tab === "list" || sp.tab === "results" ? sp.tab : "today";
  const data = await loadProspectingData();
  // リスト管理／成果は「リスト投入日（created_at）」で期間絞り込み（統一デザインの年+月バー）。
  //   今日のアタックは常に「今日」対象のため期間バーの対象外（既存どおり）。
  const periodFiltered = hasCustomRange(sp.from, sp.to) ? data.prospects.filter((p) => inCustomRange(p.created_at, sp.from, sp.to)) : data.prospects;
  const prospects = periodFiltered.filter((p) => (!sp.owner || p.owner_staff === sp.owner) && (!sp.source || p.source_list === sp.source) && (!sp.status || p.status === sp.status));
  const today = todayAttackProspects(data.prospects.filter((p) => (!sp.owner || p.owner_staff === sp.owner) && (!sp.source || p.source_list === sp.source) && (!sp.status || p.status === sp.status)));
  const metrics = prospectingMetrics(data.prospects);
  const periodMetrics = prospectingMetrics(periodFiltered);
  const duplicateNames = new Set(data.companies.map((c) => c.name.trim()).filter(Boolean));
  // 毎日の追記（日次リスト）：今日のテーマ・調査プロンプト・直近7日の追記件数。
  const today0 = jstDateKey();
  const theme = dailyTheme();
  const counts = dailyAddedCounts(data.prospects, 7);
  const todayCount = counts[counts.length - 1]?.count ?? 0;
  // 調査プロンプトに載せる「既にリストにある企業」（新しい順）。同じ会社を何度も調べさせない。
  const recentNames = data.prospects
    .slice()
    .sort((a, b) => String(b.created_at ?? "").localeCompare(String(a.created_at ?? "")))
    .map((p) => p.company_name)
    .filter(Boolean);

  return (
    <div style={{ minHeight: "calc(100vh - 80px)", margin: "-24px -24px 0", padding: "28px 24px 56px", background: `linear-gradient(160deg, ${NAVY} 0%, #0a1830 36%, #f6f8fb 36%)` }}>
      <div style={{ maxWidth: 1240, margin: "0 auto" }}>
        <header style={{ display: "flex", justifyContent: "space-between", gap: 16, alignItems: "flex-start", color: "#fff", marginBottom: 18 }}>
          <div>
            <div style={{ display: "inline-flex", alignItems: "center", gap: 8, fontSize: 12, fontWeight: 800, padding: "5px 10px", borderRadius: 999, background: "rgba(255,255,255,.12)", border: "1px solid rgba(255,255,255,.2)" }}>
              <span className="material-symbols-outlined" style={{ fontSize: 17, color: "#facc15" }}>target</span> End Prospecting
            </div>
            <h1 style={{ margin: "10px 0 6px", fontSize: 30, letterSpacing: ".02em" }}>エンド開拓</h1>
            <p style={{ margin: 0, maxWidth: 780, color: "rgba(255,255,255,.78)", lineHeight: 1.75, fontSize: 13 }}>リストを入れる → 今日アタックすべき企業を出す → 文面/スクリプトを見ながら接触 → 結果を1クリック記録 → アポ獲得後に企業管理へ昇格します。</p>
          </div>
          <div style={{ ...card, padding: 14, minWidth: 300, color: "#101828" }}>
            <div style={{ fontSize: 11, fontWeight: 800, color: "#667085" }}>売上逆算</div>
            <div style={{ fontSize: 13, lineHeight: 1.8, marginTop: 4 }}>利用企業数 = リスト数 × 接触率 × アポ率 × 登録転換率</div>
            <div style={{ display: "flex", gap: 8, marginTop: 8 }}>
              <Kpi label="リスト" value={metrics.total} /><Kpi label="接触" value={metrics.contacted} /><Kpi label="アポ" value={metrics.appointments} /><Kpi label="登録" value={metrics.registered} />
            </div>
          </div>
        </header>

        {!data.configured && <SetupCard text="Supabase 環境変数が未設定です。画面確認はできますが、保存はできません。" />}
        {data.setupMissing && <SetupCard text="prospects テーブルが未作成です。Supabase SQL Editor で supabase/prospecting.sql を実行してください。" />}

        <div style={{ marginBottom: 16 }}>
          <PillTabs
            active={tab}
            tabs={[
              { key: "today", label: "今日のアタック", icon: "bolt", href: "/prospecting" },
              { key: "list", label: "リスト管理", icon: "list_alt", href: "/prospecting?tab=list" },
              { key: "results", label: "成果", icon: "insights", href: "/prospecting?tab=results" },
            ]}
            rightSlot={tab === "list" || tab === "results" ? <SimpleRangeYearMonthBar basePath="/prospecting" /> : undefined}
          />
        </div>

        {tab === "today" ? <TodayTab prospects={today} duplicateNames={duplicateNames} todayCount={todayCount} theme={theme} />
          : tab === "list" ? <ListTab prospects={prospects} daily={{
              theme, date: today0, counts, todayCount,
              // 既にリストにある企業は調査段階で除外させる（重複スキップで実収穫が減るのを防ぐ）。
              //   コピー用は最大120社、URL起動用は文字数上限があるので25社に絞る。
              prompt: dailyResearchPrompt(theme, { date: today0, angle: hourlyAngle(), avoid: recentNames.slice(0, 120) }),
              promptForUrl: dailyResearchPrompt(theme, { date: today0, angle: hourlyAngle(), avoid: recentNames.slice(0, 25) }),
            }} />
          : <ResultsTab metrics={periodMetrics} />}
      </div>
    </div>
  );
}

function Kpi({ label, value }: { label: string; value: number }) {
  return <div style={{ flex: 1, padding: "8px 10px", borderRadius: 12, background: "#f8fafc", border: "1px solid #eaecf0" }}><div style={{ fontSize: 10, color: "#667085", fontWeight: 800 }}>{label}</div><div style={{ fontSize: 18, fontWeight: 900 }}>{value.toLocaleString("ja-JP")}</div></div>;
}
function SetupCard({ text }: { text: string }) { return <div style={{ ...card, padding: 14, marginBottom: 14, color: "#b42318", background: "#fff7ed", borderColor: "#fed7aa", fontWeight: 700 }}>{text}</div>; }

function TodayTab({ prospects, duplicateNames, todayCount, theme }: { prospects: Prospect[]; duplicateNames: Set<string>; todayCount: number; theme: DailyTheme }) {
  return <div style={{ display: "grid", gap: 12 }}>
    {/* 毎日の追記状況をアタック画面でも一目で分かるようにする（0件ならリスト管理へ誘導）。 */}
    <div style={{ ...card, padding: "12px 16px", display: "flex", alignItems: "center", gap: 12, flexWrap: "wrap", justifyContent: "space-between" }}>
      <div style={{ fontSize: 12.5, color: "#344054" }}>
        本日の追記 <b style={{ fontSize: 16, color: todayCount > 0 ? "#047857" : "#b42318" }}>{todayCount}</b> 社 ／ 今日のテーマ：<b>{theme.label}</b>
      </div>
      <a href="/prospecting?tab=list" style={{ ...btn, background: todayCount > 0 ? "#0b5cab" : "#b42318", textDecoration: "none", display: "inline-block" }}>{todayCount > 0 ? "リストに追記する" : "今日の企業を追記する"}</a>
    </div>
    {prospects.length === 0 ? <div style={{ ...card, padding: 26 }}>今日アタック対象の企業はありません。リスト管理から企業を追加してください。</div> : prospects.map((p) => <ProspectCard key={p.id} p={p} duplicate={duplicateNames.has(p.company_name)} />)}
  </div>;
}

function ProspectCard({ p, duplicate }: { p: Prospect; duplicate: boolean }) {
  const formText = `${p.company_name} ご担当者様\n\n突然のご連絡失礼いたします。ENGERの営業担当です。弊社ではITエンジニア領域の人材紹介・SES支援を成功報酬/稼働ベースでご支援しています。貴社の採用・開発体制強化でお役に立てる可能性があり、情報交換のお時間をいただけますでしょうか。`;
  const script = `お世話になります、ENGERの営業担当です。${p.industry ?? "IT/採用"}領域の企業様へ、エンジニア採用・SES人材のご支援でご連絡しました。現在、開発人材の採用や外部パートナー活用でお困りごとはありますでしょうか。`;
  return (
    <section style={{ ...card, padding: 18 }}>
      <div style={{ display: "flex", gap: 12, justifyContent: "space-between", flexWrap: "wrap" }}>
        <div><div style={{ display: "flex", alignItems: "center", gap: 8, flexWrap: "wrap" }}><h2 style={{ margin: 0, fontSize: 18 }}>{p.company_name}</h2>{duplicate && <span style={{ color: "#b45309", background: "#fff7ed", border: "1px solid #fed7aa", borderRadius: 999, padding: "2px 8px", fontSize: 11, fontWeight: 800 }}>既存企業候補</span>}<Status status={p.status} /></div><p style={{ margin: "6px 0 0", color: "#667085", fontSize: 12 }}>{[p.industry, p.owner_staff && `担当:${p.owner_staff}`, p.source_list && `出所:${p.source_list}`, `優先度:${p.priority}`].filter(Boolean).join(" · ")}</p></div>
        <form action={promoteProspectToCompanyFormAction}><input type="hidden" name="prospect_id" value={p.id} /><button style={{ ...btn, background: "#047857" }}>企業管理へ昇格</button></form>
      </div>
      <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(260px, 1fr))", gap: 12, marginTop: 14 }}>
        <CopyBox title="📋 フォーム文面" text={formText} url={p.contact_form_url || p.website || ""} />
        <CopyBox title="📞 テレアポスクリプト" text={script} url={p.phone || ""} />
      </div>
      <div style={{ display: "flex", gap: 8, flexWrap: "wrap", marginTop: 14 }}>
        {["不通", "受付止まり", "担当接続", "アポ", "NG"].map((r) => <QuickAction key={r} id={p.id} result={r} />)}
      </div>
    </section>
  );
}
function CopyBox({ title, text, url }: { title: string; text: string; url: string }) { return <div style={{ background: "#f8fafc", border: "1px solid #eaecf0", borderRadius: 14, padding: 13 }}><div style={{ fontWeight: 900, fontSize: 12 }}>{title}</div>{url && <div style={{ fontSize: 11, color: "#0b5cab", wordBreak: "break-all", marginTop: 4 }}>{url}</div>}<pre style={{ whiteSpace: "pre-wrap", fontFamily: "inherit", fontSize: 12, lineHeight: 1.7, color: "#344054" }}>{text}</pre></div>; }
function QuickAction({ id, result }: { id: string; result: string }) { return <form action={recordProspectActivityFormAction}><input type="hidden" name="prospect_id" value={id} /><input type="hidden" name="activity_type" value="架電" /><input type="hidden" name="result" value={result} /><button style={{ ...btn, background: result === "アポ" ? "#047857" : result === "NG" ? "#b42318" : "#0b5cab" }}>{result}</button></form>; }
function Status({ status }: { status: string }) { return <span style={{ padding: "3px 9px", borderRadius: 999, background: "#eaf4fd", color: "#0b5cab", fontSize: 11, fontWeight: 900 }}>{status}</span>; }

function ListTab({ prospects, daily }: { prospects: Prospect[]; daily: { theme: DailyTheme; date: string; prompt: string; promptForUrl: string; counts: { date: string; label: string; count: number }[]; todayCount: number } }) {
  return <div style={{ display: "grid", gap: 14 }}>
    <ProspectDailyAppend {...daily} defaultSource={`日次リスト（${daily.theme.label}）`} />
    <div style={{ display: "grid", gridTemplateColumns: "minmax(280px, 380px) 1fr", gap: 14, alignItems: "start" }}>
      <AddForm />
      <div style={{ ...card, padding: 16, overflowX: "auto" }}><table style={{ width: "100%", borderCollapse: "collapse", fontSize: 12 }}><thead><tr>{["会社", "状態", "ランク", "優先", "担当", "出所", "操作"].map((h) => <th key={h} style={{ textAlign: "left", padding: 8, borderBottom: "1px solid #eaecf0" }}>{h}</th>)}</tr></thead><tbody>{prospects.map((p) => <tr key={p.id}><td style={{ padding: 8, borderBottom: "1px solid #f2f4f7" }}><b>{p.company_name}</b><div style={{ color: "#667085" }}>{[p.location, p.website].filter(Boolean).join(" · ")}</div>{(p.signals?.length ?? 0) > 0 && <div style={{ display: "flex", gap: 4, flexWrap: "wrap", marginTop: 3 }}>{p.signals!.map((s) => <span key={s} style={{ fontSize: 10, fontWeight: 800, color: "#0b5cab", background: "#eaf4fd", borderRadius: 999, padding: "1px 7px" }}>{s}</span>)}</div>}</td><td><Status status={p.status} /></td><td><Rank rank={p.rank ?? null} /></td><td>{p.priority}</td><td>{p.owner_staff}</td><td>{p.source_list}</td><td><form action={updateProspectStatusFormAction}><input type="hidden" name="prospect_id" value={p.id} /><select name="status" defaultValue={p.status} style={input}>{PROSPECT_STATUSES.map((s) => <option key={s}>{s}</option>)}</select><button style={{ ...btn, marginTop: 6 }}>更新</button></form></td></tr>)}</tbody></table></div>
    </div>
  </div>;
}
function Rank({ rank }: { rank: string | null }) {
  if (!rank) return <span style={{ color: "#98a2b3" }}>—</span>;
  const c = rank === "A" ? { bg: "#ecfdf3", fg: "#027a48" } : rank === "B" ? { bg: "#eff8ff", fg: "#175cd3" } : { bg: "#f2f4f7", fg: "#475467" };
  return <span style={{ padding: "2px 8px", borderRadius: 999, background: c.bg, color: c.fg, fontSize: 11, fontWeight: 900 }}>{rank}</span>;
}
function AddForm() { return <form action={addProspectFormAction} style={{ ...card, padding: 16, display: "grid", gap: 9 }}><h2 style={{ margin: 0, fontSize: 16 }}>手入力</h2><input name="company_name" placeholder="会社名*" required style={input} /><input name="industry" placeholder="業界" style={input} /><input name="website" placeholder="企業URL" style={input} /><input name="career_url" placeholder="採用ページURL" style={input} /><input name="contact_form_url" placeholder="問い合わせフォームURL" style={input} /><input name="location" placeholder="所在地" style={input} /><input name="phone" placeholder="電話" style={input} /><input name="contact_name" placeholder="担当者" style={input} /><input name="owner_staff" placeholder="自社担当" style={input} /><input name="found_via" placeholder="発見元（PR TIMES／企業HP など）" style={input} /><input name="source_list" placeholder="出所（リスト名）" style={input} /><select name="rank" defaultValue="" style={input}><option value="">ランク未設定</option>{PROSPECT_RANKS.map((r) => <option key={r} value={r}>{r}{r === "A" ? "：今週送る" : r === "B" ? "：来週以降" : "：対象外"}</option>)}</select><input name="priority" type="number" min="0" max="100" defaultValue="50" style={input} /><textarea name="note" placeholder="メモ" rows={3} style={input} /><button style={btn}>追加</button></form>; }

function ResultsTab({ metrics }: { metrics: ReturnType<typeof prospectingMetrics> }) { return <div style={{ ...card, padding: 18 }}><h2 style={{ marginTop: 0 }}>成果ファネル</h2><div style={{ display: "grid", gridTemplateColumns: "repeat(4, 1fr)", gap: 10 }}><Kpi label="リスト" value={metrics.total} /><Kpi label="接触" value={metrics.contacted} /><Kpi label="アポ" value={metrics.appointments} /><Kpi label="登録" value={metrics.registered} /></div><h3>担当別</h3><MiniTable rows={metrics.byOwner} /><h3>リスト別</h3><MiniTable rows={metrics.bySource} /></div>; }
function MiniTable({ rows }: { rows: { label: string; total: number; contacted: number; appointments: number; registered: number }[] }) { return <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 12 }}><tbody>{rows.map((r) => <tr key={r.label}><td style={{ padding: 8, borderBottom: "1px solid #eaecf0", fontWeight: 800 }}>{r.label}</td><td>リスト {r.total}</td><td>接触 {r.contacted}</td><td>アポ {r.appointments}</td><td>登録 {r.registered}</td></tr>)}</tbody></table>; }
