import type { ReferralWords } from "../i18n/referral";

interface InviteDialogInput {
  referral: Record<string, unknown>;
  rebates: Record<string, unknown>;
  href: string;
  copiedMsg: string;
  notOffered: string;
  words: ReferralWords;
  cny: (yuan: number) => string;
  dfmt: (ms: number) => string;
  esc: (value: unknown) => string;
}

export function rebateCreditRef(key: string): string {
  return `rebate-credit:${key}`;
}

function asNumber(value: unknown, fallback = 0): number {
  const n = Number(value);
  return Number.isFinite(n) ? n : fallback;
}

function asObject(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value) ? (value as Record<string, unknown>) : {};
}

export function renderInviteDialogBody(input: InviteDialogInput): string {
  const { referral: r, rebates: rb, href, copiedMsg, notOffered, words, cny, dfmt, esc } = input;
  const stat = asObject(r.stat);
  const summary = asObject(rb.summary);
  const code = typeof stat.code === "string" ? stat.code : "";
  const invited = asNumber(stat.invited);
  const converted = asNumber(stat.converted);
  const rewards = asNumber(stat.rewards);
  const pendingCount = asNumber(stat.pending);

  const payable = asNumber(summary.payable_micro);
  const held = asNumber(summary.held_micro);
  const pendingBonus = asNumber(summary.pending_bonus_micro);
  const accrued = asNumber(summary.accrued_micro);
  const credited = asNumber(summary.credited_micro);
  const paid = asNumber(summary.paid_micro);

  const percents = Array.isArray(rb.percents)
    ? rb.percents.map((v) => Number(v)).filter((v) => Number.isFinite(v) && v > 0)
    : [];
  const rebateActive = rb.active === true && percents.length > 0;
  const referralActive = r.active === true;

  const rewardTerms = typeof r.reward_terms === "string" && r.reward_terms.trim()
    ? r.reward_terms
    : typeof r.name === "string" ? r.name : "";
  const refereeTerms = typeof r.referee_reward_terms === "string" ? r.referee_reward_terms.trim() : "";
  const minTopupMicro = asNumber(r.bonus_min_topup_micro) || asNumber(r.min_topup_micro);

  const ratesText = rebateActive
    ? percents.map((p, i) => `${words.level.replace("{n}", String(i + 1))} ${p}%`).join(" / ")
    : "";

  const leadText = referralActive && rewardTerms
    ? rewardTerms
    : rebateActive
      ? `${words.ratesLabel} · ${ratesText}`
      : notOffered;

  const subTerms: string[] = [];
  if (referralActive && refereeTerms) subTerms.push(`<p>${esc(refereeTerms)}</p>`);
  if (referralActive && rebateActive) subTerms.push(`<p class="muted">${esc(words.ratesLabel)} · ${esc(ratesText)}</p>`);
  if (referralActive && minTopupMicro > 0) {
    subTerms.push(`<p class="muted">${esc(words.minTopup.replace("{amount}", cny(minTopupMicro / 1_000_000)))}</p>`);
  }

  const statBits = [`${words.invited} ${invited}`, `${words.converted} ${converted}`];
  if (rewards > 0) statBits.push(`${words.rewards} ${rewards}`);
  if (pendingCount > 0) statBits.push(`${words.pending} ${pendingCount}`);

  const team = Array.isArray(rb.team) ? rb.team.map((v) => asNumber(v)) : [];
  const teamText = team.some((n) => n > 0)
    ? `<p class="muted" data-referral-team>${esc(words.teamLabel)} · ${esc(team.map((n, i) => `${words.level.replace("{n}", String(i + 1))} ${n}`).join(" · "))}</p>`
    : "";

  const hasHold = rb.hold_days !== undefined && rb.hold_days !== null;
  const holdDays = asNumber(rb.hold_days);
  const hasWindow = rb.window_months !== undefined && rb.window_months !== null;
  const windowMonths = asNumber(rb.window_months);
  const ruleBits: string[] = [];
  if (hasHold) ruleBits.push(holdDays > 0 ? words.holdDays.replace("{days}", String(holdDays)) : words.holdInstant);
  if (hasWindow) ruleBits.push(windowMonths > 0 ? words.windowMonths.replace("{months}", String(windowMonths)) : words.windowUnlimited);
  const ruleLine = (ruleBits.length ? `${ruleBits.join(" · ")} · ` : "") + words.poolNote;

  const breakdownItems: string[] = [];
  if (held > 0) breakdownItems.push(`<span>${esc(words.held)} ${esc(cny(held / 1_000_000))}</span>`);
  if (pendingBonus > 0) breakdownItems.push(`<span>${esc(words.pendingBonus)} ${esc(cny(pendingBonus / 1_000_000))}</span>`);
  if (accrued > 0) breakdownItems.push(`<span>${esc(words.accrued)} ${esc(cny(accrued / 1_000_000))}</span>`);
  if (credited > 0) breakdownItems.push(`<span>${esc(words.credited)} ${esc(cny(credited / 1_000_000))}</span>`);
  if (paid > 0) breakdownItems.push(`<span>${esc(words.paid)} ${esc(cny(paid / 1_000_000))}</span>`);
  const breakdownHTML = breakdownItems.length
    ? `<p class="muted" data-rebate-breakdown>${breakdownItems.join(" · ")}</p>`
    : "";

  const pendingList = Array.isArray(r.pending_bonuses) ? r.pending_bonuses : [];
  const pendingHTML = pendingList.length
    ? `<div class="card pad stack" data-referral-pending><h3>${esc(words.pendingListTitle)}</h3><div class="card list">${pendingList.map((raw) => {
        const item = asObject(raw);
        const referee = typeof item.referee === "string" ? item.referee : "";
        const amount = asNumber(item.referrer_micro);
        const dueAt = asNumber(item.due_at);
        const dueText = dueAt > 0 ? words.dueOn.replace("{date}", dfmt(dueAt * 1000)) : "";
        return `<div><span class="grow">${esc(referee)}${dueText ? `<small>${esc(dueText)}</small>` : ""}</span><b>${esc(cny(amount / 1_000_000))}</b></div>`;
      }).join("")}</div></div>`
    : "";

  const entries = Array.isArray(rb.entries) ? rb.entries.slice(0, 10) : [];
  const entriesHTML = entries.length
    ? `<div class="card pad stack" data-rebate-entries><h3>${esc(words.historyTitle)}</h3><div class="card list">${entries.map((raw) => {
        const e = asObject(raw);
        const kindKey = String(e.kind ?? "") as keyof ReferralWords["kinds"];
        const kindLabel = words.kinds[kindKey] ?? String(e.kind ?? "");
        const level = asNumber(e.level);
        const referee = typeof e.referee === "string" ? e.referee : "";
        const createdAt = asNumber(e.created_at);
        const delta = asNumber(e.delta_micro);
        const detail = [level > 0 ? words.level.replace("{n}", String(level)) : "", referee, createdAt > 0 ? dfmt(createdAt * 1000) : ""].filter(Boolean).join(" · ");
        return `<div><span class="grow">${esc(kindLabel)}${detail ? `<small>${esc(detail)}</small>` : ""}</span><b>${delta >= 0 ? "+" : ""}${esc(cny(delta / 1_000_000))}</b></div>`;
      }).join("")}</div></div>`
    : "";

  const codeBlock = code
    ? `<div class="stack"><p class="muted">${esc(words.codeLabel)}</p><div class="codebox" data-referral-code><pre class="code mono">${esc(code)}</pre><button class="btn sm" data-act="copy" data-text="${esc(code)}" data-msg="${esc(copiedMsg)}">${esc(words.copyCode)}</button></div></div>`
    : "";

  return `<div class="body stack" data-invite-dialog>
    <p class="lead">${esc(leadText)}</p>
    ${subTerms.join("")}
    ${codeBlock}
    <div class="stack"><p class="muted">${esc(words.linkLabel)}</p><div class="codebox" data-referral-link><pre class="code">${esc(href)}</pre><button class="btn sm" data-act="copy" data-text="${esc(href)}" data-msg="${esc(copiedMsg)}">${esc(words.copyLink)}</button></div></div>
    <p class="muted" data-referral-stats>${esc(statBits.join(" · "))}</p>
    ${teamText}
    <div class="card pad stack">
      <h3>${esc(words.rebatesTitle)}</h3>
      <p class="muted">${esc(words.payable)}</p>
      <b data-rebate-payable>${esc(cny(payable / 1_000_000))}</b>
      ${breakdownHTML}
      <p class="muted">${esc(ruleLine)}</p>
      <button class="btn" data-act="rebate-credit" ${payable > 0 ? "" : "disabled"}>${esc(words.transferBtn)}</button>
    </div>
    ${pendingHTML}
    ${entriesHTML}
  </div>`;
}
