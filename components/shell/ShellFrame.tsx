'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { useCallback, useEffect, useRef, useState, type ReactNode } from 'react';
import { Icon } from '@/components/ui/Icon';
import { Logo } from '@/components/ui/Logo';
import { ThemeToggle } from '@/components/ui/ThemeToggle';
import { activeKey } from '@/lib/ui/nav';
import { GlobalSearch } from './GlobalSearch';
import type { ShellNavItem, ShellUser, ShellXero } from './types';
import { UserMenu } from './UserMenu';

function Badge({ text, small = false }: { text: string; small?: boolean }) {
  if (!text) return null;
  return (
    <span
      aria-label={`${text} waiting`}
      className={`flex items-center justify-center rounded-pill bg-danger font-bold text-white ${small ? 'absolute right-[18px] top-1 h-[18px] min-w-[18px] px-[5px] text-[10px]' : 'h-5 min-w-5 px-1.5 text-[11px]'}`}
    >
      {text}
    </span>
  );
}

const isDesktop = () => window.matchMedia('(min-width: 1024px)').matches;

/**
 * Desktop (>= 1024px): charcoal sidebar + top bar. Phone: charcoal top bar with a hamburger drawer and a bottom tab bar.
 * Both are rendered and switched with CSS so there is no layout shift and no second data fetch.
 */
export function ShellFrame({
  items, user, xero, signOut, children,
}: { items: ShellNavItem[]; user: ShellUser; xero: ShellXero | null; signOut: () => Promise<void>; children: ReactNode }) {
  const pathname = usePathname();
  const current = activeKey(pathname, items);
  const [menu, setMenu] = useState(false);
  const [phoneSearch, setPhoneSearch] = useState(false);
  const deskSearch = useRef<HTMLInputElement>(null);
  const phoneSearchInput = useRef<HTMLInputElement>(null);
  const menuButton = useRef<HTMLButtonElement>(null);
  const closeButton = useRef<HTMLButtonElement>(null);
  const drawer = useRef<HTMLElement>(null);
  const tabs = items.filter((i) => i.tab);

  // Navigating closes the drawer and the phone search row.
  useEffect(() => { setMenu(false); setPhoneSearch(false); }, [pathname]);

  // "/" focuses global search (not while typing in a field).
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== '/' || e.ctrlKey || e.metaKey || e.altKey) return;
      const t = e.target as HTMLElement | null;
      if (t && (t.isContentEditable || /^(INPUT|TEXTAREA|SELECT)$/.test(t.tagName))) return;
      e.preventDefault();
      if (isDesktop()) deskSearch.current?.focus();
      else setPhoneSearch(true);
    };
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, []);

  useEffect(() => { if (phoneSearch) phoneSearchInput.current?.focus(); }, [phoneSearch]);

  const closeMenu = useCallback(() => {
    setMenu(false);
    menuButton.current?.focus();
  }, []);

  // Drawer: focus the close button, Escape closes, Tab stays inside, page behind does not scroll.
  useEffect(() => {
    if (!menu) return;
    closeButton.current?.focus();
    const prev = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') { closeMenu(); return; }
      if (e.key !== 'Tab' || !drawer.current) return;
      const f = Array.from(drawer.current.querySelectorAll<HTMLElement>('a[href],button:not([disabled])'));
      if (!f.length) return;
      const first = f[0], last = f[f.length - 1];
      if (e.shiftKey && document.activeElement === first) { e.preventDefault(); last.focus(); }
      else if (!e.shiftKey && document.activeElement === last) { e.preventDefault(); first.focus(); }
    };
    document.addEventListener('keydown', onKey);
    return () => { document.removeEventListener('keydown', onKey); document.body.style.overflow = prev; };
  }, [menu, closeMenu]);

  return (
    <div className="flex min-h-screen bg-bg text-fg">
      {/* Desktop sidebar */}
      <aside aria-label="Main navigation" className="sticky top-0 hidden h-screen w-[232px] flex-none flex-col gap-1 border-r border-side-border bg-side px-3 py-4 lg:flex">
        <Link href="/admin" aria-label="Trailers & Tankers home" className="flex items-center px-2 pb-4 pt-1">
          <Logo variant="on-dark" height={40} />
        </Link>
        <nav aria-label="Primary" className="flex flex-col gap-0.5">
          {items.map((n) => {
            const active = n.key === current;
            return (
              <Link
                key={n.key}
                href={n.href}
                aria-current={active ? 'page' : undefined}
                className={`flex h-[38px] items-center gap-2.5 rounded-pill px-3 text-body no-underline ${active ? 'bg-side-active font-semibold text-white' : 'text-side-muted hover:bg-side-active/60'}`}
              >
                <Icon name={n.icon} />
                <span className="flex-1">{n.label}</span>
                <Badge text={n.badge} />
              </Link>
            );
          })}
        </nav>
        {xero ? (
          <div className="mt-auto flex flex-col gap-1 border-t border-side-border px-2.5 pb-1 pt-3 text-[12px] leading-4 text-side-muted">
            <span className="flex items-center gap-1.5 font-semibold text-side-fg">
              <span aria-hidden="true" className={`size-2 rounded-full ${xero.connected ? 'bg-side-ok' : 'bg-danger'}`} />
              {xero.connected ? 'Xero connected' : 'Xero not connected'}
            </span>
            <span>{xero.lastSync ? `Last sync ${xero.lastSync}` : 'No sync yet'}</span>
          </div>
        ) : null}
      </aside>

      <div className="flex min-w-0 flex-1 flex-col">
        {/* Desktop top bar */}
        <header className="hidden flex-wrap items-center gap-3 border-b border-border bg-surface px-7 py-[11px] lg:flex">
          <GlobalSearch inputRef={deskSearch} className="max-w-[560px] flex-1 basis-72" />
          <div className="ml-auto flex items-center gap-1.5">
            <ThemeToggle />
            <UserMenu name={user.name} initials={user.initials} role={user.role} signOut={signOut} />
          </div>
        </header>

        {/* Phone top bar */}
        <header className="sticky top-0 z-20 flex flex-none items-center gap-2 bg-side px-3 py-2.5 text-side-fg lg:hidden">
          <button
            ref={menuButton}
            type="button"
            aria-label="Open menu"
            aria-expanded={menu}
            onClick={() => setMenu(true)}
            className="flex size-11 items-center justify-center rounded-lg text-side-fg"
          >
            <Icon name="menu" size={22} />
          </button>
          <Link href="/admin" aria-label="Trailers & Tankers home" className="flex flex-1 items-center">
            <Logo variant="on-dark" height={30} />
          </Link>
          <button
            type="button"
            aria-label="Search quote no, VIN or invoice no"
            aria-expanded={phoneSearch}
            onClick={() => setPhoneSearch((o) => !o)}
            className="flex size-11 items-center justify-center rounded-lg text-side-fg"
          >
            <Icon name="search" size={20} />
          </button>
        </header>
        {phoneSearch ? (
          <div className="border-b border-border bg-surface px-3 py-2 lg:hidden">
            <GlobalSearch inputRef={phoneSearchInput} showHint={false} className="h-11 w-full" />
          </div>
        ) : null}

        <main className="mx-auto w-full max-w-[1360px] flex-1 px-4 pb-28 pt-5 lg:px-7 lg:pb-10 lg:pt-6">{children}</main>

        {/* Phone bottom tabs */}
        <nav
          aria-label="Quick links"
          style={{ gridTemplateColumns: `repeat(${Math.max(tabs.length, 1)}, minmax(0, 1fr))` }}
          className="fixed inset-x-0 bottom-0 z-20 grid border-t border-border bg-surface px-1.5 pb-2.5 pt-1.5 lg:hidden"
        >
          {tabs.map((t) => {
            const active = t.key === current;
            return (
              <Link
                key={t.key}
                href={t.href}
                aria-current={active ? 'page' : undefined}
                className={`relative flex min-h-[52px] flex-col items-center justify-center gap-[3px] rounded-lg text-[11px] font-semibold no-underline ${active ? 'bg-accent-soft text-accent-text' : 'text-fg-muted'}`}
              >
                <Icon name={t.icon} size={22} />
                {t.label}
                <Badge text={t.badge} small />
              </Link>
            );
          })}
        </nav>
      </div>

      {/* Phone drawer */}
      {menu ? (
        <div className="fixed inset-0 z-40 lg:hidden">
          <div aria-hidden="true" onClick={closeMenu} className="absolute inset-0 bg-overlay" />
          <aside ref={drawer} role="dialog" aria-modal="true" aria-label="Menu" className="absolute inset-y-0 left-0 flex w-[300px] max-w-[85vw] flex-col gap-1 overflow-y-auto bg-side p-3 text-side-fg">
            <div className="flex items-center gap-2.5 px-1 pb-3.5 pt-1">
              <div className="flex flex-1 flex-col gap-1 leading-tight">
                <Logo variant="on-dark" height={36} />
                <span className="text-[12px] text-side-muted">{user.name} · <span className="capitalize">{user.role}</span></span>
              </div>
              <button ref={closeButton} type="button" aria-label="Close menu" onClick={closeMenu} className="flex size-11 items-center justify-center rounded-lg text-side-fg">
                <Icon name="close" size={20} strokeWidth={2} />
              </button>
            </div>
            {items.map((m) => (
              <Link
                key={m.key}
                href={m.href}
                aria-current={m.key === current ? 'page' : undefined}
                className={`flex h-12 items-center gap-3 rounded-pill px-3 text-[15px] font-medium no-underline ${m.key === current ? 'bg-side-active text-white' : 'text-side-muted'}`}
              >
                <Icon name={m.icon} size={20} />
                <span className="flex-1">{m.label}</span>
                <Badge text={m.badge} />
              </Link>
            ))}
            <ThemeToggle variant="menu" />
            <form action={signOut}>
              <button className="h-12 w-full rounded-pill border border-side-border bg-transparent text-sm font-semibold text-side-fg">Sign out</button>
            </form>
          </aside>
        </div>
      ) : null}
    </div>
  );
}
