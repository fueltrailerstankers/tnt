import Link from 'next/link';
import { Icon } from '@/components/ui/Icon';
import { buttonClass } from '@/components/ui/styles';

/** Greeting, SAST date line and the "New deal" button (only for members who can start a deal). */
export function HomeHeader({ greeting, dateLine, newDealHref }: { greeting: string; dateLine: string; newDealHref: string | null }) {
  return (
    <div className="flex flex-wrap items-end justify-between gap-3">
      <div className="flex flex-col gap-1">
        <h1 className="m-0 text-h1">{greeting}</h1>
        <p className="m-0 text-small text-fg-muted">{dateLine}</p>
      </div>
      {newDealHref ? (
        <Link href={newDealHref} className={buttonClass('primary', 36)}>
          <Icon name="plus" size={16} strokeWidth={2} />
          New deal
        </Link>
      ) : null}
    </div>
  );
}
