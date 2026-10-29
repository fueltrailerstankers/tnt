// Email building from spec.workflow.actions[].emails. Pure: no sending, no I/O.
// Literal inbox addresses in the spec are configuration, so they come from notification_recipients
// (event key "<form-slug>.<Action>"); field tokens such as [InspectorEmail] resolve from the entry.
import { displayValue, type EntryData } from '@/lib/spec/values';
import { inputFields, type EmailSpec, type FormSpec } from '@/lib/spec/types';

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
export function fillTokens(template: string, ctx: Pick<EmailContext, 'data' | 'entryNumber' | 'status' | 'adminLink'>, html: boolean): string {
  const esc = html ? escapeHtml : (s: string) => s;
  return template.replace(/\[([A-Za-z_][A-Za-z0-9_.]*)\]/g, (whole, key: string) => {
    if (key === 'Entry.AdminLink') return esc(ctx.adminLink);
    if (key === 'Entry.Number') return String(ctx.entryNumber);
    if (key === 'Entry.Status') return esc(ctx.status);
    if (key in ctx.data) return esc(displayValue(ctx.data[key]));
    return whole;
  });
}

/** Label/value rows of an entry for the email details table. Protected fields are masked; files are counted, never named. */
export function entryDetailRows(spec: FormSpec, data: EntryData, fileCounts: Record<string, number>): Array<[string, string]> {
  const rows: Array<[string, string]> = [];
  for (const f of inputFields(spec)) {
    if (f.type === 'table') continue;
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
    rows.push([label, displayValue(data[f.name])]);
  }
  return rows;
}

export function buildEmail(email: EmailSpec, action: string, ctx: EmailContext): BuiltEmail {
  const to = resolveRecipients(email, ctx.data, ctx.configuredRecipients);
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
    const rows = entryDetailRows(ctx.spec, ctx.data, ctx.fileCounts);
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
