import httpStatus from 'http-status';
import { catchAsync } from '../utils/catch-async.js';
import { TalentIssueService } from '../services/talentIssue.service.js';

// ── Customer ──────────────────────────────────────────────────────────────────

export const createIssue = catchAsync(async (req, res) => {
  const issue = await TalentIssueService.createIssue(req.user.id, req.body);
  res.status(httpStatus.CREATED).json({ success: true, data: issue });
});

export const getMyIssues = catchAsync(async (req, res) => {
  const issues = await TalentIssueService.listMyIssues(req.user.id);
  res.status(httpStatus.OK).json({ success: true, data: issues });
});

export const getEligibleEntities = catchAsync(async (req, res) => {
  const { type } = req.query; // optional: 'session' | 'priority_message'
  const data = await TalentIssueService.getEligibleEntities(req.user.id, type ?? null);
  res.status(httpStatus.OK).json({ success: true, data });
});

// ── Admin ─────────────────────────────────────────────────────────────────────

export const adminListIssues = catchAsync(async (req, res) => {
  const { status, entityType, page, limit } = req.query;
  const issues = await TalentIssueService.adminListIssues({
    status,
    entityType,
    page: page ? parseInt(page, 10) : 1,
    limit: limit ? parseInt(limit, 10) : 20,
  });
  res.status(httpStatus.OK).json({ success: true, data: issues });
});

export const adminGetIssue = catchAsync(async (req, res) => {
  const issue = await TalentIssueService.adminGetIssue(req.params.issueId);
  res.status(httpStatus.OK).json({ success: true, data: issue });
});

export const adminResolveIssue = catchAsync(async (req, res) => {
  const updated = await TalentIssueService.adminResolveIssue(
    req.user.id,
    req.params.issueId,
    req.body
  );
  res.status(httpStatus.OK).json({ success: true, data: updated });
});
