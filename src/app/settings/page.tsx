import { StaffManager } from "@/components/StaffManager";
import { getStaff } from "@/lib/staff";

export const dynamic = "force-dynamic";

export default async function SettingsPage() {
  const staff = await getStaff();
  return (
    <div className="page">
      <div className="page-head">
        <div style={{ maxWidth: 760 }}>
          <div className="meta">Settings · 設定</div>
          <h1>設定</h1>
          <div className="sub">提案管理で使う担当者（提案者・クロージング担当）を管理します。担当変更があればここで追加・削除してください。</div>
        </div>
      </div>
      <StaffManager rows={staff.rows} fromTable={staff.fromTable} />
    </div>
  );
}
