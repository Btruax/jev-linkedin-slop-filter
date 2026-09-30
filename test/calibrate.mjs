// Runs the labelled samples through Jev with the exact questions in
// server/jev.js and shows what each post would get: show, stamp or kill.
//
//   npm run calibrate                 # both platforms, live calls
//   npm run calibrate -- x            # one platform
//   npm run calibrate -- x --cached   # re-apply thresholds to saved answers, free
//
// Raw answers are saved to test/results/ so a threshold change can be
// checked without paying for the same judgments again. Change a question's
// wording and the saved answers are stale: run live again.

import { readFileSync, writeFileSync, mkdirSync, existsSync } from 'node:fs';
import { PLATFORMS, ask, decide } from '../server/jev.js';
import { prefilter } from '../server/prefilter.js';
import { loadApiKey } from '../server/env.js';

const args = process.argv.slice(2);
const cached = args.includes('--cached');
const only = args.find((a) => !a.startsWith('--'));
const names = only ? [only] : Object.keys(PLATFORMS);

const here = (path) => new URL(path, import.meta.url);
const SLOP_KINDS = new Set(['bait', 'ai', 'promo']);

const actionOf = (verdict) =>
  verdict.verdict !== 'hide' ? 'show' : verdict.kill ? 'KILL' : 'stamp';

let failed = false;

for (const name of names) {
  const platform = PLATFORMS[name];
  if (!platform) throw new Error(`Unknown platform: ${name}`);

  const samples = JSON.parse(readFileSync(here(`samples/${name}.json`), 'utf8'));
  const resultsPath = here(`results/${name}.json`);
  let answers;

  if (cached) {
    if (!existsSync(resultsPath)) throw new Error(`No saved answers for ${name}; run live first`);
    answers = JSON.parse(readFileSync(resultsPath, 'utf8'));
  } else {
    const key = loadApiKey();
    const started = Date.now();
    // Same fan-out the server uses: one request per post, all in flight.
    answers = await Promise.all(samples.map((s) => ask(platform, s.text, key)));
    const ms = Date.now() - started;
    mkdirSync(here('results/'), { recursive: true });
    writeFileSync(resultsPath, JSON.stringify(answers, null, 1) + '\n');
    console.log(`\n${name}: ${samples.length} posts judged in ${ms}ms (parallel)`);
  }

  const ids = platform.signals.map((s) => s.id);
  console.log(`\n== ${name} ==`);
  console.log(['KIND'.padEnd(10), ...ids.map((id) => id.replace('is_', '').slice(0, 9).padEnd(9)), 'JEV'.padEnd(6), 'RULE'.padEnd(6), 'TEXT'].join(' '));

  const tally = { slop: 0, caught: 0, killed: 0, genuine: 0, genuineStamped: 0, genuineKilled: 0 };

  samples.forEach((sample, i) => {
    const verdict = decide(platform, answers[i]);
    const rule = prefilter(sample.text, name);
    const action = actionOf(verdict);
    const ruleAction = rule ? actionOf(rule) : '-';

    // What the live server would actually do: a rule verdict short-circuits Jev.
    const final = rule ? ruleAction : action;
    if (SLOP_KINDS.has(sample.kind)) {
      tally.slop += 1;
      if (final !== 'show') tally.caught += 1;
      if (final === 'KILL') tally.killed += 1;
    }
    if (sample.kind === 'genuine') {
      tally.genuine += 1;
      if (final === 'stamp') tally.genuineStamped += 1;
      if (final === 'KILL') tally.genuineKilled += 1;
    }

    const scores = ids.map((id) => verdict.scores[id].toFixed(2).padEnd(9));
    const snippet = sample.text.replace(/\s+/g, ' ').slice(0, 48);
    console.log([sample.kind.padEnd(10), ...scores, action.padEnd(6), ruleAction.padEnd(6), snippet].join(' '));
  });

  console.log(
    `-- slop caught ${tally.caught}/${tally.slop}, killed ${tally.killed}/${tally.slop}` +
      ` | genuine stamped ${tally.genuineStamped}/${tally.genuine}, killed ${tally.genuineKilled}/${tally.genuine}`
  );
  // A killed genuine post is the one failure this tool must never ship with.
  if (tally.genuineKilled > 0) failed = true;
}

if (failed) {
  console.error('\nFAIL: a genuine post would be killed. Raise that signal\'s kill threshold.');
  process.exit(1);
}
