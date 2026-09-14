import { ShopCourseContentService } from '../services/shop/shopCourseContent.service.js';
import { catchAsync } from '../utils/catch-async.js';

// ── Viewing ──────────────────────────────────────────────────────────────────

export const getCourseContent = catchAsync(async (req, res) => {
  const result = await ShopCourseContentService.getCourseContent(
    req.user?.id ?? null,
    req.params.productId
  );
  res.json({ success: true, data: result });
});

export const getMyCourses = catchAsync(async (req, res) => {
  const products = await ShopCourseContentService.getMyCourses(req.user.id);
  res.json({ success: true, data: { products } });
});

// ── Modules ──────────────────────────────────────────────────────────────────

export const createModule = catchAsync(async (req, res) => {
  const module_ = await ShopCourseContentService.createModule(
    req.user.id,
    req.params.productId,
    req.body
  );
  res.status(201).json({ success: true, data: { module: module_ } });
});

export const updateModule = catchAsync(async (req, res) => {
  const module_ = await ShopCourseContentService.updateModule(
    req.user.id,
    req.params.productId,
    req.params.moduleId,
    req.body
  );
  res.json({ success: true, data: { module: module_ } });
});

export const deleteModule = catchAsync(async (req, res) => {
  await ShopCourseContentService.deleteModule(
    req.user.id,
    req.params.productId,
    req.params.moduleId
  );
  res.json({ success: true });
});

export const reorderModules = catchAsync(async (req, res) => {
  await ShopCourseContentService.reorderModules(
    req.user.id,
    req.params.productId,
    req.body.orders
  );
  res.json({ success: true });
});

// ── Lessons ──────────────────────────────────────────────────────────────────

export const createLesson = catchAsync(async (req, res) => {
  const { moduleId, ...rest } = req.body;
  const lesson = await ShopCourseContentService.createLesson(
    req.user.id,
    req.params.productId,
    moduleId,
    rest
  );
  res.status(201).json({ success: true, data: { lesson } });
});

export const updateLesson = catchAsync(async (req, res) => {
  const lesson = await ShopCourseContentService.updateLesson(
    req.user.id,
    req.params.productId,
    req.params.lessonId,
    req.body
  );
  res.json({ success: true, data: { lesson } });
});

export const deleteLesson = catchAsync(async (req, res) => {
  await ShopCourseContentService.deleteLesson(
    req.user.id,
    req.params.productId,
    req.params.lessonId
  );
  res.json({ success: true });
});

export const reorderLessons = catchAsync(async (req, res) => {
  await ShopCourseContentService.reorderLessons(
    req.user.id,
    req.params.productId,
    req.body.orders
  );
  res.json({ success: true });
});

// ── Attachments ──────────────────────────────────────────────────────────────

export const addAttachment = catchAsync(async (req, res) => {
  const attachment = await ShopCourseContentService.addAttachment(
    req.user.id,
    req.params.productId,
    req.params.lessonId,
    req.body
  );
  res.status(201).json({ success: true, data: { attachment } });
});

export const deleteAttachment = catchAsync(async (req, res) => {
  await ShopCourseContentService.deleteAttachment(
    req.user.id,
    req.params.productId,
    req.params.lessonId,
    req.params.attachmentId
  );
  res.json({ success: true });
});

// ── Progress ─────────────────────────────────────────────────────────────────

export const trackProgress = catchAsync(async (req, res) => {
  const progress = await ShopCourseContentService.trackProgress(
    req.user.id,
    req.params.productId,
    req.params.lessonId,
    req.body.watchedSeconds
  );
  res.json({ success: true, data: { progress } });
});

export const getProgress = catchAsync(async (req, res) => {
  const progress = await ShopCourseContentService.getProgress(req.user.id, req.params.productId);
  res.json({ success: true, data: progress });
});
