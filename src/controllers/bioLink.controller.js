import { BioLinkService } from '../services/social/bioLink.service.js';
import { catchAsync } from '../utils/catch-async.js';
import ApiError from '../utils/api-error.js';

export const createBioLink = catchAsync(async (req, res) => {
  const { title, url, icon } = req.body;
  if (!title) throw new ApiError(400, 'title is required');
  if (!url) throw new ApiError(400, 'url is required');
  const link = await BioLinkService.createLink(req.user.id, {
    title,
    url,
    icon,
    isPlus: req.user.isBritesidePlus,
  });
  res.status(201).json({ success: true, message: 'Bio link created', data: { link } });
});

export const getMyBioLinks = catchAsync(async (req, res) => {
  const page = Math.max(1, parseInt(req.query.page) || 1);
  const limit = Math.min(100, Math.max(1, parseInt(req.query.limit) || 20));
  const result = await BioLinkService.getMyLinks(req.user.id, { page, limit });
  res.json({ success: true, data: result });
});

export const getUserBioLinks = catchAsync(async (req, res) => {
  const page = Math.max(1, parseInt(req.query.page) || 1);
  const limit = Math.min(100, Math.max(1, parseInt(req.query.limit) || 20));
  const result = await BioLinkService.getUserLinks(req.params.userId, { page, limit });
  res.json({ success: true, data: result });
});

export const updateBioLink = catchAsync(async (req, res) => {
  const { title, url, icon } = req.body;
  const link = await BioLinkService.updateLink(req.params.linkId, req.user.id, {
    title,
    url,
    icon,
  });
  res.json({ success: true, message: 'Bio link updated', data: { link } });
});

export const deleteBioLink = catchAsync(async (req, res) => {
  await BioLinkService.deleteLink(req.params.linkId, req.user.id);
  res.json({ success: true, message: 'Bio link deleted' });
});

export const trackBioLinkClick = catchAsync(async (req, res) => {
  const result = await BioLinkService.trackClick(req.params.linkId);
  res.json({ success: true, data: result });
});
