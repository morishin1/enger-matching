import { MatchingPeerTabsServer } from "@/components/MatchingPeerTabsServer";
import { NewRegistrationsList } from "@/components/NewRegistrationsList";
import { listAccounts, listLpPendingCandidates } from "@/lib/accounts";

export const dynamic = "force-dynamic";

// マッチング → 新着：エンジャーフリーランス（enger.jp）から登録された人材の承認待ち一覧。
//   ユーザー管理（設定）から人材の承認導線を移設したもの。承認すると人材ダッシュボードが
//   使えるようになり、フリーランス一覧（/engineers）・マッチング対象に反映される。
export default async function NewcomersPage() {
  const rows = await Promise.all([listAccounts(), listLpPendingCandidates()]).then(([real, lp]) =>
    [...real.filter((a) => a.status === "pending"), ...lp]
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
