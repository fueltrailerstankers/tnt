import Link from 'next/link';
import { buttonClass } from '@/components/ui/styles';

export const metadata = { title: 'No access · Trailers & Tankers' };

/** Rendered with HTTP 403 when requirePerm() refuses (the member's access level for this area is too low). */
export default function Forbidden() {
  return (
    <main className="flex min-h-[60vh] items-center justify-center bg-bg p-4 text-fg">
      <div className="max-w-sm space-y-3 text-center">
        <h1 className="text-h2">No access</h1>
        <p className="text-body text-fg-muted">Your access level does not include this page. Ask an admin if you need it.</p>
        <Link href="/admin" className={buttonClass('secondary', 44)}>Go to the start page</Link>
      </div>
    </main>
  );
}
