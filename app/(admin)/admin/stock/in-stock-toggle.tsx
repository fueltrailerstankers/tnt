'use client';

import { useRouter } from 'next/navigation';
import { useTransition } from 'react';

/** "In stock only": hides models with no branch stock. Kept in the URL (?instock=1) so the view can be shared. */
export function InStockToggle({ checked }: { checked: boolean }) {
  const router = useRouter();
  const [pending, start] = useTransition();
  return (
    <label className="inline-flex cursor-pointer items-center gap-2 text-small font-semibold text-fg">
      <input
        type="checkbox"
        className="size-4 accent-accent"
        checked={checked}
        disabled={pending}
        onChange={(e) => {
          const on = e.target.checked;
          start(() => router.replace(on ? '/admin/stock?instock=1' : '/admin/stock', { scroll: false }));
        }}
      />
      In stock only
    </label>
  );
}
