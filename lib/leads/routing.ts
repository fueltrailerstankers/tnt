// Lead routing. Pure. The first active rule (lowest priority number, then oldest) whose conditions all
// hold decides the lead's branch and which notification event key (recipients) it goes to.

export interface RoutingRule {
  id: string;
  name: string;
  priority: number;
  match_source: string | null;
  match_product: string | null;
  match_branch: string | null;
  assign_branch: string | null;
  notify_event_key: string;
  active: boolean;
  created_at?: string | null;
}

export interface RouteInput {
  source: string;
  product: string | null;
  branch: string | null;
}

export interface Route {
  ruleId: string | null;
  branch: string | null;
  eventKey: string;
}

export const DEFAULT_EVENT_KEY = 'leads.new';

const lc = (s: string | null | undefined) => (s ?? '').trim().toLowerCase();

export function ruleMatches(rule: RoutingRule, lead: RouteInput): boolean {
  if (!rule.active) return false;
  if (rule.match_source && lc(rule.match_source) !== lc(lead.source)) return false;
  if (rule.match_product && !lc(lead.product).includes(lc(rule.match_product))) return false;
  if (rule.match_branch && lc(rule.match_branch) !== lc(lead.branch)) return false;
  return true;
}

export function routeLead(lead: RouteInput, rules: readonly RoutingRule[]): Route {
  const ordered = [...rules].sort((a, b) =>
    a.priority - b.priority || (a.created_at ?? '').localeCompare(b.created_at ?? '') || a.id.localeCompare(b.id));
  const rule = ordered.find((r) => ruleMatches(r, lead));
  if (!rule) return { ruleId: null, branch: lead.branch, eventKey: DEFAULT_EVENT_KEY };
  return { ruleId: rule.id, branch: rule.assign_branch ?? lead.branch, eventKey: rule.notify_event_key };
}

/** Recipients for the routed key; a branch key with no inboxes configured falls back to leads.new. */
export function recipientsFor(eventKey: string, rows: readonly { event_key: string; address: string; active: boolean }[]): string[] {
  const pick = (k: string) => [...new Set(rows.filter((r) => r.active && r.event_key === k).map((r) => r.address.trim()).filter(Boolean))];
  const own = pick(eventKey);
  return own.length || eventKey === DEFAULT_EVENT_KEY ? own : pick(DEFAULT_EVENT_KEY);
}
