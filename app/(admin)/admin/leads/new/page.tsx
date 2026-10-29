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
      <p className="text-xs text-neutral-600"><Link href="/admin/leads" className="underline">Leads</Link> / New</p>
      <h1 className="text-2xl font-semibold">New lead</h1>
      <p className="text-sm text-neutral-600">For leads taken by phone, walk-in or email. Give at least an email or a phone number. Routing and Xero matching run on save; no notification is sent.</p>
      {error.length ? <p role="alert" className="rounded border border-red-300 bg-red-50 p-2 text-sm">Check: {error.join(', ')}.</p> : null}
      <form action={createManualLead} className="space-y-3 rounded-lg border bg-white p-4 text-sm">
        {FIELDS.map((f) => (
          <label key={f.name} className="flex flex-col gap-1">
            <span>{f.label}</span>
            {f.textarea
              ? <textarea name={f.name} rows={4} maxLength={4000} className="rounded border px-2 py-1" />
              : <input name={f.name} type={f.type ?? 'text'} maxLength={f.name === 'product' ? 300 : 160} className="rounded border px-2 py-1" />}
          </label>
        ))}
        <button className="rounded bg-neutral-900 px-3 py-2 text-white">Create lead</button>
      </form>
    </section>
  );
}
