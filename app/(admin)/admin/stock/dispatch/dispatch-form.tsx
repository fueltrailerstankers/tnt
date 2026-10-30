'use client';

import { useId, useState, useTransition, type FormEvent } from 'react';
import { Button } from '@/components/ui/Button';
import { FieldError, Input, Label, Select, Textarea } from '@/components/ui/Field';
import { cardClass } from '@/components/ui/styles';
import { MAX_ACCESSORIES } from '@/lib/stock/deal';
import {
  ACCESSORY_FIELDS, DISPATCH_COPY, MAX_NOTES, modelOptionLabel, moveOfferLabel, type DispatchField, type DispatchMode, type FindOutcome,
} from '@/lib/stock/dispatch';
import { STOCK_COPY } from '@/lib/stock/errors';
import { checkVin, dispatchUnit, findDeal, moveFactoryUnit, type DispatchResult, type VinNote } from './actions';

export interface DispatchFormProps {
  models: Array<{ part: string; description: string }>;
  locations: Array<{ id: string; name: string; isFactory: boolean }>;
  /** Today in the org's timezone ("YYYY-MM-DD"): the default dispatch date. */
  today: string;
  currentYear: number;
  /** ?year=&number=: existing-sequence mode with Find unit already run. */
  initial: { year: number; number: number; find: FindOutcome } | null;
}

type Find = FindOutcome | { kind: 'invalid'; message: string };

const emptyAccessories = () => Array.from({ length: MAX_ACCESSORIES }, () => '');

/** Values a found deal fills in. A model that is not in the list (inactive) is left for the user to choose. */
function prefill(find: Find | null, known: ReadonlySet<string>) {
  if (find?.kind !== 'found') return null;
  const acc = emptyAccessories();
  find.deal.accessories.forEach((a, i) => { acc[i] = a; });
  const model = find.deal.model && known.has(find.deal.model) ? find.deal.model : '';
  return { model, location: find.deal.location ?? '', accessories: acc };
}

/** Factory dispatch form (stock plan 7.4). One column on phones, two from sm up. */
export function DispatchForm({ models, locations, today, currentYear, initial }: DispatchFormProps) {
  const ids = useId();
  const id = (k: string) => `${ids}-${k}`;
  const known = new Set(models.map((m) => m.part));
  const first = prefill(initial?.find ?? null, known);

  const [mode, setMode] = useState<DispatchMode>(initial ? 'deal' : 'free');
  const [dealYear, setDealYear] = useState(String(initial?.year ?? currentYear));
  const [dealNumber, setDealNumber] = useState(initial ? String(initial.number) : '');
  const [find, setFind] = useState<Find | null>(initial?.find ?? null);
  const [model, setModel] = useState(first?.model ?? '');
  const [vin, setVin] = useState('');
  const [vinNote, setVinNote] = useState<VinNote>(null);
  const [location, setLocation] = useState(first?.location ?? '');
  const [date, setDate] = useState(today);
  const [accessories, setAccessories] = useState<string[]>(first?.accessories ?? emptyAccessories());
  const [notes, setNotes] = useState('');
  const [result, setResult] = useState<DispatchResult | null>(null);
  const [finding, startFind] = useTransition();
  const [saving, startSave] = useTransition();

  const found = find?.kind === 'found' && String(find.deal.year) === dealYear.trim() && String(find.deal.number) === dealNumber.trim();
  const blocked = mode === 'deal' && !found;
  const modelMissing = mode === 'deal' && found && !model;

  const errorFor = (f: DispatchField) => (result?.field === f ? result.message : null);
  const describe = (f: DispatchField, extra?: string) => [extra, errorFor(f) ? id(`${f}-err`) : null].filter(Boolean).join(' ') || undefined;

  function runFind() {
    setResult(null);
    startFind(async () => {
      const r = await findDeal(dealYear, dealNumber);
      setFind(r);
      const p = prefill(r, known);
      if (p) {
        setModel(p.model);
        if (p.location) setLocation(p.location);
        setAccessories(p.accessories);
      }
    });
  }

  function onVinBlur() {
    const v = vin.trim();
    if (!v) { setVinNote(null); return; }
    void checkVin(v).then(setVinNote).catch(() => setVinNote(null));
  }

  function onSubmit(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    if (blocked) return;
    const fd = new FormData(e.currentTarget);
    setResult(null);
    startSave(async () => {
      setResult(await dispatchUnit(fd));
    });
  }

  function onMove() {
    const move = result?.move;
    if (!move) return;
    const fd = new FormData();
    fd.set('unit_id', move.unitId);
    fd.set('location', move.to);
    if (move.dealYear !== null && move.dealNumber !== null) {
      fd.set('deal_year', String(move.dealYear));
      fd.set('deal_number', String(move.dealNumber));
    }
    startSave(async () => {
      setResult(await moveFactoryUnit(fd));
    });
  }

  const findTone = find?.kind === 'found' ? 'bg-status-teal-bg text-status-teal-fg' : 'bg-status-red-bg text-status-red-fg';

  return (
    <form onSubmit={onSubmit} noValidate className={`${cardClass} space-y-6 p-4 sm:p-6`} aria-busy={saving || undefined}>
      <h2 className="text-h2">{DISPATCH_COPY.unitDetails}</h2>

      {result?.field === 'form' || result?.field === 'mode' ? (
        <p role="alert" className="rounded-sm bg-status-red-bg p-3 text-body text-status-red-fg">{result.message}</p>
      ) : null}

      <fieldset className="space-y-3">
        <legend className="sr-only">Dispatch mode</legend>
        <div className="grid gap-2 sm:grid-cols-2">
          {([['free', DISPATCH_COPY.modeFree], ['deal', DISPATCH_COPY.modeDeal]] as const).map(([value, label]) => (
            <label
              key={value}
              className={`flex min-h-11 cursor-pointer items-center gap-3 rounded-sm border px-3 py-2 text-body font-semibold has-[:focus-visible]:outline-2 has-[:focus-visible]:outline-focus ${mode === value ? 'border-accent bg-accent-soft' : 'border-border-strong bg-surface'}`}
            >
              <input
                type="radio" name="mode" value={value} checked={mode === value} className="size-4 accent-accent"
                onChange={() => { setMode(value); setResult(null); if (value === 'deal' && locations.find((l) => l.id === location)?.isFactory) setLocation(''); }}
              />
              {label}
            </label>
          ))}
        </div>

        {mode === 'deal' ? (
          <div className="space-y-2">
            <div className="grid grid-cols-2 gap-3 sm:flex sm:items-end">
              <div className="sm:w-32">
                <Label htmlFor={id('year')} required>{DISPATCH_COPY.dealYear}</Label>
                <Input id={id('year')} name="deal_year" inputMode="numeric" autoComplete="off" value={dealYear} onChange={(e) => setDealYear(e.target.value)} aria-describedby={describe('deal')} />
              </div>
              <div className="sm:w-44">
                <Label htmlFor={id('number')} required>{DISPATCH_COPY.sequence}</Label>
                <Input
                  id={id('number')} name="deal_number" inputMode="numeric" autoComplete="off" placeholder={DISPATCH_COPY.sequencePlaceholder}
                  value={dealNumber} onChange={(e) => setDealNumber(e.target.value)} aria-describedby={describe('deal')}
                  onKeyDown={(e) => { if (e.key === 'Enter') { e.preventDefault(); runFind(); } }}
                />
              </div>
              <Button variant="secondary" size={44} className="col-span-2 sm:col-span-1" onClick={runFind} disabled={finding}>
                {finding ? 'Finding…' : DISPATCH_COPY.find}
              </Button>
            </div>
            <div aria-live="polite">
              {find ? <p data-testid="find-result" className={`rounded-sm p-3 text-body ${findTone}`}>{find.message}</p> : null}
              {!find || (find.kind === 'found' && !found) ? <p className="text-small text-fg-muted">{DISPATCH_COPY.findFirst}</p> : null}
            </div>
            {errorFor('deal') ? <FieldError id={id('deal-err')}>{errorFor('deal')}</FieldError> : null}
          </div>
        ) : null}
      </fieldset>

      <div className="grid gap-4 sm:grid-cols-2">
        <div>
          <Label htmlFor={id('model')} required>{DISPATCH_COPY.model}</Label>
          <Select id={id('model')} name="model" required value={model} onChange={(e) => setModel(e.target.value)} aria-invalid={errorFor('model') || modelMissing ? true : undefined} aria-describedby={describe('model', modelMissing ? id('model-hint') : undefined)}>
            <option value="">{DISPATCH_COPY.modelPlaceholder}</option>
            {models.map((m) => <option key={m.part} value={m.part}>{modelOptionLabel(m.part, m.description)}</option>)}
          </Select>
          {modelMissing ? <p id={id('model-hint')} className="mt-1 text-small text-status-yellow-fg">{DISPATCH_COPY.modelNotRecognised}</p> : null}
          {errorFor('model') ? <FieldError id={id('model-err')}>{errorFor('model')}</FieldError> : null}
        </div>

        <div>
          <Label htmlFor={id('vin')} required>{DISPATCH_COPY.vin}</Label>
          <Input
            id={id('vin')} name="vin" required autoComplete="off" autoCapitalize="characters" spellCheck={false} maxLength={80}
            placeholder={DISPATCH_COPY.vinPlaceholder} value={vin} className="font-mono"
            onChange={(e) => { setVin(e.target.value); setVinNote(null); if (result?.field === 'vin') setResult(null); }}
            onBlur={onVinBlur}
            aria-invalid={errorFor('vin') || vinNote?.tone === 'error' ? true : undefined}
            aria-describedby={describe('vin', vinNote ? id('vin-note') : undefined)}
          />
          {vinNote && !errorFor('vin') ? (
            <p id={id('vin-note')} data-testid="vin-note" className={`mt-1 rounded-sm p-2 text-small ${vinNote.tone === 'error' ? 'bg-status-red-bg text-status-red-fg' : 'bg-status-teal-bg text-status-teal-fg'}`}>
              {vinNote.message}
            </p>
          ) : null}
          {errorFor('vin') ? (
            <div id={id('vin-err')} role="alert" className="mt-1 space-y-2 rounded-sm bg-status-red-bg p-3 text-small text-status-red-fg">
              <p>{errorFor('vin')}</p>
              {result?.move ? (
                <>
                  <Button variant="primary" size={44} className="w-full sm:w-auto" onClick={onMove} disabled={saving}>{moveOfferLabel(result.move.toName)}</Button>
                  <p>{DISPATCH_COPY.moveKeeps}</p>
                </>
              ) : null}
            </div>
          ) : null}
        </div>

        <div>
          <Label htmlFor={id('location')} required>{DISPATCH_COPY.destination}</Label>
          <Select id={id('location')} name="location" required value={location} onChange={(e) => setLocation(e.target.value)} aria-invalid={errorFor('location') ? true : undefined} aria-describedby={describe('location')}>
            <option value="">{DISPATCH_COPY.destinationPlaceholder}</option>
            {locations.map((l) => (
              <option key={l.id} value={l.id} disabled={l.isFactory && mode === 'deal'}>
                {l.isFactory && mode === 'deal' ? `${l.name} (${DISPATCH_COPY.factoryNotWithDeal})` : l.name}
              </option>
            ))}
          </Select>
          {errorFor('location') ? <FieldError id={id('location-err')}>{errorFor('location')}</FieldError> : null}
        </div>

        <div>
          <Label htmlFor={id('date')} required>{DISPATCH_COPY.date}</Label>
          <Input id={id('date')} name="dispatch_date" type="date" required value={date} onChange={(e) => setDate(e.target.value)} aria-invalid={errorFor('dispatch_date') ? true : undefined} aria-describedby={describe('dispatch_date')} />
          {errorFor('dispatch_date') ? <FieldError id={id('dispatch_date-err')}>{errorFor('dispatch_date')}</FieldError> : null}
        </div>
      </div>

      <fieldset className="space-y-3" aria-describedby={id('acc-hint')}>
        <legend className="text-h2">{DISPATCH_COPY.accessoriesTitle}</legend>
        <p id={id('acc-hint')} className="text-small text-fg-muted">{DISPATCH_COPY.accessoriesHint}</p>
        <div className="grid gap-2 sm:grid-cols-2">
          {ACCESSORY_FIELDS.map((name, i) => {
            const n = String(i + 1).padStart(2, '0');
            return (
              <div key={name} className="flex items-center gap-2">
                <label htmlFor={id(name)} className="w-7 shrink-0 text-right font-mono text-small text-fg-muted">
                  <span aria-hidden="true">{n}</span><span className="sr-only">Accessory {n}</span>
                </label>
                <Input
                  id={id(name)} name={name} maxLength={200} placeholder={DISPATCH_COPY.accessoryPlaceholder} value={accessories[i]}
                  onChange={(e) => setAccessories((a) => a.map((x, j) => (j === i ? e.target.value : x)))}
                />
              </div>
            );
          })}
        </div>
        {errorFor('accessories') ? <FieldError id={id('accessories-err')}>{errorFor('accessories')}</FieldError> : null}
      </fieldset>

      <div>
        <Label htmlFor={id('notes')}>{DISPATCH_COPY.notes}</Label>
        <Textarea id={id('notes')} name="notes" rows={3} maxLength={MAX_NOTES} placeholder={DISPATCH_COPY.notesPlaceholder} value={notes} onChange={(e) => setNotes(e.target.value)} aria-describedby={describe('notes')} />
        {errorFor('notes') ? <FieldError id={id('notes-err')}>{errorFor('notes')}</FieldError> : null}
      </div>

      <div className="flex flex-col gap-3 border-t border-border pt-4 sm:flex-row sm:items-center sm:justify-between">
        <p className="text-small text-fg-muted">{STOCK_COPY.vinCheckNote}</p>
        <Button type="submit" size={52} className="w-full sm:w-auto" disabled={saving || blocked}>{saving ? 'Saving…' : DISPATCH_COPY.submit}</Button>
      </div>
    </form>
  );
}
