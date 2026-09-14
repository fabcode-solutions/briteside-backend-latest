import { db } from '../config/database.js';
import { users, roles, userRoles, userInformation } from '../db/schema/index.js';
import { eq, or } from 'drizzle-orm';
import httpStatus from 'http-status';
import ApiError from '../utils/api-error.js';
import authLogger from '../config/authLogger.js';

const wrapDbError = (err, context) => {
  authLogger.error({
    context,
    message: err.message,
    stack: err.stack,
  });
  return new ApiError(httpStatus.INTERNAL_SERVER_ERROR, 'Something went wrong. Please try again.');
};

const withDbErrorHandling = (fn, context) => async (...args) => {
  try {
    return await fn(...args);
  } catch (err) {
    if (err instanceof ApiError) throw err;
    throw wrapDbError(err, context);
  }
};

export const findByEmail = withDbErrorHandling(async email => {
  const result = await db.query.users.findFirst({
    where: eq(users.email, email),
    with: {
      roles: { with: { role: true } },
      userInformation: true,
    },
  });

  if (!result) return null;

  return {
    ...result,
    roles: result.roles.map(r => r.role.name),
    userInformation: result.userInformation || null,
  };
}, 'findByEmail');

export const findByPhone = withDbErrorHandling(async phoneNumber => {
  const result = await db.query.users.findFirst({
    where: eq(users.phoneNumber, phoneNumber),
    with: {
      roles: { with: { role: true } },
      userInformation: true,
    },
  });

  if (!result) return null;

  return {
    ...result,
    roles: result.roles.map(r => r.role.name),
    userInformation: result.userInformation || null,
  };
}, 'findByPhone');

export const getUserByUsernameOrEmail = withDbErrorHandling(async identifier => {
  const result = await db.query.users.findFirst({
    where: or(
      eq(users.email, identifier),
      eq(users.phoneNumber, identifier),
      eq(users.username, identifier)
    ),
    with: {
      organizer: true,
      roles: { with: { role: true } },
      userInformation: true,
    },
  });

  if (!result) return null;

  return {
    ...result,
    roles: result.roles.map(r => r.role.name),
    userInformation: result.userInformation || null,
  };
}, 'getUserByUsernameOrEmail');

export const getUserById = withDbErrorHandling(async id => {
  const result = await db.query.users.findFirst({
    where: eq(users.id, id),
    with: {
      roles: { with: { role: true } },
      userInformation: true,
    },
  });

  if (!result) return null;

  return {
    ...result,
    roles: result.roles.map(r => r.role.name),
    userInformation: result.userInformation || null,
  };
}, 'getUserById');

export const createUser = withDbErrorHandling(async data => {
  const [newUser] = await db.insert(users).values(data).returning();

  const authenticatedRole = await db.query.roles.findFirst({
    where: eq(roles.name, 'authenticated'),
  });

  if (authenticatedRole) {
    await db.insert(userRoles).values({
      userId: newUser.id,
      roleId: authenticatedRole.id,
    });
  }

  return newUser;
}, 'createUser');

export const updateUserById = withDbErrorHandling(async (id, data) => {
  const [updatedUser] = await db.update(users).set(data).where(eq(users.id, id)).returning();
  return updatedUser || null;
}, 'updateUserById');

export const createUserInformation = withDbErrorHandling(async (userId, data) => {
  const payload = { ...data, userId };
  const [newInfo] = await db.insert(userInformation).values(payload).returning();
  return newInfo;
}, 'createUserInformation');

export const getUserInformationByUserId = withDbErrorHandling(async userId => {
  const result = await db.query.userInformation.findFirst({
    where: eq(userInformation.userId, userId),
  });
  return result || null;
}, 'getUserInformationByUserId');

export const updateUserInformationByUserId = withDbErrorHandling(async (userId, data) => {
  const [updated] = await db
    .update(userInformation)
    .set(data)
    .where(eq(userInformation.userId, userId))
    .returning();
  return updated || null;
}, 'updateUserInformationByUserId');

export const findByUsername = withDbErrorHandling(async username => {
  const result = await db.query.users.findFirst({
    where: eq(users.username, username),
  });
  return result;
}, 'findByUsername');