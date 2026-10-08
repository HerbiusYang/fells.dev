// Deployment-specific settings. Fill these in before launch.
export const site = {
  // POST {email} as JSON (e.g. Formspree, a Cloudflare Worker). Empty = mailto fallback.
  // Use the final endpoint URL: forms reject redirects rather than forward buyer data.
  waitlistEndpoint: "",
  // TODO(launch): hosted payment page (Stripe Payment Link / Lemon Squeezy checkout…).
  // {sku}, {period}, {amount}, {email}, {method} (alipay) and {code} are filled in by /checkout. Empty = payments not open yet:
  // the order is sent to the waitlist instead.
  checkoutUrl: "",
  // TODO(launch): shop links. Orders placed there are delivered as a CDK, redeemed at /checkout?mode=redeem.
  // Empty = the channel shows "shop opening soon".
  taobaoUrl: "",
  xianyuUrl: "",
  // POST {email, cdk} as JSON, with no redirect. Empty = redemption is not open yet (the email goes to the waitlist).
  redeemEndpoint: "",
  // TODO: confirm the real inbox.
  contactEmail: "hello@fells.dev",
  lodyRepo: "https://github.com/LodyAI/Lody",
};
