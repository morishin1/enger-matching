import { Icons } from "@/components/icons";
import { MeetingsClient } from "@/components/MeetingsClient";
import { engerClient, dbConfigured } from "@/lib/supabase";
import { getCompanyOverview } from "@/lib/companies";

export const dynamic = "force-dynamic";

export default async function MeetingsPage() {
  let meetings: any[] = [];
  let dbError: string | null = null;
  let needSetup = false;

  if (dbConfigured) {
    try {
      const sb = engerClient();
      const { data, error } = await sb
        .from("meetings")
        .select("*")
        .order("meeting_date", { ascending: false, nullsFirst: false })
        .limit(300);
      if (error) needSetup = true;
      else meetings = data ?? [];
    } catch (e) {
      dbError = e instanceof Error ? e.message : String(e);
    }
  } else {
    dbError = "Supabase の環境変数が未設定です";
  }

  const companies = ((await getCompanyOverview()) ?? []).map((c) => c.name);

  const total = meetings.length;
  const positive = meetings.filter((m) => m.fb_sentiment === "👍ポジティブ").length;
  const negative = meetings.filter((m) => m.fb_sentiment === "👎ネガティブ").length;
  const withCompetitor = meetings.filter((m) => (m.competitors ?? []).some((c: string) => c && c !== "言及なし")).length;

  return (
    <div className="page">
      <div className="page-head">
        <div style={{ maxWidth: 760 }}>
          <div className="meta">Meetings · 打ち合わせ記録（アウトサイド）</div>
          <h1>打ち合わせ記録</h1>
          <div className="sub">企業ごとの温度感（FB感情）・刺さった訴求点・競合言及・次回アクションを蓄積し、今後の対応に反映します。Geminiメモは要約欄に貼り付け、Drive原本はリンクで紐付けます。</div>
        </div>
      </div>

      {dbError && <div className="card" style={{ borderColor: "var(--color-danger)", color: "var(--color-danger)" }}><b>DB:</b> {dbError}</div>}
      {needSetup && (
        <div className="card" style={{ background: "var(--color-brand-25)", borderColor: "var(--color-brand-100)" }}>
          <b>打ち合わせ記録テーブルが未作成です。</b> SQL Editor で <span className="mono">supabase/meetings.sql</span> を実行してください。
        </div>
      )}

      <div className="kpi-grid">
        <div className="kpi brand">
          <div className="top"><div className="ico-box"><Icons.inbox /></div><div className="chip flat">記録</div></div>
          <div><div className="val tnum">{total}<span className="unit">件</span></div><div className="label">打ち合わせ記録</div><div className="note">直近300件</div></div>
        </div>
        <div className="kpi accent">
          <div className="top"><div className="ico-box"><Icons.check /></div><div className="chip">👍</div></div>
          <div><div className="val tnum">{positive}<span className="unit">件</span></div><div className="label">ポジティブ</div><div className="note">{total ? Math.round((positive / total) * 100) : 0}%</div></div>
        </div>
        <div className="kpi warn">
          <div className="top"><div className="ico-box"><Icons.bolt /></div><div className="chip">👎</div></div>
          <div><div className="val tnum">{negative}<span className="unit">件</span></div><div className="label">ネガティブ</div><div className="note">要フォロー</div></div>
        </div>
        <div className="kpi">
          <div className="top"><div className="ico-box"><Icons.matching /></div><div className="chip flat">競合</div></div>
          <div><div className="val tnum">{withCompetitor}<span className="unit">件</span></div><div className="label">競合言及あり</div><div className="note">他社比較</div></div>
        </div>
      </div>

      {!needSetup && <MeetingsClient meetings={meetings} companies={companies} />}
    </div>
  );
}
