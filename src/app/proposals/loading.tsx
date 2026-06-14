import { PageLoading } from "@/components/PageLoading";

// 提案管理への遷移時に即座に見出し＋スピナーを表示し、「固まった」体感を防ぐ。
export default function Loading() {
  return <PageLoading meta="Proposals · 提案管理" title="提案管理" />;
}
