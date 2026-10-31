'use client';

import { removeUser, resendInvite } from '@/app/(admin)/admin/settings/users/actions';
import { buttonClass } from '@/components/ui/styles';

/** Remove from the members list; for a pending invite it reads Cancel invite. Asks first; the server action re-checks permission and the self / last-admin guards. */
export function RemoveUserButton({ userId, name, pendingInvite = false }: { userId: string; name: string; pendingInvite?: boolean }) {
  const label = pendingInvite ? 'Cancel invite' : 'Remove';
  return (
    <form
      action={removeUser.bind(null, userId)}
      onSubmit={(e) => {
        const ask = pendingInvite
          ? `Cancel the invite for ${name}? Their invite link stops working. You can invite them again later.`
          : `Remove ${name} from the organisation? They lose access. Their history stays in the activity log.`;
        if (!window.confirm(ask)) e.preventDefault();
      }}
    >
      <input type="hidden" name="confirm" value="remove" />
      <button className={buttonClass('destructive-outline', 44)} aria-label={`${label} ${name}`}>{label}</button>
    </form>
  );
}

/** Resend invite from the members list (a new invite email; the older link stops working). Returns to the list. */
export function ResendInviteButton({ userId, name }: { userId: string; name: string }) {
  return (
    <form action={resendInvite.bind(null, userId)}>
      <input type="hidden" name="from" value="list" />
      <button className={buttonClass('secondary', 44)} aria-label={`Resend invite to ${name}`}>Resend invite</button>
    </form>
  );
}
