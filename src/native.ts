// Native (Capacitor Android) integration. All imports are dynamic so the web build stays lean.
import { Capacitor } from '@capacitor/core';

export const isNative = Capacitor.isNativePlatform();

export async function initNative(): Promise<void> {
  if (!isNative) return;
  document.documentElement.classList.add('native-app');
  const [{ StatusBar, Style }, { SplashScreen }, { App }] = await Promise.all([
    import('@capacitor/status-bar'),
    import('@capacitor/splash-screen'),
    import('@capacitor/app'),
  ]);
  const syncBar = () => {
    const light = document.documentElement.dataset.theme === 'light';
    StatusBar.setStyle({ style: light ? Style.Light : Style.Dark }).catch(() => {});
    StatusBar.setBackgroundColor({ color: light ? '#f4f2ee' : '#0f1116' }).catch(() => {});
  };
  syncBar();
  new MutationObserver(syncBar).observe(document.documentElement, { attributes: true, attributeFilter: ['data-theme'] });
  // Hardware back: close an open dialog first, then step back in history, then exit.
  App.addListener('backButton', ({ canGoBack }) => {
    const dialog = document.querySelector<HTMLElement>('[role="dialog"]');
    if (dialog) {
      document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
      return;
    }
    if (canGoBack) window.history.back();
    else App.exitApp();
  });
  requestAnimationFrame(() => SplashScreen.hide({ fadeOutDuration: 200 }).catch(() => {}));
}

/** Light haptic tick on native; no-op on the web. */
export function hapticTap(): void {
  if (!isNative) return;
  import('@capacitor/haptics').then(({ Haptics, ImpactStyle }) => Haptics.impact({ style: ImpactStyle.Light })).catch(() => {});
}
