import { redirect } from "next/navigation";

// ユーザー管理は /settings ページ内のタブに統合済み。
// 既存リンクやブックマーク互換のため、ここではタブ付き URL に転送する。
export default function ApprovalsRedirect() {
  redirect("/settings?tab=users");
}
