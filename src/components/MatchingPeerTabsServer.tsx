// マッチング/案件/人材/LP登録 の統一タブバー（サーバー版ラッパ）。
//   各リストページの本体上部にこれ1行を置くだけで、件数つきタブが表示される。
//   カウントは getSidebarCounts()（unstable_cache 済み）から取得するので追加コストは軽微。
import { getSidebarCounts } from "@/lib/counts";
import { MatchingPeerTabs } from "./MatchingTabs";

export async function MatchingPeerTabsServer({ activeCount }: { activeCount?: number } = {}) {
  const counts = await getSidebarCounts();
  return <MatchingPeerTabs counts={counts} activeCount={activeCount} />;
}
