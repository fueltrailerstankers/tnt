'use client';

import { useState } from 'react';
import { Label, Select } from '@/components/ui/Field';
import {
  AREA_LABELS, AREAS, clampAccess, LEVEL_LABELS, LEVELS, PRESET_ACCESS, presetOf, ROLE_CEILING, ROLE_LABELS, ROLES,
  type AccessMap, type Area, type Level, type Role,
} from '@/lib/security/can';
import { ADMIN_GRANTED_WRITE } from '@/lib/users/rules';

const HINTS: Partial<Record<Area, string>> = {
  tasks: 'Tasks open entries, so they also need Forms read.',
  settings: 'Write also changes form settings (public links, recipients).',
  users: 'Write invites, edits, disables and removes users.',
};

/**
 * Preset picker plus a None / Read / Write choice per area (fields `role` and `access.<area>`). Picking a preset fills
 * every area; changing any area makes the member Custom. Admin is write everywhere; factory can never read entries,
 * the Xero mirror or leads. With `lockedReason` the choices are shown but not editable (and submitted unchanged).
 */
export function AccessMatrix({ initialRole, initialAccess, lockedReason, allowAdmin = true }: { initialRole: Role; initialAccess: AccessMap; lockedReason?: string; allowAdmin?: boolean }) {
  const [role, setRole] = useState<Role>(initialRole);
  const [access, setAccess] = useState<AccessMap>(() => clampAccess(initialRole, initialAccess));
  const preset = presetOf(role, access);
  const ceiling = ROLE_CEILING[role] ?? [];
  const locked = Boolean(lockedReason);

  const pickRole = (r: Role) => {
    setRole(r);
    setAccess(clampAccess(r, PRESET_ACCESS[r]));
  };

  return (
    <div className="space-y-3">
      <div>
        <Label htmlFor="role">Preset</Label>
        <div className="flex flex-wrap items-center gap-3">
          <Select id="role" name={locked ? undefined : 'role'} value={role} disabled={locked} onChange={(e) => pickRole(e.target.value as Role)} className="max-w-56">
            {ROLES.filter((r) => allowAdmin || r !== 'admin' || r === role).map((r) => <option key={r} value={r}>{ROLE_LABELS[r]}</option>)}
          </Select>
          <span className="text-small text-fg-muted" data-testid="preset-label" aria-live="polite">
            {preset === 'custom' ? `Custom (based on ${ROLE_LABELS[role]})` : `${ROLE_LABELS[role]} preset`}
          </span>
        </div>
        {role === 'admin' ? <p className="mt-1 text-small text-fg-muted">Admins have write access everywhere, plus admin-only actions (delete entries, Xero actions, imports, stock management).</p> : null}
        {role === 'reviewer' ? <p className="mt-1 text-small text-fg-muted">Reviewers can approve entries where the form workflow asks for it.</p> : null}
        {role === 'inspector' ? <p className="mt-1 text-small text-fg-muted">Inspectors work through role links only; give an area to let them sign in to the admin.</p> : null}
        {locked ? (
          <>
            <input type="hidden" name="role" value={role} />
            {AREAS.map((a) => <input key={a} type="hidden" name={`access.${a}`} value={access[a]} />)}
            <p className="mt-1 text-small text-fg-muted">{lockedReason}</p>
          </>
        ) : null}
      </div>

      <div className="rounded-md border border-border" role="group" aria-label="Access per area">
        {AREAS.map((a) => {
          const capped = ceiling.includes(a);
          return (
            <fieldset key={a} className="flex flex-wrap items-center justify-between gap-x-4 gap-y-1.5 border-b border-border px-3 py-2.5 last:border-b-0">
              <legend className="sr-only">{AREA_LABELS[a]}</legend>
              <div aria-hidden="true" className="min-w-0 flex-1 basis-40">
                <span className="font-semibold">{AREA_LABELS[a]}</span>
                {capped ? <span className="block text-small text-fg-muted">Not available to factory accounts.</span>
                  : HINTS[a] ? <span className="block text-small text-fg-muted">{HINTS[a]}</span> : null}
              </div>
              <div className="inline-flex rounded-pill border border-border bg-surface-2 p-0.5">
                {LEVELS.map((l: Level) => {
                  const on = access[a] === l;
                  // Write on Users, Integrations and Settings is granted by admins only (it can be kept or lowered).
                  const adminGrant = !allowAdmin && l === 'write' && ADMIN_GRANTED_WRITE.includes(a) && initialAccess[a] !== 'write';
                  const disabled = locked || role === 'admin' || (capped && l !== 'none') || adminGrant;
                  return (
                    <label
                      key={l}
                      className={`relative inline-flex h-11 min-w-16 items-center justify-center rounded-pill px-3 text-small font-semibold has-[:focus-visible]:outline-2 has-[:focus-visible]:outline-focus sm:h-8 ${on ? 'bg-accent text-accent-fg' : 'text-fg-muted'} ${disabled ? 'cursor-not-allowed opacity-60' : 'cursor-pointer'}`}
                    >
                      <input
                        type="radio"
                        name={locked ? undefined : `access.${a}`}
                        value={l}
                        checked={on}
                        disabled={disabled}
                        onChange={() => setAccess({ ...access, [a]: l })}
                        className="sr-only"
                      />
                      {LEVEL_LABELS[l]}
                    </label>
                  );
                })}
              </div>
            </fieldset>
          );
        })}
      </div>
    </div>
  );
}
