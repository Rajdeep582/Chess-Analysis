import type { ReactNode } from 'react';

/** Lightweight accessible tooltip: content is exposed via aria-describedby-like title and CSS popover. */
export function Tip({ text, children, side = 'top' }: { text: string; children: ReactNode; side?: 'top' | 'bottom' | 'left' }) {
  return (
    <span className={`tip tip-${side}`} data-tip={text}>
      {children}
    </span>
  );
}

export function HelpDot({ text }: { text: string }) {
  return (
    <span className="help-dot" tabIndex={0} role="note" aria-label={text} data-tip={text}>
      ?
    </span>
  );
}
