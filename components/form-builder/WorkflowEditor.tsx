'use client';

// Workflow tab of the form designer: statuses, roles, actions (allowed when status is one of, new status,
// confirmation) and notification emails per action. Templates from lib/forms/builder/workflow.
import { Input, Label, Select } from '@/components/ui/Field';
import { buttonClass, cardClass } from '@/components/ui/styles';
import { allowedWhenFor, readAllowedWhen, workflowTemplate, type Workflow } from '@/lib/forms/builder/workflow';
import type { ActionSpec, EmailSpec } from '@/lib/spec/types';

const COLOURS = ['gray', 'teal', 'yellow', 'green', 'red'];

export function WorkflowEditor({ workflow, onChange }: { workflow: Workflow; onChange: (w: Workflow) => void }) {
  const statuses = workflow.statuses.map((s) => s.name);
  const setAction = (i: number, a: ActionSpec) => onChange({ ...workflow, actions: workflow.actions.map((x, j) => (j === i ? a : x)) });

  return (
    <div className="space-y-5">
      <section className={`${cardClass} space-y-3 p-4`}>
        <h2 className="text-h2">Templates</h2>
        <p className="text-small text-fg-muted">Replace the workflow with a starting point (Undo brings the old one back).</p>
        <div className="flex flex-wrap gap-2">
          <button type="button" className={buttonClass('secondary', 36)} onClick={() => onChange(workflowTemplate('public-submit'))}>Public submit, staff update</button>
          <button type="button" className={buttonClass('secondary', 36)} onClick={() => onChange(workflowTemplate('internal-only'))}>Internal only</button>
        </div>
      </section>

      <section className={`${cardClass} space-y-3 p-4`} aria-labelledby="wf-statuses">
        <h2 id="wf-statuses" className="text-h2">Statuses</h2>
        <ul className="space-y-2">
          {workflow.statuses.map((s, i) => (
            <li key={i} className="grid grid-cols-[1fr_8rem_auto_auto] items-center gap-2">
              <label className="sr-only" htmlFor={`st-${i}`}>Status name</label>
              <Input id={`st-${i}`} value={s.name} disabled={s.name === 'Incomplete'} onChange={(e) => onChange({ ...workflow, statuses: workflow.statuses.map((x, j) => (j === i ? { ...x, name: e.target.value } : x)) })} />
              <label className="sr-only" htmlFor={`stc-${i}`}>Colour</label>
              <Select id={`stc-${i}`} value={s.color} onChange={(e) => onChange({ ...workflow, statuses: workflow.statuses.map((x, j) => (j === i ? { ...x, color: e.target.value } : x)) })}>
                {COLOURS.map((c) => <option key={c} value={c}>{c}</option>)}
              </Select>
              <label className="flex items-center gap-1 text-small">
                <input type="checkbox" checked={!!s.archived} onChange={(e) => onChange({ ...workflow, statuses: workflow.statuses.map((x, j) => (j === i ? { ...x, archived: e.target.checked || undefined } : x)) })} />
                Archived
              </label>
              <button type="button" className={buttonClass('ghost', 32)} disabled={s.name === 'Incomplete'} aria-label={`Remove status ${s.name}`}
                onClick={() => onChange({ ...workflow, statuses: workflow.statuses.filter((_, j) => j !== i) })}>Remove</button>
            </li>
          ))}
        </ul>
        <button type="button" className={buttonClass('secondary', 32)}
          onClick={() => onChange({ ...workflow, statuses: [...workflow.statuses, { id: Math.max(0, ...workflow.statuses.map((s) => s.id)) + 1, name: `Status ${workflow.statuses.length + 1}`, color: 'teal' }] })}>
          New status
        </button>
      </section>

      <section className={`${cardClass} space-y-3 p-4`} aria-labelledby="wf-roles">
        <h2 id="wf-roles" className="text-h2">Roles</h2>
        <p className="text-small text-fg-muted">The public role fills the public link (and role links); the internal role is signed-in staff.</p>
        <ul className="space-y-2">
          {workflow.roles.map((r, i) => (
            <li key={i} className="grid grid-cols-[1fr_auto] items-center gap-2">
              <label className="sr-only" htmlFor={`ro-${i}`}>Role name</label>
              <Input id={`ro-${i}`} value={r.name} onChange={(e) => onChange({ ...workflow, roles: workflow.roles.map((x, j) => (j === i ? { ...x, name: e.target.value } : x)) })} />
              <span className="text-small text-fg-muted">{r.public ? 'Public' : r.internal ? 'Internal' : 'Other'}</span>
            </li>
          ))}
        </ul>
      </section>

      <section className="space-y-3" aria-labelledby="wf-actions">
        <h2 id="wf-actions" className="text-h2">Actions</h2>
        {workflow.actions.map((a, i) => (
          <ActionCard key={i} index={i} action={a} statuses={statuses} roles={workflow.roles.map((r) => r.name)} onChange={(x) => setAction(i, x)}
            onRemove={() => onChange({ ...workflow, actions: workflow.actions.filter((_, j) => j !== i) })} />
        ))}
        <button type="button" className={buttonClass('secondary', 36)}
          onClick={() => onChange({ ...workflow, actions: [...workflow.actions, { id: Math.max(0, ...workflow.actions.map((x) => x.id)) + 1, name: `Action${workflow.actions.length + 1}`, button: 'Save', allowedWhen: "status != 'Incomplete'", emails: [] }] })}>
          New action
        </button>
      </section>
    </div>
  );
}

function ActionCard({ index, action, statuses, roles, onChange, onRemove }: {
  index: number; action: ActionSpec; statuses: string[]; roles: string[]; onChange: (a: ActionSpec) => void; onRemove: () => void;
}) {
  const aw = readAllowedWhen(action.allowedWhen, statuses);
  const p = `ac-${index}`;
  const setAw = (statusesSel: string[] | null, role: string | null) => onChange({ ...action, allowedWhen: allowedWhenFor({ statuses: statusesSel, role }) });
  const setEmail = (j: number, e: EmailSpec) => onChange({ ...action, emails: action.emails.map((x, k) => (k === j ? e : x)) });
  return (
    <div className={`${cardClass} space-y-3 p-4`} data-testid={`action-${action.name}`}>
      <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
        <div><Label htmlFor={`${p}-name`}>Action name</Label><Input id={`${p}-name`} value={action.name} onChange={(e) => onChange({ ...action, name: e.target.value })} /></div>
        <div><Label htmlFor={`${p}-button`}>Button label</Label><Input id={`${p}-button`} value={action.button} onChange={(e) => onChange({ ...action, button: e.target.value })} /></div>
        <div>
          <Label htmlFor={`${p}-new`}>New status</Label>
          <Select id={`${p}-new`} value={action.newStatus ?? ''} onChange={(e) => onChange({ ...action, newStatus: e.target.value || undefined })}>
            <option value="">(unchanged)</option>
            {statuses.map((s) => <option key={s} value={s}>{s}</option>)}
          </Select>
        </div>
      </div>
      {aw ? (
        <fieldset>
          <legend className="mb-1.5 text-small font-semibold text-fg">Allowed when status is one of</legend>
          <div className="flex flex-wrap gap-x-4">
            {statuses.map((s) => (
              <label key={s} className="flex min-h-11 items-center gap-2 text-body">
                <input type="checkbox" className="size-5" checked={aw.statuses === null || aw.statuses.includes(s)}
                  onChange={(e) => {
                    const cur = aw.statuses ?? statuses;
                    const next = e.target.checked ? [...new Set([...cur, s])] : cur.filter((x) => x !== s);
                    setAw(next.length === statuses.length ? null : next, aw.role);
                  }} />
                {s}
              </label>
            ))}
          </div>
          <div className="mt-2 max-w-xs">
            <Label htmlFor={`${p}-role`}>Only for role</Label>
            <Select id={`${p}-role`} value={aw.role ?? ''} onChange={(e) => setAw(aw.statuses, e.target.value || null)}>
              <option value="">Any role</option>
              {roles.map((r) => <option key={r} value={r}>{r}</option>)}
            </Select>
          </div>
        </fieldset>
      ) : (
        <p className="text-small text-fg-muted">Allowed when: <span className="font-mono">{action.allowedWhen}</span> (kept as is).</p>
      )}
      <div><Label htmlFor={`${p}-conf`}>Confirmation text</Label><Input id={`${p}-conf`} value={action.confirmation ?? ''} onChange={(e) => onChange({ ...action, confirmation: e.target.value || undefined })} /></div>

      <fieldset className="space-y-2">
        <legend className="mb-1.5 text-small font-semibold text-fg">Notification emails</legend>
        {action.emails.map((e, j) => (
          <div key={j} className="space-y-2 rounded-sm border border-border p-3">
            <div>
              <Label htmlFor={`${p}-e${j}-to`}>Recipients (comma separated; [Field] for an address from the entry)</Label>
              <Input id={`${p}-e${j}-to`} value={e.to.join(', ')} onChange={(ev) => setEmail(j, { ...e, to: ev.target.value.split(',').map((s) => s.trim()).filter(Boolean) })} />
              <p className="mt-1 text-small text-fg-muted">Fixed inboxes are managed per action in Form settings (they replace literal addresses).</p>
            </div>
            <div><Label htmlFor={`${p}-e${j}-subj`}>Subject</Label><Input id={`${p}-e${j}-subj`} value={e.subject ?? ''} onChange={(ev) => setEmail(j, { ...e, subject: ev.target.value || undefined })} /></div>
            <div className="flex flex-wrap gap-x-4">
              {([['includeEntryDetails', 'Entry details'], ['includeDocumentAttachments', 'Entry PDF'], ['includeAttachments', 'Uploaded files']] as const).map(([k, l]) => (
                <label key={k} className="flex min-h-11 items-center gap-2 text-body">
                  <input type="checkbox" className="size-5" checked={!!e[k]} onChange={(ev) => setEmail(j, { ...e, [k]: ev.target.checked || undefined })} />
                  {l}
                </label>
              ))}
            </div>
            <div className="flex flex-wrap items-end gap-2">
              <div className="min-w-48">
                <Label htmlFor={`${p}-e${j}-link`}>Link for role</Label>
                <Select id={`${p}-e${j}-link`} value={e.linkForRole ?? ''} onChange={(ev) => setEmail(j, { ...e, linkForRole: ev.target.value || undefined })}>
                  <option value="">No link</option>
                  {roles.map((r) => <option key={r} value={r}>{r}</option>)}
                </Select>
              </div>
              <button type="button" className={buttonClass('ghost', 32)} onClick={() => onChange({ ...action, emails: action.emails.filter((_, k) => k !== j) })}>Remove email</button>
            </div>
          </div>
        ))}
        <button type="button" className={buttonClass('secondary', 32)} onClick={() => onChange({ ...action, emails: [...action.emails, { to: [], includeEntryDetails: true }] })}>Add email</button>
      </fieldset>
      <button type="button" className={buttonClass('destructive-outline', 32)} onClick={onRemove}>Remove action</button>
    </div>
  );
}
