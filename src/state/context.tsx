import { createContext, useContext } from 'react';
import type { AnalysisController, AppState } from './controller';
import { useStoreSelector } from './store';

export const ControllerContext = createContext<AnalysisController | null>(null);

export function useController(): AnalysisController {
  const c = useContext(ControllerContext);
  if (!c) throw new Error('ControllerContext missing');
  return c;
}

export function useApp<S>(selector: (s: AppState) => S): S {
  const c = useController();
  return useStoreSelector(c.store, selector);
}
