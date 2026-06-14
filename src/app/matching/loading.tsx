import { PageLoading } from "@/components/PageLoading";

// マッチングへの遷移時に即座に見出し＋スピナーを表示し、「固まった」体感を防ぐ。
//   マッチングは全案件×人材のスコアリングで重く、遷移フィードバックの効果が特に大きい。
export default function Loading() {
  return <PageLoading meta="Matching" title="マッチング" />;
}
