import express from 'express';
import { authMiddleware, optionalAuthMiddleware } from '../middlewares/auth.middleware.js';
import { validateMiddleware } from '../middlewares/validate.middleware.js';
import { requireActiveSubscription } from '../middlewares/subscription.middleware.js';
import { requireBusinessPermission } from '../middlewares/businessAccess.middleware.js';
import { BUSINESS_PERMISSIONS as P } from '../config/business-permissions.js';
import * as c from '../controllers/business.controller.js';
import * as v from '../validations/business.validation.js';

const router = express.Router();

// ─── Public ─────────────────────────────────────────────────────────────────
router.get('/categories', c.getCategories);
router.get('/fees/quote', c.quoteFees);
router.get('/', validateMiddleware(v.listBusinessesSchema), c.listBusinesses);

// ─── Bookings: customer side (static paths, before /:idOrSlug) ─────────────
router.get(
  '/bookings/checkout/:checkoutSessionId',
  validateMiddleware(v.checkoutSessionParamsSchema),
  c.getBookingByCheckoutSession
);
router.get('/bookings/mine', authMiddleware, validateMiddleware(v.myBookingsSchema), c.listMyBookings);
// In-app card checkout (NativeCheckoutModal) for a held booking — guests may pay too
router.post('/bookings/:bookingId/native-tax-preview', optionalAuthMiddleware, validateMiddleware(v.nativeIntentSchema), c.bookingNativeTaxPreview);
router.post('/bookings/:bookingId/native-intent', optionalAuthMiddleware, validateMiddleware(v.nativeIntentSchema), c.bookingNativeIntent);
router.post('/bookings/:bookingId/native-finalize', optionalAuthMiddleware, validateMiddleware(v.nativeFinalizeSchema), c.bookingNativeFinalize);
// …and for the remaining balance (signed-in customer)
router.post('/bookings/:bookingId/balance/native-tax-preview', authMiddleware, validateMiddleware(v.nativeIntentSchema), c.balanceNativeTaxPreview);
router.post('/bookings/:bookingId/balance/native-intent', authMiddleware, validateMiddleware(v.nativeIntentSchema), c.balanceNativeIntent);
router.post('/bookings/:bookingId/balance/native-finalize', authMiddleware, validateMiddleware(v.nativeFinalizeSchema), c.balanceNativeFinalize);
// Business side, across every business the user owns or is on the team of
// (My Calendar → Appointment Requests and the calendar view)
router.get(
  '/bookings/managed',
  authMiddleware,
  validateMiddleware(v.managedBookingsSchema),
  c.listManagedBookings
);
router.post(
  '/bookings/:bookingId/cancel',
  authMiddleware,
  validateMiddleware(v.customerCancelSchema),
  c.cancelMyBooking
);
// Pay the remaining balance online (no booking fee; 5% commission applies)
router.post(
  '/bookings/:bookingId/pay-balance',
  authMiddleware,
  validateMiddleware(v.payBalanceSchema),
  c.payMyBookingBalance
);

// ─── Authenticated, not business-scoped ────────────────────────────────────
router.get('/mine', authMiddleware, c.listMyBusinesses);
router.post(
  '/invitations/:token/accept',
  authMiddleware,
  validateMiddleware(v.acceptInvitationSchema),
  c.acceptInvitation
);
// Creating a business requires BriteSide Plus
router.post(
  '/',
  authMiddleware,
  requireActiveSubscription,
  validateMiddleware(v.createBusinessSchema),
  c.createBusiness
);

// Public profile (single segment — declared after the static paths above)
router.get('/:idOrSlug', validateMiddleware(v.getPublicBusinessSchema), c.getPublicBusiness);
router.get('/:idOrSlug/slots', validateMiddleware(v.getSlotsSchema), c.getSlots);
router.get('/:idOrSlug/bookings/quote', validateMiddleware(v.bookingQuoteSchema), c.getBookingQuote);
// Guests may book — auth is optional
router.post(
  '/:idOrSlug/bookings/checkout',
  optionalAuthMiddleware,
  validateMiddleware(v.createBookingCheckoutSchema),
  c.createBookingCheckout
);

// ─── Business-scoped (owner / team) ─────────────────────────────────────────
const scoped = (permission, schema) => [
  authMiddleware,
  validateMiddleware(schema),
  requireBusinessPermission(permission),
];

router.get('/:businessId/manage', ...scoped(P.VIEW, v.businessIdOnlySchema), c.getManagedBusiness);
router.patch('/:businessId', ...scoped(P.PROFILE_EDIT, v.updateBusinessSchema), c.updateBusiness);
router.patch(
  '/:businessId/policies',
  ...scoped(P.POLICIES_MANAGE, v.updatePoliciesSchema),
  c.updatePolicies
);
router.put(
  '/:businessId/booking-questions',
  ...scoped(P.SERVICES_MANAGE, v.updateBookingQuestionsSchema),
  c.updateBookingQuestions
);
router.delete('/:businessId', ...scoped(P.DELETE, v.businessIdOnlySchema), c.deleteBusiness);

// Services
router.post(
  '/:businessId/services',
  ...scoped(P.SERVICES_MANAGE, v.createServiceSchema),
  c.createService
);
router.patch(
  '/:businessId/services/:serviceId',
  ...scoped(P.SERVICES_MANAGE, v.updateServiceSchema),
  c.updateService
);
router.delete(
  '/:businessId/services/:serviceId',
  ...scoped(P.SERVICES_MANAGE, v.serviceIdSchema),
  c.deleteService
);

// Staff
router.post('/:businessId/staff', ...scoped(P.STAFF_MANAGE, v.createStaffSchema), c.createStaff);
router.patch(
  '/:businessId/staff/:staffId',
  ...scoped(P.STAFF_MANAGE, v.updateStaffSchema),
  c.updateStaff
);
router.delete(
  '/:businessId/staff/:staffId',
  ...scoped(P.STAFF_MANAGE, v.staffIdSchema),
  c.deleteStaff
);
// Schedule (staff-role members: own record only — enforced in service)
router.put(
  '/:businessId/staff/:staffId/schedule',
  ...scoped(P.SCHEDULE_MANAGE, v.updateStaffScheduleSchema),
  c.updateStaffSchedule
);
router.get(
  '/:businessId/staff/:staffId/date-overrides',
  ...scoped(P.SCHEDULE_MANAGE, v.staffIdSchema),
  c.getStaffDateOverrides
);
router.put(
  '/:businessId/staff/:staffId/date-overrides',
  ...scoped(P.SCHEDULE_MANAGE, v.upsertStaffDateOverridesSchema),
  c.upsertStaffDateOverrides
);

// Bookings (staff-role members only see / act on their own — enforced in service)
router.get(
  '/:businessId/bookings',
  ...scoped(P.BOOKINGS_VIEW, v.listBusinessBookingsSchema),
  c.listBusinessBookings
);
for (const [action, handler] of [
  ['confirm', c.confirmBooking],
  ['decline', c.declineBooking],
  ['cancel', c.cancelBookingByBusiness],
  ['complete', c.completeBooking],
  ['no-show', c.markBookingNoShow],
]) {
  router.post(
    `/:businessId/bookings/:bookingId/${action}`,
    ...scoped(P.BOOKINGS_MANAGE, v.businessBookingActionSchema),
    handler
  );
}

// 5% commission on in-person payments: what's owed / collected, and paying it now
router.get(
  '/:businessId/commission',
  ...scoped(P.EARNINGS_VIEW, v.businessIdOnlySchema),
  c.getCommissionSummary
);
router.post(
  '/:businessId/commission/pay',
  ...scoped(P.WALLET_MANAGE, v.payCommissionSchema),
  c.payCommission
);
router.post(
  '/:businessId/commission/:collectionId/native-intent',
  ...scoped(P.WALLET_MANAGE, v.commissionNativeIntentSchema),
  c.commissionNativeIntent
);
router.post(
  '/:businessId/commission/:collectionId/native-finalize',
  ...scoped(P.WALLET_MANAGE, v.commissionNativeFinalizeSchema),
  c.commissionNativeFinalize
);

// Team access
router.get('/:businessId/team', ...scoped(P.TEAM_MANAGE, v.businessIdOnlySchema), c.listTeam);
router.post(
  '/:businessId/team',
  ...scoped(P.TEAM_MANAGE, v.inviteTeamMemberSchema),
  c.inviteTeamMember
);
router.delete(
  '/:businessId/team/:memberId',
  ...scoped(P.TEAM_MANAGE, v.teamMemberIdSchema),
  c.revokeTeamMember
);

export default router;
