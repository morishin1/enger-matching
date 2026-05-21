"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { toggleFocus } from "@/lib/actions";

/** 注力(ハート)トグル。案件/人材の is_focus を切り替える。 */
export function FocusHeart({
  table,
  idField,
  idValue,
  initial,
  revalidate,
  size = 16,
}: {
  table: "jobs" | "candidates";
  idField: "job_no" | "candidate_no";
  idValue: number;
  initial: boolean;
  revalidate?: string;
  size?: number;
}) {
  const [on, setOn] = useState(initial);
  const [pending, start] = useTransition();
  const router = useRouter();

  const toggle = (e: React.MouseEvent) => {
    e.stopPropagation();
    const v = !on;
    setOn(v);
    start(async () => {
      const res = await toggleFocus(table, idField, idValue, v, revalidate);
      if (!res.ok) setOn(!v);
      router.refresh();
    });
  };

  return (
    <button
      type="button"
      onClick={toggle}
      disabled={pending}
      title={on ? "注力から外す" : "注力に追加"}
      aria-pressed={on}
      style={{
        border: 0, background: "transparent", cursor: "pointer", padding: 4,
        color: on ? "#e0567f" : "var(--color-ink-4)", lineHeight: 0, opacity: pending ? 0.5 : 1,
      }}
    >
      <svg viewBox="0 0 16 16" width={size} height={size} fill={on ? "currentColor" : "none"} stroke="currentColor" strokeWidth={1.5} strokeLinejoin="round">
        <path d="M8 13.5S2.5 10 2.5 6.2A2.7 2.7 0 018 4a2.7 2.7 0 015.5 2.2C13.5 10 8 13.5 8 13.5z" />
      </svg>
    </button>
  );
}
