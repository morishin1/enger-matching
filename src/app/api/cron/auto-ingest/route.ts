// GAS 代替: Gmail → AI 自動振分け → 自動登録の定期実行エンドポイント。
//   vercel.json の crons から呼ばれる（既定 30分ごと）。
//   保護: Authorization: Bearer ${CRON_SECRET}（Vercel Cron は自動で付与）。
//   手動実行（管理者）も同 URL を Authorization 付きで叩けば動く。

import { autoIngestFromGmail } from "@/lib/actions";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 300; // 最大 5分（Vercel Pro 想定）

async function handle(req: Request) {
  const secret = process.env.CRON_SECRET;
  // 本番では必ず secret を設定。未設定なら誤起動を防ぐため拒否。
  if (!secret) return Response.json({ ok: false, error: "CRON_SECRET 未設定" }, { status: 503 });
  const auth = req.headers.get("authorization") ?? "";
  if (auth !== `Bearer ${secret}`) return Response.json({ ok: false, error: "Unauthorized" }, { status: 401 });

  const url = new URL(req.url);
  const dryRun = url.searchParams.get("dry") === "1";
  const max = Number(url.searchParams.get("max") || "0") || undefined;

  const t0 = Date.now();
  const res = await autoIngestFromGmail({ dryRun, max });
  const ms = Date.now() - t0;
  return Response.json({ ...res, ms });
}

export const GET = handle;
export const POST = handle;
