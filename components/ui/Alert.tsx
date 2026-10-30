import type { ReactNode } from 'react';
import { Icon, type IconName } from './Icon';

type Tone = 'error' | 'warning' | 'success' | 'info';

const TONE: Record<Tone, { cls: string; icon: IconName }> = {
  error: { cls: 'bg-status-red-bg text-status-red-fg', icon: 'warning' },
  warning: { cls: 'bg-status-yellow-bg text-status-yellow-fg', icon: 'warning' },
  success: { cls: 'bg-status-green-bg text-status-green-fg', icon: 'check' },
  info: { cls: 'bg-surface-2 text-fg', icon: 'info' },
};

/** Inline message box. Errors are announced (role alert); the rest are polite status messages. */
export function Alert({ tone = 'info', title, children, className = '' }: { tone?: Tone; title?: ReactNode; children?: ReactNode; className?: string }) {
  const t = TONE[tone];
  return (
    <div role={tone === 'error' ? 'alert' : 'status'} className={`flex gap-3 rounded-md px-4 py-3 text-body ${t.cls} ${className}`}>
      <span className="mt-0.5 flex-none"><Icon name={t.icon} size={18} strokeWidth={2} /></span>
      <div className="min-w-0 flex-1 space-y-1">
        {title ? <p className="font-semibold">{title}</p> : null}
        {children ? <div className="space-y-1">{children}</div> : null}
      </div>
    </div>
  );
}
