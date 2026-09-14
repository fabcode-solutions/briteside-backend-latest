import express from 'express';
import multer from 'multer';
import httpStatus from 'http-status';
import { authMiddleware } from '../middlewares/auth.middleware.js';
import { checkBlockedUrl } from '../middlewares/checkBlockedUrl.js';
import ApiError from '../utils/api-error.js';
import { submitReviewFromCustomOffer } from '../controllers/talent.controller.js';
import {
  getShopProducts,
  getShopProduct,
  createShopProduct,
  updateShopProduct,
  deleteShopProduct,
  reorderShopProducts,
  reorderShopProductPins,
  pinShopProduct,
  unpinShopProduct,
  getShopProductAnalytics,
  getShopProductCustomers,
  setShopVisibility,
  recordShopProductView,
  uploadShopDeliverable,
  getShopSettings,
  setShopRefundPolicy,
  createShopCheckout,
  listShopPurchases,
  getShopDownload,
  getShopStats,
  getRefundEligibleOrders,
  createShopRefundRequest,
  listMyShopRefundRequests,
  listReceivedShopRefundRequests,
  respondToShopRefundRequest,
  createCustomOffer,
  listSentCustomOffers,
  listReceivedCustomOffers,
  withdrawCustomOffer,
  declineCustomOffer,
  acceptCustomOfferCheckout,
  cancelCustomOffer,
  completeCustomOffer,
  payRemainingCustomOfferCheckout,
  submitCustomOfferWork,
  getCustomOfferDeliverables,
   listOfferActivity,
  requestOfferRevision,
  listOfferRevisionRequests,
  requestOfferDateExtension,
  listOfferDateExtensionRequests,
  respondToOfferDateExtension,
  createOfferTipCheckout,
  raiseOfferDispute,
  listOfferDisputes,
  acceptCustomOfferDelivery
} from '../controllers/shop.controller.js';
import {
  getCourseContent,
  getMyCourses,
  createModule as createCourseModule,
  updateModule as updateCourseModule,
  deleteModule as deleteCourseModule,
  reorderModules as reorderCourseModules,
  createLesson as createCourseLesson,
  updateLesson as updateCourseLesson,
  deleteLesson as deleteCourseLesson,
  reorderLessons as reorderCourseLessons,
  addAttachment as addCourseLessonAttachment,
  deleteAttachment as deleteCourseLessonAttachment,
  trackProgress as trackCourseLessonProgress,
  getProgress as getCourseLessonProgress,
} from '../controllers/shopCourseContent.controller.js';

const router = express.Router();

const DANGEROUS_EXTENSIONS = ['.exe', '.bat', '.cmd', '.scr', '.vbs', '.jar', '.msi', '.dll'];

const deliverableUpload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 500 * 1024 * 1024 },
  fileFilter: (req, file, cb) => {
    const name = (file.originalname || '').toLowerCase();
    if (DANGEROUS_EXTENSIONS.some(ext => name.endsWith(ext))) {
      return cb(new Error('Executable files cannot be sold'), false);
    }
    return cb(null, true);
  },
});


const workUpload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 500 * 1024 * 1024 },
  fileFilter: deliverableUpload.fileFilter, // same executable-extension guard, reused
});
const handleMulterError = (error, req, res, next) => {
  if (error instanceof multer.MulterError) {
    if (error.code === 'LIMIT_FILE_SIZE') {
      return next(new ApiError(httpStatus.BAD_REQUEST, 'File too large. Maximum size is 500MB'));
    }
    return next(new ApiError(httpStatus.BAD_REQUEST, `Upload error: ${error.message}`));
  }
  if (error?.message === 'Executable files cannot be sold') {
    return next(new ApiError(httpStatus.BAD_REQUEST, error.message));
  }
  next(error);
};

router.use(authMiddleware);

router.post(
  '/deliverable',
  deliverableUpload.single('file'),
  handleMulterError,
  uploadShopDeliverable
);

router.put('/products/reorder', reorderShopProducts);
router.put('/products/pins/reorder', reorderShopProductPins);
router.get('/products/detail/:productId', getShopProduct);

router.put('/visibility', setShopVisibility);

router.get('/stats', getShopStats);

router.get('/settings', getShopSettings);
router.put('/refund-policy', setShopRefundPolicy);

router.get('/purchases', listShopPurchases);
router.get('/orders/:orderId/download', getShopDownload);

router.get('/refund-requests/eligible', getRefundEligibleOrders);
router.get('/refund-requests/mine', listMyShopRefundRequests);
router.get('/refund-requests/received', listReceivedShopRefundRequests);
router.post('/refund-requests', createShopRefundRequest);
router.patch('/refund-requests/:requestId/respond', respondToShopRefundRequest);

router.post(
  '/custom-offers',
  checkBlockedUrl('title', { optional: true, scanText: true }),
  checkBlockedUrl('description', { optional: true, scanText: true }),
  checkBlockedUrl('deliverables', { optional: true, scanText: true }),
  checkBlockedUrl('note', { optional: true, scanText: true }),
  createCustomOffer
);
router.get('/custom-offers/sent', listSentCustomOffers);
router.get('/custom-offers/received', listReceivedCustomOffers);
router.post('/custom-offers/:offerId/withdraw', withdrawCustomOffer);
router.post('/custom-offers/:offerId/decline', declineCustomOffer);
router.post('/custom-offers/:offerId/accept-checkout', acceptCustomOfferCheckout);
router.post('/custom-offers/:offerId/cancel', cancelCustomOffer);
router.post('/custom-offers/:offerId/complete', completeCustomOffer);
router.post('/custom-offers/:offerId/accept-delivery', acceptCustomOfferDelivery);
router.post('/custom-offers/:offerId/pay-remaining-checkout', payRemainingCustomOfferCheckout);
router.post(
  '/custom-offers/:offerId/deliverables',
  workUpload.array('files', 10),
  handleMulterError,
  submitCustomOfferWork
);
router.get('/custom-offers/:offerId/deliverables', getCustomOfferDeliverables)
router.post('/custom-offers/:offerId/review', submitReviewFromCustomOffer);

router.get('/custom-offers/:offerId/activity', listOfferActivity);

// ── NEW: revisions ───────────────────────────────────────────────────────────
router.post('/custom-offers/:offerId/revisions', requestOfferRevision);
router.get('/custom-offers/:offerId/revisions', listOfferRevisionRequests);

// ── NEW: delivery date extension ─────────────────────────────────────────────
router.post('/custom-offers/:offerId/date-extension', requestOfferDateExtension);
router.get('/custom-offers/:offerId/date-extension', listOfferDateExtensionRequests); // ← ADD
router.post(
  '/custom-offers/:offerId/date-extension/:requestId/respond',
  respondToOfferDateExtension
);

// ── NEW: tipping ──────────────────────────────────────────────────────────────
router.post('/custom-offers/:offerId/tip/checkout', createOfferTipCheckout);

// ── NEW: disputes / resolution center ────────────────────────────────────────
router.post('/custom-offers/:offerId/disputes', raiseOfferDispute);
router.get('/custom-offers/:offerId/disputes', listOfferDisputes);
router.post(
  '/products',
  checkBlockedUrl('title', { optional: true, scanText: true }),
  checkBlockedUrl('description', { optional: true, scanText: true }),
  checkBlockedUrl('redirectUrl', { optional: true }),
  checkBlockedUrl('deliveryLink', { optional: true }),
  createShopProduct
);
router.put(
  '/products/:productId',
  checkBlockedUrl('title', { optional: true, scanText: true }),
  checkBlockedUrl('description', { optional: true, scanText: true }),
  checkBlockedUrl('redirectUrl', { optional: true }),
  checkBlockedUrl('deliveryLink', { optional: true }),
  updateShopProduct
);
router.delete('/products/:productId', deleteShopProduct);
router.post('/products/:productId/view', recordShopProductView);
router.post('/products/:productId/checkout', createShopCheckout);
router.post('/products/:productId/pin', pinShopProduct);
router.delete('/products/:productId/pin', unpinShopProduct);
router.get('/products/:productId/analytics', getShopProductAnalytics);
router.get('/products/:productId/customers', getShopProductCustomers);

// ── Course content — real lessons for listingType 'course' products ────────
router.get('/courses/mine', getMyCourses);
router.get('/products/:productId/course', getCourseContent);
router.post('/products/:productId/course/modules', createCourseModule);
router.patch('/products/:productId/course/modules/:moduleId', updateCourseModule);
router.delete('/products/:productId/course/modules/:moduleId', deleteCourseModule);
router.put('/products/:productId/course/modules/reorder', reorderCourseModules);
router.post('/products/:productId/course/lessons', createCourseLesson);
router.patch('/products/:productId/course/lessons/:lessonId', updateCourseLesson);
router.delete('/products/:productId/course/lessons/:lessonId', deleteCourseLesson);
router.put('/products/:productId/course/lessons/reorder', reorderCourseLessons);
router.post(
  '/products/:productId/course/lessons/:lessonId/attachments',
  addCourseLessonAttachment
);
router.delete(
  '/products/:productId/course/lessons/:lessonId/attachments/:attachmentId',
  deleteCourseLessonAttachment
);
router.post(
  '/products/:productId/course/lessons/:lessonId/progress',
  trackCourseLessonProgress
);
router.get('/products/:productId/course/progress', getCourseLessonProgress);

router.get('/products/:username', getShopProducts);

export default router;