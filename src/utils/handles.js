import { and, eq, gt, inArray, isNotNull, lt, ne, or } from 'drizzle-orm';
import { db } from '../db/index.js';
import { businesses, businessPreviousHandles, handles } from '../db/schema/index.js';

/**
 * Personal usernames and business @usernames (slugs) share one namespace,
 * enforced by the "handles" table (see drizzle/0180_shared_handles.sql):
 * database triggers claim every username / slug there, so a clash fails the
 * write with unique_violation on "handles_pkey".
 *
 * Renamed businesses keep their old names in "business_previous_handles"
 * (drizzle/0181_business_previous_handles.sql) so old links redirect.
 */

/** The underlying Postgres error (drizzle may wrap it in `cause`). */
export const pgError = err => (err?.code ? err : err?.cause?.code ? err.cause : null);

/** True when `err` is a write that lost a name to another person or business. */
export const isHandleClash = err => {
  const pg = pgError(err);
  return pg?.code === '23505' && pg?.constraint === 'handles_pkey';
};

/** After a rename, the old name stays held for the business this long. */
export const HANDLE_HOLD_DAYS = 30;

/**
 * Is `name` an old @username another business renamed away from recently?
 * (It's reserved so its redirect keeps working; `exceptBusinessId` may take it back.)
 */
export async function isHandleOnHold(name, { exceptBusinessId, tx = db } = {}) {
  const since = new Date(Date.now() - HANDLE_HOLD_DAYS * 86_400_000);
  const [row] = await tx
    .select({ businessId: businessPreviousHandles.businessId })
    .from(businessPreviousHandles)
    .where(
      and(
        eq(businessPreviousHandles.name, name.toLowerCase()),
        gt(businessPreviousHandles.createdAt, since),
        ...(exceptBusinessId ? [ne(businessPreviousHandles.businessId, exceptBusinessId)] : [])
      )
    )
    .limit(1);
  return !!row;
}

// ─── Held for a business sign-up (drizzle/0183) ─────────────────────────────

/** A business sign-up's @username is held this long for the business to be created. */
export const PENDING_HANDLE_HOLD_DAYS = 30;
const holdCutoff = () => new Date(Date.now() - PENDING_HANDLE_HOLD_DAYS * 86_400_000);

/** When a hold claimed at `claimedAt` runs out. */
export const pendingHoldEndsAt = claimedAt =>
  new Date(new Date(claimedAt).getTime() + PENDING_HANDLE_HOLD_DAYS * 86_400_000);

/**
 * Drop expired sign-up holds (all of them, or just `name`'s). The pending
 * setup itself stays, so the user can still resume — the name just isn't
 * reserved any more. Returns the released names.
 */
export async function releaseExpiredPendingHolds({ name, tx = db } = {}) {
  const rows = await tx
    .delete(handles)
    .where(
      and(
        isNotNull(handles.pendingUserId),
        lt(handles.createdAt, holdCutoff()),
        ...(name ? [eq(handles.name, name.toLowerCase())] : [])
      )
    )
    .returning({ name: handles.name });
  return rows.map(r => r.name);
}

/**
 * Is `name` reserved for someone's unfinished business sign-up? An expired
 * hold is released first, so checks and the database agree. `exceptUserId`:
 * the person the hold is for (it's available to them).
 */
export async function isHeldForPendingSetup(name, { exceptUserId, tx = db } = {}) {
  const lower = name.toLowerCase();
  await releaseExpiredPendingHolds({ name: lower, tx });
  const [row] = await tx
    .select({ userId: handles.pendingUserId })
    .from(handles)
    .where(
      and(
        eq(handles.name, lower),
        isNotNull(handles.pendingUserId),
        ...(exceptUserId ? [ne(handles.pendingUserId, exceptUserId)] : [])
      )
    )
    .limit(1);
  return !!row;
}

const UUID_RE =/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/**
 * WHERE for public lookups by URL key: the business id, its current slug, or
 * one of its old @usernames (a name can't be both — claiming one ends its
 * redirect). Callers compare the found slug with what they asked for to
 * tell a redirect apart.
 */
export function businessByIdOrSlug(idOrSlug) {
  if (UUID_RE.test(idOrSlug)) return eq(businesses.id, idOrSlug);
  const name = idOrSlug.toLowerCase();
  return or(
    eq(businesses.slug, name),
    inArray(
      businesses.id,
      db
        .select({ id: businessPreviousHandles.businessId })
        .from(businessPreviousHandles)
        .where(eq(businessPreviousHandles.name, name))
    )
  );
}
