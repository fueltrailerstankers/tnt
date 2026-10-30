import { describe, expect, it } from 'vitest';
import { dialogKeyAction, initialFocusTarget, trapFocusTarget } from '@/lib/ui/focus-trap';

const base = { isTop: true, dismissible: true, defaultPrevented: false };

describe('dialogKeyAction', () => {
  it('closes on Escape for the top dialog', () => {
    expect(dialogKeyAction({ ...base, key: 'Escape' })).toBe('close');
  });
  it('ignores Escape while pending, when a popover handled it, or for a dialog underneath', () => {
    expect(dialogKeyAction({ ...base, key: 'Escape', dismissible: false })).toBe('ignore');
    expect(dialogKeyAction({ ...base, key: 'Escape', defaultPrevented: true })).toBe('ignore');
    expect(dialogKeyAction({ ...base, key: 'Escape', isTop: false })).toBe('ignore');
  });
  it('traps Tab only in the top dialog, even while pending', () => {
    expect(dialogKeyAction({ ...base, key: 'Tab' })).toBe('trap');
    expect(dialogKeyAction({ ...base, key: 'Tab', dismissible: false })).toBe('trap');
    expect(dialogKeyAction({ ...base, key: 'Tab', isTop: false })).toBe('ignore');
    expect(dialogKeyAction({ ...base, key: 'Enter' })).toBe('ignore');
  });
});

describe('trapFocusTarget', () => {
  const box = 'box';
  const items = ['close', 'input', 'cancel', 'confirm'];

  it('wraps Tab from the last element to the first', () => {
    expect(trapFocusTarget(items, 'confirm', box, false, true)).toBe('close');
  });
  it('wraps Shift+Tab from the first element (or the box) to the last', () => {
    expect(trapFocusTarget(items, 'close', box, true, true)).toBe('confirm');
    expect(trapFocusTarget(items, box, box, true, true)).toBe('confirm');
  });
  it('lets the browser move focus between inner elements', () => {
    expect(trapFocusTarget(items, 'input', box, false, true)).toBeNull();
    expect(trapFocusTarget(items, 'cancel', box, true, true)).toBeNull();
  });
  it('pulls focus back in when it escaped the dialog', () => {
    expect(trapFocusTarget(items, 'page-link', box, false, false)).toBe('close');
    expect(trapFocusTarget(items, 'page-link', box, true, false)).toBe('confirm');
  });
  it('keeps focus on the box when nothing inside is tabbable', () => {
    expect(trapFocusTarget([], 'page-link', box, false, false)).toBe(box);
  });
});

describe('initialFocusTarget', () => {
  const isClose = (el: string) => el === 'close';
  it('prefers the caller choice', () => {
    expect(initialFocusTarget('input', ['close', 'input'], isClose, 'box')).toBe('input');
  });
  it('skips the header close button for the first input or action', () => {
    expect(initialFocusTarget(null, ['close', 'input', 'confirm'], isClose, 'box')).toBe('input');
  });
  it('falls back to the close button, then the dialog itself', () => {
    expect(initialFocusTarget(undefined, ['close'], isClose, 'box')).toBe('close');
    expect(initialFocusTarget(null, [], isClose, 'box')).toBe('box');
  });
});
