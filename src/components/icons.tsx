import type { ReactNode } from "react";

type IconProps = { size?: number; fill?: boolean };

// Google Material Symbols（Outlined）でアイコンを統一。
// フォントは app/layout.tsx で読込済み（.material-symbols-outlined）。
function makeIcon(name: string, defaultFill = false) {
  return function I({ size = 18, fill = defaultFill }: IconProps = {}) {
    return (
      <span
        className="material-symbols-outlined"
        aria-hidden
        style={{
          fontSize: size,
          lineHeight: 1,
          verticalAlign: "middle",
          fontVariationSettings: `'FILL' ${fill ? 1 : 0}, 'wght' 400, 'GRAD' 0, 'opsz' ${size}`,
          userSelect: "none",
        }}
      >
        {name}
      </span>
    );
  };
}

// キー → Material Symbol 名（既存の呼び出し名は維持）
export const Icons: Record<string, (p?: IconProps) => ReactNode> = {
  dashboard: makeIcon("dashboard"),
  person_add: makeIcon("person_add"),
  matching: makeIcon("compare_arrows"),
  jobs: makeIcon("work"),
  people: makeIcon("groups"),
  proposals: makeIcon("assignment"),
  pipeline: makeIcon("view_kanban"),
  progress: makeIcon("work_history"),
  company: makeIcon("apartment"),
  analytics: makeIcon("bar_chart"),
  inbox: makeIcon("inbox"),
  mail: makeIcon("mail"),
  send: makeIcon("send"),
  ai: makeIcon("auto_awesome"),
  search: makeIcon("search"),
  bell: makeIcon("notifications"),
  settings: makeIcon("settings"),
  filter: makeIcon("filter_list"),
  sort: makeIcon("swap_vert"),
  plus: makeIcon("add"),
  arrow: makeIcon("arrow_forward"),
  chev: makeIcon("chevron_right"),
  check: makeIcon("check"),
  x: makeIcon("close"),
  star: makeIcon("star"),
  starF: makeIcon("star", true),
  bolt: makeIcon("bolt"),
  pin: makeIcon("push_pin", true),
  msg: makeIcon("chat_bubble"),
  cal: makeIcon("calendar_month"),
  dot: makeIcon("fiber_manual_record", true),
  user: makeIcon("person"),
  building: makeIcon("apartment"),
  yen: makeIcon("currency_yen"),
  engineers: makeIcon("badge"),
  loc: makeIcon("location_on"),
  clock: makeIcon("schedule"),
  doc: makeIcon("description"),
  // LINE ブランドマーク（緑の角丸＋吹き出し）。コピペ取り込みの導線で「LINE/メールから」を分かりやすく示す。
  line: function Line({ size = 18 }: IconProps = {}) {
    return (
      <svg width={size} height={size} viewBox="0 0 24 24" aria-hidden style={{ verticalAlign: "middle", flexShrink: 0 }}>
        <rect width="24" height="24" rx="6" fill="#06C755" />
        <path
          d="M12 5.2c-3.9 0-7 2.5-7 5.6 0 2.8 2.5 5.1 5.9 5.5.2 0 .5.1.6.3.1.2 0 .5 0 .6l-.1.6c0 .2-.1.7.6.4 .7-.3 3.9-2.3 5.3-3.9 1-1 1.7-2.2 1.7-3.5 0-3.1-3.1-5.6-7-5.6z"
          fill="#fff"
        />
        <g fill="#06C755">
          <rect x="8" y="9.4" width="0.95" height="3.3" rx="0.4" />
          <rect x="14.6" y="9.4" width="0.95" height="3.3" rx="0.4" />
          <rect x="10.1" y="9.4" width="0.95" height="3.3" rx="0.4" />
          <rect x="12.2" y="9.4" width="0.95" height="3.3" rx="0.4" />
        </g>
      </svg>
    );
  },
};
