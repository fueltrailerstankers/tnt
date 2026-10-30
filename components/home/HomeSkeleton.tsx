/** Placeholder while Home loads: tile and card shapes on surface-2, pulsing only when motion is allowed. */
export function HomeSkeleton() {
  const block = 'rounded-md bg-surface-2 motion-safe:animate-pulse';
  return (
    <div role="status" aria-label="Loading Home" className="flex flex-col gap-5">
      <div className="flex flex-col gap-2">
        <div className={`h-[30px] w-64 ${block}`} />
        <div className={`h-[18px] w-80 max-w-full ${block}`} />
      </div>
      <div className="grid grid-cols-2 gap-2.5 lg:gap-3 lg:[grid-template-columns:repeat(auto-fit,minmax(min(220px,100%),1fr))]">
        {[0, 1, 2, 3].map((i) => <div key={i} className={`h-[92px] border border-border ${block} ${i > 1 ? 'hidden lg:block' : ''}`} />)}
      </div>
      <div className="flex flex-wrap items-start gap-5">
        <div className="flex min-w-0 flex-[2_1_560px] flex-col gap-5">
          <div className={`h-64 ${block}`} />
          <div className={`hidden h-72 lg:block ${block}`} />
        </div>
        <div className="hidden min-w-0 flex-[1_1_300px] flex-col gap-5 lg:flex">
          <div className={`h-80 ${block}`} />
          <div className={`h-40 ${block}`} />
        </div>
      </div>
      <span className="sr-only">Loading…</span>
    </div>
  );
}
