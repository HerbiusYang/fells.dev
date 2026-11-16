import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { lstatSync, readFileSync, readlinkSync, writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { join } from 'node:path';

export function buildSourceIdentity(root) {
  const git = (...args) => execFileSync('git', args, { cwd: root, encoding: 'utf8' }).trim();
  const hash = createHash('sha256');
  const files = execFileSync('git', ['ls-files', '-z', '--cached', '--others', '--exclude-standard'], { cwd: root, encoding: 'utf8' }).split('\0').filter(Boolean).sort((left, right) => Buffer.compare(Buffer.from(left), Buffer.from(right)));
  for (const name of files) {
    const path = join(root, name);
    // Deleted tracked files still participate in the source identity.
    let bytes;
    try { bytes = lstatSync(path).isSymbolicLink() ? Buffer.from(readlinkSync(path)) : readFileSync(path); }
    catch (failure) { if (failure.code !== 'ENOENT') throw failure; bytes = Buffer.from('<deleted>'); }
    hash.update(`${name}\0${bytes.length}\0`); hash.update(bytes);
  }
  return {
    schemaVersion: 1, sourceCommit: git('rev-parse', 'HEAD'), sourceTree: git('rev-parse', 'HEAD^{tree}'),
    sourceHash: hash.digest('hex'), sourceDirty: git('status', '--porcelain', '--untracked-files=normal') !== '',
    dependencyLockSha256: createHash('sha256').update(readFileSync(join(root, 'pnpm-lock.yaml'))).digest('hex'),
  };
}

/** Bind output to the inputs present for the entire build, before packaging. */
export function buildProvenance() {
  let root, identity;
  return {
    name: 'fells-build-provenance',
    hooks: {
      'astro:config:done': ({ config }) => { root = fileURLToPath(config.root); },
      'astro:build:start': () => { identity = buildSourceIdentity(root); },
      'astro:build:done': ({ dir }) => {
        if (JSON.stringify(identity) !== JSON.stringify(buildSourceIdentity(root))) throw new Error('Source changed during build. Rebuild the exact source before packaging.');
        writeFileSync(new URL('frontend-source.json', dir), JSON.stringify(identity, null, 2) + '\n');
      },
    },
  };
}
