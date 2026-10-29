// Status -> tone map for StatusChip. Labels are written exactly as users know them from Cognito.

export type Tone = 'gray' | 'teal' | 'yellow' | 'green' | 'red';

export const STATUS_TONE: Record<string, Tone> = {
  Incomplete: 'gray', Archived: 'gray', 'Submitted (archived)': 'gray', Draft: 'gray', Lost: 'gray',
  Submitted: 'teal', New: 'teal', Invoiced: 'teal',
  Reviewed: 'yellow', Sent: 'yellow', Authorised: 'yellow', 'Dry-run': 'yellow', Contacted: 'yellow',
  Approved: 'green', Accepted: 'green', Paid: 'green', 'APPROVED EMAILED': 'green', Won: 'green',
  APPROVAL: 'red', Failed: 'red', Overdue: 'red', Declined: 'red', 'Changes requested': 'red',
};

const TONES: readonly Tone[] = ['gray', 'teal', 'yellow', 'green', 'red'];

/** Spec colour names ('yel', 'grn', ...) and tone names both resolve to a tone. */
const ALIASES: Record<string, Tone> = { yel: 'yellow', grn: 'green', gray: 'gray', grey: 'gray' };

/** Tone for a chip: an explicit colour wins, then the known status label, then gray. */
export function toneFor(status: string, color?: string | null): Tone {
  const c = (color ?? '').toLowerCase();
  if (ALIASES[c]) return ALIASES[c];
  if ((TONES as readonly string[]).includes(c)) return c as Tone;
  return STATUS_TONE[status] ?? 'gray';
}
