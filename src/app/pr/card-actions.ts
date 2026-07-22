"use server";

import { randomUUID } from "node:crypto";
import { engerAdmin } from "@/lib/supabase";
import { currentAccess } from "@/lib/accounts";
import { revalidateTag } from "next/cache";

// Canvaなどで作ったカード画像をアップロードし、OGP共有URL(dx.enger.jp/x/<token>)を発行する。
//   画像は公開バケット "pr-cards" に保存（Supabaseダッシュボードで手動作成。supabase/pr-cards.sql 参照）。
//   遷移先はUTM付き。Phase1（X経由登録の計測）と同じ utm を付与する。

const BUCKET = "pr-cards";
const SITE = "https://dx.enger.jp";

// 遷移先（登録導線）。UTMを付けてX経由を計測できるようにする。
// 既定は skill-sheet（人材のスキルシート登録＝Xからの主要導線）。
const TARGETS: Record<string, string> = {
  skillsheet: "https://enger.jp/skill-sheet",
  jobs: "https://enger.jp/jobs",
  signup: "https://enger.jp/signup",
  top: "https://enger.jp",
};

type UploadResult =
  | { ok: true; shareUrl: string; token: string; imageUrl: string }
  | { ok: false; error: string };

export async function uploadPrCard(form: FormData): Promise<UploadResult> {
  // 権限ゲート：admin / agent のみ（/pr 自体もログインゲート内だが多層防御）。
  const access = await currentAccess();
  if (!access || (access.role !== "admin" && access.role !== "agent")) {
    return { ok: false, error: "管理者またはエージェントの権限が必要です。" };
  }

  const file = form.get("image");
  if (!(file instanceof File) || file.size === 0) {
    return { ok: false, error: "カード画像（PNG/JPG）を選択してください。" };
  }
  if (!file.type.startsWith("image/")) {
    return { ok: false, error: "画像ファイル（PNG/JPG）を選択してください。" };
  }
  if (file.size > 8 * 1024 * 1024) {
    return { ok: false, error: "画像は8MBまでにしてください。" };
  }

  const targetKey = String(form.get("target") || "skillsheet");
  const target = TARGETS[targetKey] ?? TARGETS.skillsheet;
  const title =
    String(form.get("title") || "").trim() || "ENGERで、あなたに合う案件が見つかる";
  const description =
    String(form.get("description") || "").trim() ||
    "フリーランスエンジニアのための案件マッチング。単価・リモート条件から、あなたに合う案件をAIがマッチング。登録無料。";

  const token = randomUUID().replace(/-/g, "").slice(0, 12);
  const ext = (file.type.split("/")[1] || "png").replace(/[^a-z0-9]/gi, "") || "png";
  const path = `cards/${token}.${ext}`;

  const admin = engerAdmin();
  const buf = Buffer.from(await file.arrayBuffer());
  const up = await admin.storage
    .from(BUCKET)
    .upload(path, buf, { contentType: file.type, upsert: true });
  if (up.error) {
    return {
      ok: false,
      error: `アップロードに失敗しました。Storageに公開バケット "${BUCKET}" を作成してください（${up.error.message}）。`,
    };
  }
  const imageUrl = admin.storage.from(BUCKET).getPublicUrl(path).data.publicUrl;

  const redirectUrl = `${target}?utm_source=x&utm_medium=social&utm_campaign=card&utm_content=${token}`;
  const operator = access.name || access.email || null;

  const ins = await admin.from("pr_cards").insert({
    token,
    image_url: imageUrl,
    image_path: path,
    title,
    description,
    redirect_url: redirectUrl,
    operator,
    created_by_email: access.email ?? null,
  });
  if (ins.error) {
    return {
      ok: false,
      error: `保存に失敗しました。マイグレーション supabase/pr-cards.sql を適用してください（${ins.error.message}）。`,
    };
  }

  revalidateTag("dashboard", "max");
  return { ok: true, shareUrl: `${SITE}/x/${token}`, token, imageUrl };
}
