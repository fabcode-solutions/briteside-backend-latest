import httpStatus from 'http-status';
import { catchAsync } from '../utils/catch-async.js';
import { BusinessService } from '../services/business.service.js';
import { BusinessBookingService } from '../services/businessBooking.service.js';
import { BusinessGroupSessionService } from '../services/businessGroupSession.service.js';
import { BusinessGalleryService } from '../services/businessGallery.service.js';
import { BusinessCommissionService } from '../services/businessCommission.service.js';
import { BusinessReviewService } from '../services/businessReview.service.js';
import { BusinessEarningsService } from '../services/businessEarnings.service.js';
import { BusinessWallService } from '../services/businessWall.service.js';
import { BusinessInquiryService } from '../services/businessInquiry.service.js';
import { BusinessLocationService } from '../services/businessLocation.service.js';
import { BusinessCustomOfferService } from '../services/businessCustomOffer.service.js';

// ─── Public ─────────────────────────────────────────────────────────────────
export const getCategories = catchAsync(async (req, res) => {
  res.json({ success: true, data: { categories: BusinessService.getCategories() } });
});

export const listBusinesses = catchAsync(async (req, res) => {
  const data = await BusinessService.listPublic(req.validatedQuery ?? req.query);
  res.json({ success: true, data });
});

export const getPublicBusiness = catchAsync(async (req, res) => {
  const business = await BusinessService.getPublic(req.params.idOrSlug);
  res.json({ success: true, data: { business } });
});

export const quoteFees = catchAsync(async (req, res) => {
  const priceCents = Math.max(0, parseInt(req.query.priceCents, 10) || 0);
  res.json({ success: true, data: BusinessService.quoteFees(priceCents) });
});

// ─── Owner / team: business ─────────────────────────────────────────────────
export const listMyBusinesses = catchAsync(async (req, res) => {
  const businesses = await BusinessService.listMine(req.user.id);
  res.json({ success: true, data: { businesses } });
});

export const createBusiness = catchAsync(async (req, res) => {
  const business = await BusinessService.create(req.user, req.body);
  res.status(httpStatus.CREATED).json({ success: true, data: { business } });
});

export const getManagedBusiness = catchAsync(async (req, res) => {
  const business = await BusinessService.getForManage(req.business);
  res.json({ success: true, data: { business, access: req.businessAccess } });
});

export const updateBusiness = catchAsync(async (req, res) => {
  const business = await BusinessService.update(req.business, req.body);
  res.json({ success: true, data: { business } });
});

export const updatePolicies = catchAsync(async (req, res) => {
  const business = await BusinessService.update(req.business, req.body);
  res.json({ success: true, data: { business } });
});

export const saveAddOns = catchAsync(async (req, res) => {
  const addOns = await BusinessService.saveAddOns(req.business, req.body.addOns);
  res.json({ success: true, data: { addOns } });
});

export const saveQuestionnaires = catchAsync(async (req, res) => {
  const data = await BusinessService.saveQuestionnaires(req.business, req.body.questionnaires);
  res.json({ success: true, data });
});

export const uploadBookingAttachment = catchAsync(async (req, res) => {
  const attachment = await BusinessBookingService.uploadAttachment(req.params.idOrSlug, req.user, req.file);
  res.status(201).json({ success: true, data: { attachment } });
});

export const getBookingAttachmentForBusiness = catchAsync(async (req, res) => {
  const data = await BusinessBookingService.attachmentUrlForBusiness(
    req.business,
    req.params.bookingId,
    req.businessAccess,
    Number(req.params.index)
  );
  res.json({ success: true, data });
});

export const getMyBookingAttachment = catchAsync(async (req, res) => {
  const data = await BusinessBookingService.attachmentUrlForCustomer(
    req.user,
    req.params.bookingId,
    Number(req.params.index)
  );
  res.json({ success: true, data });
});

export const updateBookingQuestions = catchAsync(async (req, res) => {
  const questions = await BusinessService.updateBookingQuestions(req.business, req.body.questions);
  res.json({ success: true, data: { questions } });
});

export const deleteBusiness = catchAsync(async (req, res) => {
  await BusinessService.remove(req.business);
  res.json({ success: true, message: 'Business deleted' });
});

// ─── Services ───────────────────────────────────────────────────────────────
export const createService = catchAsync(async (req, res) => {
  const service = await BusinessService.createService(req.business, req.body);
  res.status(httpStatus.CREATED).json({ success: true, data: { service } });
});

export const updateService = catchAsync(async (req, res) => {
  const service = await BusinessService.updateService(
    req.business,
    req.params.serviceId,
    req.body
  );
  res.json({ success: true, data: { service } });
});

export const deleteService = catchAsync(async (req, res) => {
  await BusinessService.deleteService(req.business, req.params.serviceId);
  res.json({ success: true, message: 'Service deleted' });
});

// ─── Staff ──────────────────────────────────────────────────────────────────
// Locations (branches)
export const createLocation = catchAsync(async (req, res) => {
  const location = await BusinessLocationService.create(req.business, req.body);
  res.status(httpStatus.CREATED).json({ success: true, data: { location } });
});

export const updateLocation = catchAsync(async (req, res) => {
  const location = await BusinessLocationService.update(req.business, req.params.locationId, req.body);
  res.json({ success: true, data: { location } });
});

export const makePrimaryLocation = catchAsync(async (req, res) => {
  const location = await BusinessLocationService.makePrimary(req.business, req.params.locationId);
  res.json({ success: true, data: { location } });
});

export const deleteLocation = catchAsync(async (req, res) => {
  await BusinessLocationService.remove(req.business, req.params.locationId);
  res.json({ success: true });
});

export const createStaff = catchAsync(async (req, res) => {
  const staff = await BusinessService.createStaff(req.business, req.body);
  res.status(httpStatus.CREATED).json({ success: true, data: { staff } });
});

export const updateStaff = catchAsync(async (req, res) => {
  const staff = await BusinessService.updateStaff(
    req.business,
    req.params.staffId,
    req.body,
    req.businessAccess
  );
  res.json({ success: true, data: { staff } });
});

export const deleteStaff = catchAsync(async (req, res) => {
  const result = await BusinessService.deleteStaff(req.business, req.params.staffId);
  res.json({ success: true, data: result, message: 'Staff member removed' });
});

export const updateStaffSchedule = catchAsync(async (req, res) => {
  const staff = await BusinessService.updateStaffSchedule(
    req.business,
    req.params.staffId,
    req.body,
    req.businessAccess
  );
  res.json({ success: true, data: { staff } });
});

export const getStaffDateOverrides = catchAsync(async (req, res) => {
  const overrides = await BusinessService.getStaffDateOverrides(
    req.business,
    req.params.staffId,
    req.businessAccess
  );
  res.json({ success: true, data: { overrides } });
});

export const upsertStaffDateOverrides = catchAsync(async (req, res) => {
  const overrides = await BusinessService.upsertStaffDateOverrides(
    req.business,
    req.params.staffId,
    req.body.overrides,
    req.businessAccess
  );
  res.json({ success: true, data: { overrides } });
});

// ─── Team ───────────────────────────────────────────────────────────────────
export const listTeam = catchAsync(async (req, res) => {
  const members = await BusinessService.listTeam(req.business);
  res.json({ success: true, data: { members } });
});

export const inviteTeamMember = catchAsync(async (req, res) => {
  const member = await BusinessService.invite(req.business, req.user, req.body);
  res.status(httpStatus.CREATED).json({ success: true, data: { member } });
});

export const updateTeamMember = catchAsync(async (req, res) => {
  const member = await BusinessService.updateMemberRole(
    req.business,
    req.user,
    req.params.memberId,
    req.body.role,
    req.body.locationIds
  );
  res.json({ success: true, data: { member } });
});

export const updateStaffLocationSchedules = catchAsync(async (req, res) => {
  const staff = await BusinessService.updateStaffLocationSchedules(
    req.business,
    req.params.staffId,
    req.body.schedules,
    req.businessAccess
  );
  res.json({ success: true, data: { staff } });
});

export const addLocationClosure = catchAsync(async (req, res) => {
  const data = await BusinessLocationService.addClosure(
    req.business,
    req.params.locationId,
    req.body,
    req.businessAccess
  );
  res.status(httpStatus.CREATED).json({ success: true, data });
});

export const removeLocationClosure = catchAsync(async (req, res) => {
  await BusinessLocationService.removeClosure(
    req.business,
    req.params.locationId,
    req.params.closureId,
    req.businessAccess
  );
  res.json({ success: true });
});

export const revokeTeamMember = catchAsync(async (req, res) => {
  await BusinessService.revokeMember(req.business, req.params.memberId);
  res.json({ success: true, message: 'Access removed' });
});

export const acceptInvitation = catchAsync(async (req, res) => {
  const result = await BusinessService.acceptInvitation(req.user, req.params.token);
  res.json({ success: true, data: result });
});

// ─── Bookings ───────────────────────────────────────────────────────────────

export const getSlots = catchAsync(async (req, res) => {
  const data = await BusinessBookingService.getSlots(req.params.idOrSlug, req.validatedQuery ?? req.query);
  res.json({ success: true, data });
});

export const getBookingQuote = catchAsync(async (req, res) => {
  const query = req.validatedQuery ?? req.query;
  const pricing = await BusinessBookingService.quote(
    req.params.idOrSlug,
    query.serviceId,
    query.addOnIds,
    query.partySize ?? 1,
    query.locationId
  );
  res.json({ success: true, data: { pricing } });
});

// Gallery posts: likes / comments
export const getGalleryEngagement = catchAsync(async (req, res) => {
  const data = await BusinessGalleryService.engagement(req.params.idOrSlug, req.user ?? null);
  res.json({ success: true, data });
});

export const likeGalleryPost = catchAsync(async (req, res) => {
  const data = await BusinessGalleryService.like(req.user, req.params.idOrSlug, req.params.postKey);
  res.json({ success: true, data });
});

export const unlikeGalleryPost = catchAsync(async (req, res) => {
  const data = await BusinessGalleryService.unlike(req.user, req.params.idOrSlug, req.params.postKey);
  res.json({ success: true, data });
});

export const listGalleryComments = catchAsync(async (req, res) => {
  const data = await BusinessGalleryService.listComments(
    req.params.idOrSlug,
    req.params.postKey,
    req.user ?? null,
    req.validatedQuery ?? req.query
  );
  res.json({ success: true, data });
});

export const listGalleryReplies = catchAsync(async (req, res) => {
  const data = await BusinessGalleryService.listReplies(
    req.params.idOrSlug,
    req.params.postKey,
    req.params.commentId,
    req.user ?? null,
    req.validatedQuery ?? req.query
  );
  res.json({ success: true, data });
});

export const createGalleryComment = catchAsync(async (req, res) => {
  const comment = await BusinessGalleryService.createComment(
    req.user,
    req.params.idOrSlug,
    req.params.postKey,
    req.body
  );
  res.status(201).json({ success: true, data: { comment } });
});

export const updateGalleryComment = catchAsync(async (req, res) => {
  const comment = await BusinessGalleryService.updateComment(
    req.user,
    req.params.idOrSlug,
    req.params.postKey,
    req.params.commentId,
    req.body
  );
  res.json({ success: true, data: { comment } });
});

export const deleteGalleryComment = catchAsync(async (req, res) => {
  const data = await BusinessGalleryService.removeComment(
    req.user,
    req.params.idOrSlug,
    req.params.postKey,
    req.params.commentId
  );
  res.json({ success: true, data });
});

export const likeGalleryComment = catchAsync(async (req, res) => {
  const data = await BusinessGalleryService.likeComment(
    req.user,
    req.params.idOrSlug,
    req.params.postKey,
    req.params.commentId
  );
  res.json({ success: true, data });
});

export const unlikeGalleryComment = catchAsync(async (req, res) => {
  const data = await BusinessGalleryService.unlikeComment(
    req.user,
    req.params.idOrSlug,
    req.params.postKey,
    req.params.commentId
  );
  res.json({ success: true, data });
});

export const listPublicGroupSessions = catchAsync(async (req, res) => {
  const query = req.validatedQuery ?? req.query;
  const data = await BusinessBookingService.listPublicGroupSessions(
    req.params.idOrSlug,
    query.serviceId,
    query.locationId
  );
  res.json({ success: true, data });
});

// Group sessions (dashboard)
export const listGroupSessions = catchAsync(async (req, res) => {
  const data = await BusinessGroupSessionService.list(
    req.business,
    req.businessAccess,
    req.validatedQuery ?? req.query
  );
  res.json({ success: true, data });
});

export const createGroupSessions = catchAsync(async (req, res) => {
  const data = await BusinessGroupSessionService.create(req.business, req.businessAccess, req.body);
  res.status(201).json({ success: true, data });
});

export const updateGroupSession = catchAsync(async (req, res) => {
  const data = await BusinessGroupSessionService.update(
    req.business,
    req.businessAccess,
    req.params.sessionId,
    req.body
  );
  res.json({ success: true, data });
});

export const cancelGroupSession = catchAsync(async (req, res) => {
  const data = await BusinessGroupSessionService.cancel(
    req.business,
    req.businessAccess,
    req.params.sessionId,
    req.body ?? {}
  );
  res.json({ success: true, data });
});

export const createBookingCheckout = catchAsync(async (req, res) => {
  const data = await BusinessBookingService.createCheckout(req.params.idOrSlug, req.user ?? null, {
    ...req.body,
    platform: req.body.platform ?? req.get('X-Client-Platform'),
  });
  res.status(httpStatus.CREATED).json({ success: true, data });
});

export const getBookingByCheckoutSession = catchAsync(async (req, res) => {
  const data = await BusinessBookingService.getByCheckoutSession(req.params.checkoutSessionId);
  res.json({ success: true, data });
});

export const listMyBookings = catchAsync(async (req, res) => {
  const bookings = await BusinessBookingService.listForCustomer(req.user.id, req.validatedQuery ?? req.query);
  res.json({ success: true, data: { bookings } });
});

export const cancelMyBooking = catchAsync(async (req, res) => {
  const data = await BusinessBookingService.cancelByCustomer(req.user, req.params.bookingId, req.body?.reason);
  res.json({ success: true, data });
});

export const getCommissionSummary = catchAsync(async (req, res) => {
  const data = await BusinessCommissionService.summaryForBusiness(req.business);
  res.json({ success: true, data });
});

export const payCommission = catchAsync(async (req, res) => {
  const data = await BusinessCommissionService.createPayNowCheckout(req.business, req.user, req.body?.platform, req.body?.mode);
  res.json({ success: true, data });
});

export const commissionNativeIntent = catchAsync(async (req, res) => {
  const data = await BusinessCommissionService.createNativeIntent(req.business, req.params.collectionId, req.user);
  res.json({ success: true, data });
});

export const commissionNativeFinalize = catchAsync(async (req, res) => {
  const data = await BusinessCommissionService.finalizeNative(req.business, req.params.collectionId, req.body.paymentIntentId);
  res.json({ success: true, data });
});

// ─── In-app card checkout (NativeCheckoutModal): booking + remaining balance ─
export const bookingNativeTaxPreview = catchAsync(async (req, res) => {
  const data = await BusinessBookingService.previewNativeTax(req.params.bookingId, req.user ?? null, req.body);
  res.json({ success: true, data });
});

export const bookingNativeIntent = catchAsync(async (req, res) => {
  const data = await BusinessBookingService.createNativePaymentIntent(req.params.bookingId, req.user ?? null, req.body);
  res.json({ success: true, data });
});

export const bookingNativeFinalize = catchAsync(async (req, res) => {
  const data = await BusinessBookingService.finalizeNativePayment(req.params.bookingId, req.user ?? null, req.body.paymentIntentId);
  res.json({ success: true, data });
});

export const balanceNativeTaxPreview = catchAsync(async (req, res) => {
  const data = await BusinessBookingService.previewBalanceNativeTax(req.params.bookingId, req.user, req.body);
  res.json({ success: true, data });
});

export const balanceNativeIntent = catchAsync(async (req, res) => {
  const data = await BusinessBookingService.createBalanceNativeIntent(req.params.bookingId, req.user, req.body);
  res.json({ success: true, data });
});

export const balanceNativeFinalize = catchAsync(async (req, res) => {
  const data = await BusinessBookingService.finalizeBalanceNativePayment(req.params.bookingId, req.user, req.body.paymentIntentId);
  res.json({ success: true, data });
});

export const listManagedBookings = catchAsync(async (req, res) => {
  const data = await BusinessBookingService.listManaged(req.user, req.validatedQuery ?? req.query);
  res.json({ success: true, data });
});

export const listBusinessBookings = catchAsync(async (req, res) => {
  const data = await BusinessBookingService.listForBusiness(req.business, req.businessAccess, req.validatedQuery ?? req.query);
  res.json({ success: true, data });
});

const bookingAction = method =>
  catchAsync(async (req, res) => {
    const data = await BusinessBookingService[method](
      req.business,
      req.params.bookingId,
      req.businessAccess,
      req.body?.reason
    );
    res.json({ success: true, data: data?.booking ? data : { booking: data } });
  });

export const confirmBooking = bookingAction('confirm');
export const declineBooking = bookingAction('decline');
export const cancelBookingByBusiness = bookingAction('cancelByBusiness');
export const completeBooking = catchAsync(async (req, res) => {
  const booking = await BusinessBookingService.complete(
    req.business,
    req.params.bookingId,
    req.businessAccess,
    req.body ?? {}
  );
  res.json({ success: true, data: { booking } });
});

export const checkInBooking = catchAsync(async (req, res) => {
  const data = await BusinessBookingService.checkIn(
    req.business,
    req.params.bookingId,
    req.businessAccess,
    req.body ?? {}
  );
  res.json({ success: true, data });
});

export const createManualBooking = catchAsync(async (req, res) => {
  const data = await BusinessBookingService.createManual(req.business, req.businessAccess, req.body);
  res.status(httpStatus.CREATED).json({ success: true, data });
});
export const markBookingNoShow = bookingAction('markNoShow');

export const refundBookingByBusiness = catchAsync(async (req, res) => {
  const data = await BusinessBookingService.refundByBusiness(
    req.business,
    req.params.bookingId,
    req.businessAccess,
    req.body ?? {}
  );
  res.json({ success: true, data });
});

export const getBusinessRescheduleSlots = catchAsync(async (req, res) => {
  const data = await BusinessBookingService.rescheduleSlotsForBusiness(
    req.business,
    req.params.bookingId,
    req.businessAccess,
    req.validatedQuery ?? req.query
  );
  res.json({ success: true, data });
});

export const rescheduleBookingByBusiness = catchAsync(async (req, res) => {
  const data = await BusinessBookingService.rescheduleByBusiness(
    req.business,
    req.params.bookingId,
    req.businessAccess,
    req.body
  );
  res.json({ success: true, data });
});

export const getMyRescheduleSlots = catchAsync(async (req, res) => {
  const data = await BusinessBookingService.rescheduleSlotsForCustomer(
    req.user,
    req.params.bookingId,
    req.validatedQuery ?? req.query
  );
  res.json({ success: true, data });
});

export const rescheduleMyBooking = catchAsync(async (req, res) => {
  const data = await BusinessBookingService.rescheduleByCustomer(req.user, req.params.bookingId, req.body);
  res.json({ success: true, data });
});

// ─── Reviews ────────────────────────────────────────────────────────────────
export const listPublicReviews = catchAsync(async (req, res) => {
  const data = await BusinessReviewService.listPublic(req.params.idOrSlug, req.validatedQuery ?? req.query);
  res.json({ success: true, data });
});

export const listBusinessReviews = catchAsync(async (req, res) => {
  const data = await BusinessReviewService.listForBusiness(
    req.business,
    req.validatedQuery ?? req.query,
    req.businessAccess
  );
  res.json({ success: true, data });
});

export const replyToReview = catchAsync(async (req, res) => {
  const review = await BusinessReviewService.reply(req.business, req.params.reviewId, req.body.reply);
  res.json({ success: true, data: { review } });
});

export const createReview = catchAsync(async (req, res) => {
  const review = await BusinessReviewService.create(req.user, req.params.bookingId, req.body);
  res.status(httpStatus.CREATED).json({ success: true, data: { review } });
});

export const updateReview = catchAsync(async (req, res) => {
  const review = await BusinessReviewService.update(req.user, req.params.bookingId, req.body);
  res.json({ success: true, data: { review } });
});

// ─── Wall (standard business pages) ─────────────────────────────────────────
export const listWallPosts = catchAsync(async (req, res) => {
  const data = await BusinessWallService.list(
    req.params.idOrSlug,
    req.user ?? null,
    req.validatedQuery ?? req.query
  );
  res.json({ success: true, data });
});

export const openInquiryConversation = catchAsync(async (req, res) => {
  const data = await BusinessInquiryService.openConversation(req.user, req.params.idOrSlug);
  res.json({ success: true, data });
});

// ─── Custom price offers ────────────────────────────────────────────────────
export const createCustomOffer = catchAsync(async (req, res) => {
  const offer = await BusinessCustomOfferService.create(req.business, req.user, req.body);
  res.status(httpStatus.CREATED).json({ success: true, data: { offer } });
});

export const listCustomOffers = catchAsync(async (req, res) => {
  const data = await BusinessCustomOfferService.listForBusiness(req.business, req.validatedQuery ?? req.query);
  res.json({ success: true, data });
});

export const withdrawCustomOffer = catchAsync(async (req, res) => {
  const offer = await BusinessCustomOfferService.withdraw(req.business, req.params.offerId);
  res.json({ success: true, data: { offer } });
});

export const getCustomOffer = catchAsync(async (req, res) => {
  const offer = await BusinessCustomOfferService.getForUser(req.user, req.params.offerId);
  res.json({ success: true, data: { offer } });
});

export const declineCustomOffer = catchAsync(async (req, res) => {
  const offer = await BusinessCustomOfferService.decline(req.user, req.params.offerId);
  res.json({ success: true, data: { offer } });
});

export const createWallPost = catchAsync(async (req, res) => {
  const post = await BusinessWallService.create(req.user, req.params.idOrSlug, req.body.text);
  res.status(httpStatus.CREATED).json({ success: true, data: { post } });
});

export const moderateWallPost = catchAsync(async (req, res) => {
  const post = await BusinessWallService.moderate(
    req.user,
    req.params.idOrSlug,
    req.params.postId,
    req.body.status
  );
  res.json({ success: true, data: { post } });
});

export const deleteWallPost = catchAsync(async (req, res) => {
  await BusinessWallService.remove(req.user, req.params.idOrSlug, req.params.postId);
  res.json({ success: true });
});

export const likeWallPost = catchAsync(async (req, res) => {
  const data = await BusinessWallService.like(req.user, req.params.idOrSlug, req.params.postId);
  res.json({ success: true, data });
});

export const unlikeWallPost = catchAsync(async (req, res) => {
  const data = await BusinessWallService.unlike(req.user, req.params.idOrSlug, req.params.postId);
  res.json({ success: true, data });
});

export const listWallComments = catchAsync(async (req, res) => {
  const data = await BusinessWallService.listComments(
    req.params.idOrSlug,
    req.params.postId,
    req.user ?? null,
    req.validatedQuery ?? req.query
  );
  res.json({ success: true, data });
});

export const createWallComment = catchAsync(async (req, res) => {
  const comment = await BusinessWallService.createComment(
    req.user,
    req.params.idOrSlug,
    req.params.postId,
    req.body
  );
  res.status(httpStatus.CREATED).json({ success: true, data: { comment } });
});

export const listWallReplies = catchAsync(async (req, res) => {
  const data = await BusinessWallService.listReplies(
    req.params.idOrSlug,
    req.params.postId,
    req.params.commentId,
    req.user ?? null,
    req.validatedQuery ?? req.query
  );
  res.json({ success: true, data });
});

export const updateWallComment = catchAsync(async (req, res) => {
  const comment = await BusinessWallService.updateComment(
    req.user,
    req.params.idOrSlug,
    req.params.postId,
    req.params.commentId,
    req.body
  );
  res.json({ success: true, data: { comment } });
});

export const deleteWallComment = catchAsync(async (req, res) => {
  const data = await BusinessWallService.removeComment(
    req.user,
    req.params.idOrSlug,
    req.params.postId,
    req.params.commentId
  );
  res.json({ success: true, data });
});

export const likeWallComment = catchAsync(async (req, res) => {
  const { idOrSlug, postId, commentId } = req.params;
  const data = await BusinessWallService.likeComment(req.user, idOrSlug, postId, commentId);
  res.json({ success: true, data });
});

export const unlikeWallComment = catchAsync(async (req, res) => {
  const { idOrSlug, postId, commentId } = req.params;
  const data = await BusinessWallService.unlikeComment(req.user, idOrSlug, postId, commentId);
  res.json({ success: true, data });
});

// ─── Earnings & wallet ──────────────────────────────────────────────────────
export const getEarnings = catchAsync(async (req, res) => {
  const data = await BusinessEarningsService.summary(
    req.business,
    req.validatedQuery ?? req.query,
    req.businessAccess
  );
  res.json({ success: true, data });
});

export const getPayoutHistory = catchAsync(async (req, res) => {
  const data = await BusinessEarningsService.payoutHistory(req.business, req.validatedQuery ?? req.query);
  res.json({ success: true, data });
});

export const getWallet = catchAsync(async (req, res) => {
  const data = await BusinessEarningsService.wallet(req.business, req.businessAccess);
  res.json({ success: true, data });
});

export const cashOut = catchAsync(async (req, res) => {
  const data = await BusinessEarningsService.cashOut(req.business, req.businessAccess, req.body.amountCents);
  res.status(httpStatus.CREATED).json({ success: true, data });
});

export const getStripeDashboardLink = catchAsync(async (req, res) => {
  const data = await BusinessEarningsService.stripeDashboardLink(req.business, req.businessAccess);
  res.json({ success: true, data });
});

export const getStripeOnboardingLink = catchAsync(async (req, res) => {
  const data = await BusinessEarningsService.stripeOnboardingLink(req.business, req.businessAccess);
  res.json({ success: true, data });
});

export const payMyBookingBalance = catchAsync(async (req, res) => {
  const data = await BusinessBookingService.createBalanceCheckout(
    req.user,
    req.params.bookingId,
    req.body?.platform ?? req.get('X-Client-Platform'),
    req.body?.mode
  );
  res.status(httpStatus.CREATED).json({ success: true, data });
});
