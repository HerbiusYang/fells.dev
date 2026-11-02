/** Recorded counters only. Legacy writes are separate; native OpenAI 30m/12h
 * writes are already included in input. Anthropic 1h remains a subset of writes.
 */
const count = (value: unknown): number | null => typeof value === "number" && Number.isSafeInteger(value) && value >= 0 ? value : null;
type TokenPart = "input" | "cacheRead" | "cacheWrite5m" | "cacheWrite1h" | "cacheWriteLegacy" | "cacheWrite30m" | "cacheWrite12h" | "output";
export function inspectRequestTokens(row: Record<string, unknown>) {
  const input = count(row.tokens_in ?? row.input_tokens), output = count(row.tokens_out ?? row.output_tokens);
  const cacheRead = count(row.tokens_cache_r), writes = count(row.tokens_cache_w);
  // Historical rows omit zero-valued optional counters.
  const cacheWrite1h = count(row.tokens_cache_w1h === undefined ? 0 : row.tokens_cache_w1h);
  const cacheWrite30m = count(row.tokens_cache_w30m === undefined ? 0 : row.tokens_cache_w30m);
  const cacheWrite12h = count(row.tokens_cache_w12h === undefined ? 0 : row.tokens_cache_w12h);
  const openai = row.protocol === "openai";
  const includesCache = openai || row.protocol === "gemini";
  const knownProtocol = includesCache || row.protocol === "anthropic";
  const cachedInput = cacheRead !== null && cacheWrite30m !== null && cacheWrite12h !== null ? cacheRead + cacheWrite30m + cacheWrite12h : null;
  const valid = knownProtocol && input !== null && output !== null && cacheRead !== null && writes !== null && cacheWrite1h !== null && cacheWrite1h <= writes && cacheWrite30m !== null && cacheWrite12h !== null && cachedInput !== null && Number.isSafeInteger(cachedInput) && (openai || cacheWrite30m === 0 && cacheWrite12h === 0) && (!includesCache || cachedInput <= input);
  const parts: { key: TokenPart; tokens: number }[] = valid ? [
    { key: "input", tokens: input - (includesCache ? cachedInput : 0) },
    { key: "cacheRead", tokens: cacheRead },
    ...(openai ? [
      // Converted historical OpenAI logs may contain separate legacy writes.
      ...(writes > 0 ? [{ key: "cacheWriteLegacy" as const, tokens: writes }] : []),
      { key: "cacheWrite30m" as const, tokens: cacheWrite30m },
      { key: "cacheWrite12h" as const, tokens: cacheWrite12h },
    ] : [
      { key: "cacheWrite5m" as const, tokens: writes - cacheWrite1h },
      { key: "cacheWrite1h" as const, tokens: cacheWrite1h },
    ]),
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
