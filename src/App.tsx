import { useEffect, useMemo } from 'react';
import { AnalysisController } from './state/controller';
import { ControllerContext, useApp, useController } from './state/context';
import { Header } from './components/Layout/Header';
import { HomeScreen } from './components/PGNInput/HomeScreen';
import { AnalysisView } from './components/Layout/AnalysisView';
import { SettingsPanel } from './components/SettingsPanel/SettingsPanel';
import { SavedAnalyses } from './components/SavedAnalyses/SavedAnalyses';
import { ExportDialog, SaveDialog, ShareDialog, ShortcutsDialog } from './components/Layout/Dialogs';
import { Toasts } from './components/common/Toasts';

function isTyping(el: EventTarget | null): boolean {
  const t = el as HTMLElement | null;
  if (!t) return false;
  return t.isContentEditable || ['INPUT', 'TEXTAREA', 'SELECT'].includes(t.tagName);
}

function Shell() {
  const c = useController();
  const view = useApp((s) => s.view);
  const modal = useApp((s) => s.modal);
  const theme = useApp((s) => s.settings.appearance.theme);
  const reduce = useApp((s) => s.settings.performance.reduceMotion || s.settings.performance.lowPower);

  useEffect(() => {
    const root = document.documentElement;
    const apply = () => {
      const dark = theme === 'dark' || (theme === 'system' && window.matchMedia('(prefers-color-scheme: dark)').matches);
      root.dataset.theme = dark ? 'dark' : 'light';
      document.querySelector('meta[name="theme-color"]')?.setAttribute('content', dark ? '#11141a' : '#f4f2ee');
    };
    apply();
    const m = window.matchMedia('(prefers-color-scheme: dark)');
    m.addEventListener('change', apply);
    return () => m.removeEventListener('change', apply);
  }, [theme]);

  useEffect(() => {
    document.documentElement.classList.toggle('reduce-motion', reduce);
  }, [reduce]);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (isTyping(e.target) || e.metaKey || e.ctrlKey || e.altKey) return;
      const s = c.state;
      if (e.key === 'Escape') {
        if (s.modal) c.closeModal();
        else if (s.retry) c.exitRetry();
        return;
      }
      if (e.key === '?') {
        c.openModal('shortcuts');
        return;
      }
      if (s.modal || s.view !== 'analysis') return;
      switch (e.key) {
        case 'ArrowLeft':
          c.prev();
          break;
        case 'ArrowRight':
          c.next();
          break;
        case 'Home':
          c.first();
          break;
        case 'End':
          c.last();
          break;
        case ' ':
          c.toggleAutoplay();
          break;
        case 'f':
        case 'F':
          c.flip();
          break;
        case 'r':
        case 'R':
          void c.startReview();
          break;
        case 'a':
        case 'A':
          c.updateSettings((x) => ({ ...x, board: { ...x.board, showArrows: !x.board.showArrows } }));
          break;
        case 'e':
        case 'E':
          c.toggleEngine();
          break;
        default:
          return;
      }
      e.preventDefault();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [c]);

  return (
    <div className="app">
      <a className="skip-link" href="#main">
        Skip to content
      </a>
      <Header />
      {view === 'home' ? <HomeScreen /> : <AnalysisView />}
      {modal === 'settings' && <SettingsPanel />}
      {modal === 'saved' && <SavedAnalyses />}
      {modal === 'save' && <SaveDialog />}
      {modal === 'share' && <ShareDialog />}
      {modal === 'export' && <ExportDialog />}
      {modal === 'shortcuts' && <ShortcutsDialog />}
      <Toasts />
    </div>
  );
}

export default function App() {
  const controller = useMemo(() => new AnalysisController(), []);
  useEffect(() => {
    // Debug handle for automated browser tests (?debug in the URL).
    if (new URLSearchParams(window.location.search).has('debug')) (window as unknown as { __outpost: AnalysisController }).__outpost = controller;
    controller.init();
    return () => controller.engine.dispose();
  }, [controller]);
  return (
    <ControllerContext.Provider value={controller}>
      <Shell />
    </ControllerContext.Provider>
  );
}
