/**
 * Real lesson content for a shop course listing (listingType: 'course').
 *
 * Deliberately separate from GroupCourseService — that system stays
 * group-scoped only (group_courses/group_course_enrollments). This one has no
 * enrollment table at all: "enrolled" just means "owns the product or has a
 * paid shop_orders row for it" (see hasAccessToCourse), reusing checkout/order
 * infra that already exists instead of duplicating a parallel payment system.
 */
import { db } from '../../db/index.js';
import {
  shopProducts,
  shopCourseModules,
  shopCourseLessons,
  shopCourseLessonAttachments,
  shopCourseLessonProgress,
  shopOrders,
} from '../../db/schema/index.js';
import { eq, and, asc, desc, isNull, inArray } from 'drizzle-orm';
import ApiError from '../../utils/api-error.js';
import { ShopProductService } from './shopProduct.service.js';

const MAX_MODULES = 20;
const MAX_LESSONS_PER_MODULE = 100;

export class ShopCourseContentService {
  /** Course-listing-specific ownership check — reuses ShopProductService's
   *  base ownership assertion, then confirms it's actually a course. */
  static async assertCourseOwnership(userId, productId) {
    const product = await ShopProductService.assertOwnership(userId, productId);
    if (product.listingType !== 'course') {
      throw new ApiError(400, 'This product is not a course');
    }
    return product;
  }

  /** Owner always has access. Otherwise a paid (non-refunded) order is required. */
  static async hasAccessToCourse(userId, product) {
    if (!userId) return false;
    if (product.userId === userId) return true;
    const order = await db.query.shopOrders.findFirst({
      where: and(
        eq(shopOrders.productId, product.id),
        eq(shopOrders.buyerId, userId),
        eq(shopOrders.status, 'paid')
      ),
      columns: { id: true },
    });
    return !!order;
  }

  /** Keeps the existing display-only lessonsCount in sync with real lesson rows. */
  static async _refreshModuleLessonCount(tx, moduleId) {
    const lessons = await tx.query.shopCourseLessons.findMany({
      where: eq(shopCourseLessons.moduleId, moduleId),
      columns: { id: true },
    });
    await tx
      .update(shopCourseModules)
      .set({ lessonsCount: Math.max(lessons.length, 1), updatedAt: new Date() })
      .where(eq(shopCourseModules.id, moduleId));
  }

  // ── Modules ──────────────────────────────────────────────────────────────

  static async createModule(userId, productId, { title }) {
    await this.assertCourseOwnership(userId, productId);
    if (!title?.trim()) throw new ApiError(400, 'Module title is required');

    const existing = await db.query.shopCourseModules.findMany({
      where: eq(shopCourseModules.productId, productId),
      columns: { id: true },
    });
    if (existing.length >= MAX_MODULES) {
      throw new ApiError(400, `A course can have at most ${MAX_MODULES} modules`);
    }

    const [module_] = await db
      .insert(shopCourseModules)
      .values({
        productId,
        title: title.trim(),
        lessonsCount: 0,
        sortOrder: existing.length,
      })
      .returning();
    return module_;
  }

  static async updateModule(userId, productId, moduleId, { title }) {
    await this.assertCourseOwnership(userId, productId);
    const module_ = await db.query.shopCourseModules.findFirst({
      where: and(eq(shopCourseModules.id, moduleId), eq(shopCourseModules.productId, productId)),
    });
    if (!module_) throw new ApiError(404, 'Module not found');
    if (!title?.trim()) throw new ApiError(400, 'Module title is required');

    const [updated] = await db
      .update(shopCourseModules)
      .set({ title: title.trim(), updatedAt: new Date() })
      .where(eq(shopCourseModules.id, moduleId))
      .returning();
    return updated;
  }

  static async deleteModule(userId, productId, moduleId) {
    await this.assertCourseOwnership(userId, productId);
    const module_ = await db.query.shopCourseModules.findFirst({
      where: and(eq(shopCourseModules.id, moduleId), eq(shopCourseModules.productId, productId)),
    });
    if (!module_) throw new ApiError(404, 'Module not found');
    // Cascades to its lessons/attachments/progress.
    await db.delete(shopCourseModules).where(eq(shopCourseModules.id, moduleId));
  }

  static async reorderModules(userId, productId, orders) {
    await this.assertCourseOwnership(userId, productId);
    if (!Array.isArray(orders) || orders.length === 0) {
      throw new ApiError(400, 'orders must be a non-empty array');
    }
    await db.transaction(async tx => {
      for (const { id, sortOrder } of orders) {
        await tx
          .update(shopCourseModules)
          .set({ sortOrder, updatedAt: new Date() })
          .where(and(eq(shopCourseModules.id, id), eq(shopCourseModules.productId, productId)));
      }
    });
  }

  // ── Lessons ──────────────────────────────────────────────────────────────

  static async createLesson(
    userId,
    productId,
    moduleId,
    { title, description, videoUrl, videoSourceType, thumbnailUrl, duration, isFreePreview }
  ) {
    await this.assertCourseOwnership(userId, productId);
    const module_ = await db.query.shopCourseModules.findFirst({
      where: and(eq(shopCourseModules.id, moduleId), eq(shopCourseModules.productId, productId)),
    });
    if (!module_) throw new ApiError(404, 'Module not found');
    if (!title?.trim()) throw new ApiError(400, 'Lesson title is required');

    const existing = await db.query.shopCourseLessons.findMany({
      where: eq(shopCourseLessons.moduleId, moduleId),
      columns: { id: true },
    });
    if (existing.length >= MAX_LESSONS_PER_MODULE) {
      throw new ApiError(400, `A module can have at most ${MAX_LESSONS_PER_MODULE} lessons`);
    }

    const created = await db.transaction(async tx => {
      const [lesson] = await tx
        .insert(shopCourseLessons)
        .values({
          productId,
          moduleId,
          title: title.trim(),
          description: description?.trim() || null,
          videoUrl: videoUrl?.trim() || null,
          videoSourceType: videoSourceType ?? null,
          thumbnailUrl: thumbnailUrl?.trim() || null,
          duration: Number(duration) || 0,
          sortOrder: existing.length,
          isFreePreview: !!isFreePreview,
        })
        .returning();
      await this._refreshModuleLessonCount(tx, moduleId);
      return lesson;
    });
    return created;
  }

  static async updateLesson(userId, productId, lessonId, updates) {
    await this.assertCourseOwnership(userId, productId);
    const lesson = await db.query.shopCourseLessons.findFirst({
      where: and(eq(shopCourseLessons.id, lessonId), eq(shopCourseLessons.productId, productId)),
    });
    if (!lesson) throw new ApiError(404, 'Lesson not found');

    const patch = { updatedAt: new Date() };
    if (updates.title !== undefined) {
      if (!updates.title?.trim()) throw new ApiError(400, 'Lesson title is required');
      patch.title = updates.title.trim();
    }
    if (updates.description !== undefined) patch.description = updates.description?.trim() || null;
    if (updates.videoUrl !== undefined) patch.videoUrl = updates.videoUrl?.trim() || null;
    if (updates.videoSourceType !== undefined) patch.videoSourceType = updates.videoSourceType;
    if (updates.thumbnailUrl !== undefined) patch.thumbnailUrl = updates.thumbnailUrl?.trim() || null;
    if (updates.duration !== undefined) patch.duration = Number(updates.duration) || 0;
    if (updates.isFreePreview !== undefined) patch.isFreePreview = !!updates.isFreePreview;
    if (updates.isPublished !== undefined) patch.isPublished = !!updates.isPublished;

    const [updated] = await db
      .update(shopCourseLessons)
      .set(patch)
      .where(eq(shopCourseLessons.id, lessonId))
      .returning();
    return updated;
  }

  static async deleteLesson(userId, productId, lessonId) {
    await this.assertCourseOwnership(userId, productId);
    const lesson = await db.query.shopCourseLessons.findFirst({
      where: and(eq(shopCourseLessons.id, lessonId), eq(shopCourseLessons.productId, productId)),
    });
    if (!lesson) throw new ApiError(404, 'Lesson not found');

    await db.transaction(async tx => {
      // Cascades to its attachments/progress.
      await tx.delete(shopCourseLessons).where(eq(shopCourseLessons.id, lessonId));
      await this._refreshModuleLessonCount(tx, lesson.moduleId);
    });
  }

  static async reorderLessons(userId, productId, orders) {
    await this.assertCourseOwnership(userId, productId);
    if (!Array.isArray(orders) || orders.length === 0) {
      throw new ApiError(400, 'orders must be a non-empty array');
    }
    await db.transaction(async tx => {
      for (const { id, sortOrder } of orders) {
        await tx
          .update(shopCourseLessons)
          .set({ sortOrder, updatedAt: new Date() })
          .where(and(eq(shopCourseLessons.id, id), eq(shopCourseLessons.productId, productId)));
      }
    });
  }

  // ── Attachments ──────────────────────────────────────────────────────────

  static async addAttachment(userId, productId, lessonId, { title, fileUrl, fileType, size }) {
    await this.assertCourseOwnership(userId, productId);
    const lesson = await db.query.shopCourseLessons.findFirst({
      where: and(eq(shopCourseLessons.id, lessonId), eq(shopCourseLessons.productId, productId)),
    });
    if (!lesson) throw new ApiError(404, 'Lesson not found');
    if (!title?.trim() || !fileUrl?.trim()) {
      throw new ApiError(400, 'Attachment title and file are required');
    }

    const existing = await db.query.shopCourseLessonAttachments.findMany({
      where: eq(shopCourseLessonAttachments.lessonId, lessonId),
      columns: { id: true },
    });

    const [attachment] = await db
      .insert(shopCourseLessonAttachments)
      .values({
        lessonId,
        title: title.trim(),
        fileUrl: fileUrl.trim(),
        fileType: fileType || null,
        size: Number(size) || null,
        sortOrder: existing.length,
      })
      .returning();
    return attachment;
  }

  static async deleteAttachment(userId, productId, lessonId, attachmentId) {
    await this.assertCourseOwnership(userId, productId);
    const attachment = await db.query.shopCourseLessonAttachments.findFirst({
      where: and(
        eq(shopCourseLessonAttachments.id, attachmentId),
        eq(shopCourseLessonAttachments.lessonId, lessonId)
      ),
    });
    if (!attachment) throw new ApiError(404, 'Attachment not found');
    await db.delete(shopCourseLessonAttachments).where(eq(shopCourseLessonAttachments.id, attachmentId));
  }

  // ── Viewing (owner or paid buyer) ────────────────────────────────────────

  /**
   * Full syllabus for viewing/playing. Modules with nested lessons, each
   * lesson flagged `locked` — locked lessons have videoUrl/attachments
   * stripped so a curious network inspector can't pull the video URL for
   * content they haven't paid for.
   */
  static async getCourseContent(viewerId, productId) {
    const product = await db.query.shopProducts.findFirst({
      where: and(eq(shopProducts.id, productId), isNull(shopProducts.deletedAt)),
    });
    if (!product) throw new ApiError(404, 'Product not found');
    if (product.listingType !== 'course') throw new ApiError(400, 'This product is not a course');

    const isOwner = product.userId === viewerId;
    const unlocked = await this.hasAccessToCourse(viewerId, product);

    const [modules, lessons] = await Promise.all([
      db.query.shopCourseModules.findMany({
        where: eq(shopCourseModules.productId, productId),
        orderBy: [asc(shopCourseModules.sortOrder)],
      }),
      db.query.shopCourseLessons.findMany({
        where: eq(shopCourseLessons.productId, productId),
        orderBy: [asc(shopCourseLessons.sortOrder)],
      }),
    ]);

    const visibleLessons = isOwner ? lessons : lessons.filter(l => l.isPublished);
    const lessonIds = visibleLessons.map(l => l.id);
    const attachments = lessonIds.length
      ? await db.query.shopCourseLessonAttachments.findMany({
          where: inArray(shopCourseLessonAttachments.lessonId, lessonIds),
          orderBy: [asc(shopCourseLessonAttachments.sortOrder)],
        })
      : [];
    const attachmentsByLesson = new Map();
    for (const a of attachments) {
      if (!attachmentsByLesson.has(a.lessonId)) attachmentsByLesson.set(a.lessonId, []);
      attachmentsByLesson.get(a.lessonId).push(a);
    }

    let progressByLesson = new Map();
    if (unlocked && viewerId) {
      const progressRows = await db.query.shopCourseLessonProgress.findMany({
        where: and(
          eq(shopCourseLessonProgress.productId, productId),
          eq(shopCourseLessonProgress.userId, viewerId)
        ),
      });
      progressByLesson = new Map(progressRows.map(p => [p.lessonId, p]));
    }

    const lessonsByModule = new Map();
    for (const lesson of visibleLessons) {
      const canWatch = unlocked || lesson.isFreePreview;
      const shaped = {
        id: lesson.id,
        moduleId: lesson.moduleId,
        title: lesson.title,
        description: lesson.description,
        duration: lesson.duration,
        thumbnailUrl: lesson.thumbnailUrl,
        isFreePreview: lesson.isFreePreview,
        isPublished: lesson.isPublished,
        sortOrder: lesson.sortOrder,
        locked: !canWatch,
        videoUrl: canWatch ? lesson.videoUrl : null,
        videoSourceType: canWatch ? lesson.videoSourceType : null,
        attachments: canWatch ? (attachmentsByLesson.get(lesson.id) ?? []) : [],
        progress: progressByLesson.get(lesson.id)
          ? {
              watchedSeconds: progressByLesson.get(lesson.id).watchedSeconds,
              completedAt: progressByLesson.get(lesson.id).completedAt,
            }
          : null,
      };
      if (!lessonsByModule.has(lesson.moduleId)) lessonsByModule.set(lesson.moduleId, []);
      lessonsByModule.get(lesson.moduleId).push(shaped);
    }

    return {
      productId,
      title: product.title,
      isOwner,
      hasAccess: unlocked,
      totalLessons: visibleLessons.length,
      modules: modules.map(m => ({
        id: m.id,
        title: m.title,
        sortOrder: m.sortOrder,
        lessons: lessonsByModule.get(m.id) ?? [],
      })),
    };
  }

  // ── Progress ─────────────────────────────────────────────────────────────

  static async trackProgress(userId, productId, lessonId, watchedSeconds) {
    const product = await db.query.shopProducts.findFirst({
      where: eq(shopProducts.id, productId),
    });
    if (!product) throw new ApiError(404, 'Product not found');

    const lesson = await db.query.shopCourseLessons.findFirst({
      where: and(eq(shopCourseLessons.id, lessonId), eq(shopCourseLessons.productId, productId)),
    });
    if (!lesson) throw new ApiError(404, 'Lesson not found');

    const canWatch = (await this.hasAccessToCourse(userId, product)) || lesson.isFreePreview;
    if (!canWatch) throw new ApiError(403, 'You do not have access to this lesson');

    const seconds = Math.max(0, Number(watchedSeconds) || 0);
    // 90% counts as "completed" — matches the group-course player's threshold.
    const isCompleted = lesson.duration > 0 && seconds >= lesson.duration * 0.9;

    const existing = await db.query.shopCourseLessonProgress.findFirst({
      where: and(
        eq(shopCourseLessonProgress.lessonId, lessonId),
        eq(shopCourseLessonProgress.userId, userId)
      ),
    });

    if (existing) {
      const [updated] = await db
        .update(shopCourseLessonProgress)
        .set({
          watchedSeconds: Math.max(existing.watchedSeconds, seconds),
          completedAt: existing.completedAt ?? (isCompleted ? new Date() : null),
          updatedAt: new Date(),
        })
        .where(eq(shopCourseLessonProgress.id, existing.id))
        .returning();
      return updated;
    }

    const [created] = await db
      .insert(shopCourseLessonProgress)
      .values({
        productId,
        lessonId,
        userId,
        watchedSeconds: seconds,
        completedAt: isCompleted ? new Date() : null,
      })
      .returning();
    return created;
  }

  static async getProgress(userId, productId) {
    const rows = await db.query.shopCourseLessonProgress.findMany({
      where: and(
        eq(shopCourseLessonProgress.productId, productId),
        eq(shopCourseLessonProgress.userId, userId)
      ),
    });
    const totalLessons = await db.query.shopCourseLessons.findMany({
      where: and(
        eq(shopCourseLessons.productId, productId),
        eq(shopCourseLessons.isPublished, true)
      ),
      columns: { id: true },
    });
    const completedCount = rows.filter(r => r.completedAt).length;
    return {
      totalLessons: totalLessons.length,
      completedLessons: completedCount,
      percentComplete:
        totalLessons.length > 0 ? Math.round((completedCount / totalLessons.length) * 100) : 0,
      lessons: rows,
    };
  }

  /** The talent's own course-type products, for the Talent Dashboard's Courses list. */
  static async getMyCourses(userId) {
    const products = await db.query.shopProducts.findMany({
      where: and(
        eq(shopProducts.userId, userId),
        eq(shopProducts.listingType, 'course'),
        isNull(shopProducts.deletedAt)
      ),
      orderBy: [desc(shopProducts.createdAt)],
    });
    return ShopProductService.attachCourseModules(products);
  }
}
