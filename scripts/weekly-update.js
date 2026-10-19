#!/usr/bin/env node
"use strict";

/*
 * Weekly update without an AI model. Standard library only.
 *
 *   node scripts/weekly-update.js --folder <folder> [--images on|off] [--scan-posts N]
 *        [--window-days N] [--keep-raw] [--profile-dir <dir>] [--random-delay-minutes N]
 *        [--devtools-cli <path to chrome-devtools.js>] [--headless]
 *        [--process claude [--claude-path <path to claude>] [--model <name>]]
 *   node scripts/weekly-update.js --task-name --runtime <cc|cx|short agent name> --folder <folder>
 *
 * --images, --scan-posts, --window-days and --keep-raw carry the settings from the folder's
 * AGENTS.md; the scheduled command must include them, since this script does not read AGENTS.md.
 *
 * Drives the `chrome-devtools` command line client of chrome-devtools-mcp (the same tools the
 * MCP server gives an agent) on the agent's persistent browser profile: start, open the saved
 * list with the capture hook, run the collector in batches of 50 s (the client gives up on a
 * command after 60 s), normalize, stop. The run is the same as any other download: of the
 * --scan-posts most recently saved posts (default 50), those published in the last
 * --window-days days (default 60) that are not yet in the folder are written. A visible browser window opens unless --headless is given.
 *
 * The client is chrome-devtools-mcp@latest, fetched with `npx` and then run directly with this Node
 * binary, so no global install is needed and no shell is involved. When npx cannot fetch it (offline,
 * a registry problem), the newest copy already in the npm cache is used, typically the one the MCP
 * server itself runs. --devtools-cli uses an existing copy instead (for example after
 * `npm i -g chrome-devtools-mcp@latest`: <npm root -g>/chrome-devtools-mcp/build/src/bin/chrome-devtools.js).
 *
 * Cooldown: after a run blocked by a login or security check, normalize.js records a cooldown; until
 * it expires or the agent clears it after a manual sign-in, this script refuses to start (exit 3).
 * --random-delay-minutes N (0 to 240) waits a random time up to N minutes before starting; meant only
 * for schedules more frequent than weekly. --task-name prints the name to use for the scheduled job
 * (runtime, folder name, creation time) and whether a job of that name or another kit job exists.
 *
 * --process claude: after the browser is closed and normalize wrote a usable result (ok or partial,
 * never blocked or error), process every post without processing.json with process-posts.js
 * (Claude Code, headless and confined to the folder). This also catches up posts left
 * unprocessed by an earlier run. Without --process the run uses no AI model at all.
 *
 * 72-hour floor: the moment a run opens LinkedIn is recorded in .state/weekly-last-start.json. A run
 * that would start (after its random delay) less than MIN_HOURS_BETWEEN_STARTS after the previous one
 * refuses before opening a browser (status too_soon, exit 4), so a schedule plus random delay can
 * never bring two runs closer than 72 hours. An unreadable or corrupt file refuses too (fail closed).
 *
 * Exit codes as normalize: 0 ok, 1 error (including: profile in use, folder not set up),
 * 2 partial, 3 blocked (signed out or a security check: sign in again with the agent) or cooldown,
 * 4 too soon (the previous weekly run started less than 72 hours ago; nothing was opened).
 * Processing never changes this exit code: it appends its own "process exit=..." line to the log
 * (exit codes of process-posts.js) and is reported under "processing" in the JSON line.
 * Every run appends one line to <folder>/.state/weekly.log and prints one JSON line. A browser lock
 * left by a Chrome that did not close cleanly is removed before the start, and that line says so.
 */

const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const { execFile, execFileSync } = require("node:child_process");
const { promisify } = require("node:util");
const N = require("./normalize.js");
const B = require("./build-collector.js");
const P = require("./process-posts.js");

const execFileAsync = promisify(execFile);
const DEVTOOLS_PACKAGE = "chrome-devtools-mcp@latest";
const MAX_RANDOM_DELAY_MINUTES = 240;
const MIN_HOURS_BETWEEN_STARTS = 72;
const LAST_START_NAME = "weekly-last-start.json";
const TASK_PREFIX = "local.linkedin-saved-posts";
const DEFAULT_SESSION_ID = "5a7edc0de"; // daemon scope of this script (hex only, as the client requires)
const COMMAND_TIMEOUT_MS = 90000;
const MAX_BATCHES = 12;
const PROFILE_IN_USE = "The browser profile is in use by another Chrome, most likely the one your agent opened through Chrome DevTools MCP. Quit the agent (this closes its Chrome), check that no Chrome window of that profile is left, and run the update again.";
const SIGN_IN_AGAIN = `sign in again: LinkedIn showed a login or security check, so no download starts for ${N.COOLDOWN_HOURS} hours. Open your agent in your saved-posts folder and ask it to sign you in to LinkedIn again; after a successful sign-in it can lift the pause.`;

// ------------------------------------------------------------- helpers ---

function childEnv() {
  // launchd, Task Scheduler and systemd start jobs with a minimal PATH; the client's own
  // scripts need this Node binary on PATH.
  const env = { ...process.env, CHROME_DEVTOOLS_MCP_NO_USAGE_STATISTICS: "1", CHROME_DEVTOOLS_MCP_NO_UPDATE_CHECKS: "1" };
  const pathKey = Object.keys(env).find((key) => key.toUpperCase() === "PATH") || "PATH";
  env[pathKey] = [path.dirname(process.execPath), env[pathKey] || ""].filter(Boolean).join(path.delimiter);
  return env;
}

/* Command lines of all running processes, one per line; -ww keeps long ones whole (macOS and Linux ps). */
function processCommandLines() {
  return execFileSync("ps", ["-A", "-ww", "-o", "command="], { encoding: "utf8", timeout: 30000, maxBuffer: 64 * 1024 * 1024, stdio: ["ignore", "pipe", "ignore"] });
}

/* Whether a command line opens profileDir: its path as given or resolved (on macOS also with or without /private). */
function holdsProfile(listing, profileDir, platform) {
  const forms = new Set([profileDir]);
  try { forms.add(fs.realpathSync(profileDir)); } catch (_error) { /* the path as given */ }
  if (platform === "darwin") {
    for (const form of [...forms]) {
      if (form.startsWith("/private/")) forms.add(form.slice("/private".length));
      else if (/^\/(var|tmp|etc)\//.test(form)) forms.add(`/private${form}`);
    }
  }
  const escape = (value) => value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  return new RegExp(`--user-data-dir=(?:${[...forms].map(escape).join("|")})/?(?=\\s|$)`, platform === "darwin" ? "i" : "").test(listing);
}

/*
 * Chrome marks a profile in use with a SingletonLock symlink ("<host>-<pid>") on macOS and
 * Linux, and with a "lockfile" that exists while Chrome runs on Windows (opened delete-on-close;
 * Puppeteer uses the same test). The symlink outlives a Chrome that did not close cleanly, and its
 * host can be an earlier name of this computer (a Mac's name changes with the network), so it counts
 * only while a running process has the profile open: Chrome and the client's daemon carry
 * --user-data-dir=<profile>. Otherwise only the symlink is removed, as Chrome's own "Unlock profile"
 * does, and a note goes to `notes`. When the processes cannot be listed, the run refuses and names
 * the lock. Nothing else in the profile is read.
 */
function profileInUse(profileDir, platform = process.platform, listProcesses = processCommandLines, notes = []) {
  if (platform === "win32") return fs.existsSync(path.join(profileDir, "lockfile"));
  const lock = path.join(profileDir, "SingletonLock");
  const refuse = (what, error) => new N.CaptureError(`${what} (${error.code || error.message}). Quit the agent, check that no Chrome window of that profile is left, then delete the lock file ${lock} and run the update again.`);
  let target;
  try {
    if (!fs.lstatSync(lock).isSymbolicLink()) return false;
    target = fs.readlinkSync(lock);
  } catch (_error) {
    return false;
  }
  let listing;
  try { listing = String(listProcesses()); } catch (error) { throw refuse("Could not check whether the browser profile is in use: the running programs could not be listed", error); }
  if (holdsProfile(listing, profileDir, platform)) return true;
  try {
    if (fs.readlinkSync(lock) !== target) return true; // a Chrome started in the meantime
    fs.unlinkSync(lock);
  } catch (error) {
    if (error.code === "ENOENT") return false;
    throw refuse("Could not remove a stale browser lock", error);
  }
  notes.push(`Removed a stale browser lock (${target}) left by a Chrome that did not close cleanly; no running program had the profile open.`);
  return false;
}

function npmScript(name) {
  const dir = path.dirname(process.execPath);
  const candidates = [
    path.join(dir, "..", "lib", "node_modules", "npm", "bin", name),
    path.join(dir, "node_modules", "npm", "bin", name),
  ];
  return candidates.find((candidate) => fs.existsSync(candidate)) || null;
}

function compareVersions(a, b) {
  const parts = (value) => String(value).split(/[.+-]/).slice(0, 3).map((part) => Number.parseInt(part, 10) || 0);
  const [x, y] = [parts(a), parts(b)];
  for (let index = 0; index < 3; index += 1) if (x[index] !== y[index]) return x[index] - y[index];
  return 0;
}

/*
 * The chrome-devtools CLI in npx's cache: the copy of exactly `version` when given, otherwise the
 * newest copy there (npx keeps one directory per package spec, so several versions can coexist).
 */
function findCachedCli(cacheDir, version) {
  const base = path.join(cacheDir, "_npx");
  let entries = [];
  try { entries = fs.readdirSync(base); } catch (_error) { return null; }
  let best = null;
  for (const entry of entries) {
    const pkgDir = path.join(base, entry, "node_modules", "chrome-devtools-mcp");
    const bin = path.join(pkgDir, "build", "src", "bin", "chrome-devtools.js");
    try {
      const found = JSON.parse(fs.readFileSync(path.join(pkgDir, "package.json"), "utf8")).version;
      if (!fs.existsSync(bin)) continue;
      if (version) { if (found === version) return bin; continue; }
      if (!best || compareVersions(found, best.version) > 0) best = { version: found, bin };
    } catch (_error) { /* not this entry */ }
  }
  return best ? best.bin : null;
}

async function resolveCli({ cli, env }) {
  if (cli) {
    if (!fs.existsSync(cli)) throw new N.CaptureError(`--devtools-cli not found: ${cli}`);
    return cli;
  }
  const npx = npmScript("npx-cli.js");
  const npm = npmScript("npm-cli.js");
  if (!npx || !npm) throw new N.CaptureError("npm was not found next to this Node binary. Install chrome-devtools-mcp globally and pass --devtools-cli.");
  const cache = (await execFileAsync(process.execPath, [npm, "config", "get", "cache"], { env, timeout: 60000 })).stdout.trim();
  let fetchProblem = null;
  try {
    const { stdout } = await execFileAsync(process.execPath, [npx, "-y", `--package=${DEVTOOLS_PACKAGE}`, "--", "chrome-devtools", "--version"], { env, timeout: 300000 });
    const version = (/\d+\.\d+\.\d+[^\s]*/.exec(stdout) || [])[0];
    const fetched = version ? findCachedCli(cache, version) : null;
    if (fetched) return fetched;
  } catch (error) {
    fetchProblem = String(error.stderr || error.message).trim().slice(0, 200);
  }
  // Offline or a registry problem: use the newest copy npx already has (typically the MCP server's).
  const cached = findCachedCli(cache);
  if (cached) return cached;
  throw new N.CaptureError(`Could not fetch ${DEVTOOLS_PACKAGE} with npx${fetchProblem ? ` (${fetchProblem})` : ""}, and no copy is in the npm cache; pass --devtools-cli.`);
}

/*
 * The CLI reports a failed tool (for example "The browser is already running") as a normal result
 * and exits 0. With --output-format=json a failure is an array of {type: "text"} objects, while a
 * success is an object or an array of strings. Returns the failure text, or null.
 */
function toolFailure(stdout) {
  let parsed;
  try { parsed = JSON.parse(String(stdout).trim()); } catch (_error) { return null; }
  if (!Array.isArray(parsed) || !parsed.length || !parsed.every((item) => item && typeof item === "object" && item.type === "text")) return null;
  return parsed.map((item) => String(item.text || "")).join(" ").trim() || "unknown error";
}

// ------------------------------------------------- scheduled task name ---

function slug(value, max) {
  return String(value || "").toLowerCase().normalize("NFKD").replace(/[\u0300-\u036f]/g, "").replace(/[^a-z0-9]+/g, "-").replace(/^-+/, "").slice(0, max).replace(/-+$/, "");
}

/*
 * One name for the job on every system: local.linkedin-saved-posts.<runtime>.<folder name>.<YYYYMMDDHHmm>,
 * so jobs of different agents, folders and setups never share a name.
 */
function scheduledTaskName({ runtime, folder, now = new Date() }) {
  const agent = slug(runtime, 20);
  if (!agent) throw new N.CaptureError("--runtime must name the agent: cc for Claude Code, cx for Codex, or a short name of another agent.");
  const pad = (value) => String(value).padStart(2, "0");
  const stamp = `${now.getFullYear()}${pad(now.getMonth() + 1)}${pad(now.getDate())}${pad(now.getHours())}${pad(now.getMinutes())}`;
  return `${TASK_PREFIX}.${agent}.${slug(path.basename(folder), 40) || "folder"}.${stamp}`;
}

/* The name plus read-only checks: does a job of that name exist, and which other kit jobs exist (names only). */
function scheduledTaskInfo({ runtime, folder, now = new Date(), home = os.homedir(), platform = process.platform }) {
  const label = scheduledTaskName({ runtime, folder, now });
  const launchAgents = path.join(home, "Library", "LaunchAgents");
  const systemdUser = path.join(home, ".config", "systemd", "user");
  const info = { label, windows_task_name: label };
  let dir = null;
  let files = [];
  if (platform === "darwin") {
    dir = launchAgents;
    files = [`${label}.plist`];
    info.launchd_plist = path.join(launchAgents, `${label}.plist`);
  } else if (platform === "linux") {
    dir = systemdUser;
    files = [`${label}.service`, `${label}.timer`];
    info.systemd_service = path.join(systemdUser, `${label}.service`);
    info.systemd_timer = path.join(systemdUser, `${label}.timer`);
  }
  if (dir) {
    let names = [];
    try { names = fs.readdirSync(dir); } catch (_error) { names = []; }
    info.exists = files.some((file) => names.includes(file));
    info.existing_kit_jobs = names.filter((name) => name.startsWith(`${TASK_PREFIX}.`)).sort();
  } else {
    info.exists = null;
    info.note = "On Windows check with: Get-ScheduledTask -TaskName 'local.linkedin-saved-posts.*'";
  }
  return info;
}

function appendLog(stateDir, fields) {
  const line = `${new Date().toISOString()} exit=${fields.exit} status=${fields.status} new=${fields.new_posts_written ?? 0}${fields.run_id ? ` run=${fields.run_id}` : ""} ${String(fields.message || "").replace(/\s+/g, " ").trim()}\n`;
  try { fs.appendFileSync(path.join(stateDir, "weekly.log"), line, { mode: 0o600 }); } catch (_error) { /* the JSON line on stdout still reports the run */ }
}

// ------------------------------------------------------- 72-hour floor ---

/* The previous weekly start, or null when none was recorded. Anything but a missing file that cannot be used fails closed. */
function readLastStart(stateDir) {
  const unusable = (why) => new N.CaptureError(`.state/${LAST_START_NAME} exists but ${why}, so this run was skipped to keep weekly runs at least ${MIN_HOURS_BETWEEN_STARTS} hours apart. If no weekly run started in the last ${MIN_HOURS_BETWEEN_STARTS} hours, delete the file.`, "too_soon");
  let text;
  try {
    text = fs.readFileSync(path.join(stateDir, LAST_START_NAME), "utf8");
  } catch (error) {
    if (error.code === "ENOENT") return null;
    throw unusable(`could not be read (${error.code || error.name})`);
  }
  let parsed;
  try { parsed = JSON.parse(text); } catch (_error) { throw unusable("is not valid JSON"); }
  const at = parsed && typeof parsed === "object" ? Date.parse(parsed.started_at) : NaN;
  if (!Number.isFinite(at)) throw unusable("has no readable start time");
  return new Date(at);
}

function checkStartFloor(stateDir, now) {
  const last = readLastStart(stateDir);
  if (!last) return;
  const allowedAt = new Date(last.getTime() + MIN_HOURS_BETWEEN_STARTS * 3600 * 1000);
  if (now.getTime() < allowedAt.getTime()) {
    throw new N.CaptureError(`too soon: the previous weekly run started at ${last.toISOString()}, less than ${MIN_HOURS_BETWEEN_STARTS} hours ago; nothing was opened. The next run may start after ${allowedAt.toISOString()}. If this repeats, the schedule interval minus the random delay is under ${MIN_HOURS_BETWEEN_STARTS} hours.`, "too_soon");
  }
}

function recordStart(stateDir, now) {
  N.atomicReplace(path.join(stateDir, LAST_START_NAME), `${JSON.stringify({ schema_version: 1, started_at: now.toISOString() }, null, 2)}\n`);
}

// ---------------------------------------------------------------- run ---

function weeklySettings(options) {
  return N.resolveSettings({
    folder: options.folder,
    images: options.images,
    scan_posts: options["scan-posts"],
    window_days: options["window-days"],
    keep_raw: options["keep-raw"] === true,
    profile_dir: options["profile-dir"],
    batch_seconds: 50,
  });
}

async function weeklyUpdate(options) {
  const settings = weeklySettings(options);
  const listUrl = options["list-url"] || N.SAVED_ITEMS_URL; // --list-url replaces the saved-list address; normal runs never pass it
  const delayMinutes = options["random-delay-minutes"] === undefined ? 0 : Number(options["random-delay-minutes"]);
  if (!Number.isInteger(delayMinutes) || delayMinutes < 0 || delayMinutes > MAX_RANDOM_DELAY_MINUTES) throw new N.CaptureError(`--random-delay-minutes must be an integer from 0 to ${MAX_RANDOM_DELAY_MINUTES}.`);
  const sessionId = options["session-id"] || DEFAULT_SESSION_ID;
  if (!/^[a-f0-9]{4,32}$/.test(sessionId)) throw new N.CaptureError("--session-id must be 4 to 32 hex characters.");
  if (!fs.existsSync(path.join(settings.folder, "AGENTS.md")) || !fs.existsSync(path.join(settings.folder, ".state"))) {
    throw new N.CaptureError("This folder is not set up yet. Do the first download with your agent first (README.md).");
  }
  const cooldown = N.activeCooldown(path.join(settings.folder, N.STATE_DIR));
  if (cooldown) throw new N.CaptureError(N.cooldownMessage(cooldown), "cooldown");
  if (delayMinutes > 0) await (options.sleep || sleep)(Math.floor(Math.random() * delayMinutes * 60000));
  const now = options.now || (() => new Date());
  const stateDir = path.join(settings.folder, N.STATE_DIR);
  // Checked after the random delay: the floor applies to actual starts, not to scheduled ones.
  checkStartFloor(stateDir, now());

  const env = childEnv();
  const cli = await resolveCli({ cli: options["devtools-cli"], env });
  const tools = new Set(["list_pages", "navigate_page", "evaluate_script"]);
  const cdt = async (...args) => {
    let stdout;
    try {
      const formatted = tools.has(args[0]) && !args.some((arg) => String(arg).startsWith("--output-format")) ? [...args, "--output-format=json"] : args;
      ({ stdout } = await execFileAsync(process.execPath, [cli, ...formatted, "--sessionId", sessionId], { env, timeout: COMMAND_TIMEOUT_MS, maxBuffer: 64 * 1024 * 1024 }));
    } catch (error) {
      const detail = String(error.stderr || error.stdout || error.message);
      if (/already running/i.test(detail)) throw new N.CaptureError(PROFILE_IN_USE);
      throw new N.CaptureError(`chrome-devtools ${args[0]} failed: ${detail.trim().slice(0, 300)}`);
    }
    const failure = tools.has(args[0]) ? toolFailure(stdout) : null;
    if (failure) {
      if (/already running/i.test(failure)) throw new N.CaptureError(PROFILE_IN_USE);
      throw new N.CaptureError(`chrome-devtools ${args[0]} failed: ${failure.slice(0, 300)}`);
    }
    return stdout;
  };

  // A daemon of this script left by an interrupted run would hold the profile; stop it first.
  await cdt("stop").catch(() => {});
  if (profileInUse(settings.profile_dir, process.platform, options.listProcesses, options.notes)) throw new N.CaptureError(PROFILE_IN_USE);

  const info = B.build(settings, { overrides: options.collectorOverrides || {} });
  const hook = fs.readFileSync(info.hook_path, "utf8");
  const dumps = [];
  let collectFailure = null;
  try {
    await cdt("start", "--userDataDir", settings.profile_dir, `--headless=${options.headless === true}`, "--no-usage-statistics");
    const listed = JSON.parse(await cdt("list_pages", "--output-format=json"));
    const pages = Array.isArray(listed.pages) ? listed.pages : [];
    const page = pages.find((entry) => entry.selected) || pages[0];
    if (!page) throw new N.CaptureError("The browser opened no page.");
    const pageId = String(page.id);
    // The first LinkedIn visit of this run is its actual start; without a record no visit happens.
    recordStart(stateDir, now());
    await cdt("navigate_page", pageId, "--url", listUrl, "--initScript", hook);
    const collector = fs.readFileSync(info.collector_path, "utf8");
    for (let batch = 1; batch <= MAX_BATCHES; batch += 1) {
      const dump = path.join(info.raw_run_dir, `batch-${String(batch).padStart(2, "0")}.json`);
      await cdt("evaluate_script", collector, "--pageId", pageId, "--filePath", dump, "--waitForStableDom", "false");
      if (!fs.existsSync(dump)) throw new N.CaptureError("The collector returned no data file.");
      dumps.push(dump);
      if (N.peek(dump).status !== "continue") break;
    }
  } catch (error) {
    collectFailure = error;
  } finally {
    await cdt("stop").catch(() => {});
  }

  if (!dumps.length) {
    // Nothing was collected: remove the unused collector and report the cause.
    try { fs.rmSync(info.raw_run_dir, { recursive: true, force: true }); } catch (_error) { /* harmless leftover */ }
    throw collectFailure || new N.CaptureError("No data was collected.");
  }
  const result = await N.normalize(settings, { runId: info.run_id });
  if (collectFailure) {
    result.coverage_note = `${result.coverage_note} The browser step stopped early: ${collectFailure.message}`.trim();
  }
  return result;
}

/* Processing after a download with usable posts (ok or partial); never after blocked or error. */
async function processAfterDownload(args, captureStatus) {
  if (!args.process || !["ok", "partial"].includes(captureStatus)) return null;
  const processing = await P.processPosts({ folder: args.folder, claudePath: args["claude-path"], model: args.model });
  return { exit: processing.exit, status: processing.status, requested: processing.requested, processed: processing.processed, message: processing.message };
}

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

async function main(argv, overrides = {}) {
  const args = N.parseArgs(argv.slice(2), ["headless", "keep-raw", "task-name"]);
  if (!args.folder || String(args.folder).startsWith("--") || (args.process !== undefined && args.process !== "claude")) {
    process.stderr.write("Usage: node scripts/weekly-update.js --folder <folder> [--images on|off] [--scan-posts N] [--window-days N] [--keep-raw] [--profile-dir <dir>] [--random-delay-minutes N] [--devtools-cli <path>] [--headless] [--process claude [--claude-path <path>] [--model <name>]]\n       node scripts/weekly-update.js --task-name --runtime <cc|cx|name> --folder <folder>\n");
    return 1;
  }
  if (args["task-name"]) {
    try {
      process.stdout.write(`${N.asciiJson(scheduledTaskInfo({ runtime: args.runtime, folder: N.resolveSettings({ folder: args.folder }).folder, ...(overrides.taskInfo || {}) }))}\n`);
      return 0;
    } catch (error) {
      process.stdout.write(`${N.asciiJson({ capture_status: "error", message: error instanceof N.CaptureError ? error.message : `Stopped (${error.code || error.name}).` })}\n`);
      return 1;
    }
  }
  let stateDir = null;
  try { stateDir = path.join(N.resolveSettings({ folder: args.folder }).folder, N.STATE_DIR); } catch (_error) { stateDir = null; }
  const notes = []; // for example a removed stale browser lock; appended to the run's message
  const withNotes = (message) => [message, ...notes].join(" ");
  try {
    const result = await weeklyUpdate({ ...args, ...overrides, notes });
    const exit = N.exitCodeForStatus(result.capture_status);
    const message = withNotes(result.capture_status === "blocked" ? SIGN_IN_AGAIN : result.summary_line);
    appendLog(stateDir, { exit, status: result.capture_status, new_posts_written: result.new_posts_written, run_id: result.run_id, message });
    let processing = null;
    try {
      processing = await processAfterDownload(args, result.capture_status);
    } catch (error) {
      processing = { exit: P.EXIT.error, status: "error", message: `Processing stopped (${error.code || error.name}).` };
    }
    const line = { capture_status: result.capture_status, exit, new_posts_written: result.new_posts_written, run_id: result.run_id, message, coverage_note: result.coverage_note };
    if (processing) line.processing = processing;
    process.stdout.write(`${N.asciiJson(line)}\n`);
    return exit;
  } catch (error) {
    const status = error instanceof N.CaptureError ? error.status : "error";
    const exit = N.exitCodeForStatus(status);
    const message = withNotes(error instanceof N.CaptureError ? error.message : `Stopped (${error.code || error.name}).`);
    if (stateDir && fs.existsSync(stateDir)) appendLog(stateDir, { exit, status, message });
    process.stdout.write(`${N.asciiJson({ capture_status: status, exit, message })}\n`);
    return exit;
  }
}

if (require.main === module) {
  main(process.argv).then((code) => { process.exitCode = code; });
}

module.exports = { DEVTOOLS_PACKAGE, MIN_HOURS_BETWEEN_STARTS, compareVersions, findCachedCli, main, processAfterDownload, profileInUse, resolveCli, scheduledTaskInfo, scheduledTaskName, toolFailure, weeklySettings, weeklyUpdate };
