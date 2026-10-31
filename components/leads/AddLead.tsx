'use client';

import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useRef, useState, useTransition, type FormEvent, type MouseEvent } from 'react';
import { addLead } from '@/app/(admin)/admin/leads/actions';
import { Button } from '@/components/ui/Button';
import { Icon } from '@/components/ui/Icon';
import { Modal } from '@/components/ui/Modal';
import { buttonClass } from '@/components/ui/styles';
import { fieldErrors, type UiSource } from '@/lib/leads-view/actions';
import { DEDUPE_NOTE, LeadFormFields, type LeadFieldErrors } from './LeadFormFields';

/**
 * "Add lead": a link to /admin/leads/new (works without JavaScript) that opens the Add lead modal instead.
 * On save it goes to the new lead; a possible duplicate shows there as a warning.
 */
export function AddLead({ sources, branches = [] }: { sources: readonly UiSource[]; branches?: readonly string[] }) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [errors, setErrors] = useState<LeadFieldErrors>({});
  const [pending, start] = useTransition();
  const form = useRef<HTMLFormElement>(null);

  const onTrigger = (e: MouseEvent<HTMLAnchorElement>) => {
    if (e.metaKey || e.ctrlKey || e.shiftKey || e.altKey || e.button !== 0) return;
    e.preventDefault();
    setErrors({});
    setOpen(true);
  };

  // onSubmit (not a form action): React resets a form after its action runs, which would clear what was typed
  // when the server asks for a fix.
  const submit = (e: FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    const fd = new FormData(e.currentTarget);
    start(async () => {
      const r = await addLead(fd);
      if (!r.ok) {
        setErrors(fieldErrors(r.fields.length ? r.fields : ['form']));
        return;
      }
      setOpen(false);
      router.push(`/admin/leads/${r.id}`);
    });
  };

  return (
    <>
      <Link
        href="/admin/leads/new"
        onClick={onTrigger}
        className={buttonClass('primary', 36, 'max-lg:size-11 max-lg:px-0')}
      >
        <Icon name="plus" size={16} strokeWidth={2.25} />
        <span className="max-lg:sr-only">Add lead</span>
      </Link>
      <Modal
        open={open}
        onClose={() => setOpen(false)}
        title="Add lead"
        size="lg"
        pending={pending}
        footer={(
          <>
            <Button variant="secondary" size={38} onClick={() => setOpen(false)} disabled={pending}>Cancel</Button>
            <Button size={38} loading={pending} onClick={() => form.current?.requestSubmit()}>Save lead</Button>
          </>
        )}
      >
        <form ref={form} onSubmit={submit} noValidate className="flex flex-col gap-3">
          {errors.form ? <p role="alert" className="m-0 rounded-sm bg-status-red-bg px-3 py-2 text-small text-status-red-fg">{errors.form}</p> : null}
          <LeadFormFields idPrefix="add-lead" errors={errors} sources={sources} branches={branches} />
          <p className="m-0 text-[12px] leading-4 text-fg-muted">{DEDUPE_NOTE}</p>
          <button type="submit" hidden tabIndex={-1} aria-hidden="true" />
        </form>
      </Modal>
    </>
  );
}
