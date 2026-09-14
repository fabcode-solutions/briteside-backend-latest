import express from 'express';
import { authMiddleware } from '../middlewares/auth.middleware.js';
import { checkBlockedUrl } from '../middlewares/checkBlockedUrl.js';
import {
  createOrganizer,
  getOrganizers,
  getOrganizerProfile,
  updateOrganizerProfile,
  createMember,
  getOrganizerMembers,
  getMember,
  updateMember,
  updateMemberStatus,
  regenerateMemberPassword,
  deleteMember,
} from '../controllers/organizer.controller.js';
import {
  createPreset,
  listPresets,
  getPreset,
  updatePreset,
  deletePreset,
} from '../controllers/organizerPreset.controller.js';
import {
  createConnectAccount,
  getConnectStatus,
  getOnboardingLink,
  getStripeDashboardLink,
  getOrganizerEarnings,
  getEventEarnings,
  getFeeCalculator,
  getEventFeeCalculator,
  getOrganizerWallet,
  requestOrganizerCashout,
  getOrganizerPayouts,
  listPayoutMethods,
  addPayoutMethod,
  setDefaultPayoutMethod,
  deletePayoutMethod,
  getOrganizerWalletSummary,
} from '../controllers/organizerEarnings.controller.js';
import { listTransactions } from '../controllers/talentEarnings.controller.js';

const router = express.Router();

// Public routes
router.get('/', getOrganizers);

// Protected routes
router.use(authMiddleware);

router.post(
  '/',
  checkBlockedUrl('businessName', { optional: true, scanText: true }),
  checkBlockedUrl('businessDescription', { optional: true, scanText: true }),
  checkBlockedUrl('websiteUrl', { optional: true }),
  createOrganizer
);
router.get('/profile', getOrganizerProfile);
router.put(
  '/profile',
  checkBlockedUrl('businessName', { optional: true, scanText: true }),
  checkBlockedUrl('businessDescription', { optional: true, scanText: true }),
  checkBlockedUrl('websiteUrl', { optional: true }),
  checkBlockedUrl('socialLinks.instagram', { optional: true }),
  checkBlockedUrl('socialLinks.twitter', { optional: true }),
  checkBlockedUrl('socialLinks.facebook', { optional: true }),
  checkBlockedUrl('socialLinks.linkedin', { optional: true }),
  checkBlockedUrl('socialLinks.youtube', { optional: true }),
  updateOrganizerProfile
);
router.post('/presets', createPreset);
router.get('/presets', listPresets);
router.get('/presets/:presetId', getPreset);
router.put('/presets/:presetId', updatePreset);
router.delete('/presets/:presetId', deletePreset);

router.post('/members', createMember);
router.get('/members', getOrganizerMembers);
router.get('/members/:memberId', getMember);
router.put('/members/:memberId', updateMember);
router.patch('/members/:memberId/status', updateMemberStatus);
router.post('/members/:memberId/password/regenerate', regenerateMemberPassword);
router.delete('/members/:memberId', deleteMember);

// ─── STRIPE CONNECT ───────────────────────────────────────────────────────────

router.post('/stripe/connect', createConnectAccount);
router.get('/stripe/connect/status', getConnectStatus);
router.get('/stripe/connect/link', getOnboardingLink);
router.get('/stripe/connect/dashboard', getStripeDashboardLink);
router.get('/wallet/transactions', authMiddleware, listTransactions);

router.get('/earnings', getOrganizerEarnings);
router.get('/earnings/events/:eventId', getEventEarnings);
router.get('/fee-calculator', getFeeCalculator);
router.get('/fee-calculator/events/:eventId', getEventFeeCalculator);

router.get('/wallet', getOrganizerWallet);
router.get('/wallet/summary', getOrganizerWalletSummary);
router.post('/wallet/cashout', requestOrganizerCashout);
router.get('/wallet/payouts', getOrganizerPayouts);

router.get('/payout-methods', listPayoutMethods);
router.post('/payout-methods', addPayoutMethod);
router.put('/payout-methods/:methodId/default', setDefaultPayoutMethod);
router.delete('/payout-methods/:methodId', deletePayoutMethod);

export default router;