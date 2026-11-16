import { useSyncExternalStore } from 'react';
import { Engine, type UiState } from '../core/Engine';

export const engine = new Engine();

export function useUi(): UiState {
  return useSyncExternalStore(engine.store.subscribe, engine.store.get);
}
