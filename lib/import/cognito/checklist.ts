// Inspection checklist: 20 Cognito sub-sections (Fail | Pass | Comments) -> data.checklist[] as the forms engine
// stores it (lib/spec/values.ts readChecklist: all 20 rows, always). Pure.
//
// Cognito field names repeat across sub-sections (every item has "Fail"; items 1 and 11 both use "Pass"), so the
// values must arrive nested per sub-section. ASSUMPTION (A11): the sub-sections appear either as object values
// (or an array) under the section field "TrailerInspectionResults", or as top-level objects. Their own names are
// not in the spec, so each sub-section is identified by the field names inside it: the Comments name is unique per
// item (Comments, Comments1..Comments19), the Pass name is unique except for items 1 and 11. When neither
// identifies it, and there are exactly 20 sub-sections, document order decides.
import type { ChecklistItem } from '@/lib/spec/types';
import type { ChecklistRow } from '@/lib/spec/values';
import { toText, toYesNo, type IssueCode } from './values';

const ITEM_KEY = /^(Fail|Pass\d*|Comments\d*)$/;

export interface ChecklistResult {
  rows: ChecklistRow[];
  /** Top-level entry keys consumed by the checklist (the section field and any top-level sub-sections). */
  consumedKeys: string[];
  issues: IssueCode[];
  /** Non-empty keys inside sub-sections that are not Fail/Pass/Comments, reported as "checklist.<key>". */
  dropped: string[];
}

function isObj(v: unknown): v is Record<string, unknown> {
  return !!v && typeof v === 'object' && !Array.isArray(v);
}

function looksLikeItem(v: unknown): v is Record<string, unknown> {
  return isObj(v) && Object.keys(v).some((k) => ITEM_KEY.test(k));
}

function cognitoName(item: ChecklistItem, part: 'fail' | 'pass' | 'comments'): string {
  return item.fields.find((f) => f.name === part)?.cognitoName ?? '';
}

export function mapChecklist(raw: Record<string, unknown>, items: ChecklistItem[], sectionKey: string, specKeys: Set<string>): ChecklistResult {
  const issues: IssueCode[] = [];
  const dropped: string[] = [];
  const consumed: string[] = [];
  const candidates: Record<string, unknown>[] = [];

  const section = raw[sectionKey];
  if (sectionKey in raw) consumed.push(sectionKey);
  if (Array.isArray(section)) candidates.push(...section.filter(looksLikeItem));
  else if (isObj(section)) candidates.push(...Object.values(section).filter(looksLikeItem));
  for (const [k, v] of Object.entries(raw)) {
    if (k !== sectionKey && !specKeys.has(k) && looksLikeItem(v)) {
      candidates.push(v);
      consumed.push(k);
    }
  }

  const byComments = new Map(items.map((it) => [cognitoName(it, 'comments'), it.itemNo]));
  const byPass = new Map<string, number[]>();
  for (const it of items) byPass.set(cognitoName(it, 'pass'), [...(byPass.get(cognitoName(it, 'pass')) ?? []), it.itemNo]);

  const assigned = new Map<number, Record<string, unknown>>();
  const unresolved: number[] = [];
  candidates.forEach((c, i) => {
    let itemNo: number | undefined;
    for (const k of Object.keys(c)) {
      if (byComments.has(k)) itemNo = byComments.get(k);
    }
    if (itemNo === undefined) {
      for (const k of Object.keys(c)) {
        const hits = byPass.get(k);
        if (hits?.length === 1) itemNo = hits[0];
      }
    }
    if (itemNo === undefined || assigned.has(itemNo)) unresolved.push(i);
    else assigned.set(itemNo, c);
  });
  if (unresolved.length) {
    if (candidates.length === items.length) {
      for (const i of unresolved) {
        const itemNo = items[i].itemNo;
        if (assigned.has(itemNo)) issues.push('checklist_unmatched');
        else assigned.set(itemNo, candidates[i]);
      }
    } else {
      for (let n = 0; n < unresolved.length; n++) issues.push('checklist_unmatched');
    }
  }
  if (!candidates.length) issues.push('checklist_missing');

  const rows = items.map((it): ChecklistRow => {
    const c = assigned.get(it.itemNo);
    if (!c) return { itemNo: it.itemNo, label: it.label, fail: false, pass: false, comments: '' };
    const passKey = cognitoName(it, 'pass') in c ? cognitoName(it, 'pass') : Object.keys(c).find((k) => /^Pass\d*$/.test(k));
    const commentsKey = cognitoName(it, 'comments') in c ? cognitoName(it, 'comments') : Object.keys(c).find((k) => /^Comments\d*$/.test(k));
    const fail = toYesNo(c[cognitoName(it, 'fail')]);
    const pass = toYesNo(passKey ? c[passKey] : undefined);
    const comments = toText(commentsKey ? c[commentsKey] : undefined);
    for (const r of [fail, pass, comments]) if (r.issue) issues.push(r.issue);
    for (const k of Object.keys(c)) {
      if (!ITEM_KEY.test(k) && !k.startsWith('$') && c[k] !== null && c[k] !== undefined && c[k] !== '') dropped.push(`checklist.${k}`);
    }
    return { itemNo: it.itemNo, label: it.label, fail: fail.value ?? false, pass: pass.value ?? false, comments: comments.value ?? '' };
  });

  return { rows, consumedKeys: consumed, issues, dropped };
}
