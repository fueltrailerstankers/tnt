'use client';

import { useSyncExternalStore } from 'react';

const subscribe = () => () => {};

/** document.body after hydration, null during server render, so overlays can portal without a hydration mismatch. */
export function usePortalTarget(): HTMLElement | null {
  return useSyncExternalStore(subscribe, () => document.body, () => null);
}
