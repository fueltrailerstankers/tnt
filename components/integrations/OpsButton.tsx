'use client';

import { useRouter } from 'next/navigation';
import { useTransition, type ReactNode } from 'react';
import { replayEventAction, retryJobAction } from '@/app/(admin)/admin/integrations/ops-actions';
import { Button } from '@/components/ui/Button';
import { useToast } from '@/components/ui/ToastProvider';
import type { ButtonSize, ButtonVariant } from '@/components/ui/styles';
import type { OpsResult } from '@/lib/integrations/ops';

/**
 * Replay (one stored webhook event) or Retry (one failed outbox job). Calls the permission-checked server action,
 * shows the result as a toast and refreshes the page data. The id is the row's own; the server re-reads it in the
 * member's org.
 */
export function OpsButton({
  kind, id, children, label, variant = 'secondary', size = 32, className, testId,
}: { kind: 'replay' | 'retry'; id: string; children: ReactNode; label?: string; variant?: ButtonVariant; size?: ButtonSize; className?: string; testId?: string }) {
  const router = useRouter();
  const { toast } = useToast();
  const [pending, start] = useTransition();

  const run = () => start(async () => {
    let res: OpsResult;
    try {
      res = await (kind === 'replay' ? replayEventAction(id) : retryJobAction(id));
    } catch {
      res = { ok: false, message: 'This action could not be completed. Reload the page and try again.' };
    }
    if (res.ok) {
      toast({ tone: 'success', title: kind === 'replay' ? 'Replay queued' : 'Retry queued', body: res.message });
      router.refresh();
    } else {
      toast({ tone: 'error', title: kind === 'replay' ? 'Replay not queued' : 'Retry not queued', body: res.message });
    }
  });

  return (
    <Button type="button" variant={variant} size={size} className={className} loading={pending} aria-label={label} data-testid={testId} onClick={run}>
      {children}
    </Button>
  );
}
