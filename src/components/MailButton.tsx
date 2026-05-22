import { gmailComposeUrl } from "@/lib/gmail";

/** Gmail 作成画面(返信形式)を新規タブで開く緑のメールボタン。 */
export function MailButton({
  to,
  subject,
  body,
  label,
  block,
}: {
  to?: string | null;
  subject: string;
  body: string;
  label?: string;
  block?: boolean;
}) {
  const href = gmailComposeUrl({ to, subject, body });
  return (
    <a
      href={href}
      target="_blank"
      rel="noopener noreferrer"
      className={"btn-mail" + (block ? " block" : "")}
      title={to ? `${to} に返信メールを作成` : "返信メールを作成（宛先は手入力）"}
    >
      <svg viewBox="0 0 16 16" width="15" height="15" fill="none" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" strokeLinejoin="round">
        <rect x="1.5" y="3" width="13" height="10" rx="1.5" />
        <path d="M2 4l6 4 6-4" />
      </svg>
      {label && <span>{label}</span>}
    </a>
  );
}
