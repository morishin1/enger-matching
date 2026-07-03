"use client";

import { useActionState, useEffect, useState } from "react";
import { signUp, type SignupState } from "./actions";

export default function SignupPage() {
  const [state, action, pending] = useActionState<SignupState, FormData>(signUp, null);
  const [role, setRole] = useState<"client" | "candidate" | "freelance">("client");
  const [agHost, setAgHost] = useState(false);
  useEffect(() => {
    try {
      const h = window.location.hostname || "";
      const qs = new URLSearchParams(window.location.search);
      const as = qs.get("as");
      // 法人LP（ENGER business）からは ?as=client を最優先で client 固定にする。
      //   これを先に判定しないと、ホストが ag.* の場合に下の条件で freelance に倒れてしまい、
      //   法人として登録できない不具合になる（法人LP→フリーランス登録の原因）。
      if (as === "client") { setRole("client"); }
      else if (/^ag\./i.test(h) || as === "freelance") { setAgHost(true); setRole("freelance"); }
      else if (as === "candidate") { setRole("candidate"); }
    } catch { /* noop */ }
  }, []);

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
            <span style={{ fontFamily: "var(--font-display, sans-serif)", fontWeight: 800, fontSize: 20, letterSpacing: ".04em", color: "#38BDF8" }}>DX</span>
          </div>

          {state?.ok ? (
            <div style={{ background: "rgba(255,255,255,.97)", borderRadius: 18, padding: 30, boxShadow: "0 24px 70px rgba(0,0,0,.35)" }}>
              <div style={{ textAlign: "center" }}>
                <div style={{ fontSize: 40, marginBottom: 8 }}>📨</div>
                <h2 style={{ margin: "0 0 8px", fontSize: 18, fontWeight: 800, color: "#0F2440" }}>ご登録ありがとうございます</h2>
                <p style={{ fontSize: 13, color: "#4b5563", lineHeight: 1.8 }}>ログインするには、次の<b>2つの認証</b>が必要です。完了までは<b>まだログインできません</b>。</p>
              </div>
              {/* 新規登録者に「認証（メール確認＋管理者承認）が必要」であることを明示（LP側の要望対応）。 */}
              <ol style={{ margin: "14px 0 0", padding: "0 0 0 4px", listStyle: "none", display: "flex", flexDirection: "column", gap: 10 }}>
                <li style={{ display: "flex", gap: 10, alignItems: "flex-start" }}>
                  <span style={{ flex: "0 0 22px", height: 22, borderRadius: 99, background: "#0095D9", color: "#fff", fontSize: 12, fontWeight: 800, display: "grid", placeItems: "center" }}>1</span>
                  <span style={{ fontSize: 12.5, color: "#374151", lineHeight: 1.7 }}><b>メールアドレスの確認</b><br />ご登録のメールに届く「メールアドレスを登録する」リンクを開いてください。</span>
                </li>
                <li style={{ display: "flex", gap: 10, alignItems: "flex-start" }}>
                  <span style={{ flex: "0 0 22px", height: 22, borderRadius: 99, background: "#0095D9", color: "#fff", fontSize: 12, fontWeight: 800, display: "grid", placeItems: "center" }}>2</span>
                  <span style={{ fontSize: 12.5, color: "#374151", lineHeight: 1.7 }}><b>管理者の承認</b><br />確認完了後、運営（管理者）が内容を確認して承認します。承認されるとログインできるようになります。</span>
                </li>
              </ol>
              <div style={{ textAlign: "center" }}>
                <a href="/login" style={{ display: "inline-block", marginTop: 18, color: "#0095D9", fontWeight: 700, fontSize: 13, textDecoration: "none" }}>ログイン画面へ戻る →</a>
              </div>
            </div>
          ) : (
            <form action={action} style={{ background: "rgba(255,255,255,.97)", borderRadius: 18, padding: 30, display: "flex", flexDirection: "column", gap: 13, boxShadow: "0 24px 70px rgba(0,0,0,.35)", backdropFilter: "blur(6px)" }}>
              <div>
                <h2 style={{ margin: 0, fontSize: 19, fontWeight: 800, color: "#0F2440" }}>新規登録</h2>
                <p style={{ margin: "4px 0 0", fontSize: 12, color: "#6b7280" }}>登録後、管理者の承認をもってご利用いただけます。</p>
              </div>

              {agHost || role === "freelance" || role === "candidate" ? (
                <div style={{ display: "flex", flexDirection: "column", gap: 5, fontSize: 12, color: "#6b7280" }}>ご登録区分
                  <div style={{ padding: "10px 12px", borderRadius: 10, border: "1.5px solid #0095D9", background: "#eaf6fd", color: "#0F2440", fontSize: 13, fontWeight: 700 }}>
                    {role === "freelance" ? "副業エージェント（紹介して報酬を得る）" : role === "candidate" ? "エンジニア・人材" : "副業エージェント"}
                  </div>
                </div>
              ) : (
                <div style={{ display: "flex", flexDirection: "column", gap: 5, fontSize: 12, color: "#6b7280" }}>ご利用区分（ビジネス向け）
                  <div style={{ padding: "10px 12px", borderRadius: 10, border: "1.5px solid #0095D9", background: "#eaf6fd", color: "#0F2440", fontSize: 13, fontWeight: 700 }}>
                    エンジニアを採用したい企業
                  </div>
                  <div style={{ marginTop: 6, fontSize: 11, color: "#98a2b3", lineHeight: 1.7 }}>
                    ※ エンジニア（人材）の方は <a href="https://enger.jp/signup" style={{ color: "#0095D9", fontWeight: 700 }}>enger.jp</a>、副業エージェントの方は <a href="/signup?as=freelance" style={{ color: "#0095D9", fontWeight: 700 }}>こちら</a> からご登録ください（ag.enger.jp 準備中）。営業エージェント・パートナー企業は運営からの招待制です。
                  </div>
                </div>
              )}
              <input type="hidden" name="role" value={role} />
              {/* ハニーポット：人間には見えない隠しフィールド。bot がここを埋めると拒否する。 */}
              <input
                type="text" name="website" tabIndex={-1} autoComplete="off"
                aria-hidden="true"
                style={{ position: "absolute", left: "-9999px", width: 1, height: 1, opacity: 0 }}
              />

              <label style={{ display: "flex", flexDirection: "column", gap: 5, fontSize: 12, color: "#6b7280" }}>お名前（ご担当者名）
                <input name="name" type="text" required maxLength={50} placeholder="山田 太郎" style={input} />
              </label>
              {role === "client" && (
                <label style={{ display: "flex", flexDirection: "column", gap: 5, fontSize: 12, color: "#6b7280" }}>会社名
                  <input name="company" type="text" required maxLength={100} placeholder="株式会社〇〇" style={input} />
                </label>
              )}
              {role === "freelance" && (
                <label style={{ display: "flex", flexDirection: "column", gap: 5, fontSize: 12, color: "#6b7280" }}>屋号・会社名（任意）
                  <input name="company" type="text" maxLength={100} placeholder="個人／屋号があれば" style={input} />
                </label>
              )}
              <label style={{ display: "flex", flexDirection: "column", gap: 5, fontSize: 12, color: "#6b7280" }}>メールアドレス（会社のメールアドレスを推奨）
                <input name="email" type="email" required maxLength={254} autoComplete="email" placeholder="you@example.com" style={input} />
              </label>
              <label style={{ display: "flex", flexDirection: "column", gap: 5, fontSize: 12, color: "#6b7280" }}>パスワード（8文字以上・英字＋数字または記号）
                <input name="password" type="password" required minLength={8} maxLength={256} autoComplete="new-password" placeholder="••••••••" style={input} />
              </label>

              <label style={{ display: "flex", gap: 8, alignItems: "flex-start", fontSize: 12, color: "#4b5563", lineHeight: 1.7, cursor: "pointer" }}>
                <input type="checkbox" name="agree" required style={{ marginTop: 2, width: 16, height: 16, accentColor: "#0095D9", flex: "0 0 16px" }} />
                <span>
                  <a href="/terms" target="_blank" rel="noreferrer" style={{ color: "#0095D9", fontWeight: 600 }}>利用規約</a>・
                  <a href="/privacy" target="_blank" rel="noreferrer" style={{ color: "#0095D9", fontWeight: 600 }}>プライバシーポリシー</a>に同意します。
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
