// 提案メール（案件側・人材側）の組み立てを一元化する純粋モジュール。
//   メール送信画面（MailComposeWizard / JobMailBodyCard / CandMailBodyCard / SendBothMailsButton）と、
//   マッチングの送信文プレビュー（Ranking100View）から共通で使う。
//   ※ 以前は各クライアントコンポーネント内に定義されていたが、"use client" 間の相互 import を
//     避けるためここへ移設して単一ソース化した（本文テンプレの二重管理を防ぐ）。

import { reSubject } from "./gmail";

export const BUTTON_PLACEHOLDER = "<<RESPONSE_BUTTONS>>";
export const NOTICE_TEXT = "こちらは料金は発生しません。\n進捗があり次第、担当者よりご連絡させていただきます。";

const SIGNATURE = `∞∞∞∞∞∞∞∞∞∞∞∞∞∞∞∞∞∞∞∞∞∞∞∞∞∞∞∞∞∞∞∞∞∞∞∞∞∞∞
株式会社エイト
ITS事業部
野澤：080-4191-4175
 Mail：support_eigyo@8grp.co.jp
エンジニア・PM・DX人材の即戦力マッチング：https://enger.jp/
インキュベーションスペース：https://8sp.jp/
 自社サイト：https://8grp.co.jp/
〒150-0001 東京都渋谷区神宮前6-33-14-エイトカフェ2F
∞∞∞∞∞∞∞∞∞∞∞∞∞∞∞∞∞∞∞∞∞∞∞∞∞∞∞∞∞∞∞∞∞∞∞∞∞∞∞
「株式会社エイト」公式ホームページ
デキルがあふれる社会をつくる - 「株式会社エイト」公式ホームページ
異なるアイデアと先進技術を融合し、革新的なサービスを生み出す。コラボレーションとテクノロジーで、企業の課題解決と新たな価値創造を支援します。`;

// ── 件名 ─────────────────────────────────────────────────────────────

export function buildJobMailSubject(job: any): string {
  return reSubject(job.title ?? "");
}

// 人材取込元メール(SES窓口/エージェント)に「Re: <人材側元件名>」で返信し、Gmail に
// スレッド統合させて相手の受信箱の元スレッドに返信として届くようにする。
// ※ 案件名へはフォールバックしない：人材側メールに案件側と同じ件名が表示される
//    （送信確認画面で「人材側＝案件側の件名」になる）混乱の原因になっていたため。
//    人材側元件名が解決できない場合のみ、人材向けの定型件名にフォールバックする。
export const LEGACY_CAND_SUBJECT = "【案件のご紹介】希望条件に合致する案件のお知らせ";

export function buildCandMailSubject(cand?: { source_mail_subject?: string | null } | null): string {
  const orig = String(cand?.source_mail_subject ?? "").trim();
  if (orig) return reSubject(orig); // 「Re: <人材側元メールの件名>」
  return LEGACY_CAND_SUBJECT;        // 案件名は使わない（案件側と同一件名になるのを防ぐ）
}

// ── 宛先・添付リンクの解決 ─────────────────────────────────────────────

/** 取込元メール本文（note/detail）から「相手の連絡先メール」を抽出する。
 *   email / contact_email が未登録（CSV取込・旧データ等）の場合の送信先フォールバック。
 *   自社ドメイン（8grp/enger）や no-reply 系は返信先ではないので除外する。
 *   見つからなければ null（送信モーダルで手入力できる）。 */
export function extractReplyEmail(text?: string | null): string | null {
  const s = (text ?? "").toString();
  if (!s) return null;
  const RE = /[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}/g;
  const OWN = /@(?:[a-z0-9-]+\.)?(?:8grp\.co\.jp|enger\.jp)$/i;
  const BAD = /^(?:no-?reply|do-?not-?reply|noreply|postmaster|mailer-daemon|abuse)@/i;
  const all = s.match(RE) ?? [];
  for (const e of all) { if (!OWN.test(e) && !BAD.test(e)) return e; }
  return null;
}

/** スキルシートのリンクを解決する。
 *   1) 取込時に保存済みの skill_sheet_url を最優先。
 *   2) 無い場合は、先方が「添付ではなくリンクで」送ってきたスキルシートURLを
 *      取込元メール本文（cand.note）から抽出する（旧enger同様、リンクを自動記載するため）。
 *   ※ 署名や会社サイト等の無関係URLを拾わないよう、スキルシート/経歴系の語の近く、
 *      もしくはファイル共有系ドメインのURLだけを採用する（任意URLは採用しない）。 */
export function resolveSkillSheetUrl(cand: any): string | null {
  const saved = (cand?.skill_sheet_url ?? "").toString().trim();
  if (saved) return saved;
  const text = (cand?.note ?? "").toString();
  if (!text) return null;
  const URL_RE = /https?:\/\/[^\s<>"')\]　、，]+/g;
  const KEY_RE = /(スキルシート|ｽｷﾙｼｰﾄ|スキルシ-ト|経歴書|職務経歴|技術経歴|skill\s*sheet|ss[:：])/i;
  const DOC_RE = /(drive\.google|docs\.google|1drv\.ms|onedrive|sharepoint|dropbox|box\.com|\.pdf|\.xlsx?|\.docx?|\.pptx?)/i;
  const lines = text.split(/\r?\n/);
  // ① 「スキルシート：URL」のように同じ行に出てくるURL
  for (const ln of lines) {
    if (KEY_RE.test(ln)) { const m = ln.match(URL_RE); if (m?.[0]) return m[0]; }
  }
  // ② 「スキルシート：」の次行にURLがあるパターン
  for (let i = 0; i < lines.length - 1; i++) {
    if (KEY_RE.test(lines[i])) { const m = (lines[i + 1] ?? "").match(URL_RE); if (m?.[0]) return m[0]; }
  }
  // ③ キーワードが無くても、ファイル共有系ドメインのURLがあれば採用
  const urls: string[] = text.match(URL_RE) ?? [];
  const doc = urls.find((u: string) => DOC_RE.test(u));
  return doc ?? null;
}

// ── 本文 ─────────────────────────────────────────────────────────────

/** クライアント（案件企業）宛て：人材を提案する本文。 */
export function buildJobMailContent(job: any, cand: any): string {
  // 要員情報は「整形ブロック（名前/最寄駅/稼動日/所属/単価/スキル/実績）」を生成する。
  //   以前は取込元メール本文(cand.note)をそのまま貼っていたため、先方SESの挨拶・署名まで
  //   入って定型文が崩れていた。旧enger同様、整形済みブロックで出す。
  const remark = [
    `【 名　前 】${cand.name ?? ""}${cand.age_band ? `　(${cand.age_band})` : ""}`,
    cand.location ? `【最 寄 駅】${cand.location}` : "",
    cand.avail ? `【稼 動 日】${cand.avail}` : "",
    cand.affiliation ? `【所　 属】${cand.affiliation}` : "",
    `【単　 価】${cand.rate ?? "応相談"}`,
    `【ス キ ル】${Array.isArray(cand.skills) && cand.skills.length ? cand.skills.join("、") : "—"}`,
    cand.exp ? `【 実　績 】\n${cand.exp}` : "",
  ].filter(Boolean).join("\n");

  const sheetUrl = resolveSkillSheetUrl(cand);
  const skillSheet = sheetUrl
    ? `\n━━━━━━━━━━━━━━━━━━━\nスキルシート：\n${sheetUrl}\n`
    : "";

  // 応答ボタン（BUTTON_PLACEHOLDER）は挨拶文の直後＝本文冒頭に配置する。
  //   以前は署名の直前（本文末尾）にあったが、先方が最初に目にする位置へ移動（#335）。
  return `${job.client_name ?? ""}
${job.contact_name ? `${job.contact_name} 様` : "ご担当者 様"}

いつも大変お世話になっております。
株式会社エイトの営業担当でございます。
ぜひ紹介したい要員がおりますので、ご連絡いたしました。
つきましては、下記より「話を進める」または「見送り」をご選択のうえ、ご回答いただけますと幸いです。
※要員にはエントリー可否を並行して確認中でございます。

${BUTTON_PLACEHOLDER}
────────────────────────────────────
◆ご紹介していただいた案件
【案件名】：　${job.title ?? ""}
────────────────────────────────────
◆ご紹介する要員
${remark}${skillSheet}
────────────────────────────────────
${SIGNATURE}`;
}

/** 人材所属（SES窓口）宛て：案件を紹介する本文。 */
export function buildCandMailContent(job: any, cand: any): string {
  const salary = (lo?: number | null, hi?: number | null) =>
    lo && hi ? (lo === hi ? `${lo}万円` : `${lo}〜${hi}万円`) : hi ? `〜${hi}万円` : lo ? `${lo}万円〜` : "スキル見合い";

  const candidateCompany = cand.source_company || cand.company || null;

  const greeting = cand.contact_name
    ? `${cand.contact_name} 様`
    : (candidateCompany ? "ご担当者 様" : `${cand.name ?? ""} 様`);

  // 案件の内容は「案件詳細(job.detail_note)＝担当が整えた紹介文」を最優先で掲載する（#344③）。
  //   未入力の案件は従来どおり取込メール原文(job.detail)→description の順でフォールバック
  //   （既存案件のメールが空にならないようにするため）。
  const jobDetail = [job.detail_note, job.detail, job.description]
    .map((v: any) => (v ?? "").toString().trim())
    .find((v: string) => v) ?? "";
  const jobSummary = jobDetail
    ? `【案件】${job.title ?? ""}\n${jobDetail}`
    : [
        `【案件】${job.title ?? ""}`,
        Array.isArray(job.skills) && job.skills.length ? `【スキル】${job.skills.join("、")}` : "",
        `【単金】${salary(job.salary_min, job.salary_max)}`,
        job.work_location ? `【場所】${job.work_location}` : "",
        job.start_date ? `【期間】${job.start_date}〜` : "",
        job.flow_note ? `【商流】${job.flow_note}` : "",
      ].filter(Boolean).join("\n");

  // 要員の年代・最寄駅は1行にまとめる（例：I.E 様（30代後半、新所沢駅））。
  const candBandLoc = [cand.age_band, cand.location].filter(Boolean).join("、");

  // 応答ボタン（BUTTON_PLACEHOLDER）は挨拶文の直後＝本文冒頭に配置する（#336）。
  return `${candidateCompany ?? "〇〇"}
${greeting}

いつも大変お世話になっております。
株式会社エイトの営業担当でございます。
この度は要員様をご紹介いただき、誠にありがとうございます。
ぜひ、ご紹介したい案件がありましたのでご連絡致しました。
つきましては、詳細をご確認のうえ、下記の「話を進める」または「見送り」のご回答をお願いいたします。
※なお、ご案件文に必須スキル、尚可スキルの記載がある場合は、スキル、経験等を○×でご返信いただけますと幸いです。

${BUTTON_PLACEHOLDER}
────────────────────────────────────
◆ご紹介していただいた要員
【お名前】${cand.name ?? ""} 様${candBandLoc ? `（${candBandLoc}）` : ""}
────────────────────────────────────
◆ご紹介する案件
${jobSummary}
────────────────────────────────────
${SIGNATURE}`;
}
// ── HTML（応答ボタン・本文） ────────────────────────────────────────────

// 「話を進める／見送り」ボタンのHTML（メール埋め込み用）。
//   ・ENGERのレインボーカラーの帯＋ピル型ボタンで、どのメールクライアントでも崩れにくい
//     テーブル組み＋インラインスタイルで構成（bulletproof button）。
//   ・アイコン：メールでは Material Symbols のフォント/SVGが使えない（Gmailが除去する）ため、
//     check_circle / cancel と同じ見た目になる「丸地＋✓/✕」のテキストグリフで表現する。
//   ・グラデ非対応クライアント向けに background-color のフォールバックを併記。
export function buildButtonHtml(siteUrl: string, token: string): string {
  const agreeUrl  = `${siteUrl}/respond?token=${token}&action=${encodeURIComponent("話を進める")}`;
  const rejectUrl = `${siteUrl}/respond?token=${token}&action=${encodeURIComponent("見送り")}`;
  const rainbow = "linear-gradient(90deg,#e94141 0%,#f5a623 22%,#ffd93d 42%,#38c172 62%,#0095D9 82%,#7c3aed 100%)";
  return `<div style="margin:20px 0 0;max-width:420px">
  <div style="height:5px;border-radius:99px;background:#0095D9;background-image:${rainbow}"></div>
  <div style="font-size:12.5px;color:#334155;font-weight:bold;margin:10px 0 10px">ご確認のうえ、いずれかをお選びください</div>
  <table cellpadding="0" cellspacing="0" border="0" style="margin:0 0 10px">
    <tr>
      <td style="padding-right:12px">
        <a href="${agreeUrl}" target="_blank"
           style="display:inline-block;padding:13px 26px;background-color:#16a34a;background-image:linear-gradient(135deg,#16a34a,#0095D9);color:#ffffff;font-weight:bold;font-size:14px;border-radius:999px;text-decoration:none;box-shadow:0 3px 10px rgba(22,163,74,.35)">
          <span style="display:inline-block;width:18px;height:18px;line-height:18px;background:#ffffff;color:#16a34a;border-radius:50%;text-align:center;font-size:12px;font-weight:bold;margin-right:8px;vertical-align:-3px">&#10003;</span>話を進める
        </a>
      </td>
      <td>
        <a href="${rejectUrl}" target="_blank"
           style="display:inline-block;padding:11px 24px;background-color:#ffffff;color:#b42318;font-weight:bold;font-size:14px;border-radius:999px;text-decoration:none;border:2px solid #f2b8b5">
          <span style="display:inline-block;width:18px;height:18px;line-height:18px;background:#b42318;color:#ffffff;border-radius:50%;text-align:center;font-size:11px;font-weight:bold;margin-right:8px;vertical-align:-3px">&#10005;</span>見送り
        </a>
      </td>
    </tr>
  </table>
  <div style="font-size:11px;color:#64748b;line-height:1.7">
  こちらは料金は発生しません。<br>進捗があり次第、担当者よりご連絡させていただきます。
  </div>
  <div style="height:5px;border-radius:99px;background:#0095D9;background-image:${rainbow};margin-top:12px"></div>
</div>`;
}

/** 本文テキスト＋ボタンHTML → 送信用HTML。
 *   改行は <br> に変換して送る。Gmail は inline style の white-space を無視（除去）するため、
 *   pre-wrap 頼みだと受信側で改行が全て潰れて1行のベタ文になる（先方指摘の不具合）。 */
export function buildHtmlBody(text: string, buttonHtml: string): string {
  const escape = (s: string) => s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/\r?\n/g, "<br>");
  const wrapStyle = `font-family:sans-serif;font-size:14px;line-height:1.75;color:#1e293b`;
  const parts = text.split(BUTTON_PLACEHOLDER);
  if (parts.length === 1) {
    return `<div style="${wrapStyle}">${escape(text)}</div>\n${buttonHtml}`;
  }
  return parts.map((part, i) => {
    const div = `<div style="${wrapStyle}">${escape(part)}</div>`;
    return i < parts.length - 1 ? `${div}\n${buttonHtml}` : div;
  }).join("\n");
}
