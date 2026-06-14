import { PageLoading } from "@/components/PageLoading";

// 人材一覧への遷移時に即座に見出し＋スピナーを表示し、「固まった」体感を防ぐ。
export default function Loading() {
  return <PageLoading meta="People · 人材マスタ（実データ）" title="人材" />;
}
