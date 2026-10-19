async () => {
  /*
   * Saved Posts in-page collector (template for the evaluate_script tool).
   *
   * Do not hand-edit the CONFIG block for a real run: scripts/build-collector.js
   * replaces everything between the CONFIG markers with the run's values. Pass the
   * rendered file content as the `function` argument of evaluate_script, with
   * `filePath` pointing at the private raw dump. Requires scripts/capture-hook.js to
   * have been injected with navigate_page(initScript) on the same document.
   *
   * It scrolls the saved list like a person, drains the
   * responses recorded by the hook and stops once it has seen `scanPosts` posts, after
   * the list page on which `seenRunLength` posts from `knownIds` (seen in an earlier run) appear
   * in a row in list order (fewer when fewer IDs are known; a single re-saved older post that
   * moved to the top does not stop it, so newer saves below it are still read), after
   * `maxScrollSteps` scroll steps over all batches (0: no limit), at
   * the end of the list, at the batch time limit, on repeated lack of new responses,
   * on an unrecognized response shape, or on a login/challenge/unexpected page. It
   * selects nothing: normalize.js decides which of the scanned posts to download.
   * It never reads cookies or headers and sends no request of its own.
   *
   * Timing: once the list has loaded it first waits a few seconds, as a person looks at
   * the page (initialDwell*), then dwells a random, non-uniform time after every scroll
   * step: mostly between dwellMinMs and dwellMaxMs, clustered in the middle, and with
   * probability longDwellChance up to longDwellMaxMs. Never a constant interval. A batch
   * returns "continue" early enough that its last step fits inside maxRuntimeMs.
   */
  const CONFIG = /*@@CONFIG_START@@*/{
    "runId": "template",
    "scanPosts": 50,
    "knownIds": [],
    "seenRunLength": 3,
    "maxScrollSteps": 0,
    "maxRuntimeMs": 120000,
    "initialDwellMinMs": 4000,
    "initialDwellMaxMs": 7000,
    "dwellMinMs": 2500,
    "dwellMaxMs": 6000,
    "longDwellChance": 0.15,
    "longDwellMaxMs": 12000,
    "firstResponseTimeoutMs": 15000,
    "maxStalls": 3,
    "clickShowMoreOnStall": true,
    "showMoreLabels": ["Show more results"],
    "expectedPathPrefix": "/my-items/saved-posts",
    "challengeTexts": ["quick security check", "security verification", "verify you are human", "verify you're human", "let's confirm it's really you", "sign in to continue"]
  }/*@@CONFIG_END@@*/;

  const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, Math.max(0, ms)));
  const jitter = (min, max) => min + Math.floor(Math.random() * (Math.max(min, max) - min + 1));
  // The mean of two uniform draws: values cluster in the middle of the range. Now and then a
  // longer look, as a person who stops to read.
  const dwell = () => {
    if (Math.random() < CONFIG.longDwellChance) return jitter(CONFIG.dwellMaxMs, CONFIG.longDwellMaxMs);
    return Math.round(CONFIG.dwellMinMs + ((Math.random() + Math.random()) / 2) * (CONFIG.dwellMaxMs - CONFIG.dwellMinMs));
  };
  // Worst case of one loop step: a long dwell, the wait for a late response and a long dwell after
  // a "show more" click, plus the scroll itself.
  const stepBudgetMs = 2 * CONFIG.longDwellMaxMs + CONFIG.dwellMaxMs + 2000;
  const startedAt = Date.now();
  const deadline = startedAt + CONFIG.maxRuntimeMs;
  const ENTITY_TYPE = "com.linkedin.voyager.dash.search.EntityResultViewModel";
  const POST_REFERENCE = /urn:li:(?:activity|ugcPost|share):\d/;

  if (!window.__spRun || window.__spRun.runId !== CONFIG.runId) {
    window.__spRun = { runId: CONFIG.runId, batch: 0, ids: new Set(), pages: 0, terminal: null, sawEnd: false, schemaChanged: false, lastPageShort: false, lookedAtList: false, reachedSeen: false, seenRun: 0, scrollsTotal: 0 };
  }
  const run = window.__spRun;
  const known = new Set((CONFIG.knownIds || []).map(String));
  // A run of this many known posts in a row marks the part of the list read before.
  const seenRunNeeded = Math.max(1, Math.min(Number(CONFIG.seenRunLength) || 1, known.size));
  run.batch += 1;

  const result = {
    schema: "saved-posts-raw/1",
    runId: CONFIG.runId,
    batch: run.batch,
    status: null,
    stoppedBecause: null,
    pageUrl: location.origin + location.pathname,
    startedAt: new Date(startedAt).toISOString(),
    finishedAt: null,
    scrollSteps: 0,
    showMoreClicks: 0,
    pagesTotal: 0,
    postsTotal: 0,
    scanPosts: CONFIG.scanPosts,
    hook: null,
    captures: [],
  };

  const finish = (status, why, terminal = true) => {
    result.status = status;
    result.stoppedBecause = why;
    result.finishedAt = new Date().toISOString();
    result.pagesTotal = run.pages;
    result.postsTotal = run.ids.size;
    const hook = window.__sp;
    result.hook = hook ? { seen: hook.seen, dropped: hook.dropped, readErrors: hook.readErrors, marker: hook.marker } : null;
    if (terminal) run.terminal = { status, why };
    return result;
  };

  const challenge = () => {
    const pathName = location.pathname || "";
    if (/(^|\/)(login|checkpoint|authwall|challenge|uas\/login)(\/|$)/i.test(pathName)) return "login_or_challenge_url";
    if (document.querySelector('input[type="password"]')) return "password_field";
    const text = String((document.body && document.body.innerText) || "").slice(0, 8000).toLowerCase();
    if ((CONFIG.challengeTexts || []).some((needle) => needle && text.includes(String(needle).toLowerCase()))) return "challenge_text";
    return null;
  };

  const analyze = (fresh) => {
    for (const capture of fresh) {
      result.captures.push(capture);
      run.pages += 1;
      let parsed;
      try { parsed = JSON.parse(capture.body); } catch (_error) { continue; }
      const included = Array.isArray(parsed && parsed.included) ? parsed.included : [];
      const root = parsed && parsed.data && parsed.data.data && parsed.data.data.searchDashClustersByAll;
      // List order lives in elements[].items[].item["*entityResult"], which references each
      // entity's entityUrn; `included` is not in list order. Unreferenced entities go last.
      const positions = new Map();
      for (const element of root && Array.isArray(root.elements) ? root.elements : []) {
        for (const entry of element && Array.isArray(element.items) ? element.items : []) {
          const reference = entry && entry.item && entry.item["*entityResult"];
          if (typeof reference === "string" && !positions.has(reference)) positions.set(reference, positions.size);
        }
      }
      const found = [];
      for (const item of included) {
        if (!item || item.$type !== ENTITY_TYPE) continue;
        const match = /^urn:li:[A-Za-z]+:(\d+)$/.exec(String(item.trackingUrn || ""));
        if (match) found.push({ id: match[1], at: positions.has(item.entityUrn) ? positions.get(item.entityUrn) : Infinity });
      }
      found.sort((a, b) => a.at - b.at);
      const postsOnPage = found.length;
      for (const { id } of found) {
        run.ids.add(id);
        // LinkedIn orders the list by save time, but a re-saved older post jumps to the top, so one
        // known post does not prove that everything below it was read; a run of them does. The
        // page is finished first; the run then stops.
        run.seenRun = known.has(id) ? run.seenRun + 1 : 0;
        if (run.seenRun >= seenRunNeeded) run.reachedSeen = true;
      }
      if (!root) continue;
      if (postsOnPage > 0) {
        // A page with fewer posts than the page size and no pagination token looks like the last
        // page. It ends the list only if no further response arrives (see the stall handling).
        const pageSize = root.paging && Number.isInteger(root.paging.count) && root.paging.count > 0 ? root.paging.count : 10;
        const token = root.metadata && root.metadata.paginationToken;
        run.lastPageShort = postsOnPage < pageSize && !token;
        continue;
      }
      // End of list only with positive evidence of an empty page: `elements` is an array whose
      // clusters all have an empty `items` array (or no clusters), and nothing post-like is in
      // `included`. A missing `elements`, a cluster without `items`, or a populated response whose
      // posts are not recognized means LinkedIn changed the data format, not that the list ended.
      // paging.total is not used: its meaning is not established.
      const postLike = included.some((item) => item && (/EntityResult/i.test(String(item.$type || "")) || POST_REFERENCE.test(JSON.stringify(item))));
      const clustersEmpty = Array.isArray(root.elements) && root.elements.every((element) =>
        element && typeof element === "object" && Array.isArray(element.items) && element.items.length === 0);
      if (clustersEmpty && !postLike && Array.isArray(parsed.included)) run.sawEnd = true;
      else run.schemaChanged = true;
    }
  };

  const drain = () => (window.__sp && typeof window.__sp.drain === "function" ? window.__sp.drain() : []);

  const stopReason = () => {
    if (run.schemaChanged) return ["schema_changed", "unrecognized_list_response"];
    if (run.reachedSeen) return ["ok", "reached_seen"];
    // In a later run the scan depth is the step limit expressed in posts (10 visible + 7 steps).
    if (run.ids.size >= CONFIG.scanPosts) return ["ok", CONFIG.maxScrollSteps > 0 ? "scroll_limit" : "scan_limit"];
    if (run.sawEnd) return ["ok", "end_of_list"];
    return null;
  };

  const visible = (element) => {
    if (!element || !element.isConnected) return false;
    const style = getComputedStyle(element);
    return style.display !== "none" && style.visibility !== "hidden" && element.getClientRects().length > 0;
  };

  const humanScroll = async () => {
    // Already at the bottom: move up a little first, as a person would, so that
    // scroll- or visibility-based loaders see a fresh scroll to the end.
    if (document.documentElement.scrollHeight - window.scrollY - window.innerHeight <= 5) {
      window.scrollBy(0, -jitter(200, 500));
      await sleep(jitter(150, 300));
    }
    const chunks = jitter(2, 4);
    for (let index = 0; index < chunks; index += 1) {
      const remaining = document.documentElement.scrollHeight - window.scrollY - window.innerHeight;
      if (remaining <= 0) break;
      window.scrollBy(0, Math.ceil(remaining / (chunks - index)));
      await sleep(jitter(120, 350));
    }
    window.scrollTo(0, document.documentElement.scrollHeight);
  };

  const clickShowMore = () => {
    const labels = (CONFIG.showMoreLabels || []).map((label) => String(label).trim().toLowerCase()).filter(Boolean);
    if (!labels.length) return false;
    const buttons = [...document.querySelectorAll("button")].filter((button) =>
      visible(button) && labels.includes(String(button.innerText || "").trim().toLowerCase()));
    if (buttons.length !== 1) return false;
    buttons[0].click();
    return true;
  };

  if (run.terminal) return finish("done", `already_finished:${run.terminal.why}`);
  const blockedAtStart = challenge();
  if (blockedAtStart) return finish("blocked", blockedAtStart);
  if (!String(location.pathname || "").startsWith(CONFIG.expectedPathPrefix)) return finish("blocked", "unexpected_page");
  if (!window.__sp || typeof window.__sp.drain !== "function") return finish("error", "hook_missing");

  analyze(drain());
  if (run.pages === 0) {
    const firstDeadline = Math.min(deadline, Date.now() + CONFIG.firstResponseTimeoutMs);
    while (run.pages === 0 && Date.now() < firstDeadline) {
      await sleep(500);
      analyze(drain());
    }
    if (run.pages === 0) {
      // Nudge once: some lists only request the first page after a scroll.
      await humanScroll();
      result.scrollSteps += 1;
      run.scrollsTotal += 1;
      await sleep(dwell());
      analyze(drain());
    }
    if (run.pages === 0) {
      const blocked = challenge();
      if (blocked) return finish("blocked", blocked);
      return finish("api_route_missing", "no_saved_posts_response");
    }
  }

  if (!run.lookedAtList) {
    // The list has loaded: look at it for a moment before the first scroll.
    run.lookedAtList = true;
    await sleep(jitter(CONFIG.initialDwellMinMs, CONFIG.initialDwellMaxMs));
    analyze(drain());
  }

  let stalls = 0;
  for (;;) {
    const stop = stopReason();
    if (stop) return finish(stop[0], stop[1]);
    if (Date.now() + stepBudgetMs > deadline) return finish("continue", "batch_time_limit", false);
    const blocked = challenge();
    if (blocked) return finish("blocked", blocked);
    if (CONFIG.maxScrollSteps > 0 && run.scrollsTotal >= CONFIG.maxScrollSteps) return finish("ok", "scroll_limit");
    await humanScroll();
    result.scrollSteps += 1;
    run.scrollsTotal += 1;
    await sleep(dwell());
    let fresh = drain();
    if (!fresh.length) {
      const extraUntil = Date.now() + CONFIG.dwellMaxMs;
      while (!fresh.length && Date.now() < extraUntil) {
        await sleep(400);
        fresh = drain();
      }
    }
    analyze(fresh);
    if (fresh.length) {
      stalls = 0;
      continue;
    }
    stalls += 1;
    if (CONFIG.clickShowMoreOnStall && clickShowMore()) {
      result.showMoreClicks += 1;
      await sleep(dwell());
      const afterClick = drain();
      analyze(afterClick);
      if (afterClick.length) { stalls = 0; continue; }
    }
    if (stalls >= CONFIG.maxStalls) {
      // The last page had fewer posts than the page size and no pagination token, and nothing
      // followed it: the list is shorter than the scan depth and has ended.
      if (run.lastPageShort) {
        result.endEvidence = "short_last_page";
        return finish("ok", "end_of_list");
      }
      return finish("stalled", "no_new_response");
    }
  }
}
