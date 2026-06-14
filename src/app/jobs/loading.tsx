import { PageLoading } from "@/components/PageLoading";

// 案件一覧への遷移時に即座に見出し＋スピナーを表示し、「固まった」体感を防ぐ。
export default function Loading() {
  return <PageLoading meta="Jobs · 案件マスタ（実データ）" title="案件" />;
}
