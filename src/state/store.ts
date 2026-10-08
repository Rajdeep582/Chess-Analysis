import { useSyncExternalStore } from 'react';

export class Store<T extends object> {
  private listeners = new Set<() => void>();
  constructor(private state: T) {}

  getState = (): T => this.state;

  setState = (patch: Partial<T> | ((s: T) => Partial<T>)): void => {
    const p = typeof patch === 'function' ? patch(this.state) : patch;
    let changed = false;
    for (const k in p) {
      if (!Object.is((p as T)[k], this.state[k])) {
        changed = true;
        break;
      }
    }
    if (!changed) return;
    this.state = { ...this.state, ...p };
    for (const l of this.listeners) l();
  };

  subscribe = (fn: () => void): (() => void) => {
    this.listeners.add(fn);
    return () => this.listeners.delete(fn);
  };
}

export function useStoreSelector<T extends object, S>(store: Store<T>, selector: (s: T) => S): S {
  return useSyncExternalStore(store.subscribe, () => selector(store.getState()), () => selector(store.getState()));
}
