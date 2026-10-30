'use client';

import { useRouter } from 'next/navigation';
import { useOptimistic, useTransition } from 'react';

/** "In stock only": hides models with no branch stock. Kept in the URL (?instock=1) so the view can be shared. */
export function InStockToggle({ checked }: { checked: boolean }) {
  const router = useRouter();
  const [pending, start] = useTransition();
  // Shows the new state at once; falls back to the URL's value when the navigation settles.
  const [shown, setShown] = useOptimistic(checked);
  return (
    <label className="inline-flex cursor-pointer items-center gap-2 text-small font-semibold text-fg">
      <input
        type="checkbox"
        className="size-4 accent-accent"
        checked={shown}
        aria-busy={pending}
        onChange={(e) => {
          const on = e.target.checked;
          start(() => {
            setShown(on);
            router.replace(on ? '/admin/stock?instock=1' : '/admin/stock', { scroll: false });
          });
        }}
      />
      In stock only
    </label>
  );
}
