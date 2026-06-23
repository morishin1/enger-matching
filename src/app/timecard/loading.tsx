import { PageLoading } from "@/components/PageLoading";

// 遷移時に即座に見出し＋スピナーを表示し、「固まった」体感を防ぐ（prefetch無効＋force-dynamicのため）。
export default function Loading() {
  return <PageLoading meta="Timecard · タイムカード" title="タイムカード" />;
}
