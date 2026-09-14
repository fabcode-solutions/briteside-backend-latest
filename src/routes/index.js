import { Router } from 'express';

import { userRoutes } from './user.route.js';
import authRoutes from './auth.route.js';
import groupRoute from './group.route.js';
import groupChatRoute from './groupChat.route.js';
import groupQuestionRoute from './groupQuestion.route.js';
import notificationsRoute from './notification.route.js';
import eventRoute from './event.route.js';
import eventScheduleRoute from './eventSchedule.route.js';
import ticketRoute from './ticket.route.js';
import venueRoute from './venue.route.js';
import categoryRoute from './category.route.js';
import organizerRoute from './organizer.route.js';
import uploadRoute from './upload.route.js';
import socialRoute from './social.route.js';
import socialChatRoute from './socialChat.route.js';
import eventChatRoute from './eventChat.route.js';
import reviewRoute from './review.route.js';
import analyticsRoute from './analytics.route.js';
import analyticsTrackRoute from './analyticsTrack.route.js';
import organizerProfileRoute from './organizerProfile.route.js';
import ticketScanningRoute from './ticketScanning.route.js';
import paymentRoute from './payment.route.js';
import orderRoute from './order.route.js';
import streamRoute from './stream.route.js';
import { authMiddleware } from '../middlewares/auth.middleware.js';
import reportRoutes from './report.route.js';
import adminRoutes from './admin.route.js';
import adminAnalyticsRoutes from './admin-analytics.route.js';
import reservationRoutes from './reservation.route.js';
import contactRoute from './contact.route.js';
import searchRoute from './search.route.js';
import talentRoute from './talent.route.js';
import priorityMessageRoute from './priorityMessage.route.js';
import liveStreamRoute from './livestream.route.js';
import subscriptionRoute from './subscription.route.js';
import doorSalesRoute from './doorSales.route.js';
import userSpendRoute from './userSpend.route.js';
import appealRoutes from './appeal.route.js';
import demoRoute from './demo.route.js';
import talentIssueRoute from './talentIssue.route.js';
import giftCodeRoute from './giftCode.route.js';
import importRoute from './import.route.js';
import shopRoute from './shop.route.js';
import impersonationRoutes from './impersonation.routes.js';
const router = Router();

// contact form (public)
router.use('/contact', contactRoute);
// universal search (public)
router.use('/search', searchRoute);
// auth routes
router.use('/auth', authRoutes);

//report routes
router.use('/reports', reportRoutes);

// admin routes
router.use('/admin', adminRoutes);
router.use('/admin/analytics', adminAnalyticsRoutes);

// appeal routes
router.use('/appeals', appealRoutes);

// username reservation routes (public)
router.use('/reservations', reservationRoutes);

// user routes
router.use('/users', authMiddleware, userRoutes);

// event routes
router.use('/events', eventRoute);

// event schedule routes
router.use('/eventSchedules', eventScheduleRoute);

// group routes
router.use('/groups', groupRoute);
router.use('/', groupChatRoute); 
router.use('/groupQuestions', groupQuestionRoute);

// ticket routes
router.use('/tickets', ticketRoute);

// venue routes
router.use('/venues', venueRoute);

// category routes
router.use('/categories', categoryRoute);

// organizer routes
router.use('/organizers', organizerRoute);

// upload routes
router.use('/upload', uploadRoute);

// social routes
router.use('/social', socialRoute);
router.use('/socialChat', socialChatRoute);

// creator shop routes
router.use('/shop', shopRoute);

router.use('/impersonation', impersonationRoutes);


// event chat routes
router.use('/', eventChatRoute);

// review routes
router.use('/reviews', reviewRoute);

// analytics routes
router.use('/analytics', analyticsTrackRoute);
router.use('/analytics', analyticsRoute);

// organizer profile routes
router.use('/organizer-profiles', organizerProfileRoute);

//notification routes
router.use('/notifications', notificationsRoute);

// payment routes
router.use('/payments', paymentRoute);
// alias singular path for compatibility
router.use('/payment', paymentRoute);

// order routes
router.use('/orders', orderRoute);

// ticket scanning routes
router.use('/ticket-scanning', ticketScanningRoute);

// door sales routes
router.use('/door-sales', doorSalesRoute);

// stream video call routes
router.use('/stream', streamRoute);

router.use('/talent', talentRoute);
router.use('/priority-messages', priorityMessageRoute);
router.use('/livestream', liveStreamRoute);

// subscription routes (BriteSide Plus)
router.use('/subscriptions', subscriptionRoute);

// user expenditure analytics
router.use('/user/expenditure', userSpendRoute);

// demo sessions (public registration)
router.use('/demo-sessions', demoRoute);

// talent issue disputes
router.use('/talent-issues', talentIssueRoute);

// gift codes
router.use('/gift-codes', giftCodeRoute);

// influencer import sessions
router.use('/imports', importRoute);

export default router;
