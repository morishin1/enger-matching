"use server";

import { revalidatePath } from "next/cache";
import { engerAdmin } from "@/lib/supabase";

export async function markNotificationRead(id: string): Promise<{ ok: boolean }> {
  try { const sb = engerAdmin(); await sb.from("notifications").update({ read_at: new Date().toISOString() }).eq("id", id); revalidatePath("/notifications"); return { ok: true }; }
  catch { return { ok: false }; }
}

export async function markAllRead(recipient: string): Promise<{ ok: boolean }> {
  try { const sb = engerAdmin(); await sb.from("notifications").update({ read_at: new Date().toISOString() }).or(`recipient.eq.${recipient},recipient.eq.all`).is("read_at", null); revalidatePath("/notifications"); return { ok: true }; }
  catch { return { ok: false }; }
}
