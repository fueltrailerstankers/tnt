'use client';

import { useEffect, useRef, type InputHTMLAttributes } from 'react';

export interface TableCheckboxProps extends Omit<InputHTMLAttributes<HTMLInputElement>, 'type' | 'aria-label'> {
  /** Accessible name: "Select all on this page", "Select entry 214". */
  label: string;
  /** Partial selection on the header checkbox. */
  indeterminate?: boolean;
}

/** 16px row/header checkbox with a 44px hit area (the label pads around it without shifting the layout). */
export function TableCheckbox({ label, indeterminate = false, className = '', ...rest }: TableCheckboxProps) {
  const ref = useRef<HTMLInputElement>(null);
  useEffect(() => {
    if (ref.current) ref.current.indeterminate = indeterminate && !ref.current.checked;
  });
  return (
    <label className="-m-3.5 inline-flex cursor-pointer items-center justify-center p-3.5 has-[:disabled]:cursor-not-allowed">
      <input ref={ref} type="checkbox" aria-label={label} className={`size-4 cursor-[inherit] accent-accent ${className}`.trim()} {...rest} />
    </label>
  );
}
