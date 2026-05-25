"use client";

import { use, useActionState, useState } from "react";
import { signIn, type LoginState } from "./actions";

export default function LoginPage({ searchParams }: { searchParams: Promise<{ redirect?: string; err?: string }> }) {
  const { redirect = "/", err } = use(searchParams);
  const [state, action, pending] = useActionState<LoginState, FormData>(signIn, null);
  const [agree, setAgree] = useState(false);
  const [needAgree, setNeedAgree] = useState(false);
  const error = state?.error || err;
  const locked = !agree;

  const input = { padding: "12px 14px", border: "1px solid #cbd5e1", borderRadius: 8, fontSize: 14.5, fontFamily: "inherit", background: "#fff", outline: "none", width: "100%", color: "#0F2440", boxSizing: "border-box" } as const;
  const label = { display: "flex", flexDirection: "column", gap: 6, fontSize: 13, color: "#0F2440", fontWeight: 700 } as const;
  // ピル型・全幅ボタン（Spotify風）
  const pill = { display: "flex", alignItems: "center", justifyContent: "center", gap: 10, width: "100%", padding: "13px 18px", borderRadius: 999, fontSize: 14.5, fontWeight: 700, fontFamily: "inherit", cursor: "pointer", textDecoration: "none", boxSizing: "border-box", transition: "opacity .15s, transform .15s" } as const;

  return (
    <div style={{ position: "relative", minHeight: "100vh", overflow: "auto", display: "grid", placeItems: "center", padding: "40px 20px" }}>
      {/* 背景画像 + グラデーション */}
      <div aria-hidden style={{ position: "fixed", inset: 0, backgroundImage: "url('/15.png')", backgroundSize: "cover", backgroundPosition: "center" }} />
      <div aria-hidden style={{ position: "fixed", inset: 0, background: "linear-gradient(160deg, rgba(5,16,38,.92) 0%, rgba(9,28,56,.86) 55%, rgba(0,73,120,.6) 100%)" }} />

      {/* 中央カード */}
      <div style={{ position: "relative", width: "100%", maxWidth: 420 }}>
        <form action={action} style={{ background: "#fff", borderRadius: 16, padding: "36px clamp(24px, 6vw, 44px)", display: "flex", flexDirection: "column", gap: 16, boxShadow: "0 30px 80px rgba(0,0,0,.45)" }}>
          {/* ロゴ */}
          <div style={{ display: "flex", flexDirection: "column", alignItems: "center", gap: 8, marginBottom: 4 }}>
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img src="/enger-logo.png" alt="ENGER" style={{ height: 34, width: "auto" }} />
            <span style={{ fontSize: 12.5, fontWeight: 700, letterSpacing: ".08em", color: "#0095D9" }}>DX — ログイン</span>
          </div>

          {locked && <div style={{ fontSize: 12, color: "#b45309", background: "#fff7e6", border: "1px solid #f6d9a7", borderRadius: 8, padding: "9px 12px", textAlign: "center" }}>下の利用規約に同意すると、ログインが有効になります。</div>}

          {/* Google で続ける（ピル） */}
          <a
            href="/api/auth/google"
            onClick={(e) => { if (locked) { e.preventDefault(); setNeedAgree(true); } }}
            aria-disabled={locked}
            style={{ ...pill, border: "1.5px solid #d6dce5", background: "#fff", color: "#1f2937", opacity: locked ? 0.5 : 1, cursor: locked ? "not-allowed" : "pointer", pointerEvents: locked ? "none" : "auto" }}
          >
            <svg width="18" height="18" viewBox="0 0 48 48"><path fill="#EA4335" d="M24 9.5c3.54 0 6.71 1.22 9.21 3.6l6.85-6.85C35.9 2.38 30.47 0 24 0 14.62 0 6.51 5.38 2.56 13.22l7.98 6.19C12.43 13.72 17.74 9.5 24 9.5z"/><path fill="#4285F4" d="M46.98 24.55c0-1.57-.15-3.09-.38-4.55H24v9.02h12.94c-.58 2.96-2.26 5.48-4.78 7.18l7.73 6c4.51-4.18 7.09-10.36 7.09-17.65z"/><path fill="#FBBC05" d="M10.53 28.59c-.48-1.45-.76-2.99-.76-4.59s.27-3.14.76-4.59l-7.98-6.19C.92 16.46 0 20.12 0 24c0 3.88.92 7.54 2.56 10.78l7.97-6.19z"/><path fill="#34A853" d="M24 48c6.48 0 11.93-2.13 15.89-5.81l-7.73-6c-2.15 1.45-4.92 2.3-8.16 2.3-6.26 0-11.57-4.22-13.47-9.91l-7.98 6.19C6.51 42.62 14.62 48 24 48z"/></svg>
            Google で続ける
          </a>

          <div style={{ display: "flex", alignItems: "center", gap: 12, color: "#9aa7b4", fontSize: 11, letterSpacing: ".15em", margin: "2px 0" }}>
            <span style={{ flex: 1, height: 1, background: "#e5e9f0" }} /> OR <span style={{ flex: 1, height: 1, background: "#e5e9f0" }} />
          </div>

          {/* メール / パスワード */}
          <input type="hidden" name="redirect" value={redirect} />
          <label style={label}>メールアドレス
            <input name="email" type="email" required autoComplete="username" placeholder="you@example.com" disabled={locked} style={{ ...input, opacity: locked ? 0.55 : 1 }} />
          </label>
          <label style={label}>パスワード
            <input name="password" type="password" required autoComplete="current-password" placeholder="パスワード" disabled={locked} style={{ ...input, opacity: locked ? 0.55 : 1 }} />
          </label>

          <a href="/forgot-password" style={{ color: "#0095D9", fontSize: 13, fontWeight: 600, textDecoration: "none", marginTop: -4 }}>パスワードをお忘れですか？</a>

          {error && <div style={{ fontSize: 12.5, color: "#d23f57", background: "#fdecef", border: "1px solid #f6c9d2", borderRadius: 8, padding: "9px 11px" }}>{error}</div>}

          {/* ログイン（ピル・ブランド色） */}
          <button type="submit" disabled={pending || locked} style={{ ...pill, border: 0, color: "#fff", background: "linear-gradient(135deg, #0095D9, #007DB3)", cursor: (pending || locked) ? "not-allowed" : "pointer", opacity: (pending || locked) ? 0.55 : 1, boxShadow: "0 8px 20px rgba(0,149,217,.32)" }}>{pending ? "ログイン中…" : "ログイン"}</button>

          {/* 同意（必須・下部）。チェックで上のログインが有効化 */}
          <label style={{ display: "flex", gap: 9, alignItems: "flex-start", fontSize: 12, color: "#4b5563", lineHeight: 1.7, cursor: "pointer", marginTop: 2 }}>
            <input type="checkbox" checked={agree} onChange={(e) => { setAgree(e.target.checked); if (e.target.checked) setNeedAgree(false); }} style={{ marginTop: 2, width: 17, height: 17, accentColor: "#0095D9", flex: "0 0 17px" }} />
            <span><a href="https://enger.jp/terms" target="_blank" rel="noreferrer" style={{ color: "#0095D9", fontWeight: 600 }}>利用規約</a>・<a href="https://enger.jp/privacy" target="_blank" rel="noreferrer" style={{ color: "#0095D9", fontWeight: 600 }}>プライバシーポリシー</a>に同意します。</span>
          </label>
          {needAgree && <div style={{ fontSize: 12, color: "#d23f57", marginTop: -8 }}>ログインするには、上のチェックを入れて同意してください。</div>}

          {/* 新規登録（Spotify風の区切り＋アウトラインボタン） */}
          <div style={{ borderTop: "1px solid #eef2f7", marginTop: 6, paddingTop: 16, textAlign: "center" }}>
            <div style={{ fontSize: 12.5, color: "#6b7280", marginBottom: 10 }}>アカウントをお持ちでないですか？</div>
            <a href="/signup" style={{ ...pill, border: "1.5px solid #cbd5e1", background: "#fff", color: "#0F2440" }}>新規登録</a>
          </div>
        </form>
      </div>
    </div>
  );
}
