// A business's own account tools — mounted at /businesses before the main
// business router. Everything is /:businessId/account/… and scoped to the team.
import express from 'express';
import { authMiddleware } from '../middlewares/auth.middleware.js';
import { validateMiddleware } from '../middlewares/validate.middleware.js';
import { requireBusinessPermission } from '../middlewares/businessAccess.middleware.js';
import { BUSINESS_PERMISSIONS as P } from '../config/business-permissions.js';
import * as c from '../controllers/businessAccount.controller.js';
import * as v from '../validations/businessAccount.validation.js';

const router = express.Router();

const scoped = (permission, schema) => [
  authMiddleware,
  validateMiddleware(schema),
  requireBusinessPermission(permission),
];
const base = '/:businessId/account';

// Notification settings
router.get(`${base}/notification-settings`, ...scoped(P.VIEW, v.businessOnlySchema), c.getNotificationSettings);
router.put(
  `${base}/notification-settings`,
  ...scoped(P.PROFILE_EDIT, v.updateNotificationSettingsSchema),
  c.updateNotificationSettings
);

// Privacy
router.get(`${base}/privacy`, ...scoped(P.VIEW, v.businessOnlySchema), c.getPrivacy);
router.put(`${base}/privacy`, ...scoped(P.PROFILE_EDIT, v.updatePrivacySchema), c.updatePrivacy);

// Blocked accounts
router.get(`${base}/blocked`, ...scoped(P.PROFILE_EDIT, v.businessOnlySchema), c.listBlocked);
router.post(`${base}/blocked`, ...scoped(P.PROFILE_EDIT, v.blockUserSchema), c.blockUser);
router.delete(`${base}/blocked/:userId`, ...scoped(P.PROFILE_EDIT, v.unblockUserSchema), c.unblockUser);

// Pinned profiles
router.get(`${base}/pinned-profiles`, ...scoped(P.VIEW, v.listPinnedSchema), c.listPinned);
router.get(`${base}/pinned-profiles/:username`, ...scoped(P.VIEW, v.pinUsernameSchema), c.getPinStatus);
router.post(`${base}/pinned-profiles/:username`, ...scoped(P.VIEW, v.pinUsernameSchema), c.togglePin);
// Business pages (same Pinned Profiles list)
router.get(`${base}/pinned-businesses/:idOrSlug`, ...scoped(P.VIEW, v.pinBusinessSchema), c.getBusinessPinStatus);
router.post(`${base}/pinned-businesses/:idOrSlug`, ...scoped(P.VIEW, v.pinBusinessSchema), c.togglePinBusiness);

// Interests
router.get(`${base}/interests`, ...scoped(P.VIEW, v.businessOnlySchema), c.getInterests);
router.put(`${base}/interests`, ...scoped(P.PROFILE_EDIT, v.saveInterestsSchema), c.saveInterests);

// Payment methods (the business's own Stripe customer)
router.get(`${base}/payment-methods`, ...scoped(P.WALLET_MANAGE, v.businessOnlySchema), c.listPaymentMethods);
router.post(
  `${base}/payment-methods/portal`,
  ...scoped(P.WALLET_MANAGE, v.paymentPortalSchema),
  c.createPaymentPortal
);

// Spend log
router.get(`${base}/spend/summary`, ...scoped(P.WALLET_MANAGE, v.businessOnlySchema), c.getSpendSummary);
router.get(`${base}/spend/timeline`, ...scoped(P.WALLET_MANAGE, v.spendTimelineSchema), c.getSpendTimeline);
router.get(`${base}/spend/recent`, ...scoped(P.WALLET_MANAGE, v.spendRecentSchema), c.getSpendRecent);

// Digital product purchases
router.get(`${base}/purchases`, ...scoped(P.VIEW, v.listPurchasesSchema), c.listPurchases);
router.get(
  `${base}/purchases/:orderId/download`,
  ...scoped(P.VIEW, v.purchaseDownloadSchema),
  c.getPurchaseDownload
);

export default router;
