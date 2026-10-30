/** Tasks placeholder: heading, chip and row shapes on surface-2; pulses only when motion is allowed. */
export default function TasksLoading() {
  const block = 'rounded-md bg-surface-2 motion-safe:animate-pulse';
  return (
    <div role="status" aria-label="Loading tasks" className="flex flex-col gap-4">
      <div className="flex flex-col gap-1">
        <h1 className="m-0 text-h1">Tasks</h1>
        <p className="m-0 text-small text-fg-muted">Things waiting on you. Oldest first.</p>
      </div>
      <div className="flex flex-wrap gap-2">
        {[64, 108, 104, 104, 72].map((w, i) => <div key={i} style={{ width: w }} className={`h-11 rounded-pill bg-surface-2 motion-safe:animate-pulse lg:h-8`} />)}
      </div>
      <div className="rounded-md border border-border bg-surface shadow-card">
        {[0, 1, 2, 3].map((i) => (
          <div key={i} className="flex items-center gap-4 border-t border-border px-4 py-3.5 first:border-t-0">
            <div className={`size-9 flex-none ${block}`} />
            <div className="flex min-w-0 flex-1 flex-col gap-2">
              <div className={`h-4 w-2/3 max-w-80 ${block}`} />
              <div className={`h-3 w-1/2 max-w-64 ${block}`} />
            </div>
            <div className={`hidden h-[34px] w-32 lg:block ${block}`} />
          </div>
        ))}
      </div>
      <span className="sr-only">Loading…</span>
    </div>
  );
}
