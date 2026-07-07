// 提案の予約配信：定期実行エンドポイント。
//   マッチング画面で予約された配信（proposal_schedules）のうち期限が来たものを実行する。
//   無料運用: GitHub Actions（.github/workflows/proposal-schedules.yml）から15分毎に叩く。
//   保護: Authorization: Bearer ${CRON_SECRET}（auto-ingest と同じ仕組み）。
//   手動実行（管理者）も同 URL を Authorization 付きで叩けば動く。
//   ※ Vercel Hobby は関数 60秒上限。1回のバッチで処理し切れない分は
//     結果をペア単位で保存してあるため、次のバッチが続きから実行する。

import { runDueProposalSchedules } from "@/lib/proposal-schedule-run";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 60; // Vercel Hobby（無料）の上限に合わせる

async function handle(req: Request) {
  const secret = process.env.CRON_SECRET;
  // 本番では必ず secret を設定。未設定なら誤起動を防ぐため拒否。
  if (!secret) return Response.json({ ok: false, error: "CRON_SECRET 未設定" }, { status: 503 });
  const auth = req.headers.get("authorization") ?? "";
  if (auth !== `Bearer ${secret}`) return Response.json({ ok: false, error: "Unauthorized" }, { status: 401 });

  const t0 = Date.now();
  const res = await runDueProposalSchedules();
  const ms = Date.now() - t0;
  return Response.json({ ...res, ms });
}

export const GET = handle;
export const POST = handle;
