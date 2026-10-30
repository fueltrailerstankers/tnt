// Small shared pieces of the form renderer. The markup of the kit field types must stay byte-for-byte the
// same (tests/unit/kit-forms-unchanged.test.ts), so every M8 addition renders only when its option is set.

export const inputCls = (err?: string) =>
  `w-full rounded border px-3 py-2 text-base md:text-sm bg-surface disabled:bg-surface-2 ${err ? 'border-danger' : 'border-border-strong'}`;

export function RequiredMark({ show }: { show?: boolean }) {
  return show ? <span aria-hidden="true" className="text-status-red-fg"> *</span> : null;
}

export function Label({ htmlFor, text, hidden, required }: { htmlFor: string; text: string; hidden?: boolean; required?: boolean }) {
  return (
    <label htmlFor={htmlFor} className={hidden ? 'sr-only' : 'mb-1 block text-sm font-medium'}>
      {text}
      <RequiredMark show={required} />
    </label>
  );
}

export function Legend({ text, required, className = 'mb-1 text-sm font-medium' }: { text: string; required?: boolean; className?: string }) {
  return (
    <legend className={className}>
      {text}
      <RequiredMark show={required} />
    </legend>
  );
}

export function ErrorText({ msg, id }: { msg?: string; id: string }) {
  return msg ? <p id={id} className="mt-1 text-sm text-status-red-fg">{msg}</p> : null;
}

export function HelpText({ text, id }: { text?: string; id: string }) {
  return text ? <p id={id} className="mt-1 text-xs text-fg-muted">{text}</p> : null;
}

/**
 * aria attributes of an input: invalid + described by its help and error text, required when the form marks
 * required fields. Keys appear only when they apply, in the pre-M8 order (aria-invalid, aria-describedby).
 */
export function a11y(id: string, err: string | undefined, help: string | undefined, required: boolean | undefined): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  if (err) out['aria-invalid'] = true;
  const by = [help ? `${id}-help` : null, err ? `${id}-err` : null].filter(Boolean).join(' ');
  if (by) out['aria-describedby'] = by;
  if (required) out['aria-required'] = true;
  return out;
}
