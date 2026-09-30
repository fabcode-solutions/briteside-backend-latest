import { interestCategories, groupCategories, talentCategories } from '../db/schema/index.js';
import { makeCategoryAdminService } from './adminCategoryRegistry.service.js';

export const AdminInterestCategoryService = makeCategoryAdminService(
  interestCategories,
  'Interest category'
);
export const AdminGroupCategoryService = makeCategoryAdminService(groupCategories, 'Group category');
export const AdminTalentCategoryService = makeCategoryAdminService(
  talentCategories,
  'Talent category'
);
