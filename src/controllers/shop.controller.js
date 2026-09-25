import { ShopProductService } from '../services/shop/shopProduct.service.js';
import { ShopDeliverableService } from '../services/shop/shopDeliverable.service.js';
import { ShopOrderService } from '../services/shop/shopOrder.service.js';
import { ShopIapService } from '../services/shop/shopIap.service.js';
import { ShopRefundService } from '../services/shop/shopRefund.service.js';
import * as userService from '../services/user.service.js';
import { catchAsync } from '../utils/catch-async.js';
import ApiError from '../utils/api-error.js';
import { ShopCustomOfferService } from '../services/shop/shopCustomOffer.service.js';


// Routes take a username so they line up with the profile URLs, and resolve it
// to an id here — the same split social.controller.js uses.
export const getShopProducts = catchAsync(async (req, res) => {
  const { username } = req.params;
  const viewerId = req.user.id;

  const user = await userService.findByUsername(username);
  if (!user) throw new ApiError(404, 'User not found');

  const result = await ShopProductService.listForUser(user.id, viewerId);
  res.json({
    success: true,
    data: {
      products: result.products,
      pinnedProducts: result.pinnedProducts,
      settings: result.settings,
      canSell: result.canSell,
      payoutsReady: result.payoutsReady,
      isOwnShop: user.id === viewerId,
      talentRating: result.talentRating,   
    },
  });
});

export const getShopProduct = catchAsync(async (req, res) => {
  const { product, settings } = await ShopProductService.getProduct(
    req.params.productId,
    req.user.id
  );

  res.json({ success: true, data: { product, settings } });
});

export const createShopProduct = catchAsync(async (req, res) => {
  const product = await ShopProductService.createProduct(req.user.id, req.body);

  res.status(201).json({ success: true, message: 'Product created', data: { product } });
});

export const updateShopProduct = catchAsync(async (req, res) => {
  const product = await ShopProductService.updateProduct(
    req.user.id,
    req.params.productId,
    req.body
  );

  res.json({ success: true, message: 'Product updated', data: { product } });
});

export const deleteShopProduct = catchAsync(async (req, res) => {
  const result = await ShopProductService.deleteProduct(req.user.id, req.params.productId);

  res.json({ success: true, message: 'Product deleted', data: result });
});

export const reorderShopProducts = catchAsync(async (req, res) => {
  const result = await ShopProductService.reorder(req.user.id, req.body.productIds);

  res.json({ success: true, message: 'Order saved', data: result });
});

export const pinShopProduct = catchAsync(async (req, res) => {
  const product = await ShopProductService.pinProduct(req.user.id, req.params.productId);

  res.json({ success: true, message: 'Product pinned', data: { product } });
});

export const unpinShopProduct = catchAsync(async (req, res) => {
  const product = await ShopProductService.unpinProduct(req.user.id, req.params.productId);

  res.json({ success: true, message: 'Product unpinned', data: { product } });
});

export const reorderShopProductPins = catchAsync(async (req, res) => {
  const result = await ShopProductService.reorderPins(req.user.id, req.body.productIds);

  res.json({ success: true, message: 'Pinned order saved', data: result });
});

export const getShopProductAnalytics = catchAsync(async (req, res) => {
  const { days, from, to } = req.query;
  const analytics = await ShopProductService.getProductAnalytics(
    req.user.id,
    req.params.productId,
    { days, from, to }
  );

  res.json({ success: true, data: analytics });
});

export const getShopProductCustomers = catchAsync(async (req, res) => {
  const result = await ShopOrderService.getProductCustomers(req.user.id, req.params.productId);

  res.json({ success: true, data: result });
});

export const setShopVisibility = catchAsync(async (req, res) => {
  const result = await ShopProductService.setVisibility(req.user.id, req.body.visible);

  res.json({
    success: true,
    message: result.shopVisible ? 'Shop is now visible' : 'Shop is now hidden',
    data: result,
  });
});

export const recordShopProductView = catchAsync(async (req, res) => {
  const result = await ShopProductService.recordView(req.params.productId, req.user.id);

  res.json({ success: true, data: result });
});

export const uploadShopDeliverable = catchAsync(async (req, res) => {
  // Checked before touching S3, so a user who can't sell can't leave orphaned
  // objects in the private bucket.
  await ShopProductService.assertCanSell(req.user.id);

  const result = await ShopDeliverableService.upload(req.user.id, req.file);

  res.status(201).json({ success: true, message: 'File uploaded', data: result });
});

// ── Shop settings (refund policy) ────────────────────────────────────────────

export const getShopSettings = catchAsync(async (req, res) => {
  const settings = await ShopProductService.getShopSettings(req.user.id);

  res.json({ success: true, data: settings });
});

export const setShopRefundPolicy = catchAsync(async (req, res) => {
  const settings = await ShopProductService.setRefundPolicy(req.user.id, req.body);

  res.json({ success: true, message: 'Refund policy saved', data: settings });
});

// ── Purchases ────────────────────────────────────────────────────────────────

export const createShopCheckout = catchAsync(async (req, res) => {
  const result = await ShopOrderService.createCheckout(
    req.user.id,
    req.params.productId,
    req.body?.platform,
    { customerName: req.body?.customerName, customerEmail: req.body?.customerEmail }
  );

  res.json({
    success: true,
    message: result.free ? 'Product added to your purchases' : 'Checkout ready',
    data: result,
  });
});

// ── In-app purchase (App-only — the web checkout above is untouched) ───────

export const getShopIapBuyOptions = catchAsync(async (req, res) => {
  const result = await ShopIapService.getBuyOptions(req.params.productId);
  res.json({ success: true, data: result });
});

export const finalizeShopIapPurchase = catchAsync(async (req, res) => {
  const { store, transactionId, purchaseToken } = req.body || {};
  const result = await ShopIapService.finalizePurchase(req.user.id, req.params.productId, store, {
    transactionId,
    purchaseToken,
  });
  res.json({ success: true, message: 'Purchase confirmed', data: result });
});

export const listShopPurchases = catchAsync(async (req, res) => {
  const { page = 1, limit = 20 } = req.query;

  const result = await ShopOrderService.listPurchases(req.user.id, parseInt(page), parseInt(limit));

  res.json({
    success: true,
    data: { orders: result.orders, total: result.total },
    pagination: { page: parseInt(page), limit: parseInt(limit), hasMore: result.hasMore },
  });
});

export const getShopDownload = catchAsync(async (req, res) => {
  const result = await ShopOrderService.getDownload(req.user.id, req.params.orderId);

  res.json({ success: true, data: result });
});

export const getShopStats = catchAsync(async (req, res) => {
  const stats = await ShopOrderService.getStats(req.user.id);

  res.json({ success: true, data: stats });
});

// ── Refund requests ──────────────────────────────────────────────────────────

export const getRefundEligibleOrders = catchAsync(async (req, res) => {
  const orders = await ShopRefundService.listEligibleOrders(req.user.id);

  res.json({ success: true, data: { orders } });
});

export const createShopRefundRequest = catchAsync(async (req, res) => {
  const request = await ShopRefundService.requestRefund(req.user.id, req.body);

  res.status(201).json({ success: true, message: 'Refund requested', data: { request } });
});

export const listMyShopRefundRequests = catchAsync(async (req, res) => {
  const requests = await ShopRefundService.listForBuyer(req.user.id);

  res.json({ success: true, data: { requests } });
});

export const listReceivedShopRefundRequests = catchAsync(async (req, res) => {
  const { status = 'all' } = req.query;

  const [requests, pendingCount] = await Promise.all([
    ShopRefundService.listForSeller(req.user.id, status),
    ShopRefundService.pendingCountForSeller(req.user.id),
  ]);

  res.json({ success: true, data: { requests, pendingCount } });
});

// ── Admin: override a seller's decision ──────────────────────────────────────

export const adminListShopRefundRequests = catchAsync(async (req, res) => {
  const { status = 'all', page = 1, limit = 20 } = req.query;

  const result = await ShopRefundService.adminList({
    status,
    page: parseInt(page),
    limit: parseInt(limit),
  });

  res.json({
    success: true,
    data: { requests: result.requests, total: result.total },
    pagination: { page: parseInt(page), limit: parseInt(limit), hasMore: result.hasMore },
  });
});

export const adminOverrideShopRefundRequest = catchAsync(async (req, res) => {
  const request = await ShopRefundService.adminOverride(req.user.id, req.params.requestId, {
    action: req.body?.action,
    resolutionNote: req.body?.resolutionNote,
  });

  res.json({
    success: true,
    message: request.status === 'approved' ? 'Refund issued' : 'Request declined',
    data: { request },
  });
});

export const respondToShopRefundRequest = catchAsync(async (req, res) => {
  const request = await ShopRefundService.respondToRequest(req.user.id, req.params.requestId, {
    action: req.body?.action,
    resolutionNote: req.body?.resolutionNote,
  });

  res.json({
    success: true,
    message: request.status === 'approved' ? 'Refund issued' : 'Request declined',
    data: { request },
  });
});
export const createCustomOffer = catchAsync(async (req, res) => {
  const { buyerId, ...data } = req.body;
  const io = req.app.get('io');
  const offer = await ShopCustomOfferService.createOffer(req.user.id, buyerId, data, io);

  res.status(201).json({ success: true, message: 'Offer sent', data: { offer } });
});

export const listSentCustomOffers = catchAsync(async (req, res) => {
  const offers = await ShopCustomOfferService.listSentBySeller(req.user.id);
  res.json({ success: true, data: { offers } });
});

export const listReceivedCustomOffers = catchAsync(async (req, res) => {
  const [offers, pendingCount] = await Promise.all([
    ShopCustomOfferService.listReceivedByBuyer(req.user.id),
    ShopCustomOfferService.pendingCountForBuyer(req.user.id),
  ]);
  res.json({ success: true, data: { offers, pendingCount } });
});

export const withdrawCustomOffer = catchAsync(async (req, res) => {
  const io = req.app.get('io');
  const offer = await ShopCustomOfferService.withdrawOffer(req.user.id, req.params.offerId, io);
  res.json({ success: true, message: 'Offer withdrawn', data: { offer } });
});
export const declineCustomOffer = catchAsync(async (req, res) => {
  const io = req.app.get('io');
  const offer = await ShopCustomOfferService.declineOffer(req.user.id, req.params.offerId, io);
  res.json({ success: true, message: 'Offer declined', data: { offer } });
}); 

/**
 * Seller accepts a buyer-initiated service-listing purchase. Distinct from
 * acceptCustomOfferCheckout: the buyer already paid at Buy time, so this is an
 * approval, not a payment.
 */
export const approveListingPurchase = catchAsync(async (req, res) => {
  const io = req.app.get('io');
  const offer = await ShopCustomOfferService.approveListingPurchase(
    req.user.id,
    req.params.offerId,
    io
  );
  res.json({ success: true, message: 'Order accepted', data: { offer } });
});

export const acceptCustomOfferCheckout = catchAsync(async (req, res) => {
  const result = await ShopCustomOfferService.createAcceptCheckout(
    req.user.id,
    req.params.offerId,
    req.body?.platform
  );
  res.json({ success: true, message: 'Checkout ready', data: result });
});

export const cancelCustomOffer = catchAsync(async (req, res) => {
  const io = req.app.get('io');
  const offer = await ShopCustomOfferService.cancelOffer(
    req.user.id,
    req.params.offerId,
    { reason: req.body?.reason },
    io
  );
  res.json({ success: true, message: 'Offer cancelled and refunded', data: { offer } });
});



export const completeCustomOffer = catchAsync(async (req, res) => {
  const io = req.app.get('io');
  const { offer, requiresBuyerPayment } = await ShopCustomOfferService.completeOffer(
    req.user.id,
    req.params.offerId,
    io
  );
  res.json({
    success: true,
    message: requiresBuyerPayment ? 'Payment request sent to customer' : 'Service marked completed',
    data: { offer, requiresBuyerPayment },
  });
});


export const payRemainingCustomOfferCheckout = catchAsync(async (req, res) => {
  const result = await ShopCustomOfferService.createRemainderCheckout(
    req.user.id,
    req.params.offerId
  );
  res.json({ success: true, message: 'Checkout ready', data: result });
});

// Funds EXACTLY one milestone of a 'milestones' offer — never a remaining
// balance. Every guard (ownership, offer status, payment mode, stage
// sequencing, seller payout readiness) is enforced in the service.
export const fundCustomOfferMilestone = catchAsync(async (req, res) => {
  const result = await ShopCustomOfferService.createMilestoneFundingCheckout(
    req.user.id,
    req.params.offerId,
    req.params.milestoneId,
    req.body?.platform
  );
  res.json({ success: true, message: 'Checkout ready', data: result });
});

// Buyer approves one delivered milestone. Starts that stage's 48h payout hold
// and, if it was the last one, completes the whole project.
export const completeCustomOfferMilestone = catchAsync(async (req, res) => {
  const io = req.app.get('io');
  const result = await ShopCustomOfferService.completeMilestone(
    req.user.id,
    req.params.offerId,
    req.params.milestoneId,
    io
  );
  res.json({
    success: true,
    message: result.projectCompleted ? 'Project completed' : 'Milestone approved',
    data: result,
  });
});

export const submitCustomOfferWork = catchAsync(async (req, res) => {
  const io = req.app.get('io');
  const deliverables = await ShopCustomOfferService.submitWork(
    req.user.id,
    req.params.offerId,
    req.files,
    req.body?.note,
    io
  );
  res.status(201).json({ success: true, message: 'Work submitted', data: { deliverables } });
});


export const getCustomOfferDeliverables = catchAsync(async (req, res) => {
  const deliverables = await ShopCustomOfferService.listDeliverables(
    req.user.id,
    req.params.offerId
  );
  res.json({ success: true, data: { deliverables } });
});

export const listOfferActivity = catchAsync(async (req, res) => {
  const activity = await ShopCustomOfferService.listActivity(req.user.id, req.params.offerId);
  res.json({ success: true, data: { activity } });
});

export const requestOfferRevision = catchAsync(async (req, res) => {
  const io = req.app.get('io');
  const request = await ShopCustomOfferService.requestRevision(
    req.user.id,
    req.params.offerId,
    { message: req.body?.message, attachments: req.body?.attachments },
    io
  );
  res.status(201).json({ success: true, message: 'Revision requested', data: { request } });
});
export const listOfferRevisionRequests = catchAsync(async (req, res) => {
  const requests = await ShopCustomOfferService.listRevisionRequests(req.user.id, req.params.offerId);
  res.json({ success: true, data: { requests } });
});

export const requestOfferDateExtension = catchAsync(async (req, res) => {
  const io = req.app.get('io');
  const request = await ShopCustomOfferService.requestDateExtension(
    req.user.id,
    req.params.offerId,
    { requestedDueDate: req.body?.requestedDueDate, reason: req.body?.reason },
    io
  );
  res.status(201).json({ success: true, message: 'Date extension requested', data: { request } });
});

export const respondToOfferDateExtension = catchAsync(async (req, res) => {
  const io = req.app.get('io');
  const request = await ShopCustomOfferService.respondToDateExtension(
    req.user.id,
    req.params.offerId,
    req.params.requestId,
    { action: req.body?.action },
    io
  );
  res.json({ success: true, message: `Request ${request.status}`, data: { request } });
});
export const createOfferTipCheckout = catchAsync(async (req, res) => {
  const result = await ShopCustomOfferService.createTipCheckout(req.user.id, req.params.offerId, {
    amountCents: req.body?.amountCents,
  });
  res.json({ success: true, message: 'Checkout ready', data: result });
});

export const raiseOfferDispute = catchAsync(async (req, res) => {
  const dispute = await ShopCustomOfferService.raiseDispute(req.user.id, req.params.offerId, {
    reason: req.body?.reason,
    message: req.body?.message,
  });
  res.status(201).json({ success: true, message: 'Issue reported', data: { dispute } });
});

export const listOfferDisputes = catchAsync(async (req, res) => {
  const disputes = await ShopCustomOfferService.listDisputes(req.user.id, req.params.offerId);
  res.json({ success: true, data: { disputes } });
});

// ── Admin ──
export const adminListOfferDisputes = catchAsync(async (req, res) => {
  const { status = 'pending', page = 1, limit = 20 } = req.query;
  const result = await ShopCustomOfferService.adminListDisputes({ status, page: parseInt(page), limit: parseInt(limit) });
  res.json({ success: true, data: result });
});

export const adminResolveOfferDispute = catchAsync(async (req, res) => {
  const dispute = await ShopCustomOfferService.adminResolveDispute(req.user.id, req.params.disputeId, {
    resolutionNote: req.body?.resolutionNote,
  });
  res.json({ success: true, message: 'Dispute resolved', data: { dispute } });
});

export const listOfferDateExtensionRequests = catchAsync(async (req, res) => {
  const requests = await ShopCustomOfferService.listDateExtensionRequests(req.user.id, req.params.offerId);
  res.json({ success: true, data: { requests } });
});

export const acceptCustomOfferDelivery = catchAsync(async (req, res) => {
  const io = req.app.get('io');
  const { offer, requiresBuyerPayment } = await ShopCustomOfferService.acceptDelivery(
    req.user.id,
    req.params.offerId,
    io
  );
  res.json({
    success: true,
    message: requiresBuyerPayment ? 'Payment request sent' : 'Order completed',
    data: { offer, requiresBuyerPayment },
  });
})