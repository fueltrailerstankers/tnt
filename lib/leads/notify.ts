// New-lead notification email. Pure. The subject is stored in email_log, so it carries no personal data;
// the body (never logged) carries the details sales need, as the Make lead emails did.

export interface LeadForEmail {
  id: string;
  source_form: string | null;
  name: string | null;
  email: string | null;
  phone: string | null;
  product: string | null;
  message: string | null;
  branch: string | null;
  duplicate_of: string | null;
}

function esc(s: string): string {
  return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;').replace(/'/g, '&#39;');
}

export function leadEmail(lead: LeadForEmail, sourceName: string, appUrl: string, to: string[]) {
  const link = `${appUrl.replace(/\/$/, '')}/admin/leads/${lead.id}`;
  const subject = `New lead from ${sourceName}${lead.branch ? ` (${lead.branch})` : ''}`;
  const rows = ([
    ['Name', lead.name], ['Email', lead.email], ['Phone', lead.phone], ['Product', lead.product],
    ['Message', lead.message], ['Branch', lead.branch], ['Source', sourceName + (lead.source_form ? ` / ${lead.source_form}` : '')],
  ] as Array<[string, string | null]>).filter((r): r is [string, string] => Boolean(r[1]));
  const dup = lead.duplicate_of ? 'Possible duplicate of an earlier lead.' : '';
  const text = [subject, '', ...rows.map(([k, v]) => `${k}: ${v}`), ...(dup ? ['', dup] : []), '', `Open the lead: ${link}`].join('\n');
  const html = `<p>${esc(subject)}</p>` +
    `<table cellpadding="4">${rows.map(([k, v]) => `<tr><th align="left">${esc(k)}</th><td>${esc(v)}</td></tr>`).join('')}</table>` +
    (dup ? `<p>${esc(dup)}</p>` : '') + `<p><a href="${esc(link)}">Open the lead</a></p>`;
  return { to, subject, html, text };
}
