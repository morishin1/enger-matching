"use client";

import { useActionState } from "react";
import { signIn, type LoginState } from "./actions";
import { use } from "react";

export default function LoginPage({ searchParams }: { searchParams: Promise<{ redirect?: string }> }) {
  const { redirect = "/" } = use(searchParams);
  const [state, action, pending] = useActionState<LoginState, FormData>(signIn, null);

  return (
    <div style={{ minHeight: "100vh", display: "grid", placeItems: "center", background: "var(--color-surface-soft, #f5f7fa)", padding: 20 }}>
      <div style={{ width: "100%", maxWidth: 380 }}>
        <div style={{ textAlign: "center", marginBottom: 22 }}>
          <div style={{ fontFamily: "var(--font-display, sans-serif)", fontWeight: 800, fontSize: 26, letterSpacing: ".02em", color: "#0F2440" }}>
            ENGER <span style={{ color: "#0095D9" }}>DX</span>
          </div>
          <div style={{ fontSize: 12.5, color: "#6b7280", marginTop: 4 }}>マッチング業務システム</div>
        </div>

        <form action={action} style={{ background: "#fff", border: "1px solid #e5e9f0", borderRadius: 16, padding: 24, display: "flex", flexDirection: "column", gap: 14, boxShadow: "0 10px 30px rgba(15,36,64,.06)" }}>
          <h1 style={{ margin: 0, fontSize: 16, fontWeight: 700, color: "#0F2440" }}>ログイン</h1>
          <input type="hidden" name="redirect" value={redirect} />
          <label style={{ display: "flex", flexDirection: "column", gap: 5, fontSize: 12.5, color: "#6b7280" }}>
            メールアドレス
            <input name="email" type="email" required autoComplete="username" autoFocus
              style={{ padding: "11px 12px", border: "1px solid #d6dce5", borderRadius: 8, fontSize: 14, fontFamily: "inherit" }} />
          </label>
          <label style={{ display: "flex", flexDirection: "column", gap: 5, fontSize: 12.5, color: "#6b7280" }}>
            パスワード
            <input name="password" type="password" required autoComplete="current-password"
              style={{ padding: "11px 12px", border: "1px solid #d6dce5", borderRadius: 8, fontSize: 14, fontFamily: "inherit" }} />
          </label>
          {state?.error && <div style={{ fontSize: 12.5, color: "#d23f57", background: "#fdecef", border: "1px solid #f6c9d2", borderRadius: 8, padding: "8px 10px" }}>{state.error}</div>}
          <button type="submit" disabled={pending}
            style={{ background: "#0095D9", color: "#fff", border: 0, borderRadius: 8, padding: "12px", fontSize: 14, fontWeight: 700, cursor: "pointer", opacity: pending ? 0.6 : 1 }}>
            {pending ? "ログイン中…" : "ログイン"}
          </button>
        </form>
        <div style={{ textAlign: "center", fontSize: 11, color: "#9aa7b4", marginTop: 14 }}>社内関係者専用 / アカウントは管理者が発行します</div>
      </div>
    </div>
  );
}
