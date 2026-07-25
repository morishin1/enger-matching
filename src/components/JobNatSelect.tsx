"use client";

// 0724：案件の「国籍要件」を案件詳細ドロワーでその場選択→保存する。
//   従来ドロワーは本文からの自動推定バッジ（読み取り専用）のみで、編集画面で
//   「国籍制限」を選択・保存しても表示に反映されなかった（＝保存が効いていないように見えた）。
//   このコンポーネントは保存列 nationality_requirement を直接読み書きし、
//   未設定のときだけ本文からの自動判定をヒントとして併記する。
import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { toast } from "@/components/toast";
import { updateJobById } from "@/lib/actions";
import { classifyJobNationality, JOB_NAT_LABEL } from "@/lib/nationality";

const OPTIONS = ["", "日本国籍のみ", "国籍不問", "不明"] as const;

export function JobNatSelect({ jobNo, initial, detail, title, compact }: {
  jobNo: number; initial?: string | null; detail?: string | null; title?: string | null; compact?: boolean;
}) {
  const norm = (v?: string | null) => (OPTIONS as readonly string[]).includes(String(v ?? "").trim()) ? String(v ?? "").trim() : "";
  const [val, setVal] = useState<string>(norm(initial));
  const [pending, start] = useTransition();
  const router = useRouter();

  // 未設定時に参考表示する自動判定ラベル（本文・件名から推定）。
  const autoLabel = JOB_NAT_LABEL[classifyJobNationality(detail, title)];

  const onChange = (next: string) => {
    const prev = val;
    setVal(next);
    start(async () => {
      // 空欄（未設定）は null で保存し、自動判定に委ねる。
      const r = await updateJobById(jobNo, { nationality_requirement: next || null } as any);
      if (!r.ok) { setVal(prev); toast(("error" in r ? r.error : null) || "国籍要件の保存に失敗しました", "error"); return; }
      if ((r as any).skipped?.includes("nationality_requirement")) {
        setVal(prev);
        toast("保存できませんでした：データベースに「国籍制限」列（nationality_requirement）が未整備です。中央 Supabase の SQL Editor で supabase/jobs-nationality-requirement.sql を実行してください", "error");
        return;
      }
      toast(next ? `国籍要件を「${next}」に設定しました` : "国籍要件を未設定（自動判定）に戻しました", "success");
      router.refresh();
    });
  };

  return (
    <span style={{ display: "inline-flex", alignItems: "center", gap: 8, flexWrap: "wrap" }}>
      <select
        value={val}
        disabled={pending}
        onChange={(e) => onChange(e.target.value)}
        title="国籍要件（未設定のときは本文から自動判定）"
        style={{
          fontFamily: "inherit", fontSize: compact ? 12 : 13, padding: compact ? "3px 6px" : "5px 8px",
          borderRadius: 6, border: "1px solid var(--color-border-strong)",
          background: "var(--color-surface)", color: val === "日本国籍のみ" ? "#b42318" : "var(--color-ink)",
          fontWeight: val === "日本国籍のみ" ? 700 : 400, cursor: pending ? "wait" : "pointer",
        }}
      >
        <option value="">未設定（自動判定）</option>
        <option value="日本国籍のみ">日本国籍のみ</option>
        <option value="国籍不問">国籍不問</option>
        <option value="不明">不明</option>
      </select>
      {!val && <span className="muted" style={{ fontSize: 11 }}>自動判定：{autoLabel}</span>}
    </span>
  );
}
