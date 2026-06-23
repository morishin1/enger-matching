// 「元メール」リンクを常に直近受信メールへ向けるための解決ヘルパ（サーバ専用・読み取り）。
//
// 背景:
//   案件/人材レコードの source_mail_url は「取込時点」のスナップショット。後から同じ案件・
//   同じ人材・同じ送信元・同じ会社のメールを受信しても、再取込で更新されない経路（別レコード化・
//   skip/fill-empty ポリシー・未登録のまま受信箱に残る等）があると、リンクが過去メールのまま残る。
//
// 方針:
//   受信箱(inbox_emails)から、各エンティティに対応する最新メールを引き当て、source_mail_url を
//   「保存値より新しいときだけ」差し替える（＝決して過去に戻さない）。対応条件は要望どおり:
//     ・同案件 / 同人材（registered_job_no / registered_candidate_no が一致）
//     ・送信元が同じ / 同じ会社（from_email がエンティティの送信元(contact_email)と一致）
//   ただし「別の案件/人材に登録済みのメール」は送信元が一致しても除外する（別人/別案件の最新
//   メールへ誤って飛ぶのを防ぐ安全ガード）。

import { gmailMessageUrl } from "./gmail";

type InboxRow = {
  gmail_message_id: string | null;
  received_at: string | null;
  from_email: string | null;
  registered_candidate_no: number | null;
  registered_job_no: number | null;
};

const ms = (d: string | null | undefined) => { const t = d ? new Date(d).getTime() : 0; return Number.isFinite(t) ? t : 0; };
const norm = (e: unknown) => String(e ?? "").trim().toLowerCase();

function chunk<T>(arr: T[], size: number): T[][] {
  const out: T[][] = [];
  for (let i = 0; i < arr.length; i += size) out.push(arr.slice(i, i + size));
  return out;
}

/**
 * rows（candidates もしくは jobs の配列）の source_mail_url / source_mail_at を、受信箱の
 * 直近メールで上書きする（保存値より新しいときのみ）。失敗時は黙って何もしない（fail-soft）。
 */
export async function attachLatestSourceMail(
  sb: any,
  kind: "candidate" | "job",
  rows: any[],
): Promise<void> {
  try {
    if (!sb || !Array.isArray(rows) || rows.length === 0) return;
    const entNoKey = kind === "candidate" ? "candidate_no" : "job_no";
    const regNoKey = kind === "candidate" ? "registered_candidate_no" : "registered_job_no";

    const nos = Array.from(new Set(rows.map((r) => r?.[entNoKey]).filter((v): v is number => typeof v === "number")));
    // 送信元一致は inbox_emails.from_email と contact_email の「素の値」で照合する。
    //   両者は取込時に同じ Gmail の from_email から設定されるため大文字小文字も一致する。
    //   .in() は大小区別するので、ここでは小文字化せず原文のまま渡す（JS 側の比較だけ正規化）。
    const emails = Array.from(new Set(rows.map((r) => String(r?.contact_email ?? "").trim()).filter(Boolean)));
    if (nos.length === 0 && emails.length === 0) return;

    const cols = "gmail_message_id, received_at, from_email, registered_candidate_no, registered_job_no";
    const byId = new Map<string, InboxRow>();
    const gather = async (filterCol: string, vals: any[]) => {
      for (const part of chunk(vals, 300)) {
        const r: any = await sb.from("inbox_emails").select(cols)
          .not("gmail_message_id", "is", null)
          .in(filterCol, part)
          .order("received_at", { ascending: false })
          .limit(5000);
        if (r.error) continue;
        for (const m of (r.data ?? []) as InboxRow[]) if (m.gmail_message_id) byId.set(m.gmail_message_id, m);
      }
    };
    if (nos.length) await gather(regNoKey, nos);
    if (emails.length) await gather("from_email", emails);
    if (byId.size === 0) return;
    const mails = [...byId.values()];

    // 高速化: rows と mails の総当たり O(n×m) ＝ 最悪 ~200万比較/呼び出しで CPU を食っていた。
    //   ・「同案件/同人材一致」: regNo → 直近メール の Map を一度だけ作る
    //   ・「送信元一致（別エンティティ登録済みを除外）」: from_email → 直近メール の Map を一度だけ作る
    //   いずれも事前ソート＋初回採用で「最新1件」が確定。各 row は最大2回参照すれば済む O(n+m)。
    const bestByRegNo = new Map<number, InboxRow>();
    const bestByFrom = new Map<string, InboxRow>();
    const sorted = mails.slice().sort((a, b) => ms(b.received_at) - ms(a.received_at));
    for (const m of sorted) {
      const regNo = m[regNoKey] as number | null;
      if (regNo != null && !bestByRegNo.has(regNo)) bestByRegNo.set(regNo, m);
      // from_email 索引は「別エンティティに登録済み」を除外して入れる（別人/別案件へ飛ばさない安全ガード）。
      const from = norm(m.from_email);
      if (from && regNo == null && !bestByFrom.has(from)) bestByFrom.set(from, m);
    }

    for (const row of rows) {
      const no = row?.[entNoKey] as number | null | undefined;
      const email = norm(row?.contact_email);
      let best: InboxRow | null = null;
      if (no != null) {
        const m = bestByRegNo.get(no);
        if (m) best = m;
      }
      if (email) {
        const m = bestByFrom.get(email);
        if (m && (!best || ms(m.received_at) > ms(best.received_at))) best = m;
      }
      if (!best) continue;
      // 保存値より新しいときだけ差し替え（過去に戻さない）。
      if (ms(best.received_at) >= ms(row?.source_mail_at)) {
        const url = gmailMessageUrl(best.gmail_message_id);
        if (url) {
          row.source_mail_url = url;
          if (best.received_at) row.source_mail_at = best.received_at;
        }
      }
    }
  } catch {
    /* fail-soft: 解決できなければ既存の source_mail_url のまま */
  }
}
