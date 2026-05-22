"use client";

import { use, useActionState } from "react";
import { signIn, type LoginState } from "./actions";

const FEATURES = [
  { icon: "target", t: "AIマッチング", d: "案件×人材をスコアリングしてランキング" },
  { icon: "forward_to_inbox", t: "提案・稼働管理", d: "提案ボードから稼働まで一気通貫" },
  { icon: "graphic_eq", t: "打合せAI分析", d: "文字起こしから温度感を自動抽出" },
];

export default function LoginPage({ searchParams }: { searchParams: Promise<{ redirect?: string; err?: string }> }) {
  const { redirect = "/", err } = use(searchParams);
  const [state, action, pending] = useActionState<LoginState, FormData>(signIn, null);
  const error = state?.error || err;

  const input = { padding: "12px 14px", border: "1px solid #d6dce5", borderRadius: 10, fontSize: 14, fontFamily: "inherit", background: "#fff", outline: "none", width: "100%" } as const;

  return (
    <div style={{ position: "relative", minHeight: "100vh", overflow: "hidden" }}>
      {/* 背景画像 + グラデーション */}
      <div aria-hidden style={{ position: "absolute", inset: 0, backgroundImage: "url('/15.png')", backgroundSize: "cover", backgroundPosition: "center" }} />
      <div aria-hidden style={{ position: "absolute", inset: 0, background: "linear-gradient(115deg, rgba(5,16,38,.90) 0%, rgba(9,28,56,.78) 44%, rgba(0,73,120,.45) 82%, rgba(0,149,217,.22) 100%)" }} />

      {/* コンテンツ（画像の上） */}
      <div style={{ position: "relative", minHeight: "100vh", display: "grid", gridTemplateColumns: "minmax(0, 1fr) minmax(0, 460px)" }} className="login-shell">
        {/* 左：ブランドコピー（画像の上） */}
        <section className="login-brand" style={{ display: "flex", flexDirection: "column", justifyContent: "center", padding: "56px 64px", color: "#fff" }}>
          <div style={{ display: "inline-flex", alignItems: "center", gap: 10 }}>
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img src="/enger-logo.png" alt="ENGER" style={{ height: 32, width: "auto", filter: "brightness(0) invert(1)" }} />
            <span style={{ fontFamily: "var(--font-display, sans-serif)", fontWeight: 800, fontSize: 22, letterSpacing: ".06em", color: "#38BDF8" }}>DX</span>
          </div>
          <h1 style={{ fontSize: 40, fontWeight: 800, lineHeight: 1.3, margin: "36px 0 16px", letterSpacing: ".01em" }}>マッチング業務を、<br />ひとつの画面で。</h1>
          <p style={{ fontSize: 14.5, lineHeight: 1.9, color: "rgba(255,255,255,.78)", maxWidth: 420 }}>案件・人材・提案・稼働・企業・打合せ記録を横断管理する、エンジャー事務局の業務システム。</p>
          <div style={{ display: "flex", flexDirection: "column", gap: 14, marginTop: 36 }}>
            {FEATURES.map((f) => (
              <div key={f.t} style={{ display: "flex", gap: 12, alignItems: "flex-start" }}>
                <span className="material-symbols-outlined" style={{ fontSize: 20, width: 34, height: 34, borderRadius: 10, background: "rgba(255,255,255,.12)", backdropFilter: "blur(4px)", display: "grid", placeItems: "center", flex: "0 0 34px", color: "#7dd3fc" }}>{f.icon}</span>
                <div><div style={{ fontSize: 13.5, fontWeight: 700 }}>{f.t}</div><div style={{ fontSize: 12, color: "rgba(255,255,255,.65)", marginTop: 2 }}>{f.d}</div></div>
              </div>
            ))}
          </div>
        </section>

        {/* 右：ログインカード */}
        <section style={{ display: "grid", placeItems: "center", padding: 24 }}>
          <div style={{ width: "100%", maxWidth: 380 }}>
            <div className="login-mobile-brand" style={{ display: "none", textAlign: "center", marginBottom: 16 }}>
              <span style={{ fontFamily: "var(--font-display, sans-serif)", fontWeight: 800, fontSize: 24, color: "#fff" }}>ENGER <span style={{ color: "#38BDF8" }}>DX</span></span>
            </div>
            <form action={action} style={{ background: "rgba(255,255,255,.97)", borderRadius: 18, padding: 30, display: "flex", flexDirection: "column", gap: 13, boxShadow: "0 24px 70px rgba(0,0,0,.35)", backdropFilter: "blur(6px)" }}>
              <div>
                <h2 style={{ margin: 0, fontSize: 19, fontWeight: 800, color: "#0F2440" }}>ログイン</h2>
                <p style={{ margin: "4px 0 0", fontSize: 12, color: "#6b7280" }}>エンジャー事務局の関係者専用です。</p>
              </div>

              {/* Google ログイン */}
              <a href="/api/auth/google" style={{ display: "flex", alignItems: "center", justifyContent: "center", gap: 10, padding: "11px", border: "1px solid #d6dce5", borderRadius: 10, background: "#fff", color: "#3c4043", fontSize: 14, fontWeight: 600, textDecoration: "none" }}>
                <svg width="18" height="18" viewBox="0 0 48 48"><path fill="#EA4335" d="M24 9.5c3.54 0 6.71 1.22 9.21 3.6l6.85-6.85C35.9 2.38 30.47 0 24 0 14.62 0 6.51 5.38 2.56 13.22l7.98 6.19C12.43 13.72 17.74 9.5 24 9.5z"/><path fill="#4285F4" d="M46.98 24.55c0-1.57-.15-3.09-.38-4.55H24v9.02h12.94c-.58 2.96-2.26 5.48-4.78 7.18l7.73 6c4.51-4.18 7.09-10.36 7.09-17.65z"/><path fill="#FBBC05" d="M10.53 28.59c-.48-1.45-.76-2.99-.76-4.59s.27-3.14.76-4.59l-7.98-6.19C.92 16.46 0 20.12 0 24c0 3.88.92 7.54 2.56 10.78l7.97-6.19z"/><path fill="#34A853" d="M24 48c6.48 0 11.93-2.13 15.89-5.81l-7.73-6c-2.15 1.45-4.92 2.3-8.16 2.3-6.26 0-11.57-4.22-13.47-9.91l-7.98 6.19C6.51 42.62 14.62 48 24 48z"/></svg>
                Google でログイン
              </a>

              <div style={{ display: "flex", alignItems: "center", gap: 10, color: "#9aa7b4", fontSize: 11.5, margin: "2px 0" }}>
                <span style={{ flex: 1, height: 1, background: "#e5e9f0" }} /> または <span style={{ flex: 1, height: 1, background: "#e5e9f0" }} />
              </div>

              <input type="hidden" name="redirect" value={redirect} />
              <label style={{ display: "flex", flexDirection: "column", gap: 5, fontSize: 12, color: "#6b7280" }}>メールアドレス
                <input name="email" type="email" required autoComplete="username" placeholder="you@example.com" style={input} />
              </label>
              <label style={{ display: "flex", flexDirection: "column", gap: 5, fontSize: 12, color: "#6b7280" }}>パスワード
                <input name="password" type="password" required autoComplete="current-password" placeholder="••••••••" style={input} />
              </label>
              {error && <div style={{ fontSize: 12.5, color: "#d23f57", background: "#fdecef", border: "1px solid #f6c9d2", borderRadius: 8, padding: "9px 11px" }}>{error}</div>}
              <button type="submit" disabled={pending} style={{ background: "linear-gradient(135deg, #0095D9, #007DB3)", color: "#fff", border: 0, borderRadius: 10, padding: "13px", fontSize: 14.5, fontWeight: 700, cursor: "pointer", opacity: pending ? 0.6 : 1, boxShadow: "0 6px 16px rgba(0,149,217,.3)" }}>{pending ? "ログイン中…" : "メールでログイン →"}</button>
            </form>
            <div style={{ textAlign: "center", fontSize: 11, color: "rgba(255,255,255,.7)", marginTop: 14 }}>アカウントは管理者が発行します</div>
          </div>
        </section>
      </div>
    </div>
  );
}
