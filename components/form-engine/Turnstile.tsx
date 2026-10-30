'use client';

import { useEffect, useRef } from 'react';
import { TURNSTILE_FIELD } from '@/lib/security/turnstile';

interface TurnstileApi {
  render: (el: HTMLElement, opts: Record<string, unknown>) => string;
  reset: (id?: string) => void;
  remove: (id: string) => void;
}
declare global {
  interface Window {
    turnstile?: TurnstileApi;
  }
}

const SRC = 'https://challenges.cloudflare.com/turnstile/v0/api.js?render=explicit';

function loadScript(): Promise<TurnstileApi> {
  return new Promise((resolve, reject) => {
    if (window.turnstile) return resolve(window.turnstile);
    let s = document.querySelector<HTMLScriptElement>('script[data-turnstile]');
    if (!s) {
      s = document.createElement('script');
      s.src = SRC;
      s.async = true;
      s.dataset.turnstile = '1';
      document.head.appendChild(s);
    }
    s.addEventListener('load', () => (window.turnstile ? resolve(window.turnstile) : reject(new Error('turnstile'))));
    s.addEventListener('error', () => reject(new Error('turnstile')));
  });
}

/**
 * Cloudflare Turnstile widget. It adds the hidden cf-turnstile-response input to the enclosing form; the server
 * verifies it. Tokens are single use, so `resetKey` changes after every server reply to get a fresh one.
 */
export function Turnstile({ siteKey, resetKey }: { siteKey: string; resetKey?: number }) {
  const box = useRef<HTMLDivElement>(null);
  const id = useRef<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    loadScript()
      .then((t) => {
        if (cancelled || !box.current || id.current) return;
        id.current = t.render(box.current, { sitekey: siteKey, theme: 'auto', size: 'flexible', 'response-field-name': TURNSTILE_FIELD });
      })
      .catch(() => { /* The server refuses the submit with a clear message; nothing else to do here. */ });
    return () => {
      cancelled = true;
      if (id.current) window.turnstile?.remove(id.current);
      id.current = null;
    };
  }, [siteKey]);

  useEffect(() => {
    if (resetKey && id.current) window.turnstile?.reset(id.current);
  }, [resetKey]);

  return <div ref={box} className="min-h-[65px]" aria-label="Security check" role="group" />;
}
