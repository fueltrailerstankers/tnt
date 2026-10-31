import { FilterChips, type FilterChip } from '@/components/ui/FilterChips';
import { Icon } from '@/components/ui/Icon';
import { buttonClass } from '@/components/ui/styles';

/**
 * Search (GET form: works without JS, keeps the other filters) and link filter chips. `hidden` carries the filters
 * the search keeps (status, type); the page always restarts at 1.
 */
export function MirrorToolbar({ action, searchLabel, q, placeholder, hidden, statusChips, status, typeChips, type }: {
  action: string;
  /** Names the search landmark, e.g. "Search quotes". */
  searchLabel: string;
  q: string | null;
  placeholder: string;
  hidden: Record<string, string | null>;
  statusChips: readonly FilterChip[];
  status: string;
  typeChips?: readonly FilterChip[];
  type?: string;
}) {
  return (
    <div className="flex flex-col gap-3 border-b border-border px-3.5 py-3">
      <div className="flex flex-wrap items-center gap-3">
        <form method="get" action={action} role="search" aria-label={searchLabel} className="flex min-w-0 flex-[1_1_280px] items-center gap-2 sm:max-w-[420px]">
          {Object.entries(hidden).map(([k, v]) => (v ? <input key={k} type="hidden" name={k} value={v} /> : null))}
          <label className="flex h-9 min-w-0 flex-1 items-center gap-2 rounded-sm border border-border-strong bg-surface-2 px-2.5 text-fg-muted focus-within:border-focus focus-within:ring-2 focus-within:ring-focus/25">
            <Icon name="search" size={14} strokeWidth={2} />
            <span className="sr-only">Search number, contact or reference</span>
            <input
              type="search"
              name="q"
              defaultValue={q ?? ''}
              placeholder={placeholder}
              className="min-w-0 flex-1 border-0 bg-transparent text-base text-fg outline-none placeholder:text-fg-subtle sm:text-small"
            />
          </label>
          <button type="submit" className={buttonClass('secondary', 36)}>Search</button>
        </form>
        {typeChips && type ? <FilterChips label="Invoice type" chips={typeChips} value={type} size="sm" /> : null}
      </div>
      <FilterChips label="Filter by status" chips={statusChips} value={status} />
    </div>
  );
}
