import { describe, it, expect } from 'vitest';
import { updateBusinessSchema } from '../src/validations/business.validation.js';

const BID = '11111111-1111-4111-8111-111111111111';
const parse = websiteUrl =>
  updateBusinessSchema.safeParse({ params: { businessId: BID }, body: { websiteUrl } });

describe('business websiteUrl validation', () => {
  it.each(['https://example.com', 'http://shop.example.co.uk/about', '', null])('accepts %s', v => {
    expect(parse(v).success).toBe(true);
  });

  it.each([
    'javascript:alert(1)',
    'data:text/html,hi',
    'ftp://example.com',
    'example.com',
    'https://localhost',
    'not a url',
  ])('rejects %s', v => {
    expect(parse(v).success).toBe(false);
  });
});
