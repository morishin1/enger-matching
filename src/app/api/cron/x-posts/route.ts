// X集客PRの投稿文を時間帯ごとに自動生成し、Slack に「ワンクリックで投稿できる形」で流す定期ジョブ。
//   運用: GitHub Actions（.github/workflows/x-posts.yml）から時間帯ごとに ?slot= を付けて叩く。
//   保護: Authorization: Bearer ${CRON_SECRET}（auto-ingest と同じ）。
//   ※ 実投稿はしない（X API 不要）。Slack に貼られた「▶ Xに投稿」リンクを担当が押すと、
//      X の投稿画面が本文＋案件リンク付きで開く（リンク先 /job/<No> の案件カードが自動添付）。
//
//   スロット（JST）:
//     morning   08:00  高単価・新着案件
//     noon      12:15  フルリモート・柔軟な案件
//     afternoon 15:00  本日の新着案件まとめ
//     night     21:00  注目案件＋無料登録の案内
//   slot 未指定時は現在時刻(JST)から最も近いスロットを推定。slot=all で4本まとめて送る。
//   ?dry=1 で Slack 送信せず生成結果を JSON で返す（確認用）。
import { engerAdmin } from "@/lib/supabase";
import { notifySlack } from "@/lib/slack";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 60;

const PAY_DEDUCT = 7; // #243 フリーランス表示は -7万（案件ページ/OGPカードと同一ルール）
const adj = (v: number) => Math.max(0, Math.round(v) - PAY_DEDUCT);
const remoteLabel = (r?: string | null) =>
  r === "full_remote" ? "フルリモート" : r === "partial_remote" ? "一部リモート" : r === "onsite" ? "出社" : "";
// 単価が万単位で妥当（桁崩れデータ除外）。
const saneHi = (hi: number) => Number.isFinite(hi) && hi >= 20 && hi <= 300;
function rateText(lo: number | null, hi: number | null): string {
  const L = lo != null && Number.isFinite(lo) ? adj(lo) : null;
  const H = hi != null && Number.isFinite(hi) ? adj(hi) : null;
  if (L && H) return L === H ? `月${L}万円` : `月${L}〜${H}万円`;
  if (H) return `月${H}万円`;
  if (L) return `月${L}万円〜`;
  return "";
}
const utm = (content: string) =>
  new URLSearchParams({ utm_source: "x", utm_medium: "social", utm_campaign: "pr", utm_content: content }).toString();
const jobUrl = (no: string, content: string) => `https://enger.jp/job/${no}?${utm(content)}`;
const cardPng = (no: string) => `https://enger.jp/og/job/${no}.png`;
const intent = (text: string, url: string) => `https://twitter.com/intent/tweet?${new URLSearchParams({ text, url })}`;
const tagize = (s: string) => s.replace(/[^0-9A-Za-zぁ-んァ-ヶ一-龠]/g, "");

type Slot = "morning" | "noon" | "afternoon" | "night";
const SLOT_LABEL: Record<Slot, string> = {
  morning: "08:00 高単価・新着案件",
  noon: "12:15 フルリモート・柔軟な案件",
  afternoon: "15:00 本日の新着案件まとめ",
  night: "21:00 注目案件＋無料登録の案内",
};
type J = { no: string; role: string; skills: string[]; rate: string; remote: string };

function toJ(r: any): J {
  return {
    no: String(r.job_no),
    role: String(r.role_label ?? "").trim() || "エンジニア",
    skills: (Array.isArray(r.skills) ? r.skills : []).map((s: any) => String(s).trim()).filter(Boolean).slice(0, 4),
    rate: rateText(r.salary_min != null ? Number(r.salary_min) : null, r.salary_max != null ? Number(r.salary_max) : null),
    remote: remoteLabel(r.remote_type),
  };
}

async function queryJobs(
  admin: ReturnType<typeof engerAdmin>,
  opts: { fullRemote?: boolean; sinceIso?: string | null; bySalary?: boolean; limit?: number },
): Promise<J[]> {
  let q = admin.from("jobs")
    .select("job_no, role_label, skills, salary_min, salary_max, remote_type, created_at")
    .eq("is_published", true).not("job_no", "is", null);
  if (opts.fullRemote) q = q.eq("remote_type", "full_remote");
  if (opts.sinceIso) q = q.gte("created_at", opts.sinceIso);
  q = opts.bySalary ? q.order("salary_max", { ascending: false }) : q.order("created_at", { ascending: false });
  const { data } = await q.limit(opts.limit ?? 40);
  return ((data ?? []) as any[]).filter((r) => r.job_no != null && saneHi(Number(r.salary_max))).map(toJ);
}

/** JST の本日0:00 を UTC ISO で返す（本日の新着抽出用）。 */
function jstTodayStartIso(): string {
  const jst = new Date(Date.now() + 9 * 3600 * 1000);
  return new Date(Date.UTC(jst.getUTCFullYear(), jst.getUTCMonth(), jst.getUTCDate()) - 9 * 3600 * 1000).toISOString();
}

type Post = { slot: Slot; label: string; tweet: string; url: string; no: string | null };

async function buildPost(admin: ReturnType<typeof engerAdmin>, slot: Slot): Promise<Post | null> {
  const label = SLOT_LABEL[slot];
  const head = (j: J) => [j.remote, j.role].filter(Boolean).join("・");
  const skillHash = (j: J) => (j.skills[0] && tagize(j.skills[0]) ? ` #${tagize(j.skills[0])}案件` : "");

  if (slot === "morning") {
    const j = (await queryJobs(admin, { bySalary: true, limit: 20 }))[0];
    if (!j) return null;
    const tweet = `🔥高単価の新着案件\n【${head(j)}】${j.rate}\n${j.skills.slice(0, 3).join("・")}\nあなたのスキルでこの単価、狙えます。マッチ度を30秒で診断👇\n#フリーランス #高単価案件${skillHash(j)}`;
    return { slot, label, tweet, url: jobUrl(j.no, slot), no: j.no };
  }
  if (slot === "noon") {
    const j = (await queryJobs(admin, { fullRemote: true, limit: 20 }))[0]
      ?? (await queryJobs(admin, { limit: 20 }))[0];
    if (!j) return null;
    const tweet = `🏠フルリモート・柔軟に働ける案件\n【${head(j)}】${j.rate}\n${j.skills.slice(0, 3).join("・")}\n通勤なし、自分のペースで。まずは30秒でマッチ度診断👇\n#フリーランス #リモート案件${skillHash(j)}`;
    return { slot, label, tweet, url: jobUrl(j.no, slot), no: j.no };
  }
  if (slot === "afternoon") {
    let todays = await queryJobs(admin, { sinceIso: jstTodayStartIso(), limit: 20 });
    if (todays.length === 0) todays = await queryJobs(admin, { limit: 6 }); // 本日分が無ければ直近から
    const lead = todays[0];
    if (!lead) return null;
    const lines = todays.slice(0, 3).map((j) => `・${[j.remote, j.role, j.rate].filter(Boolean).join(" / ")}`);
    const tweet = `📋本日の新着案件まとめ（${todays.length}件）\n${lines.join("\n")}\nあなたに合う案件をマッチ度順で。30秒診断👇\n#フリーランス #エンジニア案件`;
    return { slot, label, tweet, url: jobUrl(lead.no, slot), no: lead.no };
  }
  // night
  const j = (await queryJobs(admin, { bySalary: true, limit: 20 }))[0];
  if (!j) return null;
  const tweet = `✨注目のフリーランス案件\n【${head(j)}】${j.rate}\n${j.skills.slice(0, 3).join("・")}\n登録無料・カード不要。あなたに合うか30秒で診断できます👇\n#フリーランス #エンジニア案件${skillHash(j)}`;
  return { slot, label, tweet, url: jobUrl(j.no, slot), no: j.no };
}

function slackBlocks(p: Post) {
  const links = [
    `<${intent(p.tweet, p.url)}|▶ Xに投稿（ワンクリック）>`,
    p.no ? `<${cardPng(p.no)}|カード画像を確認>` : "",
    `<${p.url}|案件ページ>`,
  ].filter(Boolean).join("　・　");
  return [
    { type: "header", text: { type: "plain_text", text: `𝕏 ${p.label}`, emoji: true } },
    { type: "section", text: { type: "mrkdwn", text: "```\n" + p.tweet + "\n```" } },
    { type: "context", elements: [{ type: "mrkdwn", text: links }] },
  ];
}

/** 現在時刻(JST)から最も近いスロットを推定（slot 未指定時のフォールバック）。 */
function inferSlot(): Slot {
  const h = new Date(Date.now() + 9 * 3600 * 1000).getUTCHours();
  if (h < 10) return "morning";
  if (h < 13) return "noon";
  if (h < 18) return "afternoon";
  return "night";
}

async function handle(req: Request) {
  const secret = process.env.CRON_SECRET;
  if (!secret) return Response.json({ ok: false, error: "CRON_SECRET 未設定" }, { status: 503 });
  if ((req.headers.get("authorization") ?? "") !== `Bearer ${secret}`)
    return Response.json({ ok: false, error: "Unauthorized" }, { status: 401 });

  const url = new URL(req.url);
  const dry = url.searchParams.get("dry") === "1";
  const slotParam = (url.searchParams.get("slot") || "").toLowerCase();
  const slots: Slot[] = slotParam === "all"
    ? ["morning", "noon", "afternoon", "night"]
    : (["morning", "noon", "afternoon", "night"] as Slot[]).includes(slotParam as Slot)
      ? [slotParam as Slot]
      : [inferSlot()];

  let admin: ReturnType<typeof engerAdmin>;
  try { admin = engerAdmin(); } catch { return Response.json({ ok: false, error: "SUPABASE_SERVICE_ROLE_KEY 未設定" }, { status: 503 }); }

  const results: { slot: Slot; ok: boolean; no: string | null; skipped?: boolean; error?: string }[] = [];
  const built: Post[] = [];
  for (const slot of slots) {
    let post: Post | null = null;
    try { post = await buildPost(admin, slot); } catch (e: any) { results.push({ slot, ok: false, no: null, error: String(e?.message ?? e) }); continue; }
    if (!post) { results.push({ slot, ok: false, no: null, error: "該当案件が見つかりません" }); continue; }
    built.push(post);
    if (dry) { results.push({ slot, ok: true, no: post.no }); continue; }
    const r = await notifySlack({ text: `𝕏 ${post.label}`, blocks: slackBlocks(post) });
    results.push({ slot, ok: r.ok, no: post.no, skipped: r.skipped, error: r.error });
  }
  return Response.json({ ok: results.every((r) => r.ok), dry, results, posts: dry ? built : undefined });
}

export const GET = handle;
export const POST = handle;
