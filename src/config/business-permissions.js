// Business dashboard permission catalog. The owner (businesses.ownerId) has
// every permission implicitly; team members get the set for their role.

export const BUSINESS_PERMISSIONS = {
  VIEW: 'business.view',
  PROFILE_EDIT: 'profile.edit',
  POLICIES_MANAGE: 'policies.manage',
  SERVICES_MANAGE: 'services.manage',
  STAFF_MANAGE: 'staff.manage',
  // Own schedule only for role 'staff' (enforced in service)
  SCHEDULE_MANAGE: 'schedule.manage',
  BOOKINGS_VIEW: 'bookings.view',
  BOOKINGS_MANAGE: 'bookings.manage',
  CUSTOMERS_VIEW: 'customers.view',
  REPORTS_VIEW: 'reports.view',
  // Reply to customer reviews
  REVIEWS_MANAGE: 'reviews.manage',
  // Read and answer the business inbox (customer conversations)
  INBOX_MANAGE: 'inbox.manage',
  EARNINGS_VIEW: 'earnings.view',
  WALLET_MANAGE: 'wallet.manage',
  TAXES_MANAGE: 'taxes.manage',
  TEAM_MANAGE: 'team.manage',
  DELETE: 'business.delete',
};

const P = BUSINESS_PERMISSIONS;
export const ALL_BUSINESS_PERMISSIONS = Object.values(P);

export const BUSINESS_ROLES = ['admin', 'manager', 'staff'];

export const BUSINESS_ROLE_PERMISSIONS = {
  // Everything except deleting the business (owner only)
  admin: ALL_BUSINESS_PERMISSIONS.filter(p => p !== P.DELETE),
  // Admin minus wallet, taxes and access management
  manager: ALL_BUSINESS_PERMISSIONS.filter(
    p => ![P.DELETE, P.WALLET_MANAGE, P.TAXES_MANAGE, P.TEAM_MANAGE].includes(p)
  ),
  // Linked staff member: their own schedule and bookings
  staff: [P.VIEW, P.SCHEDULE_MANAGE, P.BOOKINGS_VIEW, P.BOOKINGS_MANAGE],
};

export const permissionsForRole = role => BUSINESS_ROLE_PERMISSIONS[role] ?? [];

// Business-wide settings and money a location manager (an admin / manager
// limited to some locations) can't touch — they'd affect other locations.
const BUSINESS_WIDE = [
  P.PROFILE_EDIT,
  P.POLICIES_MANAGE,
  P.SERVICES_MANAGE,
  P.TEAM_MANAGE,
  P.EARNINGS_VIEW,
  P.WALLET_MANAGE,
  P.TAXES_MANAGE,
  P.DELETE,
];

/** Permissions for a team member, narrowed when they're limited to some locations. */
export const permissionsForMember = (role, locationIds = []) => {
  const base = permissionsForRole(role);
  return role !== 'staff' && locationIds.length ? base.filter(p => !BUSINESS_WIDE.includes(p)) : base;
};
