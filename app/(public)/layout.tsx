import { Icon } from '@/components/ui/Icon';
import { Logo } from '@/components/ui/Logo';

/** Minimal public chrome (handoff: logo, secure badge, footer). Customer and inspector forms are phone-first. */
export default function PublicLayout({ children }: { children: React.ReactNode }) {
  return (
    <div className="flex min-h-screen flex-col bg-bg text-fg">
      <header className="bg-side text-side-fg">
        <div className="mx-auto flex max-w-[960px] items-center justify-between gap-3 px-4 py-2.5">
          <Logo variant="on-dark" height={40} />
          <span className="inline-flex items-center gap-1.5 rounded-pill bg-side-active px-3 py-1 text-label font-semibold tracking-normal text-side-fg">
            <Icon name="lock" size={14} strokeWidth={2} />
            Secure form
          </span>
        </div>
      </header>
      <main className="mx-auto w-full max-w-[960px] flex-1 px-4 py-6 sm:py-8">{children}</main>
      <footer className="border-t border-border">
        <div className="mx-auto flex max-w-[960px] flex-wrap items-center justify-between gap-2 px-4 py-4 text-label font-medium tracking-normal text-fg-muted">
          <span>Trailers &amp; Tankers · sales, spares, repairs</span>
          <span>Your details are kept private and used only for this order.</span>
        </div>
      </footer>
    </div>
  );
}
