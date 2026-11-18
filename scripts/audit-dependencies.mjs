import { spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { existsSync, readFileSync, realpathSync } from 'node:fs';
import { createRequire } from 'node:module';
import { dirname, join } from 'node:path';
import { pathToFileURL } from 'node:url';

// npm audits registry versions. pnpm applies these local patches after unpacking.
// Retire this check and the two patches when a fixed upstream release is available.
const advisoryId = 'GHSA-fc5q-39xc-vjpf';
const parserHashes = new Map([
  ['2.3.2', '5583c5f70a0d7da4c7a8b5de29aced944ce1890eb287ed8147e45085113186f8'],
  ['4.0.7', '883448805a02511d0c4faf175350efe6f6e6cca923e16e9bfb5dfcdc15ed0b52'],
]);

// Resolve each dependency edge, including packages that do not export their manifest.
function installedPackage(root, auditPath) {
  const [project, ...names] = auditPath.split('>');
  if (project !== '.' || names.at(-1) !== 'picomatch') throw new Error('Unexpected picomatch audit path');
  let directory = root;
  for (const name of names) {
    if (!/^(?:@[a-z0-9_-][\w.-]*\/)?[a-z0-9_-][\w.-]*$/i.test(name)) throw new Error('Invalid package name in audit path');
    const search = createRequire(join(directory, 'package.json')).resolve.paths(name);
    const manifest = search?.map(base => join(base, name, 'package.json')).find(existsSync);
    if (!manifest) throw new Error('Missing installed dependency on ' + auditPath);
    directory = dirname(realpathSync(manifest));
  }
  return directory;
}

export function verifiedBackport(report, root = process.cwd()) {
  const advisories = Object.values(report?.advisories ?? {});
  if (advisories.length !== 1) return false;
  const [advisory] = advisories;
  if (advisory.github_advisory_id !== advisoryId || advisory.module_name !== 'picomatch' || advisory.severity !== 'high') return false;
  if (!Array.isArray(advisory.findings) || !advisory.findings.length) return false;

  return advisory.findings.every(({ version, paths }) => {
    if (!parserHashes.has(version) || !Array.isArray(paths) || !paths.length) return false;
    return paths.every(path => {
      const dir = installedPackage(root, path);
      const pkg = JSON.parse(readFileSync(join(dir, 'package.json'), 'utf8'));
      const digest = createHash('sha256').update(readFileSync(join(dir, 'lib/parse.js'))).digest('hex');
      return pkg.name === 'picomatch' && pkg.version === version && digest === parserHashes.get(version);
    });
  });
}

if (process.argv[1] && pathToFileURL(process.argv[1]).href === import.meta.url) {
  const audit = spawnSync('pnpm', ['audit', '--audit-level=high', '--json'], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'inherit'] });
  if (audit.error) throw audit.error;
  process.stdout.write(audit.stdout);
  if (audit.status === 1 && verifiedBackport(JSON.parse(audit.stdout))) {
    console.log(advisoryId + ': verified the patched parser at every reported dependency path.');
  } else {
    process.exitCode = audit.status ?? 1;
  }
}
