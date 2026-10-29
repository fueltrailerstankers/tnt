import { Logo } from '@/components/ui/Logo';

export default function PublicLayout({ children }: { children: React.ReactNode }) {
  return (
    <div className="min-h-screen bg-bg text-fg">
      <header className="bg-side px-4 py-2.5 text-side-fg">
        <div className="mx-auto flex max-w-4xl items-center">
          <Logo variant="on-dark" height={40} />
        </div>
      </header>
      <main className="mx-auto max-w-4xl p-4">{children}</main>
    </div>
  );
}
