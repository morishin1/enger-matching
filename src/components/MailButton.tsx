import { gmailComposeUrl, gmailSearchUrl } from "@/lib/gmail";

/**
 * 緑のメールボタン。3 モード:
 *  - url:    保存済みの元メールURLへ直リンク（最優先）
 *  - search: Gmail を検索で開く（元メールに飛ぶ。クライアント名/氏名など）
 *  - compose(to/subject/body): Gmail 作成画面（返信形式）を開く
 */
export function MailButton({
  url,
  search,
  to,
  subject,
  body,
  label,
  block,
  title,
}: {
  url?: string | null;
  search?: string | null;
  to?: string | null;
  subject?: string;
  body?: string;
  label?: string;
  block?: boolean;
  title?: string;
}) {
  const href = url
    ? url
    : search
      ? gmailSearchUrl(search)
      : gmailComposeUrl({ to, subject: subject ?? "", body: body ?? "" });
  const tip = title ?? (url ? "元のメールを開く" : search ? `「${search}」のメールを検索` : to ? `${to} に返信メールを作成` : "返信メールを作成");
  return (
    <a href={href} target="_blank" rel="noopener noreferrer" className={"btn-mail" + (block ? " block" : "")} title={tip}>
      <svg viewBox="0 0 16 16" width="15" height="15" fill="none" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" strokeLinejoin="round">
        <rect x="1.5" y="3" width="13" height="10" rx="1.5" />
        <path d="M2 4l6 4 6-4" />
      </svg>
      {label && <span>{label}</span>}
    </a>
  );
}
