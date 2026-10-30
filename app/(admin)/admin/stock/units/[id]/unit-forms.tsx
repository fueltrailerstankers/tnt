'use client';

import { useActionState, useState, useTransition, type FormEvent } from 'react';
import { Button } from '@/components/ui/Button';
import { FieldError, Input, Label, Select, Textarea } from '@/components/ui/Field';
import { unitStatusLabel } from '@/lib/stock/errors';
import { UNIT_STATUSES } from '@/lib/stock/kpi';
import type { ActionState, UnitRow } from '@/lib/stock/register';
import { correctUnit, transferUnit } from '../actions';

interface Option { id: string; name: string; is_factory: boolean }
interface ModelOption { part_number: string; description: string; active: boolean }

/** Submits without React's automatic form reset, so typed values stay after an error. */
function useSubmit(action: (prev: ActionState, fd: FormData) => Promise<ActionState>) {
  const [state, dispatch] = useActionState(action, {} as ActionState);
  const [pending, start] = useTransition();
  const onSubmit = (e: FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    const fd = new FormData(e.currentTarget);
    start(() => dispatch(fd));
  };
  return { state, pending, onSubmit };
}

function Result({ state, id }: { state: ActionState; id: string }) {
  if (state.error) return <FieldError id={id}>{state.error}</FieldError>;
  if (state.ok) return <p id={id} role="status" className="mt-1 text-small font-semibold text-status-green-fg">{state.ok}</p>;
  return null;
}

const pad = (n: number) => String(n).padStart(2, '0');

/** Correct record (admin): every field of the unit; only changed values are sent. */
export function CorrectRecordForm({ unit, models, locations }: { unit: UnitRow; models: ModelOption[]; locations: Option[] }) {
  const { state, pending, onSubmit } = useSubmit(correctUnit);
  const linked = !!unit.deal_id;
  const acc = unit.accessories ?? [];
  const modelOptions = models.filter((m) => m.active || m.part_number === unit.model_part);
  return (
    <form key={unit.updated_at} onSubmit={onSubmit} className="space-y-4" aria-describedby="correct-result" data-testid="correct-form">
      <input type="hidden" name="unit" value={unit.id} />
      <div className="grid gap-4 sm:grid-cols-2">
        <div>
          <Label htmlFor="c-vin" required>VIN</Label>
          <Input id="c-vin" name="vin" defaultValue={unit.vin} required maxLength={80} autoComplete="off" className="font-mono" />
        </div>
        <div>
          <Label htmlFor="c-model" required>Model / part number</Label>
          <Select id="c-model" name="model" defaultValue={unit.model_part} required>
            {modelOptions.map((m) => <option key={m.part_number} value={m.part_number}>{m.part_number} — {m.description}</option>)}
          </Select>
        </div>
        <div>
          <Label htmlFor="c-location" required>Location</Label>
          <Select id="c-location" name="location" defaultValue={unit.location_id} required>
            {locations.map((l) => <option key={l.id} value={l.id}>{l.name}</option>)}
          </Select>
        </div>
        <div>
          <Label htmlFor="c-status" required>Status</Label>
          <Select id="c-status" name="status" defaultValue={unit.status} required>
            {UNIT_STATUSES.map((s) => <option key={s} value={s}>{unitStatusLabel(s)}</option>)}
          </Select>
        </div>
        <div>
          <Label htmlFor="c-invoice">Invoice number</Label>
          <Input id="c-invoice" name="invoice" defaultValue={unit.invoice_number ?? ''} maxLength={50} autoComplete="off" placeholder="INV-0042" />
        </div>
        <div>
          <Label htmlFor="c-date">Dispatch date</Label>
          <Input id="c-date" name="dispatch_date" type="date" defaultValue={unit.dispatch_date ?? ''} />
        </div>
      </div>

      <fieldset className="rounded-sm border border-border p-3">
        <legend className="px-1 text-small font-semibold text-fg">Deal</legend>
        <div className="grid grid-cols-2 gap-3">
          <div>
            <Label htmlFor="c-deal-year">Deal year</Label>
            <Input id="c-deal-year" name="deal_year" inputMode="numeric" pattern="\d{4}" maxLength={4} defaultValue={unit.deal_year ?? ''} />
          </div>
          <div>
            <Label htmlFor="c-deal-number">Sequence number</Label>
            <Input id="c-deal-number" name="deal_number" inputMode="numeric" pattern="\d{1,9}" maxLength={9} defaultValue={unit.sequence ?? ''} />
          </div>
        </div>
        {linked ? (
          <>
            <p className="mt-2 text-small text-fg-muted">Linked to a deal. Changing the year or number relinks the unit; the old deal goes back to awaiting dispatch.</p>
            <label className="mt-2 flex items-center gap-2 text-body"><input type="checkbox" name="unlink_deal" value="1" className="size-4 accent-accent" />Unlink from the deal</label>
          </>
        ) : (
          <label className="mt-2 flex items-start gap-2 text-body">
            <input type="checkbox" name="link_deal" value="1" className="mt-0.5 size-4 accent-accent" />
            <span>Link to this deal (clears it from outstanding deals; the unit must be at a branch)</span>
          </label>
        )}
      </fieldset>

      <fieldset>
        <legend className="mb-1.5 text-small font-semibold text-fg">Fitted products &amp; accessories</legend>
        <div className="grid gap-2 sm:grid-cols-2">
          {Array.from({ length: 10 }, (_, i) => (
            <label key={i} className="flex items-center gap-2">
              <span className="w-6 shrink-0 text-right font-mono text-small text-fg-muted">{pad(i + 1)}</span>
              <Input name="accessories" defaultValue={acc[i] ?? ''} maxLength={200} placeholder="Product or accessory" aria-label={`Accessory ${pad(i + 1)}`} />
            </label>
          ))}
        </div>
      </fieldset>

      <div>
        <Label htmlFor="c-notes">Notes</Label>
        <Textarea id="c-notes" name="notes" defaultValue={unit.notes ?? ''} maxLength={2000} rows={3} placeholder="Delivery or unit notes" />
      </div>

      <div className="flex flex-wrap items-center gap-3">
        <Button type="submit" disabled={pending} size={44}>{pending ? 'Saving…' : 'Save correction'}</Button>
        <p className="text-small text-fg-muted">The audit records which fields changed.</p>
      </div>
      <Result state={state} id="correct-result" />
    </form>
  );
}

/** Transfer (admin): move the unit to another location; reason required except Factory to a branch. */
export function TransferForm({ unit, locations }: { unit: UnitRow; locations: Option[] }) {
  const submit = useSubmit(transferUnit);
  // Remounted after a move (updated_at changes) so the destination list starts again from the new location.
  return <TransferFields key={unit.updated_at} unit={unit} locations={locations} {...submit} />;
}

function TransferFields({ unit, locations, state, pending, onSubmit }: {
  unit: UnitRow; locations: Option[]; state: ActionState; pending: boolean; onSubmit: (e: FormEvent<HTMLFormElement>) => void;
}) {
  const from = locations.find((l) => l.id === unit.location_id);
  const targets = locations.filter((l) => l.id !== unit.location_id);
  const [to, setTo] = useState(targets.find((l) => !l.is_factory)?.id ?? targets[0]?.id ?? '');
  const toLoc = locations.find((l) => l.id === to);
  const reasonOptional = !!from?.is_factory && !!toLoc && !toLoc.is_factory;
  const canLinkDeal = !unit.deal_id && !!toLoc && !toLoc.is_factory;
  return (
    <form onSubmit={onSubmit} className="space-y-4" aria-describedby="transfer-result" data-testid="transfer-form">
      <input type="hidden" name="unit" value={unit.id} />
      <p className="text-body">From <span className="font-semibold">{from?.name ?? unit.location_id}</span></p>
      <div className="grid gap-4 sm:grid-cols-2">
        <div>
          <Label htmlFor="t-location" required>Destination</Label>
          <Select id="t-location" name="location" value={to} onChange={(e) => setTo(e.target.value)} required>
            {targets.map((l) => <option key={l.id} value={l.id}>{l.name}</option>)}
          </Select>
        </div>
        <div>
          <Label htmlFor="t-reason" required={!reasonOptional}>Reason</Label>
          <Input id="t-reason" name="reason" maxLength={200} autoComplete="off" required={!reasonOptional}
            placeholder={reasonOptional ? 'Optional for Factory to branch' : 'Why is the unit moving?'} />
        </div>
      </div>
      {canLinkDeal ? (
        <fieldset className="rounded-sm border border-border p-3">
          <legend className="px-1 text-small font-semibold text-fg">Link a deal (optional)</legend>
          <p className="mb-2 text-small text-fg-muted">The deal clears when its unit reaches the branch.</p>
          <div className="grid grid-cols-2 gap-3">
            <div>
              <Label htmlFor="t-deal-year">Deal year</Label>
              <Input id="t-deal-year" name="deal_year" inputMode="numeric" pattern="\d{4}" maxLength={4} />
            </div>
            <div>
              <Label htmlFor="t-deal-number">Sequence number</Label>
              <Input id="t-deal-number" name="deal_number" inputMode="numeric" pattern="\d{1,9}" maxLength={9} />
            </div>
          </div>
        </fieldset>
      ) : null}
      <Button type="submit" disabled={pending || !to} size={44}>{pending ? 'Moving…' : 'Transfer unit'}</Button>
      <Result state={state} id="transfer-result" />
    </form>
  );
}
