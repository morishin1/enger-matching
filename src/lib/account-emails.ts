// 承認待ちユーザー向けメールのテンプレート。区分(role)と用途(template)で切替。
//   - welcome           : 登録ありがとう＋次のステップ（面談予約）
//   - meeting_request   : 面談日程の案内
//   - reminder          : 未返信のリマインド
//   - approved          : 承認完了＋使い方
//   - rejected          : 残念ながら見送り

import type { Role } from "./roles";

export type EmailTemplate = "welcome" | "meeting_request" | "reminder" | "approved" | "rejected" | "custom";

const ROLE_LABEL: Record<string, string> = {
  client: "ユーザー企業", partner: "パートナー企業", freelance: "副業エージェント", candidate: "エンジニア（人材）", agent: "営業エージェント", admin: "管理者",
};

const SIGN = `\n\nENGER（エンジャー）運営\n株式会社エイト\nhttps://enger.jp/`;

function greet(name?: string | null) { return name ? `${name} 様` : "ご担当者 様"; }

export function buildEmail(opts: { template: EmailTemplate; role?: Role | string | null; name?: string | null; companyName?: string | null; meetingUrl?: string; agentName?: string | null }): { subject: string; body: string } {
  const { template, role, name, companyName, meetingUrl, agentName } = opts;
  const r = ROLE_LABEL[String(role || "")] || "ご利用者";
  const co = companyName ? `${companyName}\n` : "";
  const meetLine = meetingUrl ? `面談予約フォーム：${meetingUrl}\n` : "面談のご希望日時を返信いただければ調整いたします。\n";

  switch (template) {
    case "welcome": {
      const subject = `【ENGER】${r}でのご登録ありがとうございます（面談のご案内）`;
      const body = `${co}${greet(name)}\n\nこの度はENGER（エンジャー）に${r}としてご登録いただき、誠にありがとうございます。\nご利用開始にあたり、担当エージェントとの簡単な面談（30分・オンライン可）をお願いしております。\n\n${meetLine}\n面談実施後、ご利用機能を順次解放いたします。${agentName ? `\n担当：${agentName}` : ""}${SIGN}`;
      return { subject, body };
    }
    case "meeting_request": {
      const subject = `【ENGER】面談日程のご相談（${r}）`;
      const body = `${co}${greet(name)}\n\nお世話になっております。ENGER運営です。\nご登録いただいた件で、面談（30分・オンライン可）の日程をご相談させてください。\n\n${meetLine}\nご都合のよい候補日時を3つほどお知らせいただけますと幸いです。${agentName ? `\n担当：${agentName}` : ""}${SIGN}`;
      return { subject, body };
    }
    case "reminder": {
      const subject = `【ENGER】面談日程のご返信お願い`;
      const body = `${co}${greet(name)}\n\nお世話になっております。ENGER運営です。\n先日ご案内した面談日程について、ご返信をお待ちしております。\n\n${meetLine}\nご多忙のところ恐縮ですが、ご検討のほどよろしくお願いいたします。${agentName ? `\n担当：${agentName}` : ""}${SIGN}`;
      return { subject, body };
    }
    case "approved": {
      const subject = `【ENGER】承認完了のお知らせ（ご利用開始のご案内）`;
      const body = `${co}${greet(name)}\n\nお世話になっております。ENGER運営です。\nご面談ありがとうございました。ご利用準備が整いましたのでご案内いたします。\n\nログイン：https://dx.enger.jp/login\n\nご不明点がございましたら、いつでもご連絡ください。${agentName ? `\n担当：${agentName}` : ""}${SIGN}`;
      return { subject, body };
    }
    case "rejected": {
      const subject = `【ENGER】ご登録内容についてのご連絡`;
      const body = `${co}${greet(name)}\n\nお世話になっております。ENGER運営です。\n誠に恐れ入りますが、今回はご登録内容を踏まえ、ご利用をお見送りさせていただきたく存じます。\n何卒ご了承のほどよろしくお願い申し上げます。${SIGN}`;
      return { subject, body };
    }
    default: {
      return { subject: "【ENGER】ご連絡", body: `${greet(name)}\n${SIGN}` };
    }
  }
}

export const TEMPLATE_LABEL: Record<EmailTemplate, string> = {
  welcome: "登録歓迎＋面談案内",
  meeting_request: "面談日程の相談",
  reminder: "面談返信リマインド",
  approved: "承認完了の案内",
  rejected: "見送りのご連絡",
  custom: "カスタム",
};
