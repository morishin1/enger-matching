// GAS 代替: Gmail → AI 自動振分け → 自動登録の定期実行エンドポイント。
//   無料運用: GitHub Actions（.github/workflows/auto-ingest.yml）から定期的に叩く。
//   保護: Authorization: Bearer ${CRON_SECRET}。
//   手動実行（管理者）も同 URL を Authorization 付きで叩けば動く。
//   ※ Vercel Hobby は関数 60秒上限なので、1回あたりの処理件数を絞って多頻度で流す設計。

import { autoIngestFromGmail } from "@/lib/actions";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 60; // Vercel Hobby（無料）の上限に合わせる

// 1回の起動で処理する最大メール数。60秒に収まるよう少なめ（env で上書き可）。
const DEFAULT_MAX_PER_RUN = Number(process.env.AUTO_INGEST_MAX_PER_RUN ?? "12");

async function handle(req: Request) {
  const secret = process.env.CRON_SECRET;
  // 本番では必ず secret を設定。未設定なら誤起動を防ぐため拒否。
  if (!secret) return Response.json({ ok: false, error: "CRON_SECRET 未設定" }, { status: 503 });
  const auth = req.headers.get("authorization") ?? "";
  if (auth !== `Bearer ${secret}`) return Response.json({ ok: false, error: "Unauthorized" }, { status: 401 });

  const url = new URL(req.url);
  const dryRun = url.searchParams.get("dry") === "1";
  const max = Number(url.searchParams.get("max") || "0") || DEFAULT_MAX_PER_RUN;

  const t0 = Date.now();
  const res = await autoIngestFromGmail({ dryRun, max });
  const ms = Date.now() - t0;
  return Response.json({ ...res, ms });
}

export const GET = handle;
export const POST = handle;
