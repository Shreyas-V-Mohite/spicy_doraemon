import { useCallback, useMemo, useState } from 'react';
import { MAX_SCENE_MOLECULES, type SceneItem, type SceneStore } from './types';
import type { ViewState } from '../viewer/viewState';

/** Solo mode: the same scene API, kept in React state. */
export function useLocalScene(): SceneStore {
  const [items, setItems] = useState<SceneItem[]>([]);
  const [lastError, setLastError] = useState<string>();

  const add = useCallback((moleculeId: string) => {
    setItems((prev) => {
      if (prev.length >= MAX_SCENE_MOLECULES) {
        setLastError(`At most ${MAX_SCENE_MOLECULES} molecules — drop one in the trash first.`);
        return prev;
      }
      setLastError(undefined);
      return [...prev, { key: `local-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`, moleculeId, view: null, gesture: 'IDLE', seq: 0 }];
    });
  }, []);

  const update = useCallback((key: string, view: ViewState, gesture: string) => {
    setItems((prev) => prev.map((it) => (it.key === key ? { ...it, view, gesture, seq: it.seq + 1 } : it)));
  }, []);

  const remove = useCallback((key: string) => {
    setItems((prev) => prev.filter((it) => it.key !== key));
  }, []);

  return useMemo(() => ({ items, canEdit: true, add, update, remove, lastError }), [items, add, update, remove, lastError]);
}
