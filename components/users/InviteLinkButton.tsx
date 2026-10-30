'use client';

import { useState, useTransition } from 'react';
import { inviteLinkFor } from '@/app/(admin)/admin/settings/users/actions';
import { buttonClass } from '@/components/ui/styles';
import { USER_ERRORS } from '@/lib/users/rules';
import { CopyText } from './CopyText';

/** "Copy invite link": makes a fresh one-time link (for when email delivery is not set up) and shows it once. */
export function InviteLinkButton({ userId }: { userId: string }) {
  const [pending, start] = useTransition();
  const [link, setLink] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  return (
    <div className="space-y-2">
      <button
        type="button"
        disabled={pending}
        onClick={() => start(async () => {
          setError(null);
          const r = await inviteLinkFor(userId);
          if ('link' in r) setLink(r.link);
          else setError(USER_ERRORS[r.error] ?? USER_ERRORS.auth);
        })}
        className={buttonClass('secondary', 44)}
      >
        {pending ? 'Making link…' : 'Copy invite link'}
      </button>
      {error ? <p role="alert" className="text-small text-status-red-fg">{error}</p> : null}
      {link ? (
        <div className="space-y-1">
          <p className="text-small text-fg-muted">Send this link to the person. It works once; making a new one replaces it.</p>
          <CopyText value={link} label="Invite link" />
        </div>
      ) : null}
    </div>
  );
}
