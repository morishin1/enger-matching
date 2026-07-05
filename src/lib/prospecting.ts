import { dbConfigured, engerClient } from "@/lib/supabase";

export const PROSPECT_STATUSES = ["未接触", "フォーム送信済", "架電済", "反応あり", "アポ獲得", "商談", "ENGER登録", "見送り・NG"] as const;
export type ProspectStatus = (typeof PROSPECT_STATUSES)[number];

export type Prospect = {
  id: string;
  company_name: string;
  industry: string | null;
  website: string | null;
  contact_form_url: string | null;
  phone: string | null;
  contact_name: string | null;
  status: ProspectStatus;
  priority: number;
  owner_staff: string | null;
  ng_reason: string | null;
  note: string | null;
  source_list: string | null;
  last_activity_at: string | null;
  next_action_at: string | null;
  promoted_company_name: string | null;
  promoted_at: string | null;
  created_at: string;
};

export type ProspectActivity = {
  id: string;
  prospect_id: string;
  activity_type: string;
  result: string | null;
  note: string | null;
  activity_at: string;
  actor: string | null;
};

export type ProspectingData = {
  configured: boolean;
  setupMissing: boolean;
  prospects: Prospect[];
  activities: ProspectActivity[];
  companies: { name: string; website: string | null; phone: string | null }[];
};

export function statusFromActivity(activityType: string, result: string): ProspectStatus | null {
  if (result === "アポ") return "アポ獲得";
  if (result === "NG") return "見送り・NG";
  if (activityType === "フォーム送信") return "フォーム送信済";
  if (activityType === "架電") return result === "担当接続" ? "反応あり" : "架電済";
  if (activityType === "メール") return "フォーム送信済";
  if (activityType === "反応") return "反応あり";
  return null;
}

export async function loadProspectingData(): Promise<ProspectingData> {
  if (!dbConfigured) return { configured: false, setupMissing: false, prospects: [], activities: [], companies: [] };
  const sb = engerClient();
  const pr = await sb.from("prospects").select("*").order("priority", { ascending: false }).order("created_at", { ascending: false }).limit(500);
  if (pr.error) return { configured: true, setupMissing: true, prospects: [], activities: [], companies: [] };

  const prospects = (pr.data ?? []) as Prospect[];
  const ids = prospects.map((p) => p.id);
  let activities: ProspectActivity[] = [];
  if (ids.length) {
    const ar = await sb.from("prospect_activities").select("*").in("prospect_id", ids).order("activity_at", { ascending: false }).limit(1000);
    if (!ar.error) activities = (ar.data ?? []) as ProspectActivity[];
  }

  let companies: { name: string; website: string | null; phone: string | null }[] = [];
  const cr = await sb.from("companies").select("name, website, phone").limit(20000);
  if (!cr.error) companies = (cr.data ?? []) as typeof companies;

  return { configured: true, setupMissing: false, prospects, activities, companies };
}

export function todayAttackProspects(prospects: Prospect[]): Prospect[] {
  const active = new Set<ProspectStatus>(["未接触", "フォーム送信済", "架電済", "反応あり"]);
  const todayEnd = new Date();
  todayEnd.setHours(23, 59, 59, 999);
  return prospects
    .filter((p) => active.has(p.status) && (!p.next_action_at || new Date(p.next_action_at).getTime() <= todayEnd.getTime()))
    .sort((a, b) => (b.priority - a.priority) || (new Date(a.last_activity_at ?? a.created_at).getTime() - new Date(b.last_activity_at ?? b.created_at).getTime()))
    .slice(0, 80);
}

export function prospectingMetrics(prospects: Prospect[]) {
  const total = prospects.length;
  const contacted = prospects.filter((p) => p.status !== "未接触").length;
  const appointments = prospects.filter((p) => ["アポ獲得", "商談", "ENGER登録"].includes(p.status)).length;
  const registered = prospects.filter((p) => p.status === "ENGER登録" || p.promoted_at).length;
  const byOwner = groupRate(prospects, (p) => p.owner_staff || "未設定");
  const bySource = groupRate(prospects, (p) => p.source_list || "未設定");
  return { total, contacted, appointments, registered, byOwner, bySource };
}

function groupRate(prospects: Prospect[], keyer: (p: Prospect) => string) {
  const m = new Map<string, { total: number; contacted: number; appointments: number; registered: number }>();
  for (const p of prospects) {
    const k = keyer(p);
    const row = m.get(k) ?? { total: 0, contacted: 0, appointments: 0, registered: 0 };
    row.total++;
    if (p.status !== "未接触") row.contacted++;
    if (["アポ獲得", "商談", "ENGER登録"].includes(p.status)) row.appointments++;
    if (p.status === "ENGER登録" || p.promoted_at) row.registered++;
    m.set(k, row);
  }
  return Array.from(m.entries()).map(([label, v]) => ({ label, ...v })).sort((a, b) => b.total - a.total).slice(0, 12);
}
