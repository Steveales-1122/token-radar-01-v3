// Token Radar v3 — entry program (Node 22, standard library only).
//
// Reads the sealed snapshot from /input/snapshot.json (or --input <file|dir>),
// prices every pre-token protocol with the empirical model in lib/model.ts,
// writes the ranked board to /output/board.json, writes the dashboard's data
// as /output/data.js, copies this repository's dashboard/ and screenshots/ to
// /output, and writes /output/dossier.json with the vendored make.fun library.
//
// Outside the grader's container, MAKEFUN_OUTPUT_DIR stands in for /output:
//   mkdir -p out && MAKEFUN_OUTPUT_DIR=out node main.ts --input ../input/snapshot.json
//
// The output directory itself is never removed: only its contents are cleared,
// because the grader mounts /output and removing the mount point fails the run.

import { copyFileSync, existsSync, mkdirSync, readFileSync, readdirSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { boardIssue, buildRadar, dataScript, parseSnapshot } from './lib/model.ts';
import { buildDossier } from './vendor/makefun-board.ts';

const here = fileURLToPath(new URL('.', import.meta.url));

const TEXT_MAX_BYTES = 65_536;
const SCREENSHOT_CAPS = { max: 4, max_bytes: 524_288 };

/** --name <value> out of the arguments, or the fallback. */
function arg(name: string, fallback: string): string {
  const at = process.argv.indexOf(`--${name}`);
  if (at >= 0 && at + 1 < process.argv.length) return process.argv[at + 1]!;
  const withEquals = process.argv.find((a) => a.startsWith(`--${name}=`));
  return withEquals === undefined ? fallback : withEquals.slice(name.length + 3);
}

const inputArg = arg('input', '/input');
const inputFile = inputArg.endsWith('.json') ? inputArg : join(inputArg, 'snapshot.json');
if (!existsSync(inputFile)) {
  process.stderr.write(`token radar: no snapshot at ${inputFile}: pass --input <snapshot.json|directory> or mount the sealed /input\n`);
  process.exit(2);
}
const out = arg('output', process.env.MAKEFUN_OUTPUT_DIR ?? '/output');

const snapshot = parseSnapshot(readFileSync(inputFile, 'utf8'));
const { board, radar } = buildRadar(snapshot);
const issue = boardIssue(board, snapshot);
if (issue !== null) {
  process.stderr.write(`token radar: the model wrote a board the gate refuses: ${issue}\n`);
  process.exit(1);
}

/** Clear the contents of `dir`, never the directory itself. */
function clearContents(dir: string): void {
  if (!existsSync(dir)) return;
  for (const e of readdirSync(dir)) rmSync(join(dir, e), { recursive: true, force: true });
}

/** Copy a directory tree of regular files into `to`, skipping dot-names. */
function copyTree(from: string, to: string): void {
  if (!existsSync(from)) return;
  mkdirSync(to, { recursive: true });
  for (const e of readdirSync(from, { withFileTypes: true })) {
    if (e.name.startsWith('.')) continue;
    const src = join(from, e.name);
    const dst = join(to, e.name);
    if (e.isDirectory()) copyTree(src, dst);
    else if (statSync(src).isFile()) copyFileSync(src, dst);
  }
}

mkdirSync(out, { recursive: true });
clearContents(out);
writeFileSync(join(out, 'board.json'), `${JSON.stringify({ rows: board })}\n`);
writeFileSync(join(out, 'data.js'), dataScript(radar));
copyTree(join(here, 'dashboard'), join(out, 'dashboard'));
copyTree(join(here, 'screenshots'), join(out, 'screenshots'));
writeFileSync(join(out, 'dossier.json'), buildDossier(out, { text_max_bytes: TEXT_MAX_BYTES, screenshots: SCREENSHOT_CAPS }));
process.stdout.write(`token radar v3: ${board.length} rows, watchlist ${radar.counts.watchlist}/${radar.counts.watchlist}, dossier written\n`);
