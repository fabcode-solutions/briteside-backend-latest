/**
 * Shared Briteside email chrome.
 * Every outbound email (auth, bookings, events, groups, payments,
 * subscriptions, moderation, notifications, sessions) renders through this
 * module so the header, footer, colors, and buttons stay identical.
 */

export const FRONTEND_URL = process.env.FRONTEND_URL || 'https://www.briteside.app';
export const BRAND_COLOR = '#00D16E';
export const BRAND_NAME = 'Briteside';
export const LOGO_URL = `${FRONTEND_URL}/assets/logo/logo.png`;
const LOGO_HEIGHT = 36;

export const header = `
  <div style="background-color: #F0FDF4; padding: 24px; text-align: center;">
    <img
      src="${LOGO_URL}"
      alt="${BRAND_NAME}"
      height="${LOGO_HEIGHT}"
      style="height: ${LOGO_HEIGHT}px; width: auto; display: inline-block; border: 0;"
    />
  </div>`;

export const footer = (text = `${BRAND_NAME} · <a href="${FRONTEND_URL}" style="color: ${BRAND_COLOR}; text-decoration: none;">briteside.app</a>`) => `
  <div style="background: #f5f5f5; padding: 16px 40px; text-align: center;">
    <p style="color: #999; font-size: 12px; margin: 0; line-height: 1.6;">
      ${text}
    </p>
  </div>`;

/** Wraps body content with the shared header + footer. */
export const emailWrapper = (content, footerText) => `
<div style="font-family: 'Segoe UI', Arial, sans-serif; max-width: 600px; margin: 0 auto; background: #ffffff;">
  ${header}
  <div style="padding: 32px 40px;">
    ${content}
  </div>
  ${footer(footerText)}
</div>`;

export const ctaButton = (label, url = '#') => `
<a href="${url}" style="background-color: ${BRAND_COLOR}; color: #fff; padding: 14px 32px;
   text-decoration: none; border-radius: 8px; font-weight: 600; font-size: 15px; margin: 0 6px; display: inline-block;">
  ${label}
</a>`;

export const ctaRow = (...buttons) => `
<p style="text-align: center; margin: 28px 0;">
  ${buttons.join('')}
</p>`;

/** Labeled detail table with the brand-green left border (dates, order info, session info, etc). */
export const infoBox = rows => `
  <div style="background: #f8f9fa; border-left: 4px solid ${BRAND_COLOR}; padding: 20px 24px; border-radius: 0 8px 8px 0; margin: 20px 0;">
    <table style="width:100%; border-collapse: collapse;">
      ${rows
        .filter(Boolean)
        .map(
          ([label, value]) =>
            `<tr><td style="padding: 6px 0; color: #888; font-size: 13px; width: 150px; vertical-align: top;">${label}</td><td style="padding: 6px 0; font-weight: 600; color: #333;">${value}</td></tr>`
        )
        .join('')}
    </table>
  </div>`;

const CALLOUT_STYLES = {
  success: { bg: '#e8f5e9', border: BRAND_COLOR },
  warning: { bg: '#fff8e1', border: '#f0ad4e' },
  danger: { bg: '#fff3f3', border: '#e53e3e' },
  neutral: { bg: '#f8f9fa', border: BRAND_COLOR },
};

/** Callout block for refund notes, policy warnings, quoted messages, etc. */
export const calloutBox = (html, variant = 'neutral') => {
  const { bg, border } = CALLOUT_STYLES[variant] || CALLOUT_STYLES.neutral;
  return `<div style="background: ${bg}; border-left: 4px solid ${border}; border-radius: 0 8px 8px 0; padding: 16px 20px; margin: 16px 0;">${html}</div>`;
};
