import Link from 'next/link';
import { Icon } from '@/components/ui/Icon';

export interface FormTab {
  slug: string;
  label: string;
  encrypted: boolean;
}

/** Form switcher above the grid (handoff tab strip): links, the current one marked aria-current. Scrolls on phones. */
export function FormTabs({ tabs, current }: { tabs: readonly FormTab[]; current: string }) {
  return (
    <nav aria-label="Forms" className="-mx-4 overflow-x-auto px-4 sm:mx-0 sm:px-0">
      <ul className="m-0 flex min-w-max list-none gap-1 border-b border-border p-0">
        {tabs.map((t) => {
          const on = t.slug === current;
          return (
            <li key={t.slug}>
              <Link
                href={`/admin/forms/${t.slug}`}
                aria-current={on ? 'page' : undefined}
                className={`inline-flex h-11 items-center gap-1.5 whitespace-nowrap px-3 text-body no-underline sm:h-10 ${on ? 'font-semibold text-fg shadow-[inset_0_-2px_0_var(--color-accent)]' : 'text-fg-muted hover:text-fg'}`}
              >
                {t.label}
                {t.encrypted ? (
                  <>
                    <Icon name="lock" size={12} strokeWidth={2} />
                    <span className="sr-only"> (encrypted)</span>
                  </>
                ) : null}
              </Link>
            </li>
          );
        })}
      </ul>
    </nav>
  );
}
