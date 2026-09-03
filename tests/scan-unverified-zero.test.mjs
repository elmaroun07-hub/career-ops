// tests/scan-unverified-zero.test.mjs — what scan.mjs records for a target
// whose provider returned an empty jobs[].
//
// Each case drives a stub provider through the same ctx scan.mjs builds per
// company — makeHttpCtx(makeStatusObserver()) — against a local HTTP server,
// then asks scan's own classifyZeroResult() what that empty result means.
// Stubs rather than real providers because scan.mjs loads providers only from
// its own providers/ directory, and what is under test is the decision, not any
// one provider's parsing. No external network is involved.
import { pass, fail } from './helpers.mjs';
import http from 'node:http';
import { makeHttpCtx, makeStatusObserver } from '../providers/_http.mjs';
import { classifyZeroResult } from '../scan.mjs';

console.log('\nscan.mjs — an empty result is only "empty" when liveness was proven or never tested');

const server = http.createServer((req, res) => {
  res.setHeader('content-type', 'application/json');
  res.statusCode = req.url === '/board' ? 200 : 404;
  res.end(req.url === '/board' ? '{"jobs":[]}' : '{"error":"not found"}');
});
await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
const base = `http://127.0.0.1:${server.address().port}`;

async function classify(provider) {
  const observer = makeStatusObserver();
  const ctx = { ...makeHttpCtx(observer), sinceMs: null, includeUndated: true };
  const jobs = await provider.fetch({ name: 'Fixture Co' }, ctx);
  if (!Array.isArray(jobs) || jobs.length !== 0) throw new Error('stub must return []');
  return classifyZeroResult(observer);
}

try {
  // 1. Never touches ctx (the shape of local-parser and keyed plugin
  //    providers): no request was observed, so there is nothing to judge.
  const ignoresCtx = { id: 'stub-no-ctx', async fetch() { return []; } };
  const got1 = await classify(ignoresCtx);
  if (got1 === 'empty') pass('provider that ignores ctx and returns [] → empty');
  else fail(`provider that ignores ctx and returns [] → ${got1} (want empty)`);

  // 2. Calls ctx, swallows the 404, returns [] — the pattern #2379 removed
  //    from four providers. Liveness was tested and never proven.
  const swallows404 = {
    id: 'stub-swallow-404',
    async fetch(_entry, ctx) {
      try { await ctx.fetchJson(`${base}/gone`); } catch { /* swallowed */ }
      return [];
    },
  };
  const got2 = await classify(swallows404);
  if (got2 === 'unverified_zero') pass('provider that calls ctx, swallows a 404 and returns [] → unverified_zero');
  else fail(`provider that calls ctx, swallows a 404 and returns [] → ${got2} (want unverified_zero)`);

  // 3. Gets a 200 with no postings — a genuinely empty, reachable board.
  const empty200 = {
    id: 'stub-200-empty',
    async fetch(_entry, ctx) {
      const body = await ctx.fetchJson(`${base}/board`);
      return body.jobs;
    },
  };
  const got3 = await classify(empty200);
  if (got3 === 'empty') pass('provider that gets a 200 and returns [] → empty');
  else fail(`provider that gets a 200 and returns [] → ${got3} (want empty)`);
} catch (err) {
  fail(`unverified_zero classification threw: ${err.message}`);
} finally {
  await new Promise((resolve) => server.close(resolve));
}
