// Email building from spec.workflow.actions[].emails. Pure: no sending, no I/O.
// Literal inbox addresses in the spec are configuration, so they come from notification_recipients
// (event key "<form-slug>.<Action>"); field tokens such as [InspectorEmail] resolve from the entry.
import { displayValue, formatValue, publicData, type EntryData } from '@/lib/spec/values';
import { fieldByName, inputFields, type EmailSpec, type FormSpec } from '@/lib/spec/types';
import { hiddenNames, isHeading } from '@/lib/spec/visibility';

export interface EmailContext {
  spec: FormSpec;
  data: EntryData;
  entryNumber: number;
  status: string;
  adminLink: string;
  /** Role link URL when the email has linkForRole. */
  roleLink?: string;
  /** Active recipients configured for this event key. */
  configuredRecipients: string[];
  /** File counts per file field, for the entry details table. */
  fileCounts: Record<string, number>;
  /** Org timezone for datetime values (M8). Default UTC. */
  timeZone?: string;
}

export interface BuiltEmail {
  to: string[];
  replyTo?: string;
  subject: string;
  html: string;
  text: string;
}

const EMAIL_RE = /^[^\s@,;<>]+@[^\s@,;<>]+\.[^\s@,;<>]+$/;

export function eventKey(slug: string, action: string): string {
  return `${slug}.${action}`;
}

/** Recipients: configured inboxes replace the spec's literal addresses; [Field] tokens resolve from the entry. */
export function resolveRecipients(email: EmailSpec, data: EntryData, configured: string[]): string[] {
  const out = new Set<string>();
  let hasLiteral = false;
  for (const t of email.to) {
    const m = t.match(/^\[([A-Za-z_][A-Za-z0-9_]*)\]$/);
    if (m) {
      const v = displayValue(data[m[1]]).trim();
      if (EMAIL_RE.test(v)) out.add(v);
    } else {
      hasLiteral = true;
    }
  }
  if (hasLiteral) configured.filter((a) => EMAIL_RE.test(a)).forEach((a) => out.add(a));
  return [...out];
}

function escapeHtml(s: string): string {
  return s.replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]!);
}

/** Replaces [Entry.AdminLink], [Entry.Number], [Entry.Status] and [Field] tokens. Values are HTML-escaped. */
export function fillTokens(
  template: string, ctx: Pick<EmailContext, 'data' | 'entryNumber' | 'status' | 'adminLink'> & Partial<Pick<EmailContext, 'spec' | 'timeZone'>>, html: boolean,
): string {
  const esc = html ? escapeHtml : (s: string) => s;
  return template.replace(/\[([A-Za-z_][A-Za-z0-9_.]*)\]/g, (whole, key: string) => {
    if (key === 'Entry.AdminLink') return esc(ctx.adminLink);
    if (key === 'Entry.Number') return String(ctx.entryNumber);
    if (key === 'Entry.Status') return esc(ctx.status);
    // M8: with the spec, values render by type (a datetime in the org timezone, rating "4/5").
    if (key in ctx.data) return esc(ctx.spec ? formatValue(fieldByName(ctx.spec, key), ctx.data[key], { timeZone: ctx.timeZone }) : displayValue(ctx.data[key]));
    return whole;
  });
}

/**
 * Label/value rows of an entry for the email details table. Protected fields are masked; files are counted,
 * never named. M8: headings and fields hidden by showWhen are left out; `external` (an email to an address
 * taken from the entry) also leaves out internalOnly fields.
 */
export function entryDetailRows(
  spec: FormSpec, data: EntryData, fileCounts: Record<string, number>, opts: { timeZone?: string; external?: boolean } = {},
): Array<[string, string]> {
  const rows: Array<[string, string]> = [];
  const hidden = hiddenNames(spec, data);
  for (const f of inputFields(spec)) {
    if (f.type === 'table' || isHeading(f) || hidden.has(f.name)) continue;
    if (opts.external && 'internalOnly' in f && f.internalOnly) continue;
    if (f.type === 'section') {
      for (const r of (data.checklist as Array<{ label: string; fail: boolean; pass: boolean; comments: string }> | undefined) ?? []) {
        const result = [r.pass ? 'Pass' : '', r.fail ? 'Fail' : ''].filter(Boolean).join(' / ') || '-';
        rows.push([r.label, r.comments ? `${result}: ${r.comments}` : result]);
      }
      continue;
    }
    const label = f.label.trim() || f.name;
    if (f.type === 'file' || f.type === 'signature') {
      const n = fileCounts[f.name] ?? 0;
      rows.push([label, f.type === 'signature' ? (n ? 'Signed' : '') : n ? `${n} file${n === 1 ? '' : 's'}` : '']);
      continue;
    }
    if (f.type === 'email' && f.protected) {
      rows.push([label, data[f.name] ? '(protected)' : '']);
      continue;
    }
    rows.push([label, formatValue(f, data[f.name], { timeZone: opts.timeZone })]);
  }
  return rows;
}

/** True when an email goes to an address taken from the entry ([Field] token), i.e. possibly outside the org. */
export function isExternalEmail(email: EmailSpec): boolean {
  return email.to.some((t) => /^\[[A-Za-z_][A-Za-z0-9_]*\]$/.test(t));
}

export function buildEmail(email: EmailSpec, action: string, ctxIn: EmailContext): BuiltEmail {
  const to = resolveRecipients(email, ctxIn.data, ctxIn.configuredRecipients);
  // M8: an email to an address from the entry never carries internalOnly values, not even through [Field] tokens.
  const ctx = isExternalEmail(email) ? { ...ctxIn, data: publicData(ctxIn.spec, ctxIn.data) } : ctxIn;
  const internal = isExternalEmail(email) ? new Set(inputFields(ctxIn.spec).filter((f) => 'internalOnly' in f && f.internalOnly).map((f) => f.name)) : null;
  const strip = (t: string) => (internal ? t.replace(/\[([A-Za-z_][A-Za-z0-9_]*)\]/g, (w, k: string) => (internal.has(k) ? '' : w)) : t);
  email = { ...email, subject: email.subject === undefined ? undefined : strip(email.subject), body: email.body === undefined ? undefined : strip(email.body) };
  const subject = email.subject
    ? fillTokens(email.subject, ctx, false)
    : `${ctx.spec.name.trim()} - Entry #${ctx.entryNumber} (${action})`;
  const bodyHtml = email.body && email.body !== '(default entry email)' ? fillTokens(email.body, ctx, true) : `<p>${escapeHtml(subject)}</p>`;
  const parts = [bodyHtml.startsWith('<') ? bodyHtml : `<p>${bodyHtml}</p>`];
  const text: string[] = [htmlToText(bodyHtml)];

  if (ctx.roleLink) {
    parts.push(`<p><a href="${escapeHtml(ctx.roleLink)}">Open the entry</a></p>`);
    text.push(`Open the entry: ${ctx.roleLink}`);
  }
  if (email.includeEntryDetails || email.includeReceipt) {
    const rows = entryDetailRows(ctx.spec, ctx.data, ctx.fileCounts, { timeZone: ctx.timeZone, external: isExternalEmail(email) });
    parts.push(
      `<table cellpadding="4" style="border-collapse:collapse;font-family:Arial,sans-serif;font-size:13px">` +
        rows.map(([k, v]) => `<tr><th align="left" style="border-bottom:1px solid #ddd">${escapeHtml(k)}</th><td style="border-bottom:1px solid #ddd">${escapeHtml(v)}</td></tr>`).join('') +
        `</table>`,
    );
    text.push(rows.map(([k, v]) => `${k}: ${v}`).join('\n'));
  }
  return { to, replyTo: email.from, subject, html: parts.join('\n'), text: text.join('\n\n') };
}

function htmlToText(html: string): string {
  return html
    .replace(/<a [^>]*href="([^"]*)"[^>]*>([\s\S]*?)<\/a>/gi, '$2 ($1)')
    .replace(/<[^>]*>/g, '')
    .replace(/&nbsp;/g, ' ')
    .replace(/&amp;/g, '&')
    .replace(/\s+/g, ' ')
    .trim();
}
