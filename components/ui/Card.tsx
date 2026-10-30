import type { HTMLAttributes, ReactNode } from 'react';

type CardTag = 'section' | 'div' | 'article' | 'aside';

export interface CardProps extends HTMLAttributes<HTMLElement> {
  as?: CardTag;
  /** md p-5 gap-4 (default), sm p-4 gap-3 (rail cards), none for tables that run edge to edge. */
  padding?: 'md' | 'sm' | 'none';
}

const PADDING = { md: 'flex flex-col gap-4 p-5', sm: 'flex flex-col gap-3 p-4', none: 'overflow-hidden' } as const;

/** Surface with a 1px border, 12px radius and the card shadow. */
export function Card({ as: Tag = 'section', padding = 'md', className = '', children, ...rest }: CardProps) {
  return (
    <Tag className={`rounded-md border border-border bg-surface text-fg shadow-card ${PADDING[padding]} ${className}`.trim()} {...rest}>
      {children}
    </Tag>
  );
}

export interface CardHeaderProps {
  title: ReactNode;
  /** Right-aligned slot: a link, a button or a badge. */
  action?: ReactNode;
  /** `detail`: 15px/600 heading ("Timeline", "Files"). `section`: 12px uppercase muted label ("Buttons"). */
  variant?: 'detail' | 'section';
  /** Put this id in the Card's aria-labelledby to name the region. */
  id?: string;
  level?: 2 | 3;
  className?: string;
}

const TITLE = {
  detail: 'text-[15px] font-semibold leading-[22px] text-fg',
  section: 'text-[12px] font-semibold uppercase leading-4 tracking-[0.8px] text-fg-muted',
} as const;

export function CardHeader({ title, action, variant = 'detail', id, level = 2, className = '' }: CardHeaderProps) {
  const H = level === 3 ? 'h3' : 'h2';
  return (
    <div className={`flex flex-wrap items-center justify-between gap-x-3 gap-y-1 ${className}`.trim()}>
      <H id={id} className={`m-0 ${TITLE[variant]}`}>{title}</H>
      {action ? <div className="flex items-center gap-2 text-small">{action}</div> : null}
    </div>
  );
}
