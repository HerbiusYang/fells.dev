# fells.dev

Marketing site for Fells: Claude at a discount (Token Plan and group buy), and an
always-on cloud workspace for coding agents built on the open-source
[Lody](https://github.com/LodyAI/Lody) (Apache-2.0).

```bash
pnpm install
pnpm dev       # http://localhost:4321  (/ = English; /zh/ /zh-hant/ /ja/ /ko/ /es/)
pnpm build     # astro check + static build to dist/
```

## Where things live

| What | File |
| --- | --- |
| Landing copy, 6 languages | `src/i18n/{en,zh,zh-hant,ja,ko,es}.ts` (same shape, type-checked) |
| Inner-page copy, 6 languages | `src/i18n/pages/*.ts` (`PagesDict`) |
| Inner pages | `src/components/pages/*Page.astro`, routes in `src/pages/` and `src/pages/[lang]/` |
| Marketplace channels | `channels` in `src/data/catalog.ts` |
| Token Plan prices and quotas, group-buy seats, CNY/USD rate, pay-as-you-go table | `src/data/catalog.ts` |
| Waitlist, payment page, shop links, CDK redemption endpoint, contact email | `src/site.ts` |
| Section order | `src/components/Landing.astro` |
| Design tokens (colors, radius, fonts) | `src/styles/global.css` |
| AI, vendor and plugin icons | `src/data/icons.ts` (marks + colors), SVGs in `src/data/brand-icons.ts` |
| Spare page templates, not part of the build | `templates/synara/` (editorial landing), `templates/apple-launch/` (product-launch page for the Claude plans, with generated images in `assets/`) |

Page sections, top to bottom: promo bar → nav → hero (agent card deck +
composer; phones get the three prices instead of the deck) → agent marquee → what is Fells →
Token Plan (trial pack, 1500, 3500) → group buy (拼团: seats of a Claude Max 20×, Token Plan vs
group buy, coming-soon products, assurances) → "Is this really Claude?" → pay-as-you-go table
(coming soon) + marketplace → Developer API → clients → workspace mock → features →
surfaces → security → FAQ → referral → blog → waitlist CTA → footer.

Inner pages: `/market`, `/developer-api`, `/workspace`, `/agents`,
`/agents/{codex,claude-code,grok-build,opencode,kimi}`, `/security`, `/faq`, `/blog`,
plus `/app/start` (sign up / log in; no backend yet, only the email goes to the waitlist) and
`/checkout` (purchase entry: `?plan=trial|1500|3500` for Token Plan, `?mode=group&seat=g5` for
group buy, `?mode=redeem` to redeem a CDK), each in all 6 languages. Use `link(t, "market")` for locale-aware internal links.

`/app` is the signed-in console prototype (front end only), modeled on the agent.space
console: onboarding, workspace switcher and example project, new chat with the agent picker,
chats, files, canvas, members, plugins, sites, scheduled tasks, workspace settings (5 tabs),
user settings, API keys, marketplace and plans & credits, plus top-up, subscribe, invite,
changelog and help dialogs. Views are hash routes (`/app#/billing/credits`). Rendering lives in
`src/scripts/app.ts`, copy in `src/i18n/app/*.ts`, data in `src/data/app.ts`. State is kept in
localStorage only: nothing is charged, uploaded or run. Top-up hands off to `/checkout`.

Changes from agent.space: sidebar items say why they're unavailable without a workspace
(instead of doing nothing); the model picker is grouped by maker, searchable, priced and newest
models only; ⌘K command palette; a spending guard (monthly limit, alert, pause); the API page shows
key creation and quick-start snippets instead of a hard gate; workspace export; preferences and
notification settings; light/dark/system theme; mobile drawer; onboarding answers preselect the
agent; top-up shows the balance after the payment.

### Prices and what is on sale

Two products are on sale: **Claude Token Plan** (a monthly quota in US dollars at official API
list prices, sold in CNY) and **group buy** (seats of one official Claude Max 20×, each with a
share of every 5-hour window and of the weekly limit). Everything else is marked "coming soon".

- Every price, quota and discount on the site is computed from `tokenPlans`, `groupSeats` and
  `FX` (CNY per USD, 7) in `src/data/catalog.ts`. Copy uses placeholders (`{pct}`, `{zhe}`,
  `{trial}`, `{tp}`, `{gp}` …) that `deal()` in `src/i18n/index.ts` fills in, so headlines never
  drift from the cards. Change a price in the catalog and the whole site follows.
- Three ways to buy: Alipay (`checkoutUrl`), the Taobao shop (`taobaoUrl`) and the Xianyu shop
  (`xianyuUrl`). Shop orders are delivered as a CDK, redeemed at `/checkout?mode=redeem`
  (`redeemEndpoint`, POST `{email, cdk}`). While a setting is empty, that step records the
  email on the waitlist and tells the visitor it opens soon.
- Accessibility floor: text is 12px or larger outside the miniature product mock-ups, `--dim` is
  4.5:1 or better on every surface, controls are at least 44px tall on touch screens, and arrow
  keys move between tabs.

No canvas or WebGL: every effect is CSS transforms/gradients, so the page stays
light. Motion respects `prefers-reduced-motion`.

## Before launch

- [ ] Group-buy seat sizes and prices in `src/data/catalog.ts` are placeholders. Set them, then set
      `groupPricePending = false` to drop the "example price" tag and show the discount.
- [ ] Confirm `trialDays` (how long the trial quota stays valid) and the rule for using quota past
      the guaranteed amount (`plans.rule` in the dictionaries).
- [ ] Set `taobaoUrl`, `xianyuUrl` and `redeemEndpoint` in `src/site.ts`.
- [ ] Checkout asks buyers to agree to the Terms and the Privacy Policy: write and link both pages.
- [ ] The claims in "Is this really Claude?" (original models, nothing retained, no 5-hour window
      on Token Plan) must match how the quota is actually supplied. Check them before launch.
- [ ] `/market`, `/developer-api` and the `/app` billing views still describe the earlier USD plan
      tiers and credits; bring them in line with Token Plan and group buy.
- [ ] The earlier USD plan tiers in `src/data/catalog.ts` copy the agent.space template (Oct 2026).
- [ ] Set `waitlistEndpoint` and confirm `contactEmail` in `src/site.ts`.
- [ ] Real API base URLs in `src/components/Api.astro` (`api.fells.dev` is a placeholder).
- [ ] Gemini 4 Argon and Grok 4.7 prices are placeholders; marketplace channel prices/metrics copy agent.space.
- [ ] Set `checkoutUrl` in `src/site.ts` (Alipay payment page). Until then `/checkout` sends the order to the waitlist.
- [ ] `/app/start` is static: wire it to real auth before launch.
- [ ] `/app` runs on localStorage: connect it to Lody (workspaces, chats, files, cloud computer), real API keys and billing.
- [ ] Blog posts are titles only (marked "coming soon"); write them or hide the page.
- [ ] Blog links, referral amounts (`Referral.astro`), app download links.
- [ ] Legal review of group buy: consumer plans such as Claude Pro/Max and
      ChatGPT Pro generally forbid account sharing and resale; check each
      provider's terms before selling seats.
- [ ] Keep the Lody Apache-2.0 attribution (footer + FAQ) and its NOTICE in the app.
- [ ] Brand icons come from LobeHub Icons (`@lobehub/icons-static-svg`, MIT) and Simple Icons
      (CC0); the logos remain their owners' trademarks. Check each vendor's brand guidelines
      before launch.
