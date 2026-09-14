import { OrganizerPresetService } from '../services/organizerPreset.service.js';
import { catchAsync } from '../utils/catch-async.js';

export const createPreset = catchAsync(async (req, res) => {
  const preset = await OrganizerPresetService.createPreset(req.user.id, req.body);
  res.status(201).json({
    success: true,
    message: 'Preset created successfully',
    data: { preset },
  });
});

export const listPresets = catchAsync(async (req, res) => {
  const presets = await OrganizerPresetService.listPresets(req.user.id);
  res.json({
    success: true,
    data: { presets },
  });
});

export const getPreset = catchAsync(async (req, res) => {
  const preset = await OrganizerPresetService.getPreset(req.user.id, req.params.presetId);
  res.json({
    success: true,
    data: { preset },
  });
});

export const updatePreset = catchAsync(async (req, res) => {
  const preset = await OrganizerPresetService.updatePreset(
    req.user.id,
    req.params.presetId,
    req.body
  );
  res.json({
    success: true,
    message: 'Preset updated successfully',
    data: { preset },
  });
});

export const deletePreset = catchAsync(async (req, res) => {
  await OrganizerPresetService.deletePreset(req.user.id, req.params.presetId);
  res.json({
    success: true,
    message: 'Preset deleted successfully',
  });
});
