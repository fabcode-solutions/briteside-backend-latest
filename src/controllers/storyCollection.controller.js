import { StoryCollectionService } from '../services/social/storyCollection.service.js';
import { catchAsync } from '../utils/catch-async.js';
import ApiError from '../utils/api-error.js';

export const createCollection = catchAsync(async (req, res) => {
  const { name, coverImage, sortOrder } = req.body;
  if (!name) throw new ApiError(400, 'name is required');
  const collection = await StoryCollectionService.createCollection(req.user.id, {
    name,
    coverImage,
    sortOrder,
  });
  res.status(201).json({ success: true, message: 'Collection created', data: { collection } });
});

export const getMyCollections = catchAsync(async (req, res) => {
  const collections = await StoryCollectionService.getMyCollections(req.user.id);
  res.json({ success: true, data: { collections } });
});

export const getUserCollections = catchAsync(async (req, res) => {
  const collections = await StoryCollectionService.getUserCollections(req.params.userId);
  res.json({ success: true, data: { collections } });
});

export const getCollectionItems = catchAsync(async (req, res) => {
  const { page = 1, limit = 20 } = req.query;
  const result = await StoryCollectionService.getCollectionItems(
    req.params.collectionId,
    parseInt(page),
    parseInt(limit),
    req.user.id
  );
  res.json({ success: true, data: result });
});

export const updateCollection = catchAsync(async (req, res) => {
  const { name, coverImage, sortOrder } = req.body;
  const collection = await StoryCollectionService.updateCollection(
    req.params.collectionId,
    req.user.id,
    { name, coverImage, sortOrder }
  );
  res.json({ success: true, message: 'Collection updated', data: { collection } });
});

export const deleteCollection = catchAsync(async (req, res) => {
  await StoryCollectionService.deleteCollection(req.params.collectionId, req.user.id);
  res.json({ success: true, message: 'Collection deleted' });
});

export const addCollectionItem = catchAsync(async (req, res) => {
  const { itemType, storyId, postId } = req.body;
  const item = await StoryCollectionService.addItem(req.params.collectionId, req.user.id, {
    itemType,
    storyId,
    postId,
  });
  res.status(201).json({ success: true, message: 'Item added to collection', data: { item } });
});

export const removeCollectionItem = catchAsync(async (req, res) => {
  await StoryCollectionService.removeItem(req.params.collectionId, req.params.itemId, req.user.id);
  res.json({ success: true, message: 'Item removed from collection' });
});
