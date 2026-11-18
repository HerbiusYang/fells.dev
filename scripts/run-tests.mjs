import { spawnSync } from 'node:child_process';
import { availableParallelism } from 'node:os';

const [suite, ...args] = process.argv.slice(2);
if (suite !== 'unit' && suite !== 'browser') throw new Error('Expected unit or browser suite');
const browser = suite === 'browser';
const override = process.env.FELLS_TEST_WORKERS;
if (override !== undefined && (!/^[1-9]\d*$/.test(override) || !Number.isSafeInteger(Number(override)))) {
  throw new Error('FELLS_TEST_WORKERS must be a positive integer');
}

// Each Chromium instance starts several processes. Budget CPU and memory per
// test file so large builders can use more workers than small CI runners.
const cpuWorkers = Math.floor(availableParallelism() / (browser ? 6 : 2));
const memoryWorkers = Math.floor(process.availableMemory() / ((browser ? 2 : 0.5) * 1024 ** 3));
let workers = override === undefined ? Math.max(1, Math.min(cpuWorkers, memoryWorkers)) : Number(override);

// Live suites can share seeded accounts, a database and an operator session.
// Their enable flags end in _LIVE or _TEST. An explicit browser base can also
// direct multiple files at a single server.
if (browser && (process.env.FELLS_BROWSER_BASE || Object.entries(process.env).some(
  ([name, value]) => value === '1' && /^FELLS_.*_(LIVE|TEST)$/.test(name),
))) workers = 1;

console.error(`Running ${suite} tests with up to ${workers} file workers`);
// Append the suite glob after Node's test options so pnpm callers can filter
// by name. The build-matrix runner and direct callers can pass specific files.
const defaultFiles = args.some(arg => !arg.startsWith('-') && arg.endsWith('.test.mjs'))
  ? [] : [browser ? 'tests/browser/*.test.mjs' : 'tests/*.test.mjs'];
// With a name filter, Node can leave a fixture handle open in a file with
// zero matching tests. Exit its worker once the filtered tests have finished.
const nameFilter = args.some(arg => arg === '--test-name-pattern' || arg.startsWith('--test-name-pattern='));
const nodeArgs = ['--test', `--test-concurrency=${workers}`];
if (browser && nameFilter) nodeArgs.push('--test-force-exit');
const result = spawnSync(process.execPath, [...nodeArgs, ...args, ...defaultFiles], { stdio: 'inherit' });
if (result.error) throw result.error;
if (result.signal) process.kill(process.pid, result.signal);
else process.exitCode = result.status;
