// 「確認中」フォルダ滞留通知の定期実行エンドポイント。
//   確認中に入ってから3日以上 動きのない提案を、翌日にクロージング担当者へメール通知する。
//   無料運用: GitHub Actions（.github/workflows/confirm-stale.yml）から日次で叩く。
//   保護: Authorization: Bearer ${CRON_SECRET}。?dry=1 で送信せず対象だけ確認できる。

import { notifyStaleConfirming } from "@/lib/confirm-notify";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 60;

async function handle(req: Request) {
  const secret = process.env.CRON_SECRET;
  if (!secret) return Response.json({ ok: false, error: "CRON_SECRET 未設定" }, { status: 503 });
  const auth = req.headers.get("authorization") ?? "";
  if (auth !== `Bearer ${secret}`) return Response.json({ ok: false, error: "Unauthorized" }, { status: 401 });

  const dryRun = new URL(req.url).searchParams.get("dry") === "1";
  const t0 = Date.now();
  const res = await notifyStaleConfirming({ dryRun });
  return Response.json({ ...res, dryRun, ms: Date.now() - t0 });
}

export const GET = handle;
export const POST = handle;
