'use client';

import { useEffect, useState } from 'react';
import { Button } from '@/components/ui/Button';
import type { RailAction } from '@/lib/entry-view/status';

/**
 * Workflow buttons in the status card. Each one submits the entry form below with its spec action, exactly as the
 * form's own button does (same post, same browser checks, same server action: runAction checks role, allowedWhen
 * and permission). They let a reviewer act without scrolling through a long form, e.g. on a phone.
 */
export function RailActions({ actions, formHost }: { actions: RailAction[]; formHost: string }) {
  const [busy, setBusy] = useState(false);

  // Follow the form's own pending state (it sets aria-busy while saving).
  useEffect(() => {
    const form = document.getElementById(formHost)?.querySelector('form');
    if (!form) return;
    const sync = () => setBusy(form.getAttribute('aria-busy') === 'true');
    sync();
    const obs = new MutationObserver(sync);
    obs.observe(form, { attributes: true, attributeFilter: ['aria-busy'] });
    return () => obs.disconnect();
  }, [formHost]);

  const run = (name: string) => {
    const form = document.getElementById(formHost)?.querySelector('form');
    if (!form) return;
    // A temporary submit button carries __action, so the form's submit handler sees it as the submitter.
    const submitter = document.createElement('button');
    submitter.type = 'submit';
    submitter.name = '__action';
    submitter.value = name;
    submitter.hidden = true;
    form.appendChild(submitter);
    try {
      form.requestSubmit(submitter);
    } finally {
      submitter.remove();
    }
  };

  if (!actions.length) return null;
  return (
    <div className="flex flex-wrap gap-2" role="group" aria-label="Workflow actions">
      {actions.map((a) => (
        <Button
          key={a.name}
          variant={a.tone === 'primary' ? 'primary' : 'destructive-outline'}
          size={38}
          className="flex-[1_1_140px]"
          onClick={() => run(a.name)}
          loading={busy}
        >
          {a.label}
        </Button>
      ))}
    </div>
  );
}
