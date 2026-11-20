import { describe, expect, it } from 'vitest';
import { LOGIN_ERROR_PARAM, loginErrorMessage, signInFailureOf } from '@/lib/users/sign-in-error';

describe('signInFailureOf', () => {
  it('treats account-specific failures as credentials', () => {
    for (const status of [400, 401, 403, 404, 422, 429]) {
      expect(signInFailureOf({ status, name: 'AuthApiError' })).toBe('credentials');
    }
    expect(signInFailureOf(null)).toBe('credentials');
  });

  it('treats a restricted project, server errors and network failures as unavailable', () => {
    expect(signInFailureOf({ status: 402, name: 'AuthApiError' })).toBe('unavailable');
    expect(signInFailureOf({ status: 500 })).toBe('unavailable');
    expect(signInFailureOf({ status: 503 })).toBe('unavailable');
    expect(signInFailureOf({ status: 0 })).toBe('unavailable');
    expect(signInFailureOf({ name: 'AuthRetryableFetchError' })).toBe('unavailable');
    expect(signInFailureOf({})).toBe('unavailable');
  });
});

describe('loginErrorMessage', () => {
  it('maps each error parameter to its copy', () => {
    expect(loginErrorMessage('1')).toMatch(/Check your email and password/);
    expect(loginErrorMessage(LOGIN_ERROR_PARAM.unavailable)).toMatch(/unavailable right now/);
    expect(loginErrorMessage('link')).toMatch(/invalid or has expired/);
    expect(loginErrorMessage('anything')).toMatch(/Check your email and password/);
  });
});
