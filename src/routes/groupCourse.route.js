import { Router } from 'express';
import { authMiddleware } from '../middlewares/auth.middleware.js';
import {
  createCourse,
  listGroupCourses,
  getCourse,
  updateCourse,
  publishCourse,
  archiveCourse,
  deleteCourse,
  addLesson,
  updateLesson,
  deleteLesson,
  reorderLessons,
  createModule,
  updateModule,
  deleteModule,
  reorderModules,
  addAttachment,
  deleteAttachment,
  enrollFree,
  createCheckout,
  trackProgress,
  getCourseProgress,
  getMyCourses,
  getOrganizerCourseAnalytics,
} from '../controllers/groupCourse.controller.js';

// mergeParams so :groupId from parent router is accessible
const router = Router({ mergeParams: true });

// My enrolled courses (current user, any group)
router.get('/my', authMiddleware, getMyCourses);

// Organiser analytics for this group's courses
router.get('/analytics', authMiddleware, getOrganizerCourseAnalytics);

// List courses in group (auth optional — enrolled flag only with auth)
router.get('/', listGroupCourses);

// Create course (organiser)
router.post('/', authMiddleware, createCourse);

// Single course
router.get('/:courseId', getCourse);
router.patch('/:courseId', authMiddleware, updateCourse);
router.delete('/:courseId', authMiddleware, deleteCourse);

// Course status
router.post('/:courseId/publish', authMiddleware, publishCourse);
router.post('/:courseId/archive', authMiddleware, archiveCourse);

// Modules (organiser)
router.post('/:courseId/modules', authMiddleware, createModule);
router.patch('/:courseId/modules/:moduleId', authMiddleware, updateModule);
router.delete('/:courseId/modules/:moduleId', authMiddleware, deleteModule);
router.put('/:courseId/modules/reorder', authMiddleware, reorderModules);

// Lessons (organiser)
router.post('/:courseId/lessons', authMiddleware, addLesson);
router.patch('/:courseId/lessons/:lessonId', authMiddleware, updateLesson);
router.delete('/:courseId/lessons/:lessonId', authMiddleware, deleteLesson);
router.put('/:courseId/lessons/reorder', authMiddleware, reorderLessons);

// Lesson attachments (organiser)
router.post('/:courseId/lessons/:lessonId/attachments', authMiddleware, addAttachment);
router.delete(
  '/:courseId/lessons/:lessonId/attachments/:attachmentId',
  authMiddleware,
  deleteAttachment
);

// Enrollment (member)
router.post('/:courseId/enroll', authMiddleware, enrollFree);
router.post('/:courseId/checkout', authMiddleware, createCheckout);

// Progress (enrolled member)
router.get('/:courseId/progress', authMiddleware, getCourseProgress);
router.post('/:courseId/lessons/:lessonId/progress', authMiddleware, trackProgress);
export default router;
