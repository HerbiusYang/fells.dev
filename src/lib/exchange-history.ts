const SOURCE_URL = "https://www.ecb.europa.eu/stats/eurofxref/eurofxref-hist-90d.xml";
export interface ExchangeHistory {
  source: "ECB"; source_url: string; days: number; as_of: string;
  fetched_at: string; fresh_until: string; stale: boolean; fee_bps: 10;
  points: { date: string; reference_rate: string; exchange_rate: string }[];
}

const calendarDate = (value: unknown): value is string => typeof value === "string"
  && /^\d{4}-\d{2}-\d{2}$/.test(value) && Number.isFinite(Date.parse(value))
  && new Date(value).toISOString().slice(0, 10) === value;
const timestamp = (value: unknown): value is string => typeof value === "string" && value.length <= 48
  && /^\d{4}-\d{2}-\d{2}T(?:[01]\d|2[0-3]):[0-5]\d:[0-5]\d(?:\.\d+)?(?:Z|[+-](?:[01]\d|2[0-3]):[0-5]\d)$/.test(value)
  && calendarDate(value.slice(0, 10)) && Number.isFinite(Date.parse(value));
const rate = (value: unknown): value is string => typeof value === "string"
  && /^\d{1,3}\.\d{8}$/.test(value) && Number(value) >= 1 && Number(value) <= 101;

// Historical display data never authorizes or prices an exchange. The server's
// short-lived quote remains the only source for the actual financial operation.
export function parseExchangeHistory(value: unknown, expectedDays = 30): ExchangeHistory {
  const v = value as Record<string, unknown> | null;
  if (![7, 30, 90].includes(expectedDays) || !v || typeof v !== "object" || Array.isArray(v)
    || v.source !== "ECB" || v.source_url !== SOURCE_URL || v.days !== expectedDays || v.fee_bps !== 10
    || !calendarDate(v.as_of) || !timestamp(v.fetched_at) || !timestamp(v.fresh_until) || typeof v.stale !== "boolean"
    || !Array.isArray(v.points) || !v.points.length || v.points.length > expectedDays) throw new Error("Invalid exchange-rate history");
  let previous = "";
  const points = v.points.map(raw => {
    const p = raw as Record<string, unknown> | null;
    if (!p || typeof p !== "object" || !calendarDate(p.date) || p.date <= previous || p.date > (v.as_of as string)
      || !rate(p.reference_rate) || !rate(p.exchange_rate)) throw new Error("Invalid exchange-rate history point");
    const reference = BigInt(p.reference_rate.replace(".", "")), exchange = BigInt(p.exchange_rate.replace(".", ""));
    const delta = exchange * 1000n - reference * 1001n;
    // Both displayed rates are independently rounded to eight decimal places.
    if (delta < -2001n || delta > 2001n) throw new Error("Invalid exchange-rate history fee");
    previous = p.date;
    return { date: p.date, reference_rate: p.reference_rate, exchange_rate: p.exchange_rate };
  });
  if (previous !== v.as_of) throw new Error("Invalid exchange-rate history publication date");
  return { source: "ECB", source_url: SOURCE_URL, days: expectedDays, as_of: v.as_of,
    fetched_at: v.fetched_at, fresh_until: v.fresh_until, stale: v.stale, fee_bps: 10, points };
}
