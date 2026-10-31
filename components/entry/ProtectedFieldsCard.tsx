'use client';

import { Card, CardHeader } from '@/components/ui/Card';
import { ProtectedField, type RevealResult } from '@/components/ui/ProtectedField';
import type { ProtectedView } from '@/lib/entry-view/protected';

/**
 * Protected values of the entry, masked on the server. Admins get Reveal (an audited server action that returns
 * the value); everyone else sees the mask only. The form below does not hold these values.
 */
export function ProtectedFieldsCard({ fields, reveal }: { fields: ProtectedView[]; reveal?: (field: string) => Promise<RevealResult> }) {
  if (!fields.length) return null;
  return (
    <Card padding="sm" aria-labelledby="entry-protected-h">
      <CardHeader
        id="entry-protected-h"
        title="Protected fields"
        action={<span className="text-[12px] text-fg-muted">{reveal ? 'Revealing is logged.' : 'Masked for non-admins.'}</span>}
      />
      <div className="grid gap-3 [grid-template-columns:repeat(auto-fit,minmax(min(260px,100%),1fr))]">
        {fields.map((f) => (
          <ProtectedField
            key={f.name}
            id={`protected-${f.name}`}
            label={f.label}
            masked={f.hasValue ? f.masked : '(empty)'}
            reveal={reveal && f.hasValue ? () => reveal(f.name) : undefined}
            hint={reveal ? 'protected' : 'protected · masked for non-admins'}
          />
        ))}
      </div>
    </Card>
  );
}
