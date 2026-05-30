"use client";

import { useActionState, useState } from "react";
import { signUp, type SignupState } from "./actions";

export default function SignupPage() {
  const [state, action, pending] = useActionState<SignupState, FormData>(signUp, null);
  const [role, setRole] = useState<"client" | "agent" | "candidate">("client");

  const input = { padding: "12px 14px", border: "1px solid #d6dce5", borderRadius: 10, fontSize: 14, fontFamily: "inherit", background: "#fff", outline: "none", width: "100%" } as const;
  const roleBtn = (active: boolean) => ({ flex: 1, padding: "10px", borderRadius: 10, border: active ? "1.5px solid #0095D9" : "1px solid #d6dce5", background: active ? "#eaf6fd" : "#fff", color: active ? "#0F2440" : "#6b7280", fontSize: 12.5, fontWeight: 700, cursor: "pointer" } as const);

  return (
    <div style={{ position: "relative", minHeight: "100vh", overflow: "hidden" }}>
      <div aria-hidden style={{ position: "absolute", inset: 0, backgroundImage: "url('/15.png')", backgroundSize: "cover", backgroundPosition: "center" }} />
      <div aria-hidden style={{ position: "absolute", inset: 0, background: "linear-gradient(115deg, rgba(5,16,38,.90) 0%, rgba(9,28,56,.78) 44%, rgba(0,73,120,.45) 82%, rgba(0,149,217,.22) 100%)" }} />

      <div style={{ position: "relative", minHeight: "100vh", display: "grid", placeItems: "center", padding: 24 }}>
        <div style={{ width: "100%", maxWidth: 420 }}>
          <div style={{ display: "flex", alignItems: "center", justifyContent: "center", gap: 9, marginBottom: 16 }}>
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img src="/enger-logo.png" alt="ENGER" style={{ height: 30, width: "auto", filter: "brightness(0) invert(1)" }} />
            <span style={{ fontFamily: "var(--font-display, sans-serif)", fontWeight: 800, fontSize: 20, letterSpacing: ".04em", color: "#38BDF8" }}>business</span>
          </div>

          {state?.ok ? (
            <div style={{ background: "rgba(255,255,255,.97)", borderRadius: 18, padding: 30, boxShadow: "0 24px 70px rgba(0,0,0,.35)", textAlign: "center" }}>
              <div style={{ fontSize: 40, marginBottom: 8 }}>📨</div>
              <h2 style={{ margin: "0 0 8px", fontSize: 18, fontWeight: 800, color: "#0F2440" }}>登録を受け付けました</h2>
              <p style={{ fontSize: 13, color: "#4b5563", lineHeight: 1.8 }}>管理者の承認後にログインできるようになります。<br />承認まで今しばらくお待ちください。</p>
              <a href="/login" style={{ display: "inline-block", marginTop: 16, color: "#0095D9", fontWeight: 700, fontSize: 13, textDecoration: "none" }}>ログイン画面へ戻る →</a>
            </div>
          ) : (
            <form action={action} style={{ background: "rgba(255,255,255,.97)", borderRadius: 18, padding: 30, display: "flex", flexDirection: "column", gap: 13, boxShadow: "0 24px 70px rgba(0,0,0,.35)", backdropFilter: "blur(6px)" }}>
              <div>
                <h2 style={{ margin: 0, fontSize: 19, fontWeight: 800, color: "#0F2440" }}>新規登録</h2>
                <p style={{ margin: "4px 0 0", fontSize: 12, color: "#6b7280" }}>登録後、管理者の承認をもってご利用いただけます。</p>
              </div>

              <div style={{ display: "flex", flexDirection: "column", gap: 5, fontSize: 12, color: "#6b7280" }}>ご利用区分
                <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
                  <button type="button" onClick={() => setRole("client")} style={roleBtn(role === "client")}>エンジニアを採用したい企業</button>
                  <button type="button" onClick={() => setRole("candidate")} style={roleBtn(role === "candidate")}>エンジニア・人材</button>
                  <button type="button" onClick={() => setRole("agent")} style={roleBtn(role === "agent")}>営業・エージェント</button>
                </div>
              </div>
              <input type="hidden" name="role" value={role} />

              <label style={{ display: "flex", flexDirection: "column", gap: 5, fontSize: 12, color: "#6b7280" }}>お名前（ご担当者名）
                <input name="name" type="text" required placeholder="山田 太郎" style={input} />
              </label>
              {role === "client" && (
                <label style={{ display: "flex", flexDirection: "column", gap: 5, fontSize: 12, color: "#6b7280" }}>会社名
                  <input name="company" type="text" required placeholder="株式会社〇〇" style={input} />
                </label>
              )}
              <label style={{ display: "flex", flexDirection: "column", gap: 5, fontSize: 12, color: "#6b7280" }}>メールアドレス
                <input name="email" type="email" required autoComplete="email" placeholder="you@example.com" style={input} />
              </label>
              <label style={{ display: "flex", flexDirection: "column", gap: 5, fontSize: 12, color: "#6b7280" }}>パスワード（8文字以上）
                <input name="password" type="password" required minLength={8} autoComplete="new-password" placeholder="••••••••" style={input} />
              </label>

              <label style={{ display: "flex", gap: 8, alignItems: "flex-start", fontSize: 12, color: "#4b5563", lineHeight: 1.7, cursor: "pointer" }}>
                <input type="checkbox" name="agree" required style={{ marginTop: 2, width: 16, height: 16, accentColor: "#0095D9", flex: "0 0 16px" }} />
                <span>
                  <a href="https://enger.jp/terms" target="_blank" rel="noreferrer" style={{ color: "#0095D9", fontWeight: 600 }}>利用規約</a>・
                  <a href="https://enger.jp/privacy" target="_blank" rel="noreferrer" style={{ color: "#0095D9", fontWeight: 600 }}>プライバシーポリシー</a>に同意します。
                </span>
              </label>

              {state?.error && <div style={{ fontSize: 12.5, color: "#d23f57", background: "#fdecef", border: "1px solid #f6c9d2", borderRadius: 8, padding: "9px 11px" }}>{state.error}</div>}
              <button type="submit" disabled={pending} style={{ background: "linear-gradient(135deg, #0095D9, #007DB3)", color: "#fff", border: 0, borderRadius: 10, padding: "13px", fontSize: 14.5, fontWeight: 700, cursor: "pointer", opacity: pending ? 0.6 : 1, boxShadow: "0 6px 16px rgba(0,149,217,.3)" }}>{pending ? "登録中…" : "登録する →"}</button>
            </form>
          )}
          <div style={{ textAlign: "center", fontSize: 12, color: "rgba(255,255,255,.8)", marginTop: 14 }}>すでにアカウントをお持ちの方は <a href="/login" style={{ color: "#7dd3fc", fontWeight: 700, textDecoration: "none" }}>ログイン</a></div>
        </div>
      </div>
    </div>
  );
}
