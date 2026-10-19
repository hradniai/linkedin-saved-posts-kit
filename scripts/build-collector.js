#!/usr/bin/env node
"use strict";

/*
 * Renders scripts/collect-in-page.js with the run's settings, so the agent never
 * hand-edits JavaScript.
 *
 *   node scripts/build-collector.js --folder <folder> [--images on|off] [--scan-posts N]
 *        [--window-days N] [--max-posts N] [--backfill] [--keep-raw] [--batch-seconds N] [--raw-in-temp]
 *        [--replaces-run <run id>]
 *
 * The first download reads the 50 most recently saved posts. Every later download passes the posts
 * seen in earlier runs (normalize.js knownListIds, at most 40 IDs) into the collector, which stops at
 * the first list page showing 3 of them in a row (SEEN_RUN_LENGTH; a lone re-saved post that moved to
 * the top does not stop it), after at most 7 scroll steps (80 posts). An explicit
 * --scan-posts replaces that rule with a fixed depth. normalize.js picks what to download (see its
 * header; window 60 days by default). --backfill, only on the user's explicit request, downloads
 * every scanned post not yet in the folder (scan default 500, no early stop).
 *
 * --keep-raw (the folder's AGENTS.md says to keep raw captures) is carried into normalize_argv.
 * --raw-in-temp (only when the MCP server refused to write into <folder>/.state/raw) puts the dumps
 * in the OS temp directory, which the server always allows; normalize moves what it keeps back into
 * the folder and removes the temp run directory. It is carried into normalize_argv. Pass the refused
 * build's run ID with --replaces-run: normalize then removes that run directory, which holds only
 * collector.js (other collector-only run directories are removed only when older than an hour, so a
 * concurrent fresh build is never touched).
 *
 * Refuses while a cooldown is active (a recent run was stopped by a login or security check).
 *
 * Creates <raw dir>/<run_id>/collector.js and prints one JSON line with run_id,
 * collector_path, hook_path, dump_path_for_batch_1, normalize_argv (an argument list),
 * normalize_command (quoted for POSIX shells: macOS, Linux, Git Bash) and
 * normalize_command_powershell (quoted for PowerShell).
 */

const fs = require("node:fs");
const path = require("node:path");
const { CaptureError, LATER_MAX_SCROLL_STEPS, LATER_SCAN_POSTS, SEEN_RUN_LENGTH, knownListIds, activeCooldown, asciiJson, cooldownMessage, ensureFolder, exitCodeForStatus, newRunId, parseArgs, resolveSettings } = require("./normalize.js");

const TEMPLATE = path.join(__dirname, "collect-in-page.js");
const HOOK = path.join(__dirname, "capture-hook.js");
const CONFIG_BLOCK = /\/\*@@CONFIG_START@@\*\/[\s\S]*?\/\*@@CONFIG_END@@\*\//;
/*
 * Dwell times of the collector, in milliseconds. After the list loads it waits like a person looking
 * at it; between scroll steps it waits a random, non-uniform time (mostly DWELL, sometimes up to
 * LONG_DWELL_MAX), never a constant interval.
 */
const DWELL = { initialDwellMinMs: 4000, initialDwellMaxMs: 7000, dwellMinMs: 2500, dwellMaxMs: 6000, longDwellChance: 0.15, longDwellMaxMs: 12000 };
const CHALLENGE_TEXTS = ["quick security check", "security verification", "verify you are human", "verify you're human", "let's confirm it's really you", "sign in to continue"];

function renderCollector(template, values) {
  if (!CONFIG_BLOCK.test(template)) throw new CaptureError("collect-in-page.js lost its CONFIG markers.");
  const json = JSON.stringify(values, null, 2).replace(/\n/g, "\n  ");
  return template.replace(CONFIG_BLOCK, () => `/*@@CONFIG_START@@*/${json}/*@@CONFIG_END@@*/`);
}

// POSIX shell single quoting: the only character that needs care inside '...' is ' itself.
function shellQuote(value) {
  const textValue = String(value);
  return /^[A-Za-z0-9_\/.,:=@%+-]+$/.test(textValue) ? textValue : `'${textValue.replace(/'/g, "'\\''")}'`;
}

// PowerShell single quoting: inside '...' nothing is expanded and ' is written as ''.
function powershellQuote(value) {
  return `'${String(value).replace(/['\u2018\u2019\u201a\u201b]/g, (quote) => quote + quote)}'`;
}

function collectorValues(settings, { runId, knownIds = [] }) {
  // A later run (posts were seen before, no backfill, no explicit depth) stops at those posts.
  const later = knownIds.length > 0 && !settings.backfill && !settings.scan_posts_explicit;
  return {
    runId,
    scanPosts: later ? LATER_SCAN_POSTS : settings.scan_posts,
    knownIds: later ? knownIds : [],
    seenRunLength: SEEN_RUN_LENGTH,
    maxScrollSteps: later ? LATER_MAX_SCROLL_STEPS : 0,
    maxRuntimeMs: settings.batch_seconds * 1000,
    ...DWELL,
    firstResponseTimeoutMs: 15000,
    maxStalls: settings.max_stalls,
    clickShowMoreOnStall: true,
    showMoreLabels: ["Show more results"],
    expectedPathPrefix: "/my-items/saved-posts",
    challengeTexts: CHALLENGE_TEXTS,
  };
}

function build(settings, { now = () => new Date(), kitRoot, overrides = {} } = {}) {
  const { folder, stateDir, rawDir } = ensureFolder(settings, kitRoot);
  if (fs.existsSync(path.join(stateDir, ".lock"))) throw new CaptureError("A run is in progress (.state/.lock exists). Check before removing it.");
  const cooldown = activeCooldown(stateDir, now());
  if (cooldown) throw new CaptureError(cooldownMessage(cooldown), "cooldown");
  const runId = newRunId(now());
  const runDir = path.join(rawDir, runId);
  fs.mkdirSync(runDir, { mode: 0o700 });
  const values = { ...collectorValues(settings, { runId, knownIds: knownListIds(stateDir) }), ...overrides };
  const source = renderCollector(fs.readFileSync(TEMPLATE, "utf8"), values);
  const collectorPath = path.join(runDir, "collector.js");
  fs.writeFileSync(collectorPath, source, { flag: "wx", mode: 0o600 });
  const rawArgs = [...(settings.raw_in_temp ? ["--raw-in-temp"] : settings.raw_dir === path.join(settings.folder, ".state", "raw") ? [] : ["--raw-dir", settings.raw_dir]), ...(settings.replaces_run ? ["--replaces-run", settings.replaces_run] : [])];
  // normalize selects from the scanned posts with the same settings the collector was built with.
  const selectionArgs = ["--scan-posts", String(values.scanPosts), "--window-days", String(settings.window_days), "--max-posts", String(settings.max_posts), ...(settings.backfill ? ["--backfill"] : [])];
  const normalizeArgv = ["node", path.join(__dirname, "normalize.js"), "--folder", folder, "--run-id", runId, ...rawArgs, ...selectionArgs, "--images", settings.images ? "on" : "off", ...(settings.keep_raw ? ["--keep-raw"] : [])];
  return {
    run_id: runId,
    backfill: settings.backfill,
    folder,
    collector_path: collectorPath,
    hook_path: HOOK,
    raw_run_dir: runDir,
    dump_path_for_batch_1: path.join(runDir, "batch-01.json"),
    dump_naming: "batch-01.json, batch-02.json, ... one evaluate_script call per batch while the returned status is \"continue\"",
    saved_items_url: "https://www.linkedin.com/my-items/saved-posts/",
    scan_posts: values.scanPosts,
    stops_at_seen_posts: values.knownIds.length > 0,
    window_days: settings.window_days,
    max_posts: settings.max_posts,
    batch_seconds: settings.batch_seconds,
    normalize_argv: normalizeArgv,
    normalize_command: normalizeArgv.map(shellQuote).join(" "),
    normalize_command_powershell: `& ${normalizeArgv.map(powershellQuote).join(" ")}`,
    normalize_command_note: "Run normalize_command in a POSIX shell (macOS, Linux, Git Bash on Windows) and normalize_command_powershell in PowerShell. Never rebuild either by hand.",
  };
}

function main(argv) {
  const args = parseArgs(argv.slice(2), ["backfill", "keep-raw", "raw-in-temp"]);
  if (!args.folder || String(args.folder).startsWith("--")) {
    process.stderr.write("Usage: node scripts/build-collector.js --folder <folder> [--images on|off] [--scan-posts N] [--window-days N] [--max-posts N] [--backfill] [--keep-raw] [--batch-seconds N] [--raw-in-temp] [--replaces-run <run id>]\n");
    return 1;
  }
  try {
    const settings = resolveSettings({
      folder: args.folder,
      backfill: args.backfill === true,
      images: args.images,
      scan_posts: args["scan-posts"],
      window_days: args["window-days"],
      max_posts: args["max-posts"],
      batch_seconds: args["batch-seconds"],
      raw_dir: args["raw-dir"],
      raw_in_temp: args["raw-in-temp"] === true,
      replaces_run: args["replaces-run"],
      profile_dir: args["profile-dir"],
      keep_raw: args["keep-raw"] === true,
    });
    process.stdout.write(`${asciiJson(build(settings))}\n`);
    return 0;
  } catch (error) {
    const status = error instanceof CaptureError ? error.status : "error";
    process.stderr.write(`${asciiJson({ capture_status: status, message: error instanceof CaptureError ? error.message : `Stopped (${error.code || error.name}).` })}\n`);
    return exitCodeForStatus(status) || 1;
  }
}

if (require.main === module) {
  process.exitCode = main(process.argv);
}

module.exports = { DWELL, build, collectorValues, main, powershellQuote, renderCollector, shellQuote };
