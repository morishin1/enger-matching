// "use client" のファイルが「コンポーネント以外の関数」を export していないか検査する。
//
// なぜ必要か：
//   "use client" のモジュールから export された関数は、サーバーコンポーネントから
//   呼び出すと必ず実行時例外になる（"Attempted to call X() from the server but X is
//   on the client."）。型検査もビルドも通ってしまい、本番でその画面を開いて初めて
//   500 になる。実際に 2026-07 のマッチング画面（案件→人材）がこれで全面停止した。
//
// 規約：判定・整形などの純粋関数は src/lib/ に置き、"use client" のファイルからは
//       コンポーネント（大文字始まり）だけを export する。
//
// 使い方: node scripts/check-client-exports.mjs
import { readFileSync, readdirSync, statSync } from "node:fs";
import { join } from "node:path";

const ROOT = "src";
const IGNORE = new Set(["node_modules", ".next"]);

/** 大文字始まり＝コンポーネント（JSXを返す想定）なので対象外。 */
const isComponentName = (name) => /^[A-Z]/.test(name);

function* walk(dir) {
  for (const entry of readdirSync(dir)) {
    if (IGNORE.has(entry)) continue;
    const p = join(dir, entry);
    if (statSync(p).isDirectory()) yield* walk(p);
    else if (/\.(tsx|ts)$/.test(p)) yield p;
  }
}

const offenders = [];
for (const file of walk(ROOT)) {
  const src = readFileSync(file, "utf8");
  if (!/^\s*["']use client["']/m.test(src.slice(0, 200))) continue;
  const lines = src.split("\n");
  lines.forEach((line, i) => {
    // export function foo(...) / export const foo = (...) => / export async function foo(
    const m = line.match(/^export\s+(?:async\s+)?function\s+([A-Za-z0-9_]+)/)
      ?? line.match(/^export\s+const\s+([A-Za-z0-9_]+)\s*[:=]\s*(?:async\s*)?\(/);
    if (!m || isComponentName(m[1])) return;
    // ブラウザ専用（DOM操作・localStorage等）でサーバーから呼びようがないものは
    // 直前3行以内に @client-only と書いて除外する。
    const near = lines.slice(Math.max(0, i - 3), i + 1).join("\n");
    if (/@client-only/.test(near)) return;
    offenders.push({ file, line: i + 1, name: m[1] });
  });
}

if (offenders.length > 0) {
  console.error('"use client" のファイルからコンポーネント以外の関数が export されています。');
  console.error("サーバーコンポーネントから呼ぶと実行時に必ず落ちるため、src/lib/ へ移してください。\n");
  for (const o of offenders) console.error(`  ${o.file}:${o.line}  ${o.name}()`);
  process.exit(1);
}
console.log('OK: "use client" のファイルはコンポーネントのみを export しています。');
