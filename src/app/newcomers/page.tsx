import { MatchingPeerTabsServer } from "@/components/MatchingPeerTabsServer";
import { NewRegistrationsList } from "@/components/NewRegistrationsList";
import { listAccounts, listLpPendingCandidates, listLpTalentEntries } from "@/lib/accounts";

export const dynamic = "force-dynamic";

// マッチング → 新着：各LP（右腕COO・エンジャーフリーランス 等）から登録された人材の承認待ち一覧。
//   ・LP登録エントリー（coo_talent_entries）… 承認＝enger.candidates へ取込（マッチング対象に）
//   ・enger.jp の profiles/auth 由来 … 承認＝ログイン可の人材アカウントに
//   すべてこの1画面で承認でき、登録元バッジでどのLPから来たかが分かる。
export default async function NewcomersPage() {
  const rows = await Promise.all([listAccounts(), listLpPendingCandidates(), listLpTalentEntries()]).then(([real, lp, entries]) =>
    [
      ...entries,
      ...real.filter((a) => a.status === "pending"),
      ...lp,
    ]
      .filter((a) => a.role !== "client" && a.role !== "partner" && a.role !== "admin" && a.role !== "agent")
      .sort((a, b) => String(b.created_at).localeCompare(String(a.created_at))),
  ).catch(() => []);

  return (
    <div className="page">
      <MatchingPeerTabsServer activeCount={rows.length} />
      <div className="page-head">
        <div style={{ maxWidth: 820 }}>
          <div className="meta">ENGER · 新着登録</div>
          <h1>新着</h1>
          <div className="sub">
            <b>エンジャーフリーランス（enger.jp）</b>から登録された人材の承認待ち一覧です。
            承認すると本人が人材ダッシュボードを使えるようになり、フリーランス一覧・マッチング対象に反映されます。
            企業の新規登録は <a href="/companies?tab=new">企業管理 → 新着</a> で確認できます。
          </div>
        </div>
      </div>
      <NewRegistrationsList rows={rows} kind="talent" />
    </div>
  );
}
