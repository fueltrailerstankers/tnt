export default function PublicLayout({ children }: { children: React.ReactNode }) {
  return (
    <div className="min-h-screen bg-neutral-50 text-neutral-900">
      <header className="border-b bg-white px-4 py-3">
        <span className="font-semibold tracking-wide">TRAILERS &amp; TANKERS</span>
      </header>
      <main className="mx-auto max-w-4xl p-4">{children}</main>
    </div>
  );
}
