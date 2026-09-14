import Joi from 'joi';
import { reportTypeEnum, reportStatusEnum } from '../db/schema/userReports.js';

const createReport = {
  body: Joi.object().keys({
    type: Joi.string()
      .required()
      .valid(...reportTypeEnum.enumValues),
    targetUserId: Joi.string().uuid(),
    postId: Joi.string().uuid(),
    groupId: Joi.string().uuid(),
    eventId: Joi.string().uuid(),
    conversationId: Joi.string().uuid(),
    reason: Joi.string().required(),
    description: Joi.string().allow(null, ''),
    metadata: Joi.object(),
    evidenceImages: Joi.array().items(Joi.string()),
  }),
};

const getReports = {
  query: Joi.object().keys({
    status: Joi.string().valid(...reportStatusEnum.enumValues),
    type: Joi.string().valid(...reportTypeEnum.enumValues),
    sortBy: Joi.string(),
    sortOrder: Joi.string().valid('asc', 'desc'),
    limit: Joi.number().integer(),
    page: Joi.number().integer(),
  }),
};

const updateReportStatus = {
  params: Joi.object().keys({
    reportId: Joi.string().uuid().required(),
  }),
  body: Joi.object().keys({
    status: Joi.string()
      .required()
      .valid(...reportStatusEnum.enumValues),
    actionTaken: Joi.string(),
  }),
};

export const reportValidation = {
  createReport,
  getReports,
  updateReportStatus,
};
