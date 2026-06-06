"use client";

// 「まだ募集中？」確認ボタン。押すと last_confirmed_at を now に更新（鮮度リセット）し、
// マッチングの鮮度ガードから外れて再び候補に出るようにする。

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { confirmJobOpen } from "@/lib/actions";

export function ConfirmJobButton({ jobNo }: { jobNo: number }) {
  const router = useRouter();
  const [pending, start] = useTransition();
  const [msg, setMsg] = useState<string | null>(null);
  const click = () => start(async () => {
    setMsg(null);
    const r = await confirmJobOpen(jobNo);
    if (r.ok) { setMsg("✓ 募集中として鮮度を更新しました"); router.refresh(); }
    else setMsg(r.error ?? "更新に失敗しました");
  });
  return (
    <span style={{ display: "inline-flex", alignItems: "center", gap: 8 }}>
      <button type="button" className="btn ghost btn-xs" disabled={pending} onClick={click}
        title="先方に募集継続を確認できたら押してください。鮮度がリセットされ、再びマッチング候補に出ます。">
        {pending ? "更新中…" : "✓ まだ募集中（鮮度を更新）"}
      </button>
      {msg && <span style={{ fontSize: 11, color: msg.startsWith("✓") ? "#067647" : "#b42318" }}>{msg}</span>}
    </span>
  );
}
