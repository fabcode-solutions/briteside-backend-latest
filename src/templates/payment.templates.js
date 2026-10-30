/**
 * Payment & Refund Email Templates
 * Covers: payment receipt, refund confirmation, paid message auto-refund
 */

import { header, footer, ctaButton, infoBox } from './emailLayout.js';

export const paymentTemplates = {
  // ── Payment Receipt ─────────────────────────────────────────────────────
  paymentReceipt: {
    id: 'payment-receipt',
    subject: () => 'Receipt for your purchase',
    html: ({
      user_name,
      receipt_number,
      purchase_date,
      item_name,
      quantity,
      unit_price,
      line_total,
      subtotal,
      service_fee,
      tax,
      amount,
      payment_method,
      card_last_four,
      billing_name,
      billing_address,
    }) => `
      <div style="font-family:Arial,sans-serif;max-width:600px;margin:0 auto;">
        ${header}
        <div style="padding:30px 20px;">
          <p>Hi ${user_name},</p>
          <h2 style="color:#333;">Thank you for your purchase! 💳</h2>
          <div style="background:#f8f9fa;border-left:4px solid #00D16E;border-radius:0 8px 8px 0;padding:20px 24px;margin:16px 0;font-size:14px;">
            <strong>Receipt #${receipt_number}</strong> &nbsp;|&nbsp; ${purchase_date}<br/><br/>
            <strong>Items:</strong><br/>
            ${item_name}<br/>
            Qty: ${quantity} × ${unit_price} = ${line_total}<br/><br/>
            <table style="width:100%;font-size:13px;">
              <tr><td>Subtotal</td><td style="text-align:right;">${subtotal}</td></tr>
              <tr><td>Service Fee</td><td style="text-align:right;">${service_fee}</td></tr>
              <tr><td>Tax</td><td style="text-align:right;">${tax}</td></tr>
              <tr style="font-weight:bold;border-top:1px solid #ddd;">
                <td style="padding-top:8px;">TOTAL</td>
                <td style="text-align:right;padding-top:8px;">${amount}</td>
              </tr>
            </table>
            <br/>
            <strong>Payment:</strong> ${payment_method} ending in ${card_last_four}<br/>
            <strong>Billing:</strong> ${billing_name}, ${billing_address}
          </div>
          <div style="text-align:center;margin:24px 0;">
            ${ctaButton('Download PDF Receipt')}
            ${ctaButton('View Order Details')}
          </div>
          <p>Questions about this charge? Contact our support team.<br/><strong>The Briteside Team</strong></p>
        </div>
        ${footer(`Receipt for transaction on ${purchase_date}.<br/><a href="#">View transaction history</a> | <a href="#">Contact support</a>`)}
      </div>`,
  },

  // ── Refund Confirmation ─────────────────────────────────────────────────
  refundConfirmation: {
    id: 'refund-confirmation',
    subject: () => 'Your refund has been processed',
    html: ({
      user_name,
      refund_reference,
      order_number,
      amount,
      refund_date,
      item_name,
      original_purchase_date,
      refund_reason,
      payment_method,
      card_last_four,
      original_amount,
      non_refundable_fees,
    }) => `
      <div style="font-family:Arial,sans-serif;max-width:600px;margin:0 auto;">
        ${header}
        <div style="padding:30px 20px;">
          <p>Hi ${user_name},</p>
          <h2 style="color:#00D16E;">Your refund has been processed! 💰</h2>
          ${infoBox([
            ['Refund Reference', refund_reference],
            ['Original Order', `#${order_number}`],
            ['Refund Amount', amount],
            ['Refund Date', refund_date],
          ])}
          <p><strong>Original Purchase:</strong> ${item_name}<br/>
          Purchased on: ${original_purchase_date}<br/>
          Reason: ${refund_reason}</p>
          <p>The refund has been sent to: <strong>${payment_method} ending in ${card_last_four}</strong></p>
          <p>Please allow <strong>5–10 business days</strong> for the funds to appear in your account.</p>
          <div style="background:#f8f8f8;border-radius:6px;padding:12px;margin:16px 0;font-size:13px;">
            <table style="width:100%;">
              <tr><td>Original Amount</td><td style="text-align:right;">${original_amount}</td></tr>
              <tr><td>Amount Refunded</td><td style="text-align:right;">${amount}</td></tr>
              <tr><td>Non-refundable Fees</td><td style="text-align:right;">${non_refundable_fees}</td></tr>
            </table>
          </div>
          <div style="text-align:center;margin:24px 0;">${ctaButton('View Refund Status')}</div>
          <p>Thank you for your patience!<br/><strong>The Briteside Team</strong></p>
        </div>
        ${footer(`Refund confirmation for order #${order_number}.<br/><a href="#">View transaction history</a> | <a href="#">Contact support</a>`)}
      </div>`,
  },

  // ── Paid Message Auto-Refund ────────────────────────────────────────────
  paidMessageRefund: {
    id: 'paid-message-refund',
    subject: ({ recipient_name }) => `Your paid message to ${recipient_name} has been refunded`,
    html: ({ user_name, recipient_name, refund_amount, message_date, refund_date }) => `
      <div style="font-family:Arial,sans-serif;max-width:600px;margin:0 auto;">
        ${header}
        <div style="padding:30px 20px;">
          <p>Hi ${user_name},</p>
          <h2 style="color:#333;">Paid Message Auto-Refunded 🔄</h2>
          <p>Your paid message was automatically refunded because <strong>${recipient_name}</strong> did not reply within 48 hours.</p>
          ${infoBox([
            ['Recipient', `💬 ${recipient_name}`],
            ['Refund Amount', `💰 $${refund_amount}`],
            ['Original Message Sent', `📅 ${message_date}`],
            ['Refund Processed', `🔄 ${refund_date}`],
          ])}
          <p>Your refund of <strong>$${refund_amount}</strong> will be returned to your original payment method.</p>
          <p style="font-size:13px;color:#666;">💡 <strong>Tip:</strong> Some creators receive many messages. Try sending your message at a different time, or check if the creator offers 1:1 video bookings for a guaranteed connection.</p>
          <div style="text-align:center;margin:24px 0;">
            ${ctaButton('Try Again')}
            ${ctaButton('Browse Talent')}
          </div>
          <p><strong>The Briteside Team</strong></p>
        </div>
        ${footer(`Refund for paid message sent on ${message_date}.<br/><a href="#">View messages</a> | <a href="#">Contact support</a>`)}
      </div>`,
  },
};
