'use client';

import { useCallback, useEffect, useMemo, useRef, useState, type ReactNode, type RefObject } from 'react';
import { Alert } from '@/components/ui/Alert';
import {
  DRAFT_DEBOUNCE_MS, browserStorage, draftAge, draftKey, parseDraft, pickDraftValues, readDraftRaw, removeDraft, restoredData, sameValues,
  sweepDrafts, writeDraft, type Draft, type DraftScope, type DraftValues,
} from '@/lib/forms/draft';
import type { FormSpec } from '@/lib/spec/types';
import type { Audience, EntryData, ReadOptions } from '@/lib/spec/values';
import type { SubmitState } from './types';
import { primaryBtn, secondaryBtn } from './styles';

type Submit = (state: SubmitState, fd: FormData) => Promise<SubmitState>;
type Restore = (values: (initial: EntryData, opts: ReadOptions) => EntryData) => void;

/** A Next.js redirect thrown from a server action (a successful save): the draft must stay cleared. */
function isRedirect(e: unknown): boolean {
  const digest = (e as { digest?: unknown } | null)?.digest;
  return typeof digest === 'string' && digest.startsWith('NEXT_REDIRECT');
}

/**
 * Browser autosave for FormRenderer (rules in lib/forms/draft). Nothing happens without a scope or for encrypted
 * forms, and nothing renders on the server: the offer appears only after the stored draft is read in an effect.
 * While the offer is open, autosave pauses so the stored answers are not overwritten before the person chooses.
 */
export function useDraft(o: {
  spec: FormSpec;
  audience: Audience;
  scope?: DraftScope;
  /** The entry version the form was opened at (hidden __version); a draft saved against another version is dropped. */
  version: string | null;
  formRef: RefObject<HTMLFormElement | null>;
  submit: Submit;
  onRestore: Restore;
}): { submit: Submit; changed: () => void; banner: ReactNode; status: ReactNode } {
  const { spec, audience, version, formRef } = o;
  const scope = o.scope;
  const key = useMemo(() => (scope ? draftKey(spec, audience, scope) : null), [spec, audience, scope]);
  const [offer, setOffer] = useState<Draft | null>(null);
  const [saved, setSaved] = useState(false);
  const offerRef = useRef<Draft | null>(null);
  const baseline = useRef<DraftValues | null>(null);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  offerRef.current = offer;

  const valuesOf = useCallback((entries: Iterable<[string, unknown]>) => pickDraftValues(spec, entries, audience), [spec, audience]);

  // Read once on mount: the baseline (what the page rendered) and any stored draft that differs from it.
  useEffect(() => {
    if (!key || !formRef.current) return;
    baseline.current = valuesOf(new FormData(formRef.current).entries());
    const storage = browserStorage();
    const now = Date.now();
    sweepDrafts(storage, now);
    const raw = readDraftRaw(storage, key);
    if (!raw) return;
    const d = parseDraft(raw, spec, audience, { now, base: version });
    if (d && !sameValues(d.values, baseline.current)) setOffer(d);
    else removeDraft(storage, key);
    // Only on mount and when the form identity changes.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [key]);

  useEffect(() => () => { if (timer.current) clearTimeout(timer.current); }, []);

  const store = useCallback((values: DraftValues) => {
    if (!key) return;
    const storage = browserStorage();
    if (baseline.current && sameValues(values, baseline.current)) {
      removeDraft(storage, key);
      setSaved(false);
      return;
    }
    setSaved(writeDraft(storage, key, { values, savedAt: Date.now(), base: version }));
  }, [key, version]);

  const changed = useCallback(() => {
    if (!key) return;
    if (timer.current) clearTimeout(timer.current);
    timer.current = setTimeout(() => {
      timer.current = null;
      if (offerRef.current || !formRef.current) return;
      store(valuesOf(new FormData(formRef.current).entries()));
    }, DRAFT_DEBOUNCE_MS);
  }, [key, store, valuesOf, formRef]);

  const submit = useCallback<Submit>(async (state, fd) => {
    if (!key) return o.submit(state, fd);
    // Clear before the save: a successful save redirects away. A failed one stores the answers again.
    if (timer.current) clearTimeout(timer.current);
    timer.current = null;
    offerRef.current = null;
    setOffer(null);
    removeDraft(browserStorage(), key);
    setSaved(false);
    try {
      const r = await o.submit(state, fd);
      if (r && (r.message || (r.errors && Object.keys(r.errors).length))) store(valuesOf(fd.entries()));
      return r;
    } catch (e) {
      if (!isRedirect(e)) store(valuesOf(fd.entries()));
      throw e;
    }
  }, [key, o.submit, store, valuesOf]); // eslint-disable-line react-hooks/exhaustive-deps

  const { onRestore } = o;
  const banner = offer ? (
    <Alert tone="info" title="Restore your unsaved answers?">
      <p className="text-small text-fg-muted">Answers typed on this device {draftAge(offer.savedAt, Date.now())} were not submitted. Signatures and files are never kept.</p>
      <div className="flex flex-wrap gap-2 pt-1">
        <button
          type="button"
          className={primaryBtn}
          onClick={() => {
            const values = offer.values;
            setOffer(null);
            onRestore((initial, opts) => restoredData(spec, initial, values, opts));
            setSaved(true);
          }}
        >
          Restore
        </button>
        <button
          type="button"
          className={secondaryBtn}
          onClick={() => {
            if (key) removeDraft(browserStorage(), key);
            setOffer(null);
          }}
        >
          Discard
        </button>
      </div>
    </Alert>
  ) : null;

  // The live region exists from the first client render so screen readers announce the change.
  const status = key ? (
    <p aria-live="polite" className="min-h-4 text-right text-label font-medium tracking-normal text-fg-muted" data-testid="draft-status">
      {saved ? 'Draft saved' : ''}
    </p>
  ) : null;

  return { submit, changed, banner, status };
}
