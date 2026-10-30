'use client';

import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import { pushToast, toastAnnouncement, toastDuration, toastPoliteness, type ToastInput, type ToastItem } from '@/lib/ui/toast';
import { Toast } from './Toast';

export interface ToastApi {
  /** Shows a toast and returns its id. Never put personal data, file names, emails or tokens in it. */
  toast: (t: ToastInput) => number;
  dismiss: (id: number) => void;
}

const ToastContext = createContext<ToastApi | null>(null);

const NOOP: ToastApi = { toast: () => 0, dismiss: () => {} };

/** Toasts from anywhere under the provider. Outside a provider it does nothing. */
export function useToast(): ToastApi {
  return useContext(ToastContext) ?? NOOP;
}

interface Announcement { id: number; text: string }

/**
 * Bottom-right stack on desktop, bottom-centre above the phone tab bar. At most 3; success and info leave after
 * 5 s (paused while hovered or focused); errors stay until dismissed.
 *
 * Screen readers: two visually hidden live regions are always in the page. Each new toast's text is added to the
 * polite one (success, info) or the assertive one (errors), so it is announced once even though the card itself
 * appears later in the DOM. The cards are not live regions, which avoids double announcements.
 */
export function ToastProvider({ children }: { children: ReactNode }) {
  const [items, setItems] = useState<ToastItem[]>([]);
  const [polite, setPolite] = useState<Announcement | null>(null);
  const [assertive, setAssertive] = useState<Announcement | null>(null);
  const seq = useRef(0);

  const dismiss = useCallback((id: number) => setItems((list) => list.filter((t) => t.id !== id)), []);
  const toast = useCallback((t: ToastInput) => {
    const id = ++seq.current;
    const item: ToastItem = { ...t, id, tone: t.tone ?? 'success' };
    setItems((list) => pushToast(list, item));
    const said = { id, text: toastAnnouncement(item) };
    if (toastPoliteness(item.tone) === 'assertive') setAssertive(said);
    else setPolite(said);
    return id;
  }, []);
  const api = useMemo(() => ({ toast, dismiss }), [toast, dismiss]);

  return (
    <ToastContext.Provider value={api}>
      {children}
      <div aria-live="polite" aria-atomic="true" className="sr-only" data-testid="toast-announcer-polite">
        {polite ? <p key={polite.id}>{polite.text}</p> : null}
      </div>
      <div aria-live="assertive" aria-atomic="true" className="sr-only" data-testid="toast-announcer-assertive">
        {assertive ? <p key={assertive.id}>{assertive.text}</p> : null}
      </div>
      {items.length ? (
        <section
          aria-label="Notifications"
          className="pointer-events-none fixed inset-x-4 bottom-[84px] z-[60] flex flex-col items-center gap-2 lg:inset-x-auto lg:bottom-6 lg:right-6 lg:items-end"
        >
          {items.map((t) => <TimedToast key={t.id} item={t} onDismiss={dismiss} />)}
        </section>
      ) : null}
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
