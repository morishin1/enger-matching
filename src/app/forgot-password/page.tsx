"use client";

import Link from "@/components/AppLink";
import { useActionState } from "react";
import { requestPasswordReset, type ResetState } from "../login/actions";

const input = { padding: "13px 14px", border: "1.5px solid #cbd5e1", borderRadius: 10, fontSize: 15, fontFamily: "inherit", background: "#fff", outline: "none", width: "100%", color: "#0F2440" } as const;

export default function ForgotPasswordPage() {
  const [state, action, pending] = useActionState<ResetState, FormData>(requestPasswordReset, null);

  return (
    <div style={{ position: "relative", minHeight: "100vh", overflow: "hidden", display: "grid", placeItems: "center", padding: 24 }}>
      <div aria-hidden style={{ position: "absolute", inset: 0, backgroundImage: "url('/15.png')", backgroundSize: "cover", backgroundPosition: "center" }} />
      <div aria-hidden style={{ position: "absolute", inset: 0, background: "linear-gradient(115deg, rgba(5,16,38,.92) 0%, rgba(9,28,56,.8) 50%, rgba(0,73,120,.45) 100%)" }} />
      <div style={{ position: "relative", width: "100%", maxWidth: 400 }}>
        <form action={action} style={{ background: "rgba(255,255,255,.97)", borderRadius: 18, padding: 30, display: "flex", flexDirection: "column", gap: 13, boxShadow: "0 24px 70px rgba(0,0,0,.35)" }}>
          <div>
            <h2 style={{ margin: 0, fontSize: 19, fontWeight: 800, color: "#0F2440" }}>パスワードの再設定</h2>
            <p style={{ margin: "4px 0 0", fontSize: 12.5, color: "#6b7280", lineHeight: 1.7 }}>ご登録のメールアドレスに、パスワード再設定用のリンクをお送りします。</p>
          </div>

          {state?.ok ? (
            <div style={{ fontSize: 13, color: "#067647", background: "#ecfdf3", border: "1px solid #abefc6", borderRadius: 8, padding: "11px 13px", lineHeight: 1.7 }}>
              入力されたメールアドレスが登録されている場合、再設定リンクを送信しました。メール内のリンクから新しいパスワードを設定してください。<br />（届かない場合は迷惑メールフォルダもご確認ください）
            </div>
          ) : (
            <>
              <label style={{ display: "flex", flexDirection: "column", gap: 6, fontSize: 12.5, color: "#475569", fontWeight: 600 }}>メールアドレス
                <input name="email" type="email" required autoComplete="username" placeholder="you@example.com" style={input} />
              </label>
              {state?.error && <div style={{ fontSize: 12.5, color: "#d23f57", background: "#fdecef", border: "1px solid #f6c9d2", borderRadius: 8, padding: "9px 11px" }}>{state.error}</div>}
              <button type="submit" disabled={pending} style={{ background: "linear-gradient(135deg, #0095D9, #007DB3)", color: "#fff", border: 0, borderRadius: 10, padding: "13px", fontSize: 14.5, fontWeight: 700, cursor: pending ? "not-allowed" : "pointer", opacity: pending ? 0.6 : 1 }}>{pending ? "送信中…" : "再設定リンクを送る"}</button>
            </>
          )}

          <div style={{ textAlign: "center", marginTop: 4 }}>
            <Link href="/login" style={{ color: "#0095D9", fontSize: 12.5, fontWeight: 600, textDecoration: "none" }}>← ログインに戻る</Link>
          </div>
        </form>
      </div>
    </div>
  );
}
