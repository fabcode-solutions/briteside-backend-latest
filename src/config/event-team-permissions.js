/**
 * All known event-team permission keys (24 total).
 * Use these constants everywhere instead of raw strings.
 */
export const PERMISSIONS = {
  // Analytics
  ANALYTICS_VIEW_SALES: 'analytics.view_sales',

  // Teams management
  TEAMS_VIEW: 'teams.view',
  TEAMS_ADD: 'teams.add',
  TEAMS_EDIT_PERMISSIONS: 'teams.edit_permissions',
  TEAMS_REMOVE: 'teams.remove',
  TEAMS_ADD_ADMINS: 'teams.add_admins',

  // SMS / marketing blasts
  BLASTS_VIEW_SMS: 'blasts.view_sms',
  BLASTS_SEND_SMS: 'blasts.send_sms',
  BLASTS_EXPORT_MAILCHIMP: 'blasts.export_mailchimp',

  // Payouts
  PAYOUTS_VIEW_BALANCE: 'payouts.view_balance',
  PAYOUTS_VIEW_PAYOUTS: 'payouts.view_payouts',
  PAYOUTS_ADD_BANK: 'payouts.add_bank',
  PAYOUTS_VIEW_DISPUTES: 'payouts.view_disputes',
  PAYOUTS_VIEW_REFUNDS: 'payouts.view_refunds', // alias: refunds.view
  PAYOUTS_INITIATE: 'payouts.initiate',

  // Orders
  ORDERS_VIEW: 'orders.view',
  ORDERS_FILTER: 'orders.filter',
  ORDERS_SEARCH: 'orders.search',
  ORDERS_VIEW_DETAIL: 'orders.view_detail',
  ORDERS_RESEND_RECEIPT: 'orders.resend_receipt',
  ORDERS_REFUND: 'orders.refund',

  // Event management
  EVENT_EDIT: 'event.edit',
  EVENT_MANAGE_DOOR_SALES: 'event.manage_door_sales',
  EVENT_CHECKIN_ATTENDEES: 'event.checkin_attendees',
};

/** Flat list of every permission string — useful for validation or building a UI picker. */
export const ALL_PERMISSIONS = Object.values(PERMISSIONS);

/**
 * Predefined role templates.
 * These are not seeded globally (eventTeamRoles requires a teamId FK).
 * Use seed-event-team-roles.js to stamp these into a specific team,
 * or reference them in your service when creating a team for the first time.
 */
export const ROLE_TEMPLATES = {
  CO_ORGANIZER: {
    name: 'Co-Organizer',
    permissions: [
      PERMISSIONS.ANALYTICS_VIEW_SALES,
      PERMISSIONS.TEAMS_VIEW,
      PERMISSIONS.TEAMS_ADD,
      PERMISSIONS.TEAMS_EDIT_PERMISSIONS,
      PERMISSIONS.TEAMS_REMOVE,
      // excludes TEAMS_ADD_ADMINS intentionally
      PERMISSIONS.BLASTS_VIEW_SMS,
      PERMISSIONS.BLASTS_SEND_SMS,
      PERMISSIONS.BLASTS_EXPORT_MAILCHIMP,
      PERMISSIONS.PAYOUTS_VIEW_BALANCE,
      PERMISSIONS.PAYOUTS_VIEW_PAYOUTS,
      // excludes PAYOUTS_ADD_BANK intentionally
      PERMISSIONS.PAYOUTS_VIEW_DISPUTES,
      PERMISSIONS.PAYOUTS_VIEW_REFUNDS,
      // excludes PAYOUTS_INITIATE intentionally
      PERMISSIONS.ORDERS_VIEW,
      PERMISSIONS.ORDERS_FILTER,
      PERMISSIONS.ORDERS_SEARCH,
      PERMISSIONS.ORDERS_VIEW_DETAIL,
      PERMISSIONS.ORDERS_RESEND_RECEIPT,
      PERMISSIONS.ORDERS_REFUND,
      PERMISSIONS.EVENT_EDIT,
      PERMISSIONS.EVENT_MANAGE_DOOR_SALES,
      PERMISSIONS.EVENT_CHECKIN_ATTENDEES,
    ], // 21 of 24
  },

  CHECK_IN_STAFF: {
    name: 'Check-in Staff',
    permissions: [PERMISSIONS.EVENT_CHECKIN_ATTENDEES], // 1 of 24
  },

  MARKETING: {
    name: 'Marketing',
    permissions: [
      PERMISSIONS.ANALYTICS_VIEW_SALES,
      PERMISSIONS.BLASTS_VIEW_SMS,
      PERMISSIONS.BLASTS_SEND_SMS,
      PERMISSIONS.BLASTS_EXPORT_MAILCHIMP,
    ], // 4 of 24
  },

  DOOR_MANAGER: {
    name: 'Door Manager',
    permissions: [
      PERMISSIONS.ANALYTICS_VIEW_SALES,
      PERMISSIONS.ORDERS_VIEW,
      PERMISSIONS.ORDERS_FILTER,
      PERMISSIONS.ORDERS_SEARCH,
      PERMISSIONS.ORDERS_VIEW_DETAIL,
      PERMISSIONS.ORDERS_RESEND_RECEIPT,
      PERMISSIONS.PAYOUTS_VIEW_BALANCE,
      PERMISSIONS.PAYOUTS_VIEW_DISPUTES,
      PERMISSIONS.PAYOUTS_VIEW_REFUNDS,
      PERMISSIONS.EVENT_MANAGE_DOOR_SALES,
      PERMISSIONS.EVENT_CHECKIN_ATTENDEES,
      PERMISSIONS.TEAMS_VIEW,
      PERMISSIONS.BLASTS_VIEW_SMS,
      PERMISSIONS.ORDERS_REFUND,
    ], // 14 of 24
  },
};
