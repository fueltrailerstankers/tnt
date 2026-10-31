import Link from 'next/link';
import { Badge } from '@/components/ui/Badge';
import { Icon } from '@/components/ui/Icon';
import { buttonClass } from '@/components/ui/styles';
import { formatCount, type FormCardModel } from '@/lib/admin/forms-index';
import type { Tone } from '@/lib/ui/status';
import { PublicLinkButton } from './PublicLinkButton';

const FLAG: Record<Tone, string> = {
  gray: 'bg-status-gray-bg text-status-gray-fg',
  teal: 'bg-status-teal-bg text-status-teal-fg',
  yellow: 'bg-status-yellow-bg text-status-yellow-fg',
  green: 'bg-status-green-bg text-status-green-fg',
  red: 'bg-status-red-bg text-status-red-fg',
};

export interface FormCardLinks {
  publicUrl: string | null;
  design: boolean;
  settings: boolean;
  importEntries: boolean;
}

/** One form on /admin/forms: icon, name, access and encrypted badges, entry and unread counts, New entry, Public link. */
export function FormCard({ card, links }: { card: FormCardModel; links: FormCardLinks }) {
  const titleId = `form-card-title-${card.slug}`;
  const manage = links.design || links.settings || links.importEntries;
  return (
    <li className="flex">
      <article
        aria-labelledby={titleId}
        data-testid={`form-card-${card.slug}`}
        className="flex w-full flex-col gap-3.5 rounded-md border border-border bg-surface p-[18px] text-fg shadow-card"
      >
        <div className="flex items-start gap-3">
          <span aria-hidden="true" className="flex size-10 flex-none items-center justify-center rounded-md bg-surface-2 text-fg">
            <Icon name={card.icon} size={20} />
          </span>
          <div className="flex min-w-0 flex-1 flex-col gap-1">
            <h2 id={titleId} className="m-0 text-base font-semibold leading-6">
              <Link href={card.href} className="text-fg no-underline hover:underline">{card.label}</Link>
            </h2>
            <div className="flex flex-wrap gap-1.5">
              <Badge variant="neutral">{card.access}</Badge>
              {card.encrypted ? <Badge variant="encrypted" /> : null}
              {card.autoFromXero ? <Badge variant="auto" /> : null}
              {card.flag ? (
                <span className={`inline-flex items-center whitespace-nowrap rounded-xs px-[7px] py-0.5 text-[11px] font-semibold leading-4 ${FLAG[card.flag.tone]}`}>
                  {card.flag.label}
                </span>
              ) : null}
            </div>
          </div>
        </div>

        <dl className="m-0 flex gap-6">
          <div className="flex flex-col-reverse">
            <dt className="text-[12px] leading-4 text-fg-muted">entries</dt>
            <dd className="m-0 font-mono text-[22px] font-semibold leading-7">{formatCount(card.entries)}</dd>
          </div>
          <div className="flex flex-col-reverse">
            <dt className="text-[12px] leading-4 text-fg-muted">unread</dt>
            <dd className={`m-0 font-mono text-[22px] font-semibold leading-7 ${card.unread ? 'text-accent-text' : 'text-fg-muted'}`}>
              {card.unread ? (
                <Link href={`${card.href}?view=unread`} className="text-accent-text no-underline hover:underline" aria-label={`${card.unread} unread in ${card.label}`}>
                  {formatCount(card.unread)}
                </Link>
              ) : '0'}
            </dd>
          </div>
        </dl>

        <div className="mt-auto flex flex-col gap-2.5">
          <div className="flex gap-2">
            {card.newHref ? (
              <Link href={card.newHref} className={buttonClass('primary', 44, 'flex-1 sm:h-9 sm:px-3.5 sm:text-body')} aria-label={`New entry in ${card.label}`}>
                <Icon name="plus" size={14} strokeWidth={2.25} />
                New entry
              </Link>
            ) : null}
            {card.publicPath && links.publicUrl ? (
              <PublicLinkButton formLabel={card.label} url={links.publicUrl} path={card.publicPath} />
            ) : (
              <button type="button" disabled className={buttonClass('secondary', 44, 'flex-1 font-medium sm:h-9 sm:px-3.5 sm:text-body')}>
                <Icon name="lock" size={14} />
                Internal only
              </button>
            )}
          </div>
          {manage ? (
            <div className="flex flex-wrap items-center gap-x-3 gap-y-1 border-t border-border pt-2 text-small">
              {links.design ? <Link href={`${card.href}/design`} className={buttonClass('link', 36, 'min-h-11 sm:min-h-0')}>Design</Link> : null}
              {links.settings ? <Link href={`${card.href}/settings`} className={buttonClass('link', 36, 'min-h-11 sm:min-h-0')}>Settings</Link> : null}
              {links.importEntries ? <Link href={`/admin/forms/import#form-${card.slug}`} className={buttonClass('link', 36, 'min-h-11 sm:min-h-0')}>Import entries</Link> : null}
            </div>
          ) : null}
        </div>
      </article>
    </li>
  );
}
