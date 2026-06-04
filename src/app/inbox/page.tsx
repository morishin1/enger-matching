// 旧 /inbox は /mail?tab=inbox（お問い合わせ）に統合済み。リダイレクトのみ。
import { redirect } from "next/navigation";
export default function InboxRedirect() { redirect("/mail?tab=inbox"); }
