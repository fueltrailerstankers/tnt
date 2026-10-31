// Small shared pieces of the form renderer (labels, help, errors, aria). The kit forms' markup must stay as it
// was (tests/unit/kit-forms-unchanged.test.ts), so the M8 bits render only when their option is set.
import { errorCls, labelCls } from './styles';

export function RequiredMark({ show }: { show?: boolean }) {
  return show ? <span className="ml-0.5 text-danger" aria-hidden="true">*</span> : null;
}

export function FieldLabel({ htmlFor, text, hidden, required }: { htmlFor: string; text: string; hidden?: boolean; required?: boolean }) {
  return (
    <label htmlFor={htmlFor} className={hidden ? 'sr-only' : labelCls}>
      {text}
      <RequiredMark show={required} />
    </label>
  );
}

export function Legend({ text, required, hidden }: { text: string; required?: boolean; hidden?: boolean }) {
  return (
    <legend className={hidden ? 'sr-only' : labelCls}>
      {text}
      <RequiredMark show={required} />
    </legend>
  );
}

export function ErrorText({ msg, id }: { msg?: string; id: string }) {
  return msg ? <p id={id} className={errorCls}>{msg}</p> : null;
}

/** M8 `help`: the note under a field. */
export function HelpText({ text, id }: { text?: string; id: string }) {
  return text ? <p id={id} className="mt-1.5 text-small text-fg-muted">{text}</p> : null;
}

/**
 * aria attributes of an input: invalid and described by its help and error text (keys only when they apply,
 * in the pre-M8 order), plus aria-required on required inputs (the * is aria-hidden).
 */
export function a11y(id: string, err: string | undefined, help: string | undefined, required: boolean | undefined): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  if (err) out['aria-invalid'] = true;
  const by = [help ? `${id}-help` : null, err ? `${id}-err` : null].filter(Boolean).join(' ');
  if (by) out['aria-describedby'] = by;
  if (required) out['aria-required'] = true;
  return out;
}
