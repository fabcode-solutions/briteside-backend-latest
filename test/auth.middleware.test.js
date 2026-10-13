import { describe, it, expect, vi } from 'vitest';
import { requireAdmin } from '../src/middlewares/auth.middleware.js';

// requireAdmin gates every /admin/* route (including the new ACRCloud
// copyright-case endpoints) — a non-admin authenticated user must be
// rejected with 403, never reach the controller.
describe('requireAdmin', () => {
  it('rejects a request with no authenticated user at all', () => {
    const req = {};
    const next = vi.fn();
    requireAdmin(req, {}, next);
    expect(next).toHaveBeenCalledTimes(1);
    const err = next.mock.calls[0][0];
    expect(err).toBeInstanceOf(Error);
    expect(err.statusCode).toBe(403);
  });

  it('rejects an authenticated user without the admin role', () => {
    const req = { user: { id: 'user-1', roles: ['user'] } };
    const next = vi.fn();
    requireAdmin(req, {}, next);
    expect(next).toHaveBeenCalledTimes(1);
    expect(next.mock.calls[0][0]).toMatchObject({ statusCode: 403 });
  });

  it('rejects a user with an empty roles array', () => {
    const req = { user: { id: 'user-1', roles: [] } };
    const next = vi.fn();
    requireAdmin(req, {}, next);
    expect(next.mock.calls[0][0]).toMatchObject({ statusCode: 403 });
  });

  it('allows a user whose roles include "admin" through unchanged', () => {
    const req = { user: { id: 'admin-1', roles: ['user', 'admin'] } };
    const next = vi.fn();
    requireAdmin(req, {}, next);
    expect(next).toHaveBeenCalledTimes(1);
    expect(next.mock.calls[0]).toEqual([]); // called with no error argument
  });
});
