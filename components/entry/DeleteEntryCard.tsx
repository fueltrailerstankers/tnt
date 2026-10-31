'use client';

import { useState } from 'react';
import { Button } from '@/components/ui/Button';
import { Card, CardHeader } from '@/components/ui/Card';
import { Icon } from '@/components/ui/Icon';
import { TypedConfirmModal } from '@/components/ui/TypedConfirmModal';

/**
 * Admin only. Delete through TypedConfirmModal: the confirm button stays disabled until the entry number is typed
 * exactly; the server action (deleteEntry) checks entries.delete and the number again, audits and redirects.
 */
export function DeleteEntryCard({ number, remove, error }: { number: number; remove: (fd: FormData) => Promise<void>; error?: string | null }) {
  const [open, setOpen] = useState(false);
  return (
    <Card padding="sm" aria-labelledby="entry-delete-h" className="border-danger">
      <CardHeader id="entry-delete-h" title={<span className="text-status-red-fg">Delete entry</span>} />
      <p className="m-0 text-small text-fg-muted">Removes the entry, its files and documents. You will type the entry number to confirm.</p>
      {error ? (
        <p role="alert" className="m-0 flex items-center gap-1.5 text-small text-status-red-fg">
          <Icon name="warning" size={14} strokeWidth={2} />
          {error}
        </p>
      ) : null}
      <Button variant="destructive-outline" size={36} className="self-start" onClick={() => setOpen(true)}>
        <Icon name="trash" size={16} strokeWidth={2} />
        Delete entry…
      </Button>
      <TypedConfirmModal
        open={open}
        onClose={() => setOpen(false)}
        title={`Delete entry #${number}?`}
        body="This cannot be undone. The entry, its files and its generated documents are removed; the audit log keeps a record."
        phrase={String(number)}
        confirmLabel="Delete"
        tone="destructive"
        onConfirm={async (typed) => {
          const fd = new FormData();
          fd.set('confirm', typed);
          await remove(fd);
        }}
      />
    </Card>
  );
}
