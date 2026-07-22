import { engerAdmin } from "@/lib/supabase";

// X集客カードの共有ページ dx.enger.jp/x/<token>。
//   ・SNSクローラー（Twitterbot等）には <head> の OGP / twitter:card メタを返す
//     → Xでカード画像が大きく表示される（summary_large_image）。
//   ・人間のブラウザには即座に遷移先（登録/案件ページ・UTM付き）へ転送する。
//   ルートハンドラなので管理画面のレイアウト(AppShell)を経由せず、軽量に配信できる。
export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const FALLBACK = "https://enger.jp/jobs";

function esc(s: string): string {
  return String(s ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

export async function GET(
  _req: Request,
  ctx: { params: Promise<{ token: string }> },
): Promise<Response> {
  const { token } = await ctx.params;

  let card:
    | { image_url: string; title: string | null; description: string | null; redirect_url: string | null }
    | null = null;
  try {
    const admin = engerAdmin();
    const { data } = await admin
      .from("pr_cards")
      .select("image_url,title,description,redirect_url")
      .eq("token", token)
      .maybeSingle();
    card = data ?? null;
  } catch {
    card = null;
  }

  // 見つからない/未適用時は登録導線へ素直に転送。
  if (!card) {
    return new Response(null, { status: 302, headers: { Location: FALLBACK } });
  }

  const dest = card.redirect_url || FALLBACK;
  const title = esc(card.title || "ENGERで、あなたに合う案件が見つかる");
  const desc = esc(card.description || "フリーランスエンジニアのための案件マッチング。");
  const img = esc(card.image_url);
  const destAttr = esc(dest);
  const destJson = JSON.stringify(dest);
  const shareUrl = esc(`https://dx.enger.jp/x/${token}`);

  const html = `<!doctype html>
<html lang="ja">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<title>${title}</title>
<meta name="robots" content="noindex,nofollow">
<meta property="og:type" content="website">
<meta property="og:site_name" content="ENGER">
<meta property="og:title" content="${title}">
<meta property="og:description" content="${desc}">
<meta property="og:image" content="${img}">
<meta property="og:url" content="${shareUrl}">
<meta name="twitter:card" content="summary_large_image">
<meta name="twitter:title" content="${title}">
<meta name="twitter:description" content="${desc}">
<meta name="twitter:image" content="${img}">
<meta http-equiv="refresh" content="0;url=${destAttr}">
<style>
  body{margin:0;font-family:'Noto Sans JP',system-ui,-apple-system,sans-serif;background:#0e1a33;color:#fff;display:flex;min-height:100vh;align-items:center;justify-content:center;text-align:center;padding:24px;box-sizing:border-box}
  .c{max-width:640px;width:100%}
  img{max-width:100%;height:auto;border-radius:14px;box-shadow:0 24px 60px rgba(0,0,0,.45)}
  .b{display:inline-block;margin-top:22px;background:#FFC400;color:#14224A;font-weight:700;font-size:16px;padding:14px 28px;border-radius:12px;text-decoration:none}
  .s{margin-top:14px;font-size:12px;color:rgba(255,255,255,.6)}
</style>
</head>
<body>
<div class="c">
<a href="${destAttr}"><img src="${img}" alt="${title}"></a>
<div><a class="b" href="${destAttr}">無料で案件を探す →</a></div>
<div class="s">まもなく移動します…</div>
</div>
<script>location.replace(${destJson});</script>
</body>
</html>`;

  return new Response(html, {
    status: 200,
    headers: {
      "content-type": "text/html; charset=utf-8",
      "cache-control": "public, max-age=300",
    },
  });
}
