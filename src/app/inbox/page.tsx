// 旧 /inbox（お問い合わせ）はダッシュボードに統合済み。リダイレクトのみ。
import { redirect } from "next/navigation";
export default function InboxRedirect() { redirect("/"); }
