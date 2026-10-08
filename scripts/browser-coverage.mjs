import { readFile, readdir, writeFile } from 'node:fs/promises';
import { resolve, relative } from 'node:path';
import { createHash } from 'node:crypto';

const hash = value => createHash('sha256').update(value).digest('hex');

// V8 ranges are nested: a covered parent must not cover an uncalled function or
// untaken branch inside it. At each offset the innermost range supplies the count.
function executedRanges(functions) {
  const points = functions.flatMap(fn => fn.ranges).flatMap((range, id) => range.endOffset > range.startOffset ? [
    { offset: range.startOffset, start: true, id, range },
    { offset: range.endOffset, start: false, id, range },
  ] : []);
  points.sort((a, b) => a.offset - b.offset || Number(a.start) - Number(b.start) ||
    (a.start ? b.range.endOffset - a.range.endOffset || a.id - b.id : b.range.startOffset - a.range.startOffset || b.id - a.id));
  const active = [], ranges = [];
  let previous = 0;
  for (const point of points) {
    if (point.offset > previous && active.at(-1)?.range.count > 0) ranges.push({ start: previous, end: point.offset });
    if (point.start) active.push(point);
    else active.splice(active.findIndex(entry => entry.id === point.id), 1);
    previous = point.offset;
  }
  return ranges;
}

export async function summarizeBrowserCoverage(dist, directory, destination, minimum = 0) {
  if (!Number.isFinite(minimum) || minimum < 0 || minimum > 100) throw new Error('Browser coverage minimum must be a number between 0 and 100');
  const scripts = new Map();
  async function scan(path) {
    for (const entry of await readdir(path, { withFileTypes: true })) {
      const file = resolve(path, entry.name);
      if (entry.isDirectory()) { await scan(file); continue; }
      if (entry.name.endsWith('.js')) {
        const text = await readFile(file, 'utf8');
        scripts.set(hash(text), { file: relative(dist, file), length: text.length, ranges: [] });
      } else if (entry.name.endsWith('.html')) {
        const html = await readFile(file, 'utf8');
        for (const [, attributes, text] of html.matchAll(/<script\b([^>]*)>([\s\S]*?)<\/script>/gi)) {
          const type = attributes.match(/\btype\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s>]+))/i);
          const mime = (type?.[1] ?? type?.[2] ?? type?.[3] ?? '').trim().toLowerCase();
          if (!text.trim() || /\bsrc\s*=/i.test(attributes) || !['', 'module', 'text/javascript', 'application/javascript', 'text/ecmascript', 'application/ecmascript'].includes(mime)) continue;
          const key = hash(text);
          if (!scripts.has(key)) scripts.set(key, { file: relative(dist, file) + '#inline-' + key.slice(0, 8), length: text.length, ranges: [] });
        }
      }
    }
  }
  await scan(dist);
  let unattributedEntries = 0;
  for (const name of await readdir(directory)) {
    if (!name.endsWith('.json')) continue;
    for (const entry of JSON.parse(await readFile(resolve(directory, name), 'utf8'))) {
      if (!Array.isArray(entry.functions) || (entry.source !== undefined && typeof entry.source !== 'string')) throw new Error('Invalid Playwright V8 coverage entry');
      // Playwright may report a retired VM script after navigation without its
      // source. Keep the full denominator and assign it no executed coverage.
      if (entry.source === undefined) { unattributedEntries++; continue; }
      const script = scripts.get(hash(entry.source));
      if (script) script.ranges.push(...executedRanges(entry.functions));
    }
  }
  const files = [...scripts.values()].map(script => {
    let end = 0, covered = 0;
    for (const range of script.ranges.sort((a, b) => a.start - b.start || a.end - b.end)) {
      const start = Math.max(end, range.start), next = Math.min(script.length, range.end);
      if (next > start) covered += next - start;
      end = Math.max(end, next);
    }
    return { file: script.file, total: script.length, covered, percent: script.length ? +(covered / script.length * 100).toFixed(2) : 100 };
  }).sort((a, b) => a.file.localeCompare(b.file));
  const total = files.reduce((sum, file) => sum + file.total, 0), covered = files.reduce((sum, file) => sum + file.covered, 0);
  const percent = total ? covered / total * 100 : 0;
  const report = { metric: 'Executed UTF-16 ranges in all unique built JavaScript assets and inline scripts; not source branch coverage', total, covered, percent: +percent.toFixed(2), minimum, unattributedEntries, files };
  await writeFile(destination, JSON.stringify(report, null, 2) + '\n');
  console.log(`Browser JavaScript execution coverage: ${report.percent}% (${files.length} unique scripts); report: ${destination}`);
  if (percent < minimum) throw new Error(`Browser execution coverage ${report.percent}% is below ${minimum}%`);
  return report;
}
