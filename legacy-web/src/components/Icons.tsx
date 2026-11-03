import type { ReactNode } from "react";

const paths = {
  dashboard: (
    <>
      <rect x="3" y="3" width="7" height="9" rx="1.5" />
      <rect x="14" y="3" width="7" height="5" rx="1.5" />
      <rect x="14" y="12" width="7" height="9" rx="1.5" />
      <rect x="3" y="16" width="7" height="5" rx="1.5" />
    </>
  ),
  box: (
    <>
      <path d="M21 8 12 3 3 8v8l9 5 9-5z" />
      <path d="m3 8 9 5 9-5" />
      <path d="M12 21v-8" />
    </>
  ),
  database: (
    <>
      <ellipse cx="12" cy="5" rx="8" ry="3" />
      <path d="M4 5v7c0 1.7 3.6 3 8 3s8-1.3 8-3V5" />
      <path d="M4 12v7c0 1.7 3.6 3 8 3s8-1.3 8-3v-7" />
    </>
  ),
  terraform: (
    <>
      <path d="M4 5.4 9 2.5v8.8L4 14.2z" />
      <path d="M10 2.5 15 5.4v8.8l-5 2.9z" />
      <path d="M16 5.4 21 8.3v8.8l-5 2.9z" />
    </>
  ),
  ansible: (
    <>
      <circle cx="12" cy="4.5" r="2" />
      <circle cx="5" cy="19" r="2" />
      <circle cx="19" cy="19" r="2" />
      <path d="M12 6.5v5M12 11.5 6.6 17M12 11.5 17.4 17" />
    </>
  ),
  git: (
    <>
      <circle cx="18" cy="6" r="3" />
      <circle cx="6" cy="18" r="3" />
      <path d="M6 15V3" />
      <path d="M18 9a9 9 0 0 1-9 9" />
    </>
  ),
  jenkins: (
    <>
      <rect x="3" y="3" width="7" height="7" rx="1.5" />
      <rect x="14" y="14" width="7" height="7" rx="1.5" />
      <path d="M10 6.5h4.5a3 3 0 0 1 3 3V14" />
      <path d="M14 17.5h-4.5a3 3 0 0 1-3-3V10" />
    </>
  ),
  activity: <path d="M3 12h3.5l2.8 8 5.4-16 2.8 8H21" />,
  settings: (
    <>
      <path d="M4 8h16M4 16h16" />
      <circle cx="9" cy="8" r="2.2" />
      <circle cx="15" cy="16" r="2.2" />
    </>
  ),
  refresh: (
    <>
      <path d="M20.5 12a8.5 8.5 0 1 1-2.6-6.1" />
      <path d="M21 4.5V10h-5.5" />
    </>
  ),
  sun: (
    <>
      <circle cx="12" cy="12" r="4" />
      <path d="M12 2v2M12 20v2M4.9 4.9l1.5 1.5M17.6 17.6l1.5 1.5M2 12h2M20 12h2M4.9 19.1l1.5-1.5M17.6 6.4l1.5-1.5" />
    </>
  ),
  moon: <path d="M20.8 13.4A8.8 8.8 0 1 1 10.6 3.2a7 7 0 0 0 10.2 10.2z" />,
  search: (
    <>
      <circle cx="11" cy="11" r="7" />
      <path d="m20.5 20.5-4-4" />
    </>
  ),
  play: <path d="M7 4.6v14.8L20 12z" />,
  pause: (
    <>
      <path d="M9 5v14M15 5v14" />
    </>
  ),
  restart: (
    <>
      <path d="M3.5 12a8.5 8.5 0 1 0 2.6-6.1" />
      <path d="M3 4.5V10h5.5" />
    </>
  ),
  external: (
    <>
      <path d="M14 4h6v6" />
      <path d="M20 4 11 13" />
      <path d="M18 14.5V19a1 1 0 0 1-1 1H5a1 1 0 0 1-1-1V7a1 1 0 0 1 1-1h4.5" />
    </>
  ),
  check: <path d="m4 12.5 5 5L20 6.5" />,
  alert: (
    <>
      <path d="M12 3.2 2.6 20h18.8z" />
      <path d="M12 9.5v4.5M12 17.2v.1" />
    </>
  ),
  info: (
    <>
      <circle cx="12" cy="12" r="9" />
      <path d="M12 11v6M12 7.6v.1" />
    </>
  ),
  chevronRight: <path d="m9 5.5 6.5 6.5L9 18.5" />,
  chevronDown: <path d="m5.5 9 6.5 6.5L18.5 9" />,
  x: <path d="M6 6l12 12M18 6 6 18" />,
  plus: <path d="M12 5v14M5 12h14" />,
  terminal: (
    <>
      <path d="m4 7 5 5-5 5" />
      <path d="M12.5 19H20" />
    </>
  ),
  server: (
    <>
      <rect x="3" y="4" width="18" height="7" rx="2" />
      <rect x="3" y="13" width="18" height="7" rx="2" />
      <path d="M7 7.5v.1M7 16.5v.1" />
    </>
  ),
  clock: (
    <>
      <circle cx="12" cy="12" r="9" />
      <path d="M12 7v5.3l3.4 2" />
    </>
  ),
  shield: <path d="M12 3 5 5.8v6c0 4.6 3 7.9 7 9.2 4-1.3 7-4.6 7-9.2v-6z" />,
  cpu: (
    <>
      <rect x="7" y="7" width="10" height="10" rx="2" />
      <path d="M10 3v4M14 3v4M10 17v4M14 17v4M3 10h4M3 14h4M17 10h4M17 14h4" />
    </>
  ),
  drive: (
    <>
      <rect x="2.5" y="8" width="19" height="8" rx="2" />
      <path d="M6.5 16v3M17.5 16v3M6.5 12v.1M10.5 12v.1" />
    </>
  ),
  filter: <path d="M3.5 5h17l-6.5 7.4V19l-4-2.2v-4.4z" />,
} as const;

export type IconName = keyof typeof paths;

export function Icon({ name, size = 16, className }: { name: IconName; size?: number; className?: string }): ReactNode {
  return (
    <svg
      className={className}
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth={1.6}
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
      focusable="false"
    >
      {paths[name]}
    </svg>
  );
}
