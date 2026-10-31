'use client';

import { useState } from 'react';
import { disconnectXero } from '@/app/(admin)/admin/integrations/xero/actions';
import { Button } from '@/components/ui/Button';
import { Modal } from '@/components/ui/Modal';

/** Disconnect asks first: the mirror stops syncing until someone connects again. Posts to the existing action. */
export function DisconnectXero() {
  const [open, setOpen] = useState(false);
  const [pending, setPending] = useState(false);
  return (
    <>
      <Button variant="destructive-outline" size={38} onClick={() => setOpen(true)}>Disconnect</Button>
      <Modal
        open={open}
        onClose={() => setOpen(false)}
        title="Disconnect Xero?"
        description="The stored tokens are removed and the mirror stops syncing. Quotes and invoices already mirrored stay. Connect again to resume."
        role="alertdialog"
        pending={pending}
      >
        <form action={disconnectXero} onSubmit={() => setPending(true)} className="flex flex-wrap justify-end gap-2">
          <Button variant="secondary" size={38} onClick={() => setOpen(false)} disabled={pending}>Cancel</Button>
          <Button type="submit" variant="destructive" size={38} loading={pending}>Disconnect</Button>
        </form>
      </Modal>
    </>
  );
}
