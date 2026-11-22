import type { SVGProps } from 'react';

const paths = {
  library: <><rect x="3" y="3" width="7" height="7" rx="1.5"/><rect x="14" y="3" width="7" height="7" rx="1.5"/><rect x="3" y="14" width="7" height="7" rx="1.5"/><rect x="14" y="14" width="7" height="7" rx="1.5"/></>,
  heart: <path d="M20.4 4.6a5.5 5.5 0 0 0-7.8 0l-.6.6-.6-.6a5.5 5.5 0 0 0-7.8 7.8L12 21l8.4-8.6a5.5 5.5 0 0 0 0-7.8Z"/>,
  clock: <><circle cx="12" cy="12" r="9"/><path d="M12 7v5l3 2"/></>,
  upload: <><path d="M12 16V3m-5 5 5-5 5 5M4 15v5a1 1 0 0 0 1 1h14a1 1 0 0 0 1-1v-5"/></>,
  plus: <path d="M12 5v14M5 12h14"/>,
  search: <><circle cx="10.8" cy="10.8" r="7.3"/><path d="m16 16 4.5 4.5"/></>,
  settings: <><path d="m9 3-.7 2.2-2 .9L4 5.7 2 9l1.6 1.8v2.4L2 15l2 3.3 2.3-.4 2 .9L9 21h6l.7-2.2 2-.9 2.3.4 2-3.3-1.6-1.8v-2.4L22 9l-2-3.3-2.3.4-2-.9L15 3Z"/><circle cx="12" cy="12" r="3"/></>,
  help: <><circle cx="12" cy="12" r="9"/><path d="M9.5 8.5a2.5 2.5 0 1 1 4.2 1.8c-1 .6-1.7 1.2-1.7 2.7m0 3h.01"/></>,
  chevron: <path d="m9 5 7 7-7 7"/>,
  back: <path d="m14 5-7 7 7 7M7 12h14"/>,
  play: <path d="m9 5 11 7-11 7Z"/>,
  pause: <><path d="M8 5v14M16 5v14"/></>,
  reset: <><path d="M3 10a9 9 0 1 1 1.6 7M3 4v6h6"/></>,
  close: <path d="m6 6 12 12M6 18 18 6"/>,
  check: <path d="m5 12 4 4L19 6"/>,
  warning: <><path d="m10.3 3.7-8 14A2 2 0 0 0 4 21h16a2 2 0 0 0 1.7-3.3l-8-14a2 2 0 0 0-3.4 0Z"/><path d="M12 8v5m0 4h.01"/></>,
  gamepad: <><path d="M7 6h10a4 4 0 0 1 3.9 3.2l1.5 7.3a3 3 0 0 1-5.1 2.7L14 16h-4l-3.3 3.2a3 3 0 0 1-5.1-2.7l1.5-7.3A4 4 0 0 1 7 6Z"/><path d="M7 9v5m-2.5-2.5h5M17 10h.01M19 13h.01"/></>,
  keyboard: <><rect x="2" y="5" width="20" height="14" rx="2"/><path d="M5 9h.01M9 9h.01M13 9h.01M17 9h.01M19 12h.01M5 12h.01M9 12h.01M13 12h.01M7 16h10"/></>,
  save: <><path d="M19 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h12l4 4v12a2 2 0 0 1-2 2Z"/><path d="M7 3v6h10V3M7 21v-8h10v8"/></>,
  load: <><path d="M12 3v12m-4-4 4 4 4-4M4 16v4h16v-4"/></>,
  volume: <><path d="m11 4-6 5H2v6h3l6 5ZM15 8a6 6 0 0 1 0 8m3-11a10 10 0 0 1 0 14"/></>,
  mute: <><path d="m11 4-6 5H2v6h3l6 5ZM16 9l6 6m-6 0 6-6"/></>,
  expand: <path d="M8 3H3v5m13-5h5v5M3 16v5h5m13-5v5h-5"/>,
  cartridge: <><path d="M5 3h14v18H5ZM8 3v4h8V3M8 21v-4h8v4"/><path d="M8 11h8M8 14h5"/></>,
  refresh: <><path d="M20 8a9 9 0 0 0-15-3L2 8m0-5v5h5m-3 8a9 9 0 0 0 15 3l3-3m0 5v-5h-5"/></>,
  list: <><path d="M8 6h13M8 12h13M8 18h13M3 6h.01M3 12h.01M3 18h.01"/></>,
  folder: <path d="M3 7V5a2 2 0 0 1 2-2h5l2 3h7a2 2 0 0 1 2 2v11a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2Z"/>,
  delete: <><path d="M3 6h18M9 6V3h6v3M5 6l1 15h12l1-15M10 10v7M14 10v7"/></>,
  edit: <><path d="m16 3 5 5-12 12-6 1 1-6ZM13 6l5 5"/></>,
} satisfies Record<string, React.ReactNode>;

export type IconName = keyof typeof paths;
export function Icon({ name, size = 20, ...props }: SVGProps<SVGSVGElement> & { name: IconName; size?: number }) {
  return <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true" {...props}>{paths[name]}</svg>;
}
