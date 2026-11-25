import logger from '../config/logger.js';
import { PENDING_HANDLE_HOLD_DAYS, releaseExpiredPendingHolds } from '../utils/handles.js';

/**
 * Business sign-ups hold their @username until the business is created, for
 * PENDING_HANDLE_HOLD_DAYS. Free the names whose hold ran out (the pending
 * setup itself stays, so the user can still resume — just without the
 * reservation). Checks also release an expired hold on the spot; this keeps
 * the table tidy for names nobody asks about.
 */
export async function releaseExpiredHandleHolds() {
  try {
    const released = await releaseExpiredPendingHolds();
    if (released.length) {
      logger.info(
        `[pendingHandleHolds] Released ${released.length} @username hold(s) older than ${PENDING_HANDLE_HOLD_DAYS} days`
      );
    }
  } catch (err) {
    logger.error('[pendingHandleHolds] Error:', err);
  }
}
