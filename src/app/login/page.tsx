"use client";

import { use, useActionState } from "react";
import { signIn, type LoginState } from "./actions";

const FEATURES = [
  { icon: "🎯", t: "AIマッチング", d: "案件×人材をスコアリングしてランキング表示" },
  { icon: "📨", t: "提案・稼働管理", d: "提案ボード→稼働まで一気通貫で管理" },
  { icon: "📝", t: "打合せAI分析", d: "文字起こしから温度感・次アクションを自動抽出" },
];

export default function LoginPage({ searchParams }: { searchParams: Promise<{ redirect?: string }> }) {
  const { redirect = "/" } = use(searchParams);
  const [state, action, pending] = useActionState<LoginState, FormData>(signIn, null);

  const input = {
    padding: "12px 14px", border: "1px solid #d6dce5", borderRadius: 10, fontSize: 14, fontFamily: "inherit",
    background: "#fff", outline: "none", width: "100%",
  } as const;

  return (
    <div style={{ minHeight: "100vh", display: "grid", gridTemplateColumns: "minmax(0, 1.1fr) minmax(0, 0.9fr)" }} className="login-shell">
      {/* 左：ブランドパネル */}
      <aside style={{
        position: "relative", overflow: "hidden", color: "#fff", padding: "56px 56px 40px",
        display: "flex", flexDirection: "column", justifyContent: "space-between",
        background: "radial-gradient(1200px 500px at 10% -10%, #1E3A5F 0%, transparent 60%), linear-gradient(135deg, #07142b 0%, #0F2440 55%, #00597B 130%)",
      }} className="login-brand">
        {/* 装飾 */}
        <div aria-hidden style={{ position: "absolute", top: -120, right: -80, width: 360, height: 360, borderRadius: "50%", background: "radial-gradient(circle, rgba(56,189,248,.25), transparent 70%)" }} />
        <div aria-hidden style={{ position: "absolute", bottom: -100, left: -60, width: 300, height: 300, borderRadius: "50%", background: "radial-gradient(circle, rgba(0,149,217,.18), transparent 70%)" }} />

        <div style={{ position: "relative" }}>
          <div style={{ display: "inline-flex", alignItems: "center", gap: 10 }}>
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img src="/enger-logo.png" alt="ENGER" style={{ height: 30, width: "auto", filter: "brightness(0) invert(1)" }} />
            <span style={{ fontFamily: "var(--font-display, sans-serif)", fontWeight: 800, fontSize: 20, letterSpacing: ".06em", color: "#38BDF8" }}>DX</span>
          </div>
          <h1 style={{ fontSize: 34, fontWeight: 800, lineHeight: 1.35, margin: "44px 0 14px", letterSpacing: ".01em" }}>
            マッチング業務を、<br />ひとつの画面で。
          </h1>
          <p style={{ fontSize: 14, lineHeight: 1.9, color: "rgba(255,255,255,.7)", maxWidth: 380 }}>
            案件・人材・提案・稼働・企業・打合せ記録を横断管理する、エンジャー事務局の業務システム。
          </p>
        </div>

        <div style={{ position: "relative", display: "flex", flexDirection: "column", gap: 16, margin: "40px 0" }}>
          {FEATURES.map((f) => (
            <div key={f.t} style={{ display: "flex", gap: 12, alignItems: "flex-start" }}>
              <span style={{ fontSize: 18, width: 34, height: 34, borderRadius: 10, background: "rgba(255,255,255,.08)", display: "grid", placeItems: "center", flex: "0 0 34px" }}>{f.icon}</span>
              <div>
                <div style={{ fontSize: 13.5, fontWeight: 700 }}>{f.t}</div>
                <div style={{ fontSize: 12, color: "rgba(255,255,255,.6)", marginTop: 2 }}>{f.d}</div>
              </div>
            </div>
          ))}
        </div>

        <div style={{ position: "relative", fontSize: 11, color: "rgba(255,255,255,.45)" }}>© 2026 株式会社エイト · ENGER DX</div>
      </aside>

      {/* 右：ログインフォーム */}
      <main style={{ display: "grid", placeItems: "center", background: "#f5f7fa", padding: 24 }}>
        <div style={{ width: "100%", maxWidth: 360 }}>
          <div className="login-mobile-brand" style={{ display: "none", textAlign: "center", marginBottom: 18 }}>
            <span style={{ fontFamily: "var(--font-display, sans-serif)", fontWeight: 800, fontSize: 24, color: "#0F2440" }}>ENGER <span style={{ color: "#0095D9" }}>DX</span></span>
          </div>
          <form action={action} style={{ background: "#fff", border: "1px solid #e5e9f0", borderRadius: 16, padding: 28, display: "flex", flexDirection: "column", gap: 14, boxShadow: "0 18px 50px rgba(15,36,64,.08)" }}>
            <div>
              <h2 style={{ margin: 0, fontSize: 18, fontWeight: 800, color: "#0F2440" }}>ログイン</h2>
              <p style={{ margin: "4px 0 0", fontSize: 12, color: "#6b7280" }}>エンジャー事務局の関係者専用です。</p>
            </div>
            <input type="hidden" name="redirect" value={redirect} />
            <label style={{ display: "flex", flexDirection: "column", gap: 5, fontSize: 12, color: "#6b7280" }}>
              メールアドレス
              <input name="email" type="email" required autoComplete="username" autoFocus placeholder="you@example.com" style={input} />
            </label>
            <label style={{ display: "flex", flexDirection: "column", gap: 5, fontSize: 12, color: "#6b7280" }}>
              パスワード
              <input name="password" type="password" required autoComplete="current-password" placeholder="••••••••" style={input} />
            </label>
            {state?.error && <div style={{ fontSize: 12.5, color: "#d23f57", background: "#fdecef", border: "1px solid #f6c9d2", borderRadius: 8, padding: "9px 11px" }}>{state.error}</div>}
            <button type="submit" disabled={pending} style={{ background: "linear-gradient(135deg, #0095D9, #007DB3)", color: "#fff", border: 0, borderRadius: 10, padding: "13px", fontSize: 14.5, fontWeight: 700, cursor: "pointer", opacity: pending ? 0.6 : 1, boxShadow: "0 6px 16px rgba(0,149,217,.3)" }}>
              {pending ? "ログイン中…" : "ログイン →"}
            </button>
          </form>
          <div style={{ textAlign: "center", fontSize: 11, color: "#9aa7b4", marginTop: 14 }}>アカウントは管理者が発行します</div>
        </div>
      </main>
    </div>
  );
}
