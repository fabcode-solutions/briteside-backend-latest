import Stripe from 'stripe';
import config from '../../config/config.js';
import { StripeConnectService } from '../stripeConnect.service.js';

// Briteside Plus nexus routing — TAX_STRATEGY.md §3.2/§3.3. NOT reviewed by a
// tax attorney/CPA; this is a best-effort implementation against Stripe's
// real Tax Registrations API (verified against the installed `stripe` SDK's
// type definitions, not guessed from memory).
//
// Stripe Checkout's `automatic_tax.liability` parameter lets a platform
// designate who is liable for tax on a Checkout Session it creates, without
// needing that session to be a direct/destination charge on the connected
// account:
//   - { type: 'self' }                      -> Briteside's own registrations/nexus
//   - { type: 'account', account: 'acct_x' } -> that connected account's registrations/nexus
// Whichever party is named, Stripe still only calculates nonzero tax for
// jurisdictions where THAT party actually holds an active registration — so
// picking the "wrong" liable party when neither has nexus in the buyer's
// actual state still correctly resolves to $0, never an invented rate. See
// TAX_STRATEGY.md §3.2: "Neither creator nor Briteside has nexus -> Stripe
// returns $0 tax."
//
// LIMITATION (documented, not silently papered over): this app's shop
// checkout doesn't collect the buyer's billing address before creating the
// Checkout Session (automatic_tax collects it live, during the hosted
// session). That means we can't check "does the chosen liable party have a
// registration in THIS SPECIFIC buyer's state" ahead of time — we can only
// decide, per order, "does the creator have nexus ANYWHERE" and prefer them
// if so (matching the priority order in TAX_STRATEGY.md §3.2: creator nexus
// is checked first). If the creator's nexus doesn't happen to cover the
// buyer's actual state, Stripe still correctly returns $0 for that
// transaction rather than overcollecting — so this ordering can undercollect
// relative to a perfect state-by-state check, but can never overcollect,
// which matches the "fail toward $0" instruction.

let stripe = null;
if (config.stripe?.secretKey) {
  stripe = new Stripe(config.stripe.secretKey);
}

export class PlusTaxLiabilityService {
  /**
   * @param {string|null} sellerUserId - the creator/seller's app user id.
   * @returns {Promise<{ liability: { type: 'self' } | { type: 'account', account: string } | null }>}
   *   `liability: null` means "don't enable automatic_tax at all" — used
   *   when we can't even check (Stripe not configured) or the connected
   *   account is missing, so checkout fails toward charging no tax rather
   *   than guessing.
   */
  static async resolveLiability(sellerUserId) {
    if (!stripe) return { liability: null };

    try {
      const creatorHasNexus = await this._accountHasActiveUsRegistration(sellerUserId);
      if (creatorHasNexus.account) {
        return { liability: { type: 'account', account: creatorHasNexus.account } };
      }

      const britesideHasNexus = await this._platformHasActiveUsRegistration();
      if (britesideHasNexus) {
        return { liability: { type: 'self' } };
      }

      // Neither party holds any active US registration at all — don't even
      // enable automatic_tax, so Stripe can't attempt a calculation against
      // an unconfigured Tax Settings default and surface a confusing error,
      // and so the buyer definitely isn't charged tax.
      return { liability: null };
    } catch (err) {
      // Tax Registration lookups are best-effort. Any failure here must fail
      // toward "don't collect tax" rather than letting a transient Stripe
      // API error block checkout, or — worse — silently defaulting to a
      // liability that ends up overcollecting.
      console.error('[PlusTax] liability resolution failed, disabling automatic_tax:', err.message);
      return { liability: null };
    }
  }

  /** @returns {Promise<{ account: string|null }>} the creator's connected account id if it holds at least one active US tax registration, else null. */
  static async _accountHasActiveUsRegistration(sellerUserId) {
    if (!sellerUserId) return { account: null };
    const connectAccount = await StripeConnectService.getForUser(sellerUserId).catch(() => null);
    if (!connectAccount?.stripeAccountId) return { account: null };

    const registrations = await stripe.tax.registrations.list(
      { status: 'active', limit: 10 },
      { stripeAccount: connectAccount.stripeAccountId }
    );
    const hasUsRegistration = registrations.data.some(r => r.country === 'US');
    return { account: hasUsRegistration ? connectAccount.stripeAccountId : null };
  }

  /** @returns {Promise<boolean>} whether Briteside's own platform account holds at least one active US tax registration. */
  static async _platformHasActiveUsRegistration() {
    const registrations = await stripe.tax.registrations.list({ status: 'active', limit: 10 });
    return registrations.data.some(r => r.country === 'US');
  }
}
