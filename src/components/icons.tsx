import type { ReactNode } from "react";

type IconProps = { size?: number; fill?: boolean };

function makeIcon(d: string, defaultFill = false) {
  return function I({ size = 16, fill = defaultFill }: IconProps = {}) {
    return (
      <svg
        viewBox="0 0 16 16"
        width={size}
        height={size}
        fill="none"
        stroke="currentColor"
        strokeWidth={1.5}
        strokeLinecap="round"
        strokeLinejoin="round"
      >
        {fill ? <path d={d} fill="currentColor" stroke="none" /> : <path d={d} />}
      </svg>
    );
  };
}

export const Icons: Record<string, (p?: IconProps) => ReactNode> = {
  dashboard: makeIcon("M2.5 8.5L8 3l5.5 5.5M3.5 7.5v5.5h9V7.5"),
  matching: makeIcon("M3 4.5h4M3 8h4M3 11.5h4M9 4.5h4M9 8h4M9 11.5h4M7 4.5l2 0M7 8l2 0M7 11.5l2 0"),
  jobs: makeIcon("M3 5.5h10v7H3zM5.5 5.5V4h5v1.5M3 8.5h10"),
  people: makeIcon("M5.5 7.5a2 2 0 100-4 2 2 0 000 4zM10.5 8.5a1.5 1.5 0 100-3 1.5 1.5 0 000 3zM2.5 13c.4-1.7 1.8-3 3-3s2.6 1.3 3 3M9 13c.3-1.3 1.2-2 2-2s1.7.7 2 2"),
  proposals: makeIcon("M3 3h7l3 3v7H3zM10 3v3h3"),
  pipeline: makeIcon("M2.5 4.5h11M2.5 8h11M2.5 11.5h11M4.5 4.5v7M9 4.5v7M12 4.5v7"),
  progress: makeIcon("M2.5 4h7M2.5 8h10M2.5 12h5M11 4l2 2-2 2M13 8l-2 2 2 2"),
  company: makeIcon("M2.5 13.5V4l5-1.5 5 1.5v9.5M2.5 6.5h10M5 8.5h.5M7.5 8.5h.5M5 10.5h.5M7.5 10.5h.5M9.5 8.5h.5M9.5 10.5h.5M6 13.5v-3h3v3"),
  analytics: makeIcon("M3 13V8M6.5 13V5M10 13V9.5M13.5 13V3"),
  inbox: makeIcon("M2.5 8.5L4 4h8l1.5 4.5v4.5h-11zM2.5 8.5h3l1 1.5h3l1-1.5h3"),
  ai: makeIcon("M8 2.5l1.2 2.8 2.8 1.2-2.8 1.2L8 10.5 6.8 7.7 4 6.5l2.8-1.2zM12 11l.5 1.2L13.5 13l-1 .5L12 14.5l-.5-1L10.5 13l1-.5z"),
  search: makeIcon("M11.5 11.5l2 2M7 12a5 5 0 100-10 5 5 0 000 10z"),
  bell: makeIcon("M4 11h8l-1-1.5V7a3 3 0 00-6 0v2.5L4 11zM6.5 12.5a1.5 1.5 0 003 0"),
  settings: makeIcon("M8 6a2 2 0 100 4 2 2 0 000-4zM8 3v1.5M8 11.5V13M3 8h1.5M11.5 8H13M4.5 4.5l1 1M10.5 10.5l1 1M4.5 11.5l1-1M10.5 5.5l1-1"),
  filter: makeIcon("M2.5 4h11M4.5 8h7M6.5 12h3"),
  sort: makeIcon("M3 5l2-2 2 2M5 3v10M13 11l-2 2-2-2M11 13V3"),
  plus: makeIcon("M8 3v10M3 8h10"),
  arrow: makeIcon("M5 8h6M8 5l3 3-3 3"),
  chev: makeIcon("M6 4l4 4-4 4"),
  check: makeIcon("M3.5 8.5l3 3 6-6"),
  x: makeIcon("M4 4l8 8M12 4l-8 8"),
  star: makeIcon("M8 2l1.8 3.8 4.2.6-3 3 .8 4.2L8 11.6 4.2 13.6l.8-4.2-3-3 4.2-.6z"),
  starF: makeIcon("M8 2l1.8 3.8 4.2.6-3 3 .8 4.2L8 11.6 4.2 13.6l.8-4.2-3-3 4.2-.6z", true),
  bolt: makeIcon("M9 2L4 9h3.5L7 14l5-7H8.5L9 2z"),
  pin: makeIcon("M8 2v6.5M5.5 8.5h5L8 13z", true),
  msg: makeIcon("M2.5 4h11v7H6l-2 2v-2H2.5z"),
  cal: makeIcon("M3 4.5h10v9H3zM3 7.5h10M5.5 3v3M10.5 3v3"),
  dot: makeIcon("M8 7.5a.5.5 0 100 1 .5.5 0 000-1z", true),
  user: makeIcon("M8 8a2.5 2.5 0 100-5 2.5 2.5 0 000 5zM3 13.5c.7-2.4 2.7-4 5-4s4.3 1.6 5 4"),
  building: makeIcon("M3 13.5V3.5h7v10M10 13.5V6.5h3v7M4.5 5.5h1M4.5 7.5h1M4.5 9.5h1M7.5 5.5h1M7.5 7.5h1M7.5 9.5h1"),
  yen: makeIcon("M4.5 3l3.5 5 3.5-5M5 8h6M5 10.5h6M8 8v5"),
  loc: makeIcon("M8 14s4.5-4 4.5-7.5a4.5 4.5 0 10-9 0C3.5 10 8 14 8 14zM8 8a1.5 1.5 0 100-3 1.5 1.5 0 000 3z"),
  clock: makeIcon("M8 14A6 6 0 108 2a6 6 0 000 12zM8 5v3l2 1.5"),
};
