import { Router } from 'express';
import { authMiddleware } from '../middlewares/auth.middleware.js';
import {
  listResources,
  createResource,
  updateResource,
  deleteResource,
} from '../controllers/groupResource.controller.js';

// mergeParams so :groupId from parent router is accessible
const router = Router({ mergeParams: true });

router.get('/', listResources);
router.post('/', authMiddleware, createResource);
router.patch('/:resourceId', authMiddleware, updateResource);
router.delete('/:resourceId', authMiddleware, deleteResource);

export default router;
