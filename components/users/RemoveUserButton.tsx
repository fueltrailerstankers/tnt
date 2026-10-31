'use client';

import { removeUser } from '@/app/(admin)/admin/settings/users/actions';
import { buttonClass } from '@/components/ui/styles';

/** Remove from the members list. Asks first; the server action re-checks permission and the self / last-admin guards. */
export function RemoveUserButton({ userId, name }: { userId: string; name: string }) {
  return (
    <form
      action={removeUser.bind(null, userId)}
      onSubmit={(e) => {
        if (!window.confirm(`Remove ${name} from the organisation? They lose access. Their history stays in the activity log.`)) e.preventDefault();
      }}
    >
      <input type="hidden" name="confirm" value="remove" />
      <button className={buttonClass('destructive-outline', 44)} aria-label={`Remove ${name}`}>Remove</button>
    </form>
  );
}
