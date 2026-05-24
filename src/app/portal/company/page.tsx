import { redirect } from "next/navigation";
import { engerClient, dbConfigured } from "@/lib/supabase";
import { currentAccess } from "@/lib/accounts";
import { CompanyProfileForm, type CompanyProfile } from "@/components/CompanyProfileForm";

export const dynamic = "force-dynamic";

/** ユーザー企業(client)向け：自社のMission・カルチャー・求める人物像を編集。 */
export default async function PortalCompanyPage() {
  const access = await currentAccess();
  if (access && access.role !== "client") redirect("/");

  const companyName = access?.companyName ?? null;
  let initial: CompanyProfile = { mission: "", culture: "", ideal_persona: "", appeal: "", website: "" };
  let note: string | null = null;

  if (!companyName) {
    note = "アカウントに会社名が未設定です。管理者に会社名の登録を依頼してください。";
  } else if (dbConfigured) {
    try {
      const sb = engerClient();
      const { data } = await sb.from("company_profiles").select("mission, culture, ideal_persona, appeal, website").eq("company", companyName).maybeSingle();
      if (data) initial = {
        mission: data.mission ?? "", culture: data.culture ?? "", ideal_persona: data.ideal_persona ?? "",
        appeal: data.appeal ?? "", website: data.website ?? "",
      };
    } catch { /* 未作成は空のまま */ }
  }

  return (
    <div className="page">
      <div className="page-head">
        <div style={{ maxWidth: 760 }}>
          <div className="meta">企業プロフィール · {companyName ?? "—"}</div>
          <h1>企業プロフィール / Mission</h1>
          <div className="sub">貴社の Mission・カルチャー・求める人物像を登録すると、スキルだけでなく<b>方向性に合う人材</b>のマッチング・訴求に活用されます。エンジニアにも貴社の魅力として表示されます。</div>
        </div>
      </div>

      {note && <div className="card" style={{ background: "var(--color-brand-25)", border: "1px solid var(--color-brand-100)", fontSize: 13, marginBottom: 14 }}>{note}</div>}

      {!note && <CompanyProfileForm initial={initial} />}
    </div>
  );
}
