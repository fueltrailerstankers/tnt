import { describe, expect, it } from 'vitest';
import { FX_SETTING_KEY, fxInputValue, fxLabel, fxRateOf, parseFxInput } from '@/lib/settings/fx';
import { durationLabel, jobRunView, parseJobState, parsePage, STALL_MS } from '@/lib/settings/job-runs';
import { orgChanges, parseOrgForm, timezoneLabel } from '@/lib/settings/org';
import { branchLabel, knownEventKeys, parseRecipient, sortRecipients } from '@/lib/settings/recipients';

describe('fx.zar_usd (manual ZAR -> USD rate)', () => {
  it('uses the documented key', () => {
    expect(FX_SETTING_KEY).toBe('fx.zar_usd');
  });

  it('accepts a positive decimal string (USD per 1 ZAR) and keeps the typed text', () => {
    expect(parseFxInput('0.0547')).toEqual({ ok: true, value: '0.0547' });
    expect(parseFxInput(' 0.05 ')).toEqual({ ok: true, value: '0.05' });
    expect(parseFxInput('1')).toEqual({ ok: true, value: '1' });
    expect(parseFxInput('0.00000001')).toEqual({ ok: true, value: '0.00000001' });
  });

  it('blank clears the rate', () => {
    expect(parseFxInput('')).toEqual({ ok: true, value: null });
    expect(parseFxInput('   ')).toEqual({ ok: true, value: null });
    expect(parseFxInput(null)).toEqual({ ok: true, value: null });
  });

  it('refuses zero, negatives, exponents, commas, junk and absurd rates', () => {
    for (const bad of ['0', '0.0', '-0.05', '+0.05', '5e-2', '0,0547', '.05', '05', '0.05 USD', 'NaN', 'Infinity', '18.2', '0.123456789', '1.5', 'abc']) {
      expect(parseFxInput(bad).ok, bad).toBe(false);
    }
    expect(parseFxInput(0.05 as unknown).ok).toBe(false);
  });

  it('reads the stored value back, ignoring anything invalid', () => {
    expect(fxRateOf('0.0547')).toBe(0.0547);
    expect(fxRateOf(0.0547)).toBeNull(); // must be a string
    expect(fxRateOf('-1')).toBeNull();
    expect(fxRateOf(null)).toBeNull();
    expect(fxInputValue('0.0547')).toBe('0.0547');
    expect(fxInputValue({})).toBe('');
    expect(fxLabel('0.0547')).toBe('R 1 = $0.0547');
    expect(fxLabel(undefined)).toBeNull();
  });
});

describe('Organisation form', () => {
  const ok = { name: 'Trailers & Tankers', timezone: 'Africa/Johannesburg', currency: 'USD', fxSource: 'manual', fxRate: '0.0547' };

  it('parses a valid form', () => {
    expect(parseOrgForm(ok)).toEqual({ ok: true, value: { name: 'Trailers & Tankers', timezone: 'Africa/Johannesburg', currency: 'USD', fxRate: '0.0547' } });
    expect(parseOrgForm({ ...ok, currency: 'ZAR', fxRate: '' })).toMatchObject({ ok: true, value: { currency: 'ZAR', fxRate: null } });
  });

  it('collects field errors with fixed texts', () => {
    const r = parseOrgForm({ name: '', timezone: 'Mars/Base', currency: 'EUR', fxSource: 'feed', fxRate: '-1' });
    expect(r.ok).toBe(false);
    if (!r.ok) {
      expect(Object.keys(r.errors).sort()).toEqual(['currency', 'fxRate', 'fxSource', 'name', 'timezone']);
      expect(JSON.stringify(r.errors)).not.toContain('Mars');
    }
    const fxOnly = parseOrgForm({ ...ok, fxRate: '0' });
    expect(fxOnly).toEqual({ ok: false, errors: { fxRate: 'The rate must be more than 0.' } });
  });

  it('labels the SAST zone and lists what changed', () => {
    expect(timezoneLabel('Africa/Johannesburg')).toBe('Africa/Johannesburg (SAST, UTC+2)');
    expect(timezoneLabel('UTC')).toBe('UTC');
    const before = { name: 'A', timezone: 'Africa/Johannesburg', currency: 'USD', fxRate: null };
    expect(orgChanges(before, { name: 'A', timezone: 'UTC', currency: 'ZAR', fxRate: '0.05' })).toEqual({ changed: ['timezone', 'currency'], fxChanged: true });
    expect(orgChanges({ ...before, fxRate: '0.05' }, { name: 'B', timezone: 'Africa/Johannesburg', currency: 'USD', fxRate: '0.05' })).toEqual({ changed: ['name'], fxChanged: false });
  });
});

describe('Notification recipients', () => {
  it('validates event key, address and branch', () => {
    expect(parseRecipient({ eventKey: 'release.paid', address: ' Accounts@Example.com ', branch: ' Durban ', active: true }))
      .toEqual({ ok: true, value: { id: null, eventKey: 'release.paid', address: 'accounts@example.com', branch: 'Durban', active: true } });
    expect(parseRecipient({ eventKey: 'request-for-invoice.Submit', address: 'a@example.com', branch: '', active: false }))
      .toMatchObject({ ok: true, value: { branch: null, active: false } });
    const bad = parseRecipient({ eventKey: 'Release paid', address: 'not-an-email', branch: 'x'.repeat(61), active: true });
    expect(bad).toEqual({ ok: false, errors: {
      eventKey: 'Use an event key like release.paid or request-for-invoice.Submit.', address: 'Enter one email address.', branch: 'Branch is up to 60 characters.',
    } });
    expect(parseRecipient({ id: 'nope', eventKey: 'release.paid', address: 'a@example.com', active: true })).toMatchObject({ ok: false, errors: { form: expect.any(String) } });
    expect(parseRecipient({ eventKey: 'release', address: 'a@example.com', active: true }).ok).toBe(false);
    expect(parseRecipient({ eventKey: 'leads.new', address: 'a@example.com, b@example.com', active: true }).ok).toBe(false);
  });

  it('sorts rows and lists known keys', () => {
    const rows = [
      { id: '1', event_key: 'release.paid', address: 'b@example.com', branch: null, active: true },
      { id: '2', event_key: 'leads.new', address: 'z@example.com', branch: 'Durban', active: false },
      { id: '3', event_key: 'leads.new', address: 'y@example.com', branch: null, active: true },
    ];
    expect(sortRecipients(rows).map((r) => r.id)).toEqual(['3', '2', '1']);
    expect(knownEventKeys(rows)).toEqual(['leads.new', 'release.paid']);
    expect(branchLabel(null)).toBe('All branches');
    expect(branchLabel('Cape Town')).toBe('Cape Town');
  });
});

describe('Job runs', () => {
  const now = Date.parse('2026-10-29T12:00:00Z');
  it('derives state, duration and a redacted error', () => {
    expect(jobRunView({ id: 8812, job: 'xero.sync.full', started_at: '2026-10-29T11:58:00Z', finished_at: '2026-10-29T11:58:04.1Z', ok: false, processed: 3, error: 'xero 429' }, now))
      .toEqual({ id: '#8812', job: 'xero.sync.full', startedAt: '2026-10-29T11:58:00Z', duration: '4.1 s', state: 'Failed', tone: 'red', processed: '3', error: '429 Too Many Requests' });
    expect(jobRunView({ id: 1, job: 'outbox', started_at: '2026-10-29T11:59:00Z', finished_at: null, ok: null, processed: 0, error: null }, now)).toMatchObject({ state: 'Running', tone: 'teal', duration: '—', error: null });
    expect(jobRunView({ id: 2, job: 'outbox', started_at: new Date(now - STALL_MS - 1).toISOString(), finished_at: null, ok: null, processed: 0, error: null }, now)).toMatchObject({ state: 'Stalled' });
    expect(jobRunView({ id: 3, job: 'outbox', started_at: '2026-10-29T11:00:00Z', finished_at: '2026-10-29T11:00:00.6Z', ok: true, processed: 9, error: null }, now)).toMatchObject({ state: 'Succeeded', duration: '600 ms', processed: '9' });
    const leaky = jobRunView({ id: 4, job: 'x', started_at: '2026-10-29T11:00:00Z', finished_at: '2026-10-29T11:00:01Z', ok: false, processed: 0, error: 'mail to someone@example.com failed for 8001015009087' }, now);
    expect(leaky.error).not.toContain('@');
    expect(leaky.error).not.toContain('8001015009087');
  });

  it('formats durations and parses filters', () => {
    expect(durationLabel('2026-10-29T11:00:00Z', '2026-10-29T11:02:05Z')).toBe('2 min 5 s');
    expect(durationLabel('2026-10-29T11:00:00Z', '2026-10-29T10:00:00Z')).toBe('—');
    expect(parseJobState('failed')).toBe('failed');
    expect(parseJobState('drop table')).toBe('all');
    expect(parsePage('3')).toBe(3);
    expect(parsePage('-1')).toBe(1);
    expect(parsePage('99999')).toBe(1);
    expect(parsePage(undefined)).toBe(1);
  });
});
