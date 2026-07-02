"use server";

// 外部共有リンクのサーバアクション。
//   createShareLink   … 発行（admin/agent のみ）。同一対象の有効リンクがあれば再利用してURLを安定させる。
//   verifySharePasscode … 公開ページのパスコード検証（Cookie を発行して再表示）。
import { randomBytes, randomInt } from "crypto";
import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import { currentAccess, resolveAccess } from "@/lib/accounts";
import { engerAdmin } from "@/lib/supabase";
import { SHARE_EXPIRE_DAYS, SHARE_MAX_PASSCODE_ATTEMPTS, isValidShareToken, shareCookieName, shareCookieValue, shareUrl } from "@/lib/share";

export async function createShareLink(
  kind: "job" | "candidate",
  no: number,
  opts?: { passcode?: boolean },
): Promise<{ ok: boolean; url?: string; passcode?: string | null; expiresAt?: string | null; response?: string | null; respondedAt?: string | null; error?: string }> {
  const access = await currentAccess();
  if (!access || (access.role !== "admin" && access.role !== "agent")) {
    return { ok: false, error: "権限がありません（管理者またはエージェントのみ）" };
  }
  if (kind !== "job" && kind !== "candidate") return { ok: false, error: "対象種別が不正です" };
  if (!Number.isFinite(no)) return { ok: false, error: "対象番号が不正です" };
  let admin: ReturnType<typeof engerAdmin>;
  try { admin = engerAdmin(); } catch { return { ok: false, error: "サーバ設定エラー：SUPABASE_SERVICE_ROLE_KEY が未設定です" }; }

  const usePass = opts?.passcode !== false;

  // 同じ対象・同じパスコード設定の有効リンクがあれば再利用（先方へ案内済みURLが無効にならないように）。
  //   ※ パスコード失敗上限に達してロックされたリンクは再利用しない（再発行の依頼に応えられるように）。
  try {
    let q: any = admin.from("share_links")
      .select("token, passcode, expires_at, passcode_attempts, response, responded_at")
      .eq("kind", kind)
      .is("revoked_at", null)
      .gt("expires_at", new Date().toISOString());
    q = kind === "job" ? q.eq("job_no", no) : q.eq("candidate_no", no);
    const r = await q.order("created_at", { ascending: false }).limit(5);
    if (!r.error) {
      const hit = (r.data ?? []).find((x: any) =>
        (usePass ? !!x.passcode : !x.passcode) && (x.passcode_attempts ?? 0) < SHARE_MAX_PASSCODE_ATTEMPTS);
      if (hit) {
        return {
          ok: true, url: shareUrl(hit.token), passcode: hit.passcode ?? null, expiresAt: hit.expires_at ?? null,
          response: hit.response ?? null, respondedAt: hit.responded_at ?? null,
        };
      }
    }
  } catch { /* テーブル未作成などは新規発行の insert 側でエラーメッセージを出す */ }

  const token = randomBytes(18).toString("base64url"); // 24文字・推測不可
  const passcode = usePass ? String(randomInt(0, 1000000)).padStart(6, "0") : null;
  const expiresAt = new Date(Date.now() + SHARE_EXPIRE_DAYS * 86400000).toISOString();
  const ins = await admin.from("share_links").insert({
    token,
    kind,
    job_no: kind === "job" ? no : null,
    candidate_no: kind === "candidate" ? no : null,
    passcode,
    created_by_email: access.email ?? null,
    expires_at: expiresAt,
  });
  if (ins.error) {
    const msg = String(ins.error.message ?? "");
    return {
      ok: false,
      error: /share_links|schema cache|does not exist/i.test(msg)
        ? "共有リンクの台帳が未作成です（supabase/share-links.sql を実行してください）"
        : msg,
    };
  }
  return { ok: true, url: shareUrl(token), passcode, expiresAt };
}

/** 公開ページのパスコード検証（<form action> から呼ぶ）。成功で Cookie を置いて再表示。
 *  連続失敗は passcode_attempts に記録し、上限（SHARE_MAX_PASSCODE_ATTEMPTS）超過でリンクごと無効化（総当たり対策）。 */
export async function verifySharePasscode(formData: FormData): Promise<void> {
  const token = String(formData.get("token") ?? "").trim();
  const passcode = String(formData.get("passcode") ?? "").trim();
  if (!isValidShareToken(token)) redirect("/login");

  let ok = false;
  let expiresAt: string | null = null;
  try {
    const admin = engerAdmin();
    let r: any = await admin.from("share_links").select("id, passcode, expires_at, revoked_at, passcode_attempts").eq("token", token).maybeSingle();
    if (r.error) r = await admin.from("share_links").select("id, passcode, expires_at, revoked_at").eq("token", token).maybeSingle();
    const link: any = r.data;
    const alive = link && !link.revoked_at && (!link.expires_at || new Date(link.expires_at).getTime() > Date.now());
    const locked = !!link && (link.passcode_attempts ?? 0) >= SHARE_MAX_PASSCODE_ATTEMPTS;
    if (alive && !locked && link.passcode && passcode && passcode === link.passcode) {
      ok = true;
      expiresAt = link.expires_at ?? null;
      // 成功したら失敗カウントをリセット（正規の閲覧者の打ち間違いを引きずらない）。
      if ((link.passcode_attempts ?? 0) > 0) {
        try { await admin.from("share_links").update({ passcode_attempts: 0 }).eq("id", link.id); } catch { /* 列未整備は無視 */ }
      }
    } else if (alive && !locked && link?.passcode) {
      // 失敗：カウントを進める。並行リクエストで加算が飛ばないよう RPC のアトミック加算を優先し、
      //   関数未作成の環境では読み書き加算にフォールバック（列が無い環境では黙ってスキップ）。
      try {
        const rpc = await admin.rpc("share_passcode_fail", { p_token: token });
        if (rpc.error) await admin.from("share_links").update({ passcode_attempts: (link.passcode_attempts ?? 0) + 1 }).eq("id", link.id);
      } catch { /* noop */ }
    }
  } catch { /* noop → 失敗扱い */ }

  if (ok) {
    const store = await cookies();
    const maxAge = expiresAt
      ? Math.max(60, Math.floor((new Date(expiresAt).getTime() - Date.now()) / 1000))
      : SHARE_EXPIRE_DAYS * 86400;
    store.set(shareCookieName(token), shareCookieValue(token, passcode), {
      httpOnly: true,
      sameSite: "lax",
      secure: process.env.NODE_ENV === "production",
      path: "/share",
      maxAge,
    });
    redirect(`/share/${token}`);
  }
  redirect(`/share/${token}?err=1`);
}

/** 公開ページの「興味あります / 見送り」回答（メール版「話を進める/見送り」のWEB版）。
 *  回答を share_links に記録し、発行者のお知らせ（ベル）へ通知する。再回答（変更）も可。 */
export async function recordShareResponse(formData: FormData): Promise<void> {
  const token = String(formData.get("token") ?? "").trim();
  const choice = String(formData.get("choice") ?? "");
  if (!isValidShareToken(token)) redirect("/login");
  const label = choice === "interested" ? "興味あり" : choice === "declined" ? "見送り" : null;
  if (!label) redirect(`/share/${token}`);

  let recorded = false;
  try {
    const admin = engerAdmin();
    const r: any = await admin.from("share_links")
      .select("id, kind, job_no, candidate_no, passcode, expires_at, revoked_at, created_by_email, response")
      .eq("token", token).maybeSingle();
    const link: any = r.data;
    const alive = link && !link.revoked_at && (!link.expires_at || new Date(link.expires_at).getTime() > Date.now());
    // パスコード付きリンクは、パスコード通過済み（Cookie 検証OK）でなければ回答も受け付けない。
    let authed = !!alive;
    if (alive && link.passcode) {
      const store = await cookies();
      authed = store.get(shareCookieName(token))?.value === shareCookieValue(token, link.passcode);
    }
    if (alive && authed) {
      const upd = await admin.from("share_links")
        .update({ response: label, responded_at: new Date().toISOString() })
        .eq("id", link.id);
      recorded = !upd.error;
      // 発行者への通知（お知らせ/ベル）。名前が引けないときは全員宛て。失敗しても回答自体は成立させる。
      if (recorded && link.response !== label) {
        try {
          let recipient = "all";
          if (link.created_by_email) {
            const acc = await resolveAccess(String(link.created_by_email).toLowerCase());
            if (acc?.name) recipient = acc.name;
          }
          const target = link.kind === "job"
            ? `案件 No.${String(link.job_no ?? "—").padStart(5, "0")}`
            : `人材 P-${String(link.candidate_no ?? "—").padStart(5, "0")}`;
          await admin.from("notifications").insert({
            recipient,
            kind: "info",
            title: `外部共有ページで「${label}」の回答がありました`,
            body: `${target} の外部共有ページで、先方が「${label}」を選択しました。進捗の連絡・フォローをお願いします。`,
          });
        } catch { /* 通知失敗は無視（回答の記録を優先） */ }
      }
    }
  } catch { /* noop */ }
  redirect(`/share/${token}${recorded ? "?done=1" : ""}`);
}
