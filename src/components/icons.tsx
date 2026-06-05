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
};
