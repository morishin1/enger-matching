// KGI/KPI ダッシュボード。
//   月間売上目標（手動）＋ 人員配分（インサイド/アウトサイド）→ AIが逆算して
//   稼働人数/面談/提案/打ち合わせ の月次KPIに割り振り、営業日数で週次・日次に按分して
//   「チームで達成する」目標として表示する。打ち合わせは人員容量（1人1日3件）で実現性を判定。
//   実績（提案/面談/稼働）は proposals 由来（getKpiSnapshot）で達成率＋リカバリー必要ペースを併記。
import Link from "@/components/AppLink";
import { currentAccess } from "@/lib/accounts";
import { canManageDept } from "@/lib/roles";
import { businessDaysInMonth } from "@/lib/person-kgi";
import { getKgiSalesPlan, meetingCapacityMonth, DEFAULT_MTG_PER_PERSON_DAY } from "@/lib/kgi-plan";
import { KgiPlanControls } from "@/components/KgiPlanControls";
import { KgiBoard } from "@/components/KgiBoard";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

const MONTHS = Array.from({ length: 12 }, (_, i) => i + 1);
const two = (n: number) => String(n).padStart(2, "0");

export default async function KgiDashboardPage({ searchParams }: { searchParams: Promise<{ y?: string; m?: string }> }) {
  const sp = await searchParams;
  const access = await currentAccess();
  if (!access) return <div className="page"><div className="card">ログインが必要です。</div></div>;
  const canEdit = access.role === "admin" || canManageDept(access.teamRole);

  const now = new Date();
  const y = /^\d{4}$/.test(sp.y ?? "") ? Number(sp.y) : now.getFullYear();
  const m = /^\d{1,2}$/.test(sp.m ?? "") && Number(sp.m) >= 1 && Number(sp.m) <= 12 ? Number(sp.m) : now.getMonth() + 1;
  const mk = `${y}-${two(m)}-01`;
  const bizDays = businessDaysInMonth(mk);

  const planRow = await getKgiSalesPlan(mk);
  const salesTarget = planRow?.salesTargetMan ?? null;
  const avgDeal = planRow?.avgDealMan ?? null;
  const headcount = planRow?.headcount ?? { inside: 0, outside: 0 };
  const plan = planRow?.plan ?? null;

  // 打ち合わせ容量（現在の人員配分ベース）と、当月の打ち合わせ目標の実現性。
  const capacity = meetingCapacityMonth(headcount, bizDays, DEFAULT_MTG_PER_PERSON_DAY);
  const apptTarget = plan?.monthly.appointment ?? 0;
  const feasible = capacity <= 0 ? null : apptTarget <= capacity; // 人員未入力なら判定なし
  // 逆算KPI・週次・リカバリー・仕入れの各セクションと実績集計は KgiBoard に集約（数値クリックで根拠データ）。

  return (
    <div className="page">
      {/* ヘッダ */}
      <div className="page-head" style={{ alignItems: "flex-start" }}>
        <div style={{ maxWidth: 860 }}>
          <div className="meta">KGI / KPI · ダッシュボード</div>
          <h1><span className="material-symbols-outlined" aria-hidden style={{ fontSize: 28, verticalAlign: "-5px", marginRight: 8, color: "var(--color-brand-700)" }}>insights</span>KGI/KPI ダッシュボード</h1>
          <div className="sub">
            <b>月間の売上目標</b>と<b>人員配分（インサイド/アウトサイド）</b>を設定すると、達成に必要な
            <b>提案数・面談数・稼働人数・打ち合わせ数</b>をAIが逆算し、営業日数で<b>週次・日次</b>に割り振ります。
            打ち合わせは<b>1人1日{DEFAULT_MTG_PER_PERSON_DAY}件</b>を上限に実現性を判定し、遅れは<b>必要日次ペース</b>で取り戻します。
          </div>
        </div>
      </div>

      {/* 年／月セレクタ */}
      <div className="card" style={{ padding: "10px 12px", display: "flex", alignItems: "center", gap: 8, flexWrap: "wrap" }}>
        <span style={{ fontWeight: 800, fontSize: 14, marginRight: 6 }}>{y}年</span>
        {MONTHS.map((mm) => {
          const on = mm === m;
          return (
            <Link key={mm} href={`/kgi?y=${y}&m=${mm}`} prefetch={false} style={{
              padding: "6px 12px", borderRadius: 8, textDecoration: "none", fontSize: 13, fontWeight: on ? 800 : 600,
              background: on ? "var(--color-brand-600)" : "transparent", color: on ? "#fff" : "var(--color-ink-2)",
            }}>{mm}月</Link>
          );
        })}
        <span style={{ marginLeft: "auto", display: "flex", gap: 6 }}>
          <Link href={`/kgi?y=${m === 1 ? y - 1 : y}&m=${m === 1 ? 12 : m - 1}`} prefetch={false} className="btn ghost btn-xs" style={{ textDecoration: "none" }}>← 前月</Link>
          <Link href={`/kgi?y=${m === 12 ? y + 1 : y}&m=${m === 12 ? 1 : m + 1}`} prefetch={false} className="btn ghost btn-xs" style={{ textDecoration: "none" }}>翌月 →</Link>
        </span>
      </div>

      {/* 売上目標・人員配分（手動）＋ AI計算 */}
      <KgiPlanControls month={mk} initialTarget={salesTarget} initialAvgDeal={avgDeal} initialInside={headcount.inside} initialOutside={headcount.outside} hasPlan={!!plan} canEdit={canEdit} />

      {/* サマリー：売上目標・人員/容量・AI前提 */}
      <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(220px, 1fr))", gap: 14 }}>
        <div className="card" style={{ padding: "16px 18px" }}>
          <div style={{ fontSize: 11, color: "var(--color-ink-4)", fontWeight: 700 }}>月間売上目標</div>
          <div className="mono" style={{ fontSize: 28, fontWeight: 800 }}>{salesTarget != null ? `${salesTarget.toLocaleString("ja-JP")}万` : "未設定"}</div>
          <div className="muted" style={{ fontSize: 11 }}>
            平均単価 <b>{(avgDeal ?? plan?.avgDealMan) != null ? `${Math.round((avgDeal ?? plan?.avgDealMan)!)}万/名` : "未設定"}</b> ／ 当月の営業日 {bizDays}日
          </div>
        </div>
        <div className="card" style={{ padding: "16px 18px" }}>
          <div style={{ fontSize: 11, color: "var(--color-ink-4)", fontWeight: 700 }}>人員配分・打ち合わせ容量</div>
          <div style={{ fontSize: 15, fontWeight: 800, marginTop: 2 }}>
            IN {headcount.inside}名 ／ OUT {headcount.outside}名
            <span className="muted" style={{ fontSize: 11, fontWeight: 600 }}>（計{headcount.inside + headcount.outside}名）</span>
          </div>
          <div className="muted" style={{ fontSize: 11, marginTop: 4, lineHeight: 1.6 }}>
            {capacity > 0
              ? <>月間打ち合わせ容量 <b>約{capacity.toLocaleString("ja-JP")}件</b>（{headcount.inside + headcount.outside}名×{DEFAULT_MTG_PER_PERSON_DAY}件/日×{bizDays}日）</>
              : <>人員を入力すると容量を試算します</>}
          </div>
        </div>
        {plan && (
          <div className="card" style={{ padding: "16px 18px" }}>
            <div style={{ fontSize: 11, color: "var(--color-ink-4)", fontWeight: 700 }}>AIの前提（逆算の根拠）</div>
            <div style={{ fontSize: 13, marginTop: 4, lineHeight: 1.7 }}>
              平均単価 <b>{Math.round(plan.avgDealMan)}万</b>/名・月 ／ 転換率 打合せ→提案 <b>{Math.round(plan.conv.appointmentToProposal * 100)}%</b>・提案→面談 <b>{Math.round(plan.conv.proposalToMeeting * 100)}%</b>・面談→稼働 <b>{Math.round(plan.conv.meetingToPlacement * 100)}%</b>
            </div>
            {plan.rationale && <div className="muted" style={{ fontSize: 11, marginTop: 4 }}>{plan.rationale}</div>}
          </div>
        )}
      </div>

      {/* 実現性の判定＆打ち手（AIの実現条件） */}
      {plan && feasible === false && (
        <div className="card" style={{ background: "#fef3f2", borderColor: "#fecdca", color: "#b42318", fontSize: 12.5, lineHeight: 1.7 }}>
          <b>⚠ 打ち合わせ目標が人員容量を超えています。</b>
          目標 <b>{apptTarget.toLocaleString("ja-JP")}件</b> ＞ 容量 <b>約{capacity.toLocaleString("ja-JP")}件</b>（1人1日{DEFAULT_MTG_PER_PERSON_DAY}件換算）。
          数を追うより<b>単価↑・転換率↑・増員</b>、または<b>エンド直案件の獲得</b>・<b>フリーランス/BP人材の確保</b>で必要数を圧縮してください。
          {plan.advice && <div style={{ marginTop: 6, color: "#7a271a" }}>AIの提案：{plan.advice}</div>}
        </div>
      )}
      {plan && feasible === true && plan.advice && (
        <div className="card" style={{ background: "#eefbf3", borderColor: "#bbe8cd", color: "#067647", fontSize: 12.5, lineHeight: 1.7 }}>
          <b>✓ 打ち合わせ目標は現在の人員容量に収まります。</b>
          <div style={{ marginTop: 4, color: "#05603a" }}>AIの提案：{plan.advice}</div>
        </div>
      )}

      {!plan && (
        <div className="card" style={{ background: "#fff6e0", borderColor: "#fde9b0", color: "#9a7b12", fontSize: 12.5 }}>
          {salesTarget == null
            ? <><b>まず月間売上目標と人員配分を入力してください。</b> その後「AIで週次/日次KPIを計算」を押すと、必要な提案数・面談数・稼働人数・打ち合わせ数が割り振られます。</>
            : <><b>「AIで週次/日次KPIを計算」を押してください。</b> 売上目標 {salesTarget?.toLocaleString("ja-JP")}万円 と人員配分から逆算します。</>}
        </div>
      )}

      {/* シーズナリティ・逆算KPI・リカバリー・週次カレンダー・仕入れKGI（数値クリックで根拠データ）。
          共通コンポーネント KgiBoard に集約（ダッシュボードと共用）。plan 未設定の案内は上のカードで表示するため抑制。 */}
      <KgiBoard month={mk} showPlanHint={false} />

      <div className="muted" style={{ fontSize: 11, lineHeight: 1.7 }}>
        ※ 初版は<b>全社（チーム）ビュー</b>です。売上目標・人員配分は月ごとに手動設定、KPIの割り振り・週配分・実現条件はAI/仮説モデルが算定します（AIキー未設定時は既定の転換率で逆算）。
        部署別・個人別、日次の予定×実績カレンダー、案件/人材の仕入れKPI（エンド直・FL・BP・PP採用）は今後の拡張予定です。
      </div>
    </div>
  );
}
