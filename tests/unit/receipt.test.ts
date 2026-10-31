import { describe, expect, it } from 'vitest';
import { receiptHeading, receiptReference } from '@/lib/forms/receipt';

describe('thank-you receipt', () => {
  it('builds a reference only from a plain positive number', () => {
    expect(receiptReference('request-for-invoice', '388')).toBe('RFI-388');
    expect(receiptReference('delivery-note', '291')).toBe('DN-291');
    expect(receiptReference('job-card', '0')).toBeNull();
    expect(receiptReference('job-card', '12a')).toBeNull();
    expect(receiptReference('job-card', '<script>')).toBeNull();
    expect(receiptReference('job-card', undefined)).toBeNull();
  });
  it('uses the design heading where there is one, else the form name', () => {
    expect(receiptHeading('request-for-invoice', 'Request For Invoice')).toBe('Thank you, we have your request');
    expect(receiptHeading('job-card', 'JOB CARD')).toBe('JOB CARD');
  });
});
