"use client";

// #387④：ENGERフリーランス最新プロフィールのライブ表示。
//   人材プロフィールドロワー／人材詳細に置くと、開くたびに紐づくフリーランス側の最新値
//   （スキル詳細・スキルタグ・経験業種・居住地・最寄駅・リモート希望・ツール・職種）を取得して表示する。
//   「プロフィールを更新」を押さなくても常に最新（コピーではなくライブ参照）。
//   紐づきが無い人材（ENGERフリーランス以外）では何も表示しない。
import { useEffect, useState } from "react";
import { getLinkedProfileLive, type LinkedProfileLive } from "@/app/engineers/actions";

export function FreelanceLiveProfile({ candidateId }: { candidateId: string }) {
  const [data, setData] = useState<LinkedProfileLive | null>(null);

  useEffect(() => {
    let cancelled = false;
    getLinkedProfileLive(candidateId).then((r) => {
      if (!cancelled && r.ok && r.data?.linked) setData(r.data);
    }).catch(() => { /* 取得失敗時は何も出さない（人材マスタ側の表示は従来どおり） */ });
    return () => { cancelled = true; };
  }, [candidateId]);

  if (!data) return null;

  const item = (label: string, value: string) => value ? (
    <div style={{ display: "flex", alignItems: "baseline", gap: 6, fontSize: 12.5, minWidth: 0 }}>
      <span className="muted" style={{ fontSize: 11.5, flexShrink: 0, whiteSpace: "nowrap" }}>{label}：</span>
      <span style={{ wordBreak: "break-word", minWidth: 0 }}>{value}</span>
    </div>
  ) : null;

  return (
    <div className="card" style={{ padding: 12, display: "flex", flexDirection: "column", gap: 8 }}>
      <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
        <div style={{ fontSize: 11, letterSpacing: ".08em", textTransform: "uppercase", color: "var(--color-ink-4)", fontWeight: 600 }}>ENGERフリーランス 最新プロフィール</div>
        <span title="フリーランス本人がプロフィールを更新・保存すると、開くたびに自動で最新が表示されます（プロフィールを更新ボタン不要）"
          style={{ fontSize: 10, fontWeight: 700, padding: "1px 8px", borderRadius: 99, background: "#e7f3ea", color: "#067647", border: "1px solid #bfe3cc" }}>自動反映</span>
      </div>

      {/* #387②：年数・工程の入力があるスキルを先に表示（未入力は後ろ・「（年数・工程は未入力）」は出さない）。 */}
      {data.skill_details.length > 0 && (
        <div>
          <div style={{ fontSize: 11, fontWeight: 600, color: "var(--color-ink-4)", marginBottom: 5 }}>スキル詳細（本人登録：経験年数・担当工程）</div>
          <div style={{ display: "flex", flexDirection: "column", gap: 3 }}>
            {data.skill_details.map((s) => (
              <div key={s.name} style={{ display: "flex", alignItems: "baseline", gap: 8, fontSize: 12.5, flexWrap: "wrap", padding: "3px 0", borderBottom: "1px solid var(--color-surface-inset)" }}>
                <span className="tag brand" style={{ fontSize: 11, flexShrink: 0 }}>{s.name}</span>
                {s.years && <span style={{ color: "var(--color-ink-2)" }}>経験 {s.years}</span>}
                {s.processes.length > 0 && <span className="muted" style={{ fontSize: 11.5 }}>担当工程：{s.processes.join("・")}</span>}
              </div>
            ))}
          </div>
        </div>
      )}

      <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(220px, 1fr))", gap: "6px 14px" }}>
        {item("職種", data.title)}
        {item("経験業種", data.industries)}
        {item("居住地", data.residence)}
        {item("最寄駅", data.nearest_station)}
        {item("リモート希望", data.remote_pref)}
        {item("ツール・開発環境", data.tools.join(" / "))}
      </div>
    </div>
  );
}
