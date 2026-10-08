import { spawn } from 'node:child_process';
import { mkdtemp, readdir, mkdir, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { resolve, join } from 'node:path';
import { summarizeBrowserCoverage } from './browser-coverage.mjs';

const output = await mkdtemp(join(tmpdir(), 'fells-tests-'));
const configured = join(output, 'configured'), unconfigured = join(output, 'unconfigured');
const coverage = process.argv.includes('--coverage');
const coverageDirectory = join(output, 'coverage');
const project = process.cwd();
const run = (args, env = {}) => new Promise((resolve, reject) => {
  const child = spawn(process.execPath, args, { cwd: project, env: { ...process.env, ...env }, stdio: 'inherit' });
  child.on('error', reject);
  child.on('exit', (code, signal) => code === 0 ? resolve() : reject(new Error(`${args.join(' ')} failed (${signal || code})`)));
});
const tests = async directory => (await readdir(directory)).filter(name => name.endsWith('.test.mjs')).map(name => join(directory, name)).sort();

console.log('Each test run builds isolated configured and unconfigured output.');
console.log(`Temporary output: ${output}`);
let failed = false;
try {
  await run(['node_modules/astro/bin/astro.mjs', 'check']);
  await run(['node_modules/typescript/bin/tsc', '--noEmit', '--noUnusedLocals', '--noUnusedParameters']);
  await run(['node_modules/knip/bin/knip.js']);
  await run(['node_modules/knip/bin/knip.js', '--production', '--strict']);
  await run(['node_modules/astro/bin/astro.mjs', 'build', '--outDir', configured], { SUPPORT_PORTAL_PATH: 'fells-test-portal' });
  const unitArgs = ['--test', '--test-timeout=60000'];
  if (coverage) unitArgs.push('--experimental-test-coverage', '--test-coverage-exclude=tests/**', '--test-coverage-lines=95', '--test-coverage-branches=85', '--test-coverage-functions=85');
  await run([...unitArgs, ...await tests('tests')]);
  if (coverage) await mkdir(coverageDirectory);
  // Run both build matrices even when a regression fails so a missing route cannot mask widget failures.
  try {
    await run(['--test', '--test-concurrency=1', '--test-timeout=60000', ...await tests('tests/browser')], { TEST_DIST_DIR: configured, TEST_REQUIRE_SUPPORT_PORTAL: '1', ...(coverage ? { TEST_BROWSER_COVERAGE_DIR: coverageDirectory } : {}) });
  } catch (error) { console.error(error.message); failed = true; }
  if (coverage) {
    const reports = resolve('reports');
    await mkdir(reports, { recursive: true });
    try {
      await summarizeBrowserCoverage(configured, coverageDirectory, join(reports, 'browser-coverage.json'), Number(process.env.BROWSER_COVERAGE_MIN?.trim() || 70));
    } catch (error) { console.error(error.message); failed = true; }
  }
  await run(['node_modules/astro/bin/astro.mjs', 'build', '--outDir', unconfigured], { SUPPORT_PORTAL_PATH: '' });
  try {
    await run(['--test', '--test-concurrency=1', '--test-timeout=60000', '--test-name-pattern=public customer widget', 'tests/browser/support-widget.test.mjs'], { TEST_DIST_DIR: unconfigured, TEST_REQUIRE_SUPPORT_PORTAL: '0', ...(coverage ? { TEST_BROWSER_COVERAGE_DIR: '' } : {}) });
  } catch (error) { console.error(error.message); failed = true; }
  if (failed) throw new Error('Frontend regression tests failed');
} catch (error) {
  console.error(error.message);
  process.exitCode = 1;
} finally {
  if (process.env.TEST_KEEP_BUILD === '1' || process.exitCode) console.log(`Build output retained: ${output}`);
  else await rm(output, { recursive: true, force: true });
}
