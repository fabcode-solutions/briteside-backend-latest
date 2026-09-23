import Stripe from 'stripe';
import config from '../config/config.js';
import { db } from '../db/index.js';
import { eq, and, desc, asc, count, sum, sql, isNull, inArray } from 'drizzle-orm';
import { groups, groupMembers, users } from '../db/schema/index.js';
import {
  groupCourses,
  groupCourseModules,
  groupCourseLessons,
  groupCourseLessonAttachments,
  groupCourseEnrollments,
  groupCourseLessonProgress,
} from '../db/schema/groupCourses.js';
import { stripeCustomers } from '../db/schema/britesidePlus.js';
import ApiError from '../utils/api-error.js';
import { requireGroupCreator } from '../utils/group-helpers.js';

let _stripe = null;
function getStripe() {
  if (!_stripe) {
    if (!config.stripe?.secretKey) throw new ApiError(503, 'Stripe is not configured');
    _stripe = new Stripe(config.stripe.secretKey);
  }
  return _stripe;
}

async function requireCourseOrganiser(courseId, userId) {
  const course = await db.query.groupCourses.findFirst({
    where: and(eq(groupCourses.id, courseId), isNull(groupCourses.deletedAt)),
  });
  if (!course) throw new ApiError(404, 'Course not found');
  await requireGroupCreator(course.groupId, userId, 'Only the group creator can manage courses.');
  return course;
}

async function getEnrollment(courseId, userId) {
  return db.query.groupCourseEnrollments.findFirst({
    where: and(
      eq(groupCourseEnrollments.courseId, courseId),
      eq(groupCourseEnrollments.userId, userId)
    ),
  });
}

export class GroupCourseService {
  // ─────────────────────────────────────────
  // COURSE CRUD  (organiser only)
  // ─────────────────────────────────────────

  static async createCourse(
    groupId,
    userId,
    { title, description, thumbnailUrl, isFree, price, metadata }
  ) {
    await requireGroupCreator(groupId, userId, 'Only the group creator can create courses.');

    const group = await db.query.groups.findFirst({ where: eq(groups.id, groupId) });
    if (!group) throw new ApiError(404, 'Group not found');

    let stripeProductId = null;
    let stripePriceId = null;

    if (!isFree && price && parseFloat(price) > 0) {
      // Selling a course is a Briteside Plus feature — a non-Plus organizer
      // can still create a course, just not charge for it. Re-checked here
      // (not trusted from the client) since price is real money.
      const creator = await db.query.users.findFirst({
        where: eq(users.id, userId),
        columns: { isBritesidePlus: true },
      });
      if (!creator?.isBritesidePlus) {
        throw new ApiError(403, 'Briteside Plus is required to sell a paid course.');
      }

      const s = getStripe();
      const product = await s.products.create({
        name: title,
        description: description ?? undefined,
        metadata: { type: 'group_course', groupId },
      });
      const stripePrice = await s.prices.create({
        product: product.id,
        unit_amount: Math.round(parseFloat(price) * 100),
        currency: 'usd',
      });
      stripeProductId = product.id;
      stripePriceId = stripePrice.id;
    }

    const [course] = await db
      .insert(groupCourses)
      .values({
        groupId,
        createdBy: userId,
        title,
        description: description ?? null,
        thumbnailUrl: thumbnailUrl ?? null,
        isFree: isFree ?? true,
        price: isFree ? null : (price ?? null),
        stripeProductId,
        stripePriceId,
        metadata: metadata ?? {},
        status: 'draft',
      })
      .returning();

    return course;
  }

  static async updateCourse(courseId, userId, updates) {
    const course = await requireCourseOrganiser(courseId, userId);

    const { title, description, thumbnailUrl, metadata } = updates;
    const patch = { updatedAt: new Date() };
    if (title !== undefined) patch.title = title;
    if (description !== undefined) patch.description = description;
    if (thumbnailUrl !== undefined) patch.thumbnailUrl = thumbnailUrl;
    if (metadata !== undefined) patch.metadata = metadata;

    if (patch.title && course.stripeProductId) {
      getStripe()
        .products.update(course.stripeProductId, { name: patch.title })
        .catch(() => {});
    }

    const [updated] = await db
      .update(groupCourses)
      .set(patch)
      .where(eq(groupCourses.id, courseId))
      .returning();
    return updated;
  }

  static async publishCourse(courseId, userId) {
    await requireCourseOrganiser(courseId, userId);
    const [updated] = await db
      .update(groupCourses)
      .set({ status: 'published', updatedAt: new Date() })
      .where(eq(groupCourses.id, courseId))
      .returning();
    return updated;
  }

  static async archiveCourse(courseId, userId) {
    await requireCourseOrganiser(courseId, userId);
    const [updated] = await db
      .update(groupCourses)
      .set({ status: 'archived', updatedAt: new Date() })
      .where(eq(groupCourses.id, courseId))
      .returning();
    return updated;
  }

  static async deleteCourse(courseId, userId) {
    await requireCourseOrganiser(courseId, userId);
    await db
      .update(groupCourses)
      .set({ deletedAt: new Date(), updatedAt: new Date() })
      .where(eq(groupCourses.id, courseId));
    return { deleted: true };
  }

  // ─────────────────────────────────────────
  // COURSE QUERIES
  // ─────────────────────────────────────────

  static async listGroupCourses(groupId, userId, { page = 1, limit = 20, status } = {}) {
    const isMember = userId
      ? await db.query.groupMembers.findFirst({
          where: and(eq(groupMembers.groupId, groupId), eq(groupMembers.userId, userId)),
        })
      : null;

    const conditions = [eq(groupCourses.groupId, groupId), isNull(groupCourses.deletedAt)];
    if (!isMember) {
      conditions.push(eq(groupCourses.status, 'published'));
    } else if (status) {
      conditions.push(eq(groupCourses.status, status));
    }

    const offset = (page - 1) * limit;
    const [rows, totalRows] = await Promise.all([
      db.query.groupCourses.findMany({
        where: and(...conditions),
        orderBy: [desc(groupCourses.createdAt)],
        limit,
        offset,
        with: {
          createdBy: { columns: { id: true, firstName: true, lastName: true, image: true } },
        },
      }),
      db
        .select({ count: count() })
        .from(groupCourses)
        .where(and(...conditions)),
    ]);

    let enrolledSet = new Set();
    if (userId && rows.length > 0) {
      const ids = rows.map(r => r.id);
      const enrollments = await db
        .select({ courseId: groupCourseEnrollments.courseId })
        .from(groupCourseEnrollments)
        .where(
          and(
            sql`${groupCourseEnrollments.courseId} = ANY(ARRAY[${sql.join(
              ids.map(id => sql`${id}::uuid`),
              sql`, `
            )}])`,
            eq(groupCourseEnrollments.userId, userId)
          )
        );
      enrollments.forEach(e => enrolledSet.add(e.courseId));
    }

    return {
      courses: rows.map(c => ({ ...c, isEnrolled: enrolledSet.has(c.id) })),
      pagination: {
        page,
        limit,
        total: totalRows[0]?.count ?? 0,
        pages: Math.ceil((totalRows[0]?.count ?? 0) / limit),
      },
    };
  }

  static async getCourse(courseId, userId) {
    const course = await db.query.groupCourses.findFirst({
      where: and(eq(groupCourses.id, courseId), isNull(groupCourses.deletedAt)),
      with: {
        createdBy: { columns: { id: true, firstName: true, lastName: true, image: true } },
        modules: {
          orderBy: [asc(groupCourseModules.sortOrder)],
          with: {
            lessons: {
              where: eq(groupCourseLessons.isPublished, true),
              orderBy: [asc(groupCourseLessons.sortOrder)],
              with: {
                attachments: { orderBy: [asc(groupCourseLessonAttachments.sortOrder)] },
              },
            },
          },
        },
      },
    });
    if (!course) throw new ApiError(404, 'Course not found');

    let enrollment = null;
    if (userId) enrollment = await getEnrollment(courseId, userId);
    const isCreator = !!userId && userId === course.createdBy.id;
    const canAccessFull = isCreator || course.isFree || !!enrollment;

    return {
      ...course,
      modules: course.modules.map(module => ({
        ...module,
        lessons: module.lessons.map(l => {
          const unlocked = canAccessFull || l.isFreePreview;
          return {
            ...l,
            description: unlocked ? l.description : null,
            videoUrl: unlocked ? l.videoUrl : null,
            attachments: unlocked ? l.attachments : [],
          };
        }),
      })),
      isEnrolled: !!enrollment,
    };
  }

  // ─────────────────────────────────────────
  // MODULE CRUD  (organiser only)
  // ─────────────────────────────────────────

  static async createModule(courseId, userId, { title, description }) {
    await requireCourseOrganiser(courseId, userId);

    const [lastModule] = await db
      .select({ maxOrder: sql`MAX(${groupCourseModules.sortOrder})` })
      .from(groupCourseModules)
      .where(eq(groupCourseModules.courseId, courseId));

    const [module] = await db
      .insert(groupCourseModules)
      .values({
        courseId,
        title,
        description: description ?? null,
        sortOrder: Number(lastModule?.maxOrder ?? -1) + 1,
      })
      .returning();
    return { ...module, lessons: [] };
  }

  static async updateModule(moduleId, courseId, userId, updates) {
    await requireCourseOrganiser(courseId, userId);

    const { title, description } = updates;
    const patch = { updatedAt: new Date() };
    if (title !== undefined) patch.title = title;
    if (description !== undefined) patch.description = description;

    const [updated] = await db
      .update(groupCourseModules)
      .set(patch)
      .where(and(eq(groupCourseModules.id, moduleId), eq(groupCourseModules.courseId, courseId)))
      .returning();
    if (!updated) throw new ApiError(404, 'Module not found');
    return updated;
  }

  static async deleteModule(moduleId, courseId, userId) {
    await requireCourseOrganiser(courseId, userId);
    const [deleted] = await db
      .delete(groupCourseModules)
      .where(and(eq(groupCourseModules.id, moduleId), eq(groupCourseModules.courseId, courseId)))
      .returning();
    if (!deleted) throw new ApiError(404, 'Module not found');
    return { deleted: true };
  }

  static async reorderModules(courseId, userId, orders) {
    await requireCourseOrganiser(courseId, userId);

    const ids = orders.map(o => o.id);
    const existing = await db
      .select({ id: groupCourseModules.id })
      .from(groupCourseModules)
      .where(and(eq(groupCourseModules.courseId, courseId), inArray(groupCourseModules.id, ids)));
    if (existing.length !== ids.length) {
      throw new ApiError(400, 'One or more modules do not belong to this course');
    }

    await db.transaction(async tx => {
      for (const { id, sortOrder } of orders) {
        await tx
          .update(groupCourseModules)
          .set({ sortOrder, updatedAt: new Date() })
          .where(and(eq(groupCourseModules.id, id), eq(groupCourseModules.courseId, courseId)));
      }
    });
    return { reordered: true };
  }

  // ─────────────────────────────────────────
  // LESSON CRUD  (organiser only)
  // ─────────────────────────────────────────

  static async addLesson(
    courseId,
    userId,
    { moduleId, title, description, videoUrl, videoSourceType, thumbnailUrl, duration, isFreePreview }
  ) {
    await requireCourseOrganiser(courseId, userId);

    const module = await db.query.groupCourseModules.findFirst({
      where: and(eq(groupCourseModules.id, moduleId), eq(groupCourseModules.courseId, courseId)),
    });
    if (!module) throw new ApiError(400, 'moduleId does not belong to this course');

    const [lastLesson] = await db
      .select({ maxOrder: sql`MAX(${groupCourseLessons.sortOrder})` })
      .from(groupCourseLessons)
      .where(eq(groupCourseLessons.moduleId, moduleId));

    const sortOrder = Number(lastLesson?.maxOrder ?? -1) + 1;

    const [lesson] = await db
      .insert(groupCourseLessons)
      .values({
        courseId,
        moduleId,
        title,
        description: description ?? null,
        videoUrl: videoUrl ?? null,
        videoSourceType: videoSourceType ?? null,
        thumbnailUrl: thumbnailUrl ?? null,
        duration: duration ?? 0,
        sortOrder,
        isFreePreview: isFreePreview ?? false,
      })
      .returning();

    await db
      .update(groupCourses)
      .set({ totalLessons: sql`${groupCourses.totalLessons} + 1`, updatedAt: new Date() })
      .where(eq(groupCourses.id, courseId));

    return { ...lesson, attachments: [] };
  }

  static async updateLesson(lessonId, courseId, userId, updates) {
    await requireCourseOrganiser(courseId, userId);

    const lesson = await db.query.groupCourseLessons.findFirst({
      where: and(eq(groupCourseLessons.id, lessonId), eq(groupCourseLessons.courseId, courseId)),
    });
    if (!lesson) throw new ApiError(404, 'Lesson not found');

    const {
      moduleId,
      title,
      description,
      videoUrl,
      videoSourceType,
      thumbnailUrl,
      duration,
      isFreePreview,
      isPublished,
    } = updates;
    const patch = { updatedAt: new Date() };
    if (moduleId !== undefined) {
      const module = await db.query.groupCourseModules.findFirst({
        where: and(eq(groupCourseModules.id, moduleId), eq(groupCourseModules.courseId, courseId)),
      });
      if (!module) throw new ApiError(400, 'moduleId does not belong to this course');
      patch.moduleId = moduleId;
    }
    if (title !== undefined) patch.title = title;
    if (description !== undefined) patch.description = description;
    if (videoUrl !== undefined) patch.videoUrl = videoUrl;
    if (videoSourceType !== undefined) patch.videoSourceType = videoSourceType;
    if (thumbnailUrl !== undefined) patch.thumbnailUrl = thumbnailUrl;
    if (duration !== undefined) patch.duration = duration;
    if (isFreePreview !== undefined) patch.isFreePreview = isFreePreview;
    if (isPublished !== undefined) patch.isPublished = isPublished;

    const [updated] = await db
      .update(groupCourseLessons)
      .set(patch)
      .where(eq(groupCourseLessons.id, lessonId))
      .returning();
    return updated;
  }

  static async deleteLesson(lessonId, courseId, userId) {
    await requireCourseOrganiser(courseId, userId);
    await db
      .delete(groupCourseLessons)
      .where(and(eq(groupCourseLessons.id, lessonId), eq(groupCourseLessons.courseId, courseId)));
    await db
      .update(groupCourses)
      .set({
        totalLessons: sql`GREATEST(${groupCourses.totalLessons} - 1, 0)`,
        updatedAt: new Date(),
      })
      .where(eq(groupCourses.id, courseId));
    return { deleted: true };
  }

  static async reorderLessons(courseId, userId, orders) {
    await requireCourseOrganiser(courseId, userId);

    const moduleIds = [...new Set(orders.map(o => o.moduleId))];
    const existingModules = await db
      .select({ id: groupCourseModules.id })
      .from(groupCourseModules)
      .where(
        and(eq(groupCourseModules.courseId, courseId), inArray(groupCourseModules.id, moduleIds))
      );
    if (existingModules.length !== moduleIds.length) {
      throw new ApiError(400, 'One or more modules do not belong to this course');
    }

    await db.transaction(async tx => {
      for (const { id, sortOrder, moduleId } of orders) {
        await tx
          .update(groupCourseLessons)
          .set({ sortOrder, moduleId, updatedAt: new Date() })
          .where(and(eq(groupCourseLessons.id, id), eq(groupCourseLessons.courseId, courseId)));
      }
    });
    return { reordered: true };
  }

  // ─────────────────────────────────────────
  // LESSON ATTACHMENTS  (organiser only)
  // ─────────────────────────────────────────

  static async addAttachment(lessonId, courseId, userId, { title, fileUrl, fileType, size }) {
    await requireCourseOrganiser(courseId, userId);

    const lesson = await db.query.groupCourseLessons.findFirst({
      where: and(eq(groupCourseLessons.id, lessonId), eq(groupCourseLessons.courseId, courseId)),
    });
    if (!lesson) throw new ApiError(404, 'Lesson not found');

    const [lastAttachment] = await db
      .select({ maxOrder: sql`MAX(${groupCourseLessonAttachments.sortOrder})` })
      .from(groupCourseLessonAttachments)
      .where(eq(groupCourseLessonAttachments.lessonId, lessonId));

    const [attachment] = await db
      .insert(groupCourseLessonAttachments)
      .values({
        lessonId,
        title,
        fileUrl,
        fileType: fileType ?? null,
        size: size ?? null,
        sortOrder: Number(lastAttachment?.maxOrder ?? -1) + 1,
      })
      .returning();
    return attachment;
  }

  static async deleteAttachment(attachmentId, lessonId, courseId, userId) {
    await requireCourseOrganiser(courseId, userId);

    const lesson = await db.query.groupCourseLessons.findFirst({
      where: and(eq(groupCourseLessons.id, lessonId), eq(groupCourseLessons.courseId, courseId)),
    });
    if (!lesson) throw new ApiError(404, 'Lesson not found');

    const [deleted] = await db
      .delete(groupCourseLessonAttachments)
      .where(
        and(
          eq(groupCourseLessonAttachments.id, attachmentId),
          eq(groupCourseLessonAttachments.lessonId, lessonId)
        )
      )
      .returning();
    if (!deleted) throw new ApiError(404, 'Attachment not found');
    return { deleted: true };
  }

  // ─────────────────────────────────────────
  // ENROLLMENT
  // ─────────────────────────────────────────

  static async enrollFree(courseId, userId) {
    const course = await db.query.groupCourses.findFirst({
      where: and(eq(groupCourses.id, courseId), isNull(groupCourses.deletedAt)),
    });
    if (!course) throw new ApiError(404, 'Course not found');
    if (course.status !== 'published') throw new ApiError(400, 'Course is not published');
    if (!course.isFree) throw new ApiError(400, 'Paid course — use checkout instead');

    const member = await db.query.groupMembers.findFirst({
      where: and(eq(groupMembers.groupId, course.groupId), eq(groupMembers.userId, userId)),
    });
    if (!member) throw new ApiError(403, 'Must be a group member to enrol');

    const existing = await getEnrollment(courseId, userId);
    if (existing) return existing;

    const [enrollment] = await db
      .insert(groupCourseEnrollments)
      .values({ courseId, userId, amountPaid: '0' })
      .returning();

    await db
      .update(groupCourses)
      .set({ totalEnrollments: sql`${groupCourses.totalEnrollments} + 1`, updatedAt: new Date() })
      .where(eq(groupCourses.id, courseId));

    return enrollment;
  }

  static async createEnrollmentCheckout(courseId, userId, successUrl, cancelUrl) {
    const course = await db.query.groupCourses.findFirst({
      where: and(eq(groupCourses.id, courseId), isNull(groupCourses.deletedAt)),
    });
    if (!course) throw new ApiError(404, 'Course not found');
    if (course.status !== 'published') throw new ApiError(400, 'Course is not published');
    if (course.isFree) throw new ApiError(400, 'Free course — use /enroll instead');
    if (!course.stripePriceId) throw new ApiError(500, 'Course payment not configured');

    const member = await db.query.groupMembers.findFirst({
      where: and(eq(groupMembers.groupId, course.groupId), eq(groupMembers.userId, userId)),
    });
    if (!member) throw new ApiError(403, 'Must be a group member to enrol');

    const existing = await getEnrollment(courseId, userId);
    if (existing) throw new ApiError(409, 'Already enrolled');

    const s = getStripe();
    const customerRow = await db.query.stripeCustomers.findFirst({
      where: eq(stripeCustomers.userId, userId),
    });

    const session = await s.checkout.sessions.create({
      mode: 'payment',
      customer: customerRow?.stripeCustomerId ?? undefined,
      line_items: [{ price: course.stripePriceId, quantity: 1 }],
      success_url: successUrl,
      cancel_url: cancelUrl,
      metadata: {
        type: 'group_course_enrollment',
        courseId,
        userId,
        groupId: course.groupId,
        price: course.price,
      },
    });

    return { url: session.url, sessionId: session.id };
  }

  static async handleCourseCheckoutCompleted(session) {
    const { courseId, userId, price } = session.metadata ?? {};
    if (!courseId || !userId) return;

    const existing = await getEnrollment(courseId, userId);
    if (existing) return;

    await db.insert(groupCourseEnrollments).values({
      courseId,
      userId,
      amountPaid: price ?? '0',
      stripePaymentIntentId:
        typeof session.payment_intent === 'string' ? session.payment_intent : null,
      stripeSessionId: session.id,
    });

    await db
      .update(groupCourses)
      .set({ totalEnrollments: sql`${groupCourses.totalEnrollments} + 1`, updatedAt: new Date() })
      .where(eq(groupCourses.id, courseId));
  }

  // ─────────────────────────────────────────
  // PROGRESS TRACKING
  // ─────────────────────────────────────────

  static async trackLessonProgress(lessonId, userId, watchedSeconds) {
    const lesson = await db.query.groupCourseLessons.findFirst({
      where: eq(groupCourseLessons.id, lessonId),
    });
    if (!lesson) throw new ApiError(404, 'Lesson not found');

    const enrollment = await getEnrollment(lesson.courseId, userId);
    if (!enrollment) throw new ApiError(403, 'Not enrolled in this course');

    const existing = await db.query.groupCourseLessonProgress.findFirst({
      where: and(
        eq(groupCourseLessonProgress.enrollmentId, enrollment.id),
        eq(groupCourseLessonProgress.lessonId, lessonId)
      ),
    });

    const isCompleted =
      lesson.duration > 0 ? watchedSeconds >= lesson.duration * 0.9 : watchedSeconds > 0;
    const completedAt = isCompleted ? (existing?.completedAt ?? new Date()) : null;

    if (existing) {
      const [updated] = await db
        .update(groupCourseLessonProgress)
        .set({
          watchedSeconds: Math.max(existing.watchedSeconds, watchedSeconds),
          completedAt: completedAt ?? existing.completedAt,
          updatedAt: new Date(),
        })
        .where(eq(groupCourseLessonProgress.id, existing.id))
        .returning();
      await this._checkCourseCompletion(enrollment.id, lesson.courseId);
      return updated;
    }

    const [created] = await db
      .insert(groupCourseLessonProgress)
      .values({ enrollmentId: enrollment.id, lessonId, userId, watchedSeconds, completedAt })
      .returning();

    await this._checkCourseCompletion(enrollment.id, lesson.courseId);
    return created;
  }

  static async _checkCourseCompletion(enrollmentId, courseId) {
    const [{ total }] = await db
      .select({ total: count() })
      .from(groupCourseLessons)
      .where(
        and(eq(groupCourseLessons.courseId, courseId), eq(groupCourseLessons.isPublished, true))
      );

    const [{ done }] = await db
      .select({ done: count() })
      .from(groupCourseLessonProgress)
      .where(
        and(
          eq(groupCourseLessonProgress.enrollmentId, enrollmentId),
          sql`${groupCourseLessonProgress.completedAt} IS NOT NULL`
        )
      );

    if (Number(total) > 0 && Number(done) >= Number(total)) {
      await db
        .update(groupCourseEnrollments)
        .set({ status: 'completed', completedAt: new Date(), updatedAt: new Date() })
        .where(eq(groupCourseEnrollments.id, enrollmentId));
    }
  }

  static async getCourseProgress(courseId, userId) {
    const enrollment = await db.query.groupCourseEnrollments.findFirst({
      where: and(
        eq(groupCourseEnrollments.courseId, courseId),
        eq(groupCourseEnrollments.userId, userId)
      ),
      with: { lessonProgress: true },
    });
    if (!enrollment) throw new ApiError(403, 'Not enrolled in this course');

    const lessons = await db.query.groupCourseLessons.findMany({
      where: and(
        eq(groupCourseLessons.courseId, courseId),
        eq(groupCourseLessons.isPublished, true)
      ),
      orderBy: [asc(groupCourseLessons.sortOrder)],
    });

    const progressMap = new Map(enrollment.lessonProgress.map(p => [p.lessonId, p]));
    const completedCount = [...progressMap.values()].filter(p => p.completedAt).length;

    return {
      enrollmentId: enrollment.id,
      status: enrollment.status,
      enrolledAt: enrollment.createdAt,
      completedAt: enrollment.completedAt,
      progressPercent: lessons.length > 0 ? Math.round((completedCount / lessons.length) * 100) : 0,
      completedLessons: completedCount,
      totalLessons: lessons.length,
      lessons: lessons.map(l => {
        const p = progressMap.get(l.id);
        return {
          id: l.id,
          title: l.title,
          sortOrder: l.sortOrder,
          duration: l.duration,
          watchedSeconds: p?.watchedSeconds ?? 0,
          completedAt: p?.completedAt ?? null,
        };
      }),
    };
  }

  static async getMyCourses(userId) {
    const enrollments = await db.query.groupCourseEnrollments.findMany({
      where: eq(groupCourseEnrollments.userId, userId),
      orderBy: [desc(groupCourseEnrollments.createdAt)],
      with: {
        course: {
          columns: {
            id: true,
            title: true,
            description: true,
            thumbnailUrl: true,
            isFree: true,
            status: true,
            totalLessons: true,
          },
        },
      },
    });

    return Promise.all(
      enrollments.map(async e => {
        const progress = await this.getCourseProgress(e.courseId, userId).catch(() => null);
        return {
          ...e.course,
          enrollmentId: e.id,
          enrollmentStatus: e.status,
          enrolledAt: e.createdAt,
          progressPercent: progress?.progressPercent ?? 0,
          completedLessons: progress?.completedLessons ?? 0,
        };
      })
    );
  }

  // ─────────────────────────────────────────
  // ORGANISER ANALYTICS
  // ─────────────────────────────────────────

  static async getOrganizerCourseAnalytics(groupId, userId) {
    await requireGroupCreator(groupId, userId, 'Only the group creator can view course analytics.');

    const courses = await db.query.groupCourses.findMany({
      where: and(eq(groupCourses.groupId, groupId), isNull(groupCourses.deletedAt)),
      orderBy: [desc(groupCourses.createdAt)],
    });

    if (courses.length === 0) {
      return {
        courses: [],
        totals: { totalCourses: 0, totalEnrollments: 0, totalRevenue: '0.00' },
      };
    }

    const courseIds = courses.map(c => c.id);
    const idArraySql = sql`ARRAY[${sql.join(
      courseIds.map(id => sql`${id}::uuid`),
      sql`, `
    )}]`;

    const [[enrollTotals], perCourse] = await Promise.all([
      db
        .select({
          totalEnrollments: count(),
          totalRevenue: sum(groupCourseEnrollments.amountPaid),
        })
        .from(groupCourseEnrollments)
        .where(sql`${groupCourseEnrollments.courseId} = ANY(${idArraySql})`),
      db
        .select({
          courseId: groupCourseEnrollments.courseId,
          enrollments: count(),
          revenue: sum(groupCourseEnrollments.amountPaid),
          completed: sql`SUM(CASE WHEN ${groupCourseEnrollments.status} = 'completed' THEN 1 ELSE 0 END)`,
        })
        .from(groupCourseEnrollments)
        .where(sql`${groupCourseEnrollments.courseId} = ANY(${idArraySql})`)
        .groupBy(groupCourseEnrollments.courseId),
    ]);

    const statsMap = new Map(perCourse.map(s => [s.courseId, s]));

    return {
      courses: courses.map(c => {
        const s = statsMap.get(c.id);
        return {
          id: c.id,
          title: c.title,
          status: c.status,
          isFree: c.isFree,
          price: c.price,
          totalLessons: c.totalLessons,
          enrollments: Number(s?.enrollments ?? 0),
          completed: Number(s?.completed ?? 0),
          revenue: parseFloat(s?.revenue ?? 0).toFixed(2),
          createdAt: c.createdAt,
        };
      }),
      totals: {
        totalCourses: courses.length,
        totalEnrollments: Number(enrollTotals?.totalEnrollments ?? 0),
        totalRevenue: parseFloat(enrollTotals?.totalRevenue ?? 0).toFixed(2),
      },
    };
  }

  // ─────────────────────────────────────────
  // ADMIN ANALYTICS
  // ─────────────────────────────────────────

  static async getAdminCourseAnalytics({ dateFrom, dateTo } = {}) {
    const courseConditions = [isNull(groupCourses.deletedAt)];
    if (dateFrom) courseConditions.push(sql`${groupCourses.createdAt} >= ${new Date(dateFrom)}`);
    if (dateTo) courseConditions.push(sql`${groupCourses.createdAt} <= ${new Date(dateTo)}`);

    const enrollConditions = [];
    if (dateFrom)
      enrollConditions.push(sql`${groupCourseEnrollments.createdAt} >= ${new Date(dateFrom)}`);
    if (dateTo)
      enrollConditions.push(sql`${groupCourseEnrollments.createdAt} <= ${new Date(dateTo)}`);

    const [[totals], [enrollStats], topCourses] = await Promise.all([
      db
        .select({
          totalCourses: count(),
          publishedCourses: sql`SUM(CASE WHEN ${groupCourses.status} = 'published' THEN 1 ELSE 0 END)`,
          freeCourses: sql`SUM(CASE WHEN ${groupCourses.isFree} = TRUE THEN 1 ELSE 0 END)`,
          paidCourses: sql`SUM(CASE WHEN ${groupCourses.isFree} = FALSE THEN 1 ELSE 0 END)`,
        })
        .from(groupCourses)
        .where(and(...courseConditions)),
      db
        .select({
          totalEnrollments: count(),
          totalRevenue: sum(groupCourseEnrollments.amountPaid),
          completedEnrollments: sql`SUM(CASE WHEN ${groupCourseEnrollments.status} = 'completed' THEN 1 ELSE 0 END)`,
        })
        .from(groupCourseEnrollments)
        .where(enrollConditions.length ? and(...enrollConditions) : undefined),
      db
        .select({
          courseId: groupCourseEnrollments.courseId,
          enrollments: count(),
          revenue: sum(groupCourseEnrollments.amountPaid),
        })
        .from(groupCourseEnrollments)
        .where(enrollConditions.length ? and(...enrollConditions) : undefined)
        .groupBy(groupCourseEnrollments.courseId)
        .orderBy(desc(count()))
        .limit(10),
    ]);

    let topCoursesWithMeta = topCourses;
    if (topCourses.length > 0) {
      const ids = topCourses.map(t => t.courseId);
      const details = await db.query.groupCourses.findMany({
        where: sql`${groupCourses.id} = ANY(ARRAY[${sql.join(
          ids.map(id => sql`${id}::uuid`),
          sql`, `
        )}])`,
        columns: { id: true, title: true, groupId: true },
      });
      const titleMap = new Map(details.map(c => [c.id, c]));
      topCoursesWithMeta = topCourses.map(t => ({
        courseId: t.courseId,
        enrollments: Number(t.enrollments),
        revenue: parseFloat(t.revenue ?? 0).toFixed(2),
        ...titleMap.get(t.courseId),
      }));
    }

    return {
      courses: {
        total: Number(totals?.totalCourses ?? 0),
        published: Number(totals?.publishedCourses ?? 0),
        free: Number(totals?.freeCourses ?? 0),
        paid: Number(totals?.paidCourses ?? 0),
      },
      enrollments: {
        total: Number(enrollStats?.totalEnrollments ?? 0),
        completed: Number(enrollStats?.completedEnrollments ?? 0),
        totalRevenue: parseFloat(enrollStats?.totalRevenue ?? 0).toFixed(2),
      },
      topCourses: topCoursesWithMeta,
    };
  }
}
