import { GroupCourseService } from '../services/groupCourse.service.js';
import { catchAsync } from '../utils/catch-async.js';
import ApiError from '../utils/api-error.js';

// ─────────────────────────────────────────
// COURSES
// ─────────────────────────────────────────

export const createCourse = catchAsync(async (req, res) => {
  const { groupId } = req.params;
  const course = await GroupCourseService.createCourse(groupId, req.user.id, req.body);
  res.status(201).json({ success: true, data: course });
});

export const listGroupCourses = catchAsync(async (req, res) => {
  const { groupId } = req.params;
  const { page, limit, status } = req.query;
  const result = await GroupCourseService.listGroupCourses(groupId, req.user?.id ?? null, {
    page: parseInt(page) || 1,
    limit: parseInt(limit) || 20,
    status,
  });
  res.json({ success: true, data: result });
});

export const getCourse = catchAsync(async (req, res) => {
  const { courseId } = req.params;
  const course = await GroupCourseService.getCourse(courseId, req.user?.id ?? null);
  res.json({ success: true, data: course });
});

export const updateCourse = catchAsync(async (req, res) => {
  const { courseId } = req.params;
  const course = await GroupCourseService.updateCourse(courseId, req.user.id, req.body);
  res.json({ success: true, data: course });
});

export const publishCourse = catchAsync(async (req, res) => {
  const { courseId } = req.params;
  const course = await GroupCourseService.publishCourse(courseId, req.user.id);
  res.json({ success: true, data: course });
});

export const archiveCourse = catchAsync(async (req, res) => {
  const { courseId } = req.params;
  const course = await GroupCourseService.archiveCourse(courseId, req.user.id);
  res.json({ success: true, data: course });
});

export const deleteCourse = catchAsync(async (req, res) => {
  const { courseId } = req.params;
  await GroupCourseService.deleteCourse(courseId, req.user.id);
  res.json({ success: true, message: 'Course deleted successfully ' });
});

// ─────────────────────────────────────────
// LESSONS
// ─────────────────────────────────────────

export const addLesson = catchAsync(async (req, res) => {
  const { courseId } = req.params;
  const lesson = await GroupCourseService.addLesson(courseId, req.user.id, req.body);
  res.status(201).json({ success: true, data: lesson });
});

export const updateLesson = catchAsync(async (req, res) => {
  const { courseId, lessonId } = req.params;
  const lesson = await GroupCourseService.updateLesson(lessonId, courseId, req.user.id, req.body);
  res.json({ success: true, data: lesson });
});

export const deleteLesson = catchAsync(async (req, res) => {
  const { courseId, lessonId } = req.params;
  await GroupCourseService.deleteLesson(lessonId, courseId, req.user.id);
  res.json({ success: true, message: 'Lesson deleted' });
});

export const reorderLessons = catchAsync(async (req, res) => {
  const { courseId } = req.params;
  const { orders } = req.body;
  if (!Array.isArray(orders)) throw new ApiError(400, 'orders must be an array');
  await GroupCourseService.reorderLessons(courseId, req.user.id, orders);
  res.json({ success: true, message: 'Lessons reordered' });
});

// ─────────────────────────────────────────
// MODULES
// ─────────────────────────────────────────

export const createModule = catchAsync(async (req, res) => {
  const { courseId } = req.params;
  const module = await GroupCourseService.createModule(courseId, req.user.id, req.body);
  res.status(201).json({ success: true, data: module });
});

export const updateModule = catchAsync(async (req, res) => {
  const { courseId, moduleId } = req.params;
  const module = await GroupCourseService.updateModule(moduleId, courseId, req.user.id, req.body);
  res.json({ success: true, data: module });
});

export const deleteModule = catchAsync(async (req, res) => {
  const { courseId, moduleId } = req.params;
  await GroupCourseService.deleteModule(moduleId, courseId, req.user.id);
  res.json({ success: true, message: 'Module deleted' });
});

export const reorderModules = catchAsync(async (req, res) => {
  const { courseId } = req.params;
  const { orders } = req.body;
  if (!Array.isArray(orders)) throw new ApiError(400, 'orders must be an array');
  await GroupCourseService.reorderModules(courseId, req.user.id, orders);
  res.json({ success: true, message: 'Modules reordered' });
});

// ─────────────────────────────────────────
// LESSON ATTACHMENTS
// ─────────────────────────────────────────

export const addAttachment = catchAsync(async (req, res) => {
  const { courseId, lessonId } = req.params;
  const attachment = await GroupCourseService.addAttachment(
    lessonId,
    courseId,
    req.user.id,
    req.body
  );
  res.status(201).json({ success: true, data: attachment });
});

export const deleteAttachment = catchAsync(async (req, res) => {
  const { courseId, lessonId, attachmentId } = req.params;
  await GroupCourseService.deleteAttachment(attachmentId, lessonId, courseId, req.user.id);
  res.json({ success: true, message: 'Attachment deleted' });
});

// ─────────────────────────────────────────
// ENROLLMENT
// ─────────────────────────────────────────

export const enrollFree = catchAsync(async (req, res) => {
  const { courseId } = req.params;
  const enrollment = await GroupCourseService.enrollFree(courseId, req.user.id);
  res.status(201).json({ success: true, data: enrollment });
});

export const createCheckout = catchAsync(async (req, res) => {
  const { courseId } = req.params;
  const { successUrl, cancelUrl } = req.body;
  if (!successUrl || !cancelUrl) throw new ApiError(400, 'successUrl and cancelUrl are required');
  const session = await GroupCourseService.createEnrollmentCheckout(
    courseId,
    req.user.id,
    successUrl,
    cancelUrl
  );
  res.json({ success: true, data: session });
});

// ─────────────────────────────────────────
// PROGRESS
// ─────────────────────────────────────────

export const trackProgress = catchAsync(async (req, res) => {
  const { lessonId } = req.params;
  const { watchedSeconds } = req.body;
  if (typeof watchedSeconds !== 'number')
    throw new ApiError(400, 'watchedSeconds must be a number');
  const progress = await GroupCourseService.trackLessonProgress(
    lessonId,
    req.user.id,
    watchedSeconds
  );
  res.json({ success: true, data: progress });
});

export const getCourseProgress = catchAsync(async (req, res) => {
  const { courseId } = req.params;
  const progress = await GroupCourseService.getCourseProgress(courseId, req.user.id);
  res.json({ success: true, data: progress });
});

export const getMyCourses = catchAsync(async (req, res) => {
  const courses = await GroupCourseService.getMyCourses(req.user.id);
  res.json({ success: true, data: courses });
});

// ─────────────────────────────────────────
// ORGANISER ANALYTICS
// ─────────────────────────────────────────

export const getOrganizerCourseAnalytics = catchAsync(async (req, res) => {
  const { groupId } = req.params;
  const analytics = await GroupCourseService.getOrganizerCourseAnalytics(groupId, req.user.id);
  res.json({ success: true, data: analytics });
});
