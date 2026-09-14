import { catchAsync } from '../utils/catch-async.js';
import { GroupResourceService } from '../services/groupResource.service.js';

export const listResources = catchAsync(async (req, res) => {
  const { groupId } = req.params;
  const resources = await GroupResourceService.listResources(groupId);
  res.json({ success: true, data: resources });
});

export const createResource = catchAsync(async (req, res) => {
  const { groupId } = req.params;
  const resource = await GroupResourceService.createResource(groupId, req.user.id, req.body);
  res.status(201).json({ success: true, data: resource });
});

export const updateResource = catchAsync(async (req, res) => {
  const { groupId, resourceId } = req.params;
  const resource = await GroupResourceService.updateResource(
    resourceId,
    groupId,
    req.user.id,
    req.body
  );
  res.json({ success: true, data: resource });
});

export const deleteResource = catchAsync(async (req, res) => {
  const { groupId, resourceId } = req.params;
  await GroupResourceService.deleteResource(resourceId, groupId, req.user.id);
  res.json({ success: true, message: 'Resource deleted' });
});
