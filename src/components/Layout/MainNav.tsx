import { useLayoutEffect, useRef, useState } from 'react';
import { useApp, useController } from '../../state/context';
import type { PageView } from '../../state/controller';
import { Icon, type IconName } from '../common/Icon';

type NavId = 'analysis' | PageView;

const ITEMS: { id: NavId; label: string; icon: IconName; tone: string; hint: string }[] = [
  { id: 'analysis', label: 'Analysis', icon: 'chart', tone: '#f0b54a', hint: 'Analyze a game or position' },
  { id: 'play', label: 'Play', icon: 'swords', tone: '#ff6b6b', hint: 'Play against Stockfish' },
  { id: 'puzzles', label: 'Puzzles', icon: 'puzzle', tone: '#34c78f', hint: 'Solve puzzles by theme' },
  { id: 'openings', label: 'Openings', icon: 'book', tone: '#7aa7ff', hint: 'Explore the opening book' },
  { id: 'editor', label: 'Editor', icon: 'grid', tone: '#c58cff', hint: 'Set up and analyze any position' },
];

/**
 * Main navigation, shown on every screen: a segmented bar in the header on desktop
 * (with a sliding highlight) and an app-style tab bar at the bottom on phones & tablets.
 */
export function MainNav({ variant }: { variant: 'top' | 'bottom' }) {
  const c = useController();
  const view = useApp((s) => s.view);
  const active: NavId = view === 'home' || view === 'analysis' ? 'analysis' : view;
  const navRef = useRef<HTMLElement>(null);
  const [pill, setPill] = useState<{ x: number; w: number; tone: string } | null>(null);

  // Slide the highlight under the active item (re-measured when the bar resizes).
  useLayoutEffect(() => {
    const nav = navRef.current;
    if (!nav || variant !== 'top') return;
    const measure = () => {
      const el = nav.querySelector<HTMLElement>(`[data-nav="${active}"]`);
      if (el) setPill({ x: el.offsetLeft, w: el.offsetWidth, tone: ITEMS.find((i) => i.id === active)!.tone });
    };
    measure();
    const ro = new ResizeObserver(measure);
    ro.observe(nav);
    return () => ro.disconnect();
  }, [active, variant]);

  const go = (id: NavId) => {
    if (id === 'analysis') c.openAnalysis();
    else c.openPage(id);
  };

  return (
    <nav ref={navRef} className={`main-nav ${variant}`} aria-label="Main sections">
      {variant === 'top' && pill && (
        <span className="mn-pill" aria-hidden="true" style={{ transform: `translateX(${pill.x}px)`, width: pill.w, ['--tone' as string]: pill.tone }} />
      )}
      {ITEMS.map((it) => (
        <button
          key={it.id}
          type="button"
          data-nav={it.id}
          className={`mn-item ${active === it.id ? 'active' : ''}`}
          style={{ ['--tone' as string]: it.tone }}
          aria-current={active === it.id ? 'page' : undefined}
          title={it.hint}
          onClick={() => go(it.id)}
        >
          <span className="mn-icon">
            <Icon name={it.icon} size={variant === 'top' ? 18 : 21} />
          </span>
          <span className="mn-label">{it.label}</span>
        </button>
      ))}
    </nav>
  );
}
