import { ImportService } from '../services/imports/import.service.js';
import { catchAsync } from '../utils/catch-async.js';
import httpStatus from 'http-status';

export const getImportStatus = catchAsync(async (req, res) => {
  const result = await ImportService.getImportStatus(req.user.id);
  res.status(httpStatus.OK).json({ success: true, data: result });
});

export const createImport = catchAsync(async (req, res) => {
  const imp = await ImportService.createImport(req.user.id);
  res.status(httpStatus.CREATED).json({ success: true, data: imp });
});

export const presignImages = catchAsync(async (req, res) => {
  const { id } = req.params;
  const { images } = req.body;
  const result = await ImportService.presignImages(id, req.user.id, images);
  res.status(httpStatus.OK).json({ success: true, data: result });
});

export const submitImport = catchAsync(async (req, res) => {
  const { id } = req.params;
  const result = await ImportService.submitImport(id, req.user.id);
  res.status(httpStatus.OK).json({ success: true, data: result });
});

export const getImport = catchAsync(async (req, res) => {
  const { id } = req.params;
  const imp = await ImportService.getImport(id, req.user.id);
  res.status(httpStatus.OK).json({ success: true, data: imp });
});

export const getImportImages = catchAsync(async (req, res) => {
  const { id } = req.params;
  const images = await ImportService.getImportImages(id, req.user.id);
  res.status(httpStatus.OK).json({ success: true, data: images });
});

export const deleteImport = catchAsync(async (req, res) => {
  const { id } = req.params;
  const result = await ImportService.deleteImport(id, req.user.id);
  res.status(httpStatus.OK).json({ success: true, data: result });
});
