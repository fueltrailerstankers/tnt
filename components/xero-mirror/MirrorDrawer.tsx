'use client';

import { useRouter } from 'next/navigation';
import type { ReactNode } from 'react';
import { Drawer } from '@/components/ui/Drawer';

/**
 * The record drawer of a mirror list. It is open while the URL has ?id= (the row link pushes it), so Back closes it;
 * the close button, Escape and the scrim replace the URL with the list's own. Content is rendered on the server.
 */
export function MirrorDrawer({ closeHref, eyebrow, title, meta, footer, children }: {
  closeHref: string;
  eyebrow: ReactNode;
  title: ReactNode;
  meta?: ReactNode;
  footer?: ReactNode;
  children: ReactNode;
}) {
  const router = useRouter();
  return (
    <Drawer
      open
      onClose={() => router.replace(closeHref, { scroll: false })}
      eyebrow={eyebrow}
      title={title}
      monoTitle
      meta={meta}
      footer={footer}
      closeLabel="Close details"
    >
      {children}
    </Drawer>
  );
}
