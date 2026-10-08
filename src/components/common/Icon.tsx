/* Original UI icon set (24×24, stroke based). */
const PATHS: Record<string, string> = {
  first: 'M6 5v14M18 6l-8 6 8 6z',
  prev: 'M15 6l-6 6 6 6',
  next: 'M9 6l6 6-6 6',
  last: 'M18 5v14M6 6l8 6-8 6z',
  play: 'M8 5.5v13l10-6.5z',
  pause: 'M8 5.5v13M16 5.5v13',
  flip: 'M7 4v13m0 0l-3-3m3 3l3-3M17 20V7m0 0l-3 3m3-3l3 3',
  settings: 'M12 15.2a3.2 3.2 0 1 0 0-6.4 3.2 3.2 0 0 0 0 6.4zM19.4 13.5l1.6 1.2-1.8 3.1-1.9-.6a7.5 7.5 0 0 1-2 1.2l-.4 2h-3.6l-.4-2a7.5 7.5 0 0 1-2-1.2l-1.9.6-1.8-3.1 1.6-1.2a7.6 7.6 0 0 1 0-2.9L3.1 9.3 4.9 6.2l1.9.6a7.5 7.5 0 0 1 2-1.2l.4-2h3.6l.4 2a7.5 7.5 0 0 1 2 1.2l1.9-.6 1.8 3.1-1.6 1.2a7.6 7.6 0 0 1 0 2.9z',
  share: 'M8.6 13.4l6.8 4M15.4 6.6l-6.8 4M18 8a3 3 0 1 0 0-6 3 3 0 0 0 0 6zM6 15a3 3 0 1 0 0-6 3 3 0 0 0 0 6zM18 22a3 3 0 1 0 0-6 3 3 0 0 0 0 6z',
  save: 'M5 3h11l3 3v15H5zM8 3v5h7V3M8 21v-7h8v7',
  folder: 'M3 6.5A1.5 1.5 0 0 1 4.5 5h4.6l2 2.2h8.4A1.5 1.5 0 0 1 21 8.7V18a1.5 1.5 0 0 1-1.5 1.5h-15A1.5 1.5 0 0 1 3 18z',
  download: 'M12 4v11m0 0l-4.5-4.5M12 15l4.5-4.5M4.5 19.5h15',
  upload: 'M12 16V5m0 0L7.5 9.5M12 5l4.5 4.5M4.5 19.5h15',
  plus: 'M12 5v14M5 12h14',
  close: 'M6 6l12 12M18 6L6 18',
  help: 'M12 21a9 9 0 1 0 0-18 9 9 0 0 0 0 18zM9.6 9.3a2.5 2.5 0 1 1 3.6 2.2c-.8.4-1.2 1-1.2 1.8v.5M12 17h.01',
  arrows: 'M4 20L15 9m0 0h-6m6 0v6M20 4v5m0-5h-5',
  power: 'M12 3v8M7 6.3a7 7 0 1 0 10 0',
  star: 'M12 3l2.6 5.9 6.4.6-4.8 4.3 1.4 6.3L12 16.9 6.4 20.1l1.4-6.3L3 9.5l6.4-.6z',
  trash: 'M4.5 7h15M9.5 7V4.5h5V7M6.5 7l1 13h9l1-13',
  copy: 'M9 9h11v11H9zM5 15H4V4h11v1',
  edit: 'M4 20h4l11-11-4-4L4 16zM14 6l4 4',
  home: 'M3.5 11L12 4l8.5 7M6 9.5V20h12V9.5',
  undo: 'M9 14L4 9l5-5M4 9h10.5a5.5 5.5 0 0 1 0 11H11',
  bolt: 'M13 3L5 13.5h6L10 21l8-10.5h-6z',
  info: 'M12 21a9 9 0 1 0 0-18 9 9 0 0 0 0 18zM12 11v5.5M12 7.6h.01',
  more: 'M5 12h.01M12 12h.01M19 12h.01',
  check: 'M5 12.5l4.5 4.5L19 7.5',
  target: 'M12 21a9 9 0 1 0 0-18 9 9 0 0 0 0 18zM12 16a4 4 0 1 0 0-8 4 4 0 0 0 0 8zM12 12h.01',
  file: 'M6 3h8l4 4v14H6zM14 3v4h4',
  chart: 'M4 19.5h16M6 16l4-5 3.5 3L19 7',
  keyboard: 'M3 6.5h18v11H3zM7 10h.01M10.5 10h.01M14 10h.01M17.5 10h.01M8 14h8',
};

export type IconName = keyof typeof PATHS;

export function Icon({ name, size = 18, className }: { name: IconName; size?: number; className?: string }) {
  return (
    <svg
      className={`icon ${className ?? ''}`}
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth={1.8}
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
      focusable="false"
    >
      <path d={PATHS[name]} />
    </svg>
  );
}
