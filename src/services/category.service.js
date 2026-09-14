import { count } from 'drizzle-orm';
import { db } from '../db/index.js';
import { categories } from '../db/schema/index.js';

export class CategoryService {
  static async getCategories({ page = 1, limit = 20 } = {}) {
    const offset = (page - 1) * limit;

    const [allCategories, [{ total }]] = await Promise.all([
      db.query.categories.findMany({
        orderBy: (categories, { asc }) => [asc(categories.name)],
        limit,
        offset,
      }),
      db.select({ total: count() }).from(categories),
    ]);

    return {
      categories: allCategories,
      pagination: {
        page,
        limit,
        total,
        totalPages: Math.ceil(total / limit) || 1,
        hasMore: page * limit < total,
      },
    };
  }

  static async seedCategories() {
    const defaultCategories = [
      { name: 'Music', description: 'Concerts, festivals, and music events' },
      { name: 'Sports', description: 'Sporting events and competitions' },
      { name: 'Technology', description: 'Tech conferences and workshops' },
      { name: 'Business', description: 'Business meetings and conferences' },
      { name: 'Arts', description: 'Art exhibitions and cultural events' },
      { name: 'Food', description: 'Food festivals and culinary events' },
      { name: 'Education', description: 'Educational workshops and seminars' },
      { name: 'Entertainment', description: 'Shows, comedy, and entertainment' },
    ];

    const createdCategories = [];

    for (const category of defaultCategories) {
      const [created] = await db
        .insert(categories)
        .values({
          ...category,
          createdAt: new Date(),
          updatedAt: new Date(),
        })
        .onConflictDoNothing()
        .returning();

      if (created) {
        createdCategories.push(created);
      }
    }

    return { created: createdCategories.length };
  }
}
