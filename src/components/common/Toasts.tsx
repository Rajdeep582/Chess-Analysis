import { useApp, useController } from '../../state/context';
import { Icon } from './Icon';

export function Toasts() {
  const c = useController();
  const toasts = useApp((s) => s.toasts);
  return (
    <div className="toasts" role="status" aria-live="polite">
      {toasts.map((t) => (
        <div key={t.id} className={`toast ${t.kind}`}>
          <Icon name={t.kind === 'error' ? 'info' : t.kind === 'success' ? 'check' : 'info'} size={16} />
          <div>
            <div>{t.text}</div>
            {t.detail && <div className="toast-detail">{t.detail}</div>}
          </div>
          <button type="button" className="icon-btn tiny" aria-label="Dismiss" onClick={() => c.dismissToast(t.id)}>
            <Icon name="close" size={14} />
          </button>
        </div>
      ))}
    </div>
  );
}
