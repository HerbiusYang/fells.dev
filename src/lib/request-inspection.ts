/** Measured-only port of upstream console observability (raydocs/fells.dev#13).
 * Request logs do not contain prompt sections, TTFT, route scores or prices.
 * Missing counters remain unavailable; cache-write 1h is a subset of writes.
 */
const count = (value: unknown): number | null => typeof value === "number" && Number.isSafeInteger(value) && value >= 0 ? value : null;
type TokenPart = "input" | "cacheRead" | "cacheWrite5m" | "cacheWrite1h" | "output";
export function inspectRequestTokens(row: Record<string, unknown>) {
  const input = count(row.tokens_in ?? row.input_tokens), output = count(row.tokens_out ?? row.output_tokens);
  const cacheRead = count(row.tokens_cache_r), writes = count(row.tokens_cache_w);
  // The server omits the zero-valued 1h subset in historical request rows.
  const cacheWrite1h = row.tokens_cache_w1h === undefined ? 0 : count(row.tokens_cache_w1h);
  const includesCache = row.protocol === "openai" || row.protocol === "gemini";
  const knownProtocol = includesCache || row.protocol === "anthropic";
  const valid = knownProtocol && input !== null && output !== null && cacheRead !== null && writes !== null && cacheWrite1h !== null && cacheWrite1h <= writes && (!includesCache || cacheRead <= input);
  const parts: { key: TokenPart; tokens: number }[] = valid ? [
    { key: "input", tokens: input - (includesCache ? cacheRead : 0) },
    { key: "cacheRead", tokens: cacheRead },
    { key: "cacheWrite5m", tokens: writes - cacheWrite1h },
    { key: "cacheWrite1h", tokens: cacheWrite1h },
    { key: "output", tokens: output },
  ] : [];
  const sum = parts.reduce((total, part) => total + part.tokens, 0);
  const total = valid && Number.isSafeInteger(sum) ? sum : null;
  return { total, parts: total === null ? [] : parts };
}

/** Total request duration, never an inferred time to first token. */
export function inspectRequestLatency(rows: Record<string, unknown>[]) {
  const samples = rows.map(row => count(row.latency_ms)).filter((value): value is number => value !== null).sort((a,b) => a-b);
  const buckets = [0,0,0,0,0];
  for (const ms of samples) buckets[ms < 500 ? 0 : ms < 1000 ? 1 : ms < 2000 ? 2 : ms < 5000 ? 3 : 4]++;
  const percentile = (fraction: number) => samples.length ? samples[Math.ceil(samples.length * fraction)-1] : null;
  return { count: samples.length, p50: percentile(.5), p95: percentile(.95), buckets };
}
