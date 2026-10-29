import Link from 'next/link';
import { requirePerm } from '@/lib/security/require';
import { createManualLead } from '../actions';

export const dynamic = 'force-dynamic';
export const metadata = { title: 'New lead · Trailers & Tankers' };

const FIELDS: Array<{ name: string; label: string; type?: string; textarea?: boolean }> = [
  { name: 'name', label: 'Name' },
  { name: 'email', label: 'Email', type: 'email' },
  { name: 'phone', label: 'Phone', type: 'tel' },
  { name: 'product', label: 'Product / interest' },
  { name: 'branch', label: 'Branch' },
  { name: 'message', label: 'Message', textarea: true },
];

export default async function NewLead({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  await requirePerm('leads.manage');
  const sp = await searchParams;
  const error = typeof sp.error === 'string' ? sp.error.split(',').filter((f) => FIELDS.some((x) => x.name === f) || f === 'form') : [];
  return (
    <section className="max-w-xl space-y-4">
      <p className="text-xs text-fg-muted"><Link href="/admin/leads" className="underline">Leads</Link> / New</p>
      <h1 className="text-h1">New lead</h1>
      <p className="text-sm text-fg-muted">For leads taken by phone, walk-in or email. Give at least an email or a phone number. Routing and Xero matching run on save; no notification is sent.</p>
      {error.length ? <p role="alert" className="rounded-sm border border-status-red-fg/30 bg-status-red-bg p-2 text-sm text-status-red-fg">Check: {error.join(', ')}.</p> : null}
      <form action={createManualLead} className="space-y-3 rounded-md border bg-surface p-4 text-sm shadow-card">
        {FIELDS.map((f) => (
          <label key={f.name} className="flex flex-col gap-1">
            <span>{f.label}</span>
            {f.textarea
              ? <textarea name={f.name} rows={4} maxLength={4000} className="rounded-sm border px-2 py-1" />
              : <input name={f.name} type={f.type ?? 'text'} maxLength={f.name === 'product' ? 300 : 160} className="rounded-sm border px-2 py-1" />}
          </label>
        ))}
        <button className="rounded-pill bg-accent px-3.5 py-1.5 font-semibold text-accent-fg">Create lead</button>
      </form>
    </section>
  );
}
