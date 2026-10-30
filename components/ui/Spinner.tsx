import { Icon } from './Icon';

/** Decorative spinner; always pair it with visible text ("Syncing…"). Still under prefers-reduced-motion. */
export function Spinner({ size = 14, className = '' }: { size?: number; className?: string }) {
  return <Icon name="spinner" size={size} strokeWidth={2.5} className={`flex-none animate-spin motion-reduce:animate-none ${className}`.trim()} />;
}
