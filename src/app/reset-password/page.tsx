"use client";

import Link from "@/components/AppLink";
import { useActionState } from "react";
import { updatePassword, type ResetState } from "../login/actions";

const input = { padding: "13px 14px", border: "1.5px solid #cbd5e1", borderRadius: 10, fontSize: 15, fontFamily: "inherit", background: "#fff", outline: "none", width: "100%", color: "#0F2440" } as const;

export default function ResetPasswordPage() {
  const [state, action, pending] = useActionState<ResetState, FormData>(updatePassword, null);

  return (
    <div style={{ position: "relative", minHeight: "100vh", overflow: "hidden", display: "grid", placeItems: "center", padding: 24 }}>
      <div aria-hidden style={{ position: "absolute", inset: 0, backgroundImage: "url('/15.png')", backgroundSize: "cover", backgroundPosition: "center" }} />
      <div aria-hidden style={{ position: "absolute", inset: 0, background: "linear-gradient(115deg, rgba(5,16,38,.92) 0%, rgba(9,28,56,.8) 50%, rgba(0,73,120,.45) 100%)" }} />
      <div style={{ position: "relative", width: "100%", maxWidth: 400 }}>
        <form action={action} style={{ background: "rgba(255,255,255,.97)", borderRadius: 18, padding: 30, display: "flex", flexDirection: "column", gap: 13, boxShadow: "0 24px 70px rgba(0,0,0,.35)" }}>
          <div>
            <h2 style={{ margin: 0, fontSize: 19, fontWeight: 800, color: "#0F2440" }}>新しいパスワードの設定</h2>
            <p style={{ margin: "4px 0 0", fontSize: 12.5, color: "#6b7280", lineHeight: 1.7 }}>新しいパスワード（8文字以上）を入力してください。</p>
          </div>

          {state?.ok ? (
            <>
              <div style={{ fontSize: 13, color: "#067647", background: "#ecfdf3", border: "1px solid #abefc6", borderRadius: 8, padding: "11px 13px", lineHeight: 1.7 }}>
                パスワードを更新しました。新しいパスワードでログインしてください。
              </div>
              <Link href="/login" style={{ textAlign: "center", background: "linear-gradient(135deg, #0095D9, #007DB3)", color: "#fff", borderRadius: 10, padding: "13px", fontSize: 14.5, fontWeight: 700, textDecoration: "none" }}>ログインへ →</Link>
            </>
          ) : (
            <>
              <label style={{ display: "flex", flexDirection: "column", gap: 6, fontSize: 12.5, color: "#475569", fontWeight: 600 }}>新しいパスワード
                <input name="password" type="password" required autoComplete="new-password" placeholder="8文字以上" style={input} />
              </label>
              <label style={{ display: "flex", flexDirection: "column", gap: 6, fontSize: 12.5, color: "#475569", fontWeight: 600 }}>新しいパスワード（確認）
                <input name="password2" type="password" required autoComplete="new-password" placeholder="もう一度入力" style={input} />
              </label>
              {state?.error && <div style={{ fontSize: 12.5, color: "#d23f57", background: "#fdecef", border: "1px solid #f6c9d2", borderRadius: 8, padding: "9px 11px", lineHeight: 1.6 }}>{state.error}</div>}
              <button type="submit" disabled={pending} style={{ background: "linear-gradient(135deg, #0095D9, #007DB3)", color: "#fff", border: 0, borderRadius: 10, padding: "13px", fontSize: 14.5, fontWeight: 700, cursor: pending ? "not-allowed" : "pointer", opacity: pending ? 0.6 : 1 }}>{pending ? "更新中…" : "パスワードを更新"}</button>
              <div style={{ textAlign: "center", marginTop: 4 }}>
                <Link href="/forgot-password" style={{ color: "#0095D9", fontSize: 12.5, fontWeight: 600, textDecoration: "none" }}>リンクが切れた場合は再送する</Link>
              </div>
            </>
          )}
        </form>
      </div>
    </div>
  );
}
