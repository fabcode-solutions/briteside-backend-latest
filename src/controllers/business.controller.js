import httpStatus from 'http-status';
import { catchAsync } from '../utils/catch-async.js';
import { BusinessService } from '../services/business.service.js';
import { BusinessBookingService } from '../services/businessBooking.service.js';
import { BusinessCommissionService } from '../services/businessCommission.service.js';

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
  const pricing = await BusinessBookingService.quote(req.params.idOrSlug, (req.validatedQuery ?? req.query).serviceId);
  res.json({ success: true, data: { pricing } });
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
export const completeBooking = bookingAction('complete');
export const markBookingNoShow = bookingAction('markNoShow');

export const payMyBookingBalance = catchAsync(async (req, res) => {
  const data = await BusinessBookingService.createBalanceCheckout(
    req.user,
    req.params.bookingId,
    req.body?.platform ?? req.get('X-Client-Platform'),
    req.body?.mode
  );
  res.status(httpStatus.CREATED).json({ success: true, data });
});
