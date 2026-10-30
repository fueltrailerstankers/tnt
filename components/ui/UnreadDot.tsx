/**
 * 8px unread marker. Alone (tables) it is role=img named "Unread" or "Read"; the read state is a hollow dot.
 * With `withLabel` it shows the word next to the dot and the dot is decorative.
 */
export function UnreadDot({ read = false, withLabel = false }: { read?: boolean; withLabel?: boolean }) {
  const dot = `inline-block size-2 flex-none rounded-full ${read ? 'border border-border-strong' : 'bg-accent'}`;
  if (withLabel) {
    return (
      <span className="inline-flex items-center gap-1.5 text-small">
        <span aria-hidden="true" className={dot} />
        {read ? 'Read' : 'Unread'}
      </span>
    );
  }
  return <span role="img" aria-label={read ? 'Read' : 'Unread'} className={dot} />;
}
