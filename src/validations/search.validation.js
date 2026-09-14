import { z } from 'zod';

export const searchQuerySchema = z.object({
  body: z.object({}).optional(),
  params: z.object({}).optional(),
  query: z.object({
    q: z
      .string({ required_error: 'Search query is required' })
      .trim()
      .min(2, 'Search query must be at least 2 characters')
      .max(100, 'Search query is too long'),
    limit: z.coerce.number().int().min(1).max(20).default(10),
  }),
});
