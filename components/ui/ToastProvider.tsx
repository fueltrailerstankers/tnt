'use client';

import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import { pushToast, toastDuration, type ToastInput, type ToastItem } from '@/lib/ui/toast';
import { Toast } from './Toast';

export interface ToastApi {
  /** Shows a toast and returns its id. Never put personal data, file names, emails or tokens in it. */
  toast: (t: ToastInput) => number;
  dismiss: (id: number) => void;
}

const ToastContext = createContext<ToastApi | null>(null);

const NOOP: ToastApi = { toast: () => 0, dismiss: () => {} };

/** Toasts from anywhere under the provider (mounted in the admin layout). Outside a provider it does nothing. */
export function useToast(): ToastApi {
  return useContext(ToastContext) ?? NOOP;
}

/**
 * Bottom-right stack on desktop, bottom-centre above the phone tab bar. At most 3; success and info leave after
 * 5 s (paused while hovered or focused); errors stay until dismissed.
 */
export function ToastProvider({ children }: { children: ReactNode }) {
  const [items, setItems] = useState<ToastItem[]>([]);
  const seq = useRef(0);

  const dismiss = useCallback((id: number) => setItems((list) => list.filter((t) => t.id !== id)), []);
  const toast = useCallback((t: ToastInput) => {
    const id = ++seq.current;
    setItems((list) => pushToast(list, { ...t, id, tone: t.tone ?? 'success' }));
    return id;
  }, []);
  const api = useMemo(() => ({ toast, dismiss }), [toast, dismiss]);

  return (
    <ToastContext.Provider value={api}>
      {children}
      <div className="pointer-events-none fixed inset-x-4 bottom-[84px] z-[60] flex flex-col items-center gap-2 lg:inset-x-auto lg:bottom-6 lg:right-6 lg:items-end">
        {items.map((t) => <TimedToast key={t.id} item={t} onDismiss={dismiss} />)}
      </div>
    </ToastContext.Provider>
  );
}

function TimedToast({ item, onDismiss }: { item: ToastItem; onDismiss: (id: number) => void }) {
  const [paused, setPaused] = useState(false);
  const delay = toastDuration(item);
  const remaining = useRef(delay ?? 0);

  useEffect(() => {
    if (delay === null || paused) return;
    const started = Date.now();
    const timer = window.setTimeout(() => onDismiss(item.id), Math.max(0, remaining.current));
    return () => {
      window.clearTimeout(timer);
      remaining.current -= Date.now() - started;
    };
  }, [delay, paused, item.id, onDismiss]);

  return (
    <Toast
      tone={item.tone}
      title={item.title}
      body={item.body}
      action={item.action}
      onDismiss={() => onDismiss(item.id)}
      onMouseEnter={() => setPaused(true)}
      onMouseLeave={() => setPaused(false)}
      onFocus={() => setPaused(true)}
      onBlur={(e) => { if (!e.currentTarget.contains(e.relatedTarget as Node | null)) setPaused(false); }}
    />
  );
}
