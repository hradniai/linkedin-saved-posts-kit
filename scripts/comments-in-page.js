async () => {
  /*
   * OPTIONAL. Reads visible top-level comments from an already opened LinkedIn
   * post page (https://www.linkedin.com/feed/update/urn:li:activity:<ID>/).
   * Pass this file's content as the `function` argument of evaluate_script and
   * dump the result with `filePath`, then run:
   *   node scripts/normalize.js attach-comments --folder <folder> --post-id <ID> --raw <dump>
   *
   * It clicks nothing ("load more" stays closed), sends no request and reads no
   * cookies. Comments are found through their "View more options for <Name>'s
   * comment" button; the text of each comment container is taken as shown, so it
   * may include the author line and button labels. Compare with take_snapshot
   * before relying on the output. Post pages load bot detection scripts, so open
   * few of them.
   */
  const MAX_COMMENTS = 10;
  const MAX_TEXT = 4000;
  const LABEL = /^View more options for (.+?)[’']s comment\.?$/i;
  const result = { schema: "saved-posts-comments/1", status: null, pageUrl: location.origin + location.pathname, comments: [], note: "" };
  const pathName = location.pathname || "";
  if (/(^|\/)(login|checkpoint|authwall|challenge|uas\/login)(\/|$)/i.test(pathName) || document.querySelector('input[type="password"]')) {
    result.status = "blocked";
    result.note = "Login or challenge page; nothing was read.";
    return result;
  }
  const buttons = [...document.querySelectorAll("button[aria-label]")].filter((button) => LABEL.test(button.getAttribute("aria-label") || ""));
  const seen = new Set();
  for (const button of buttons) {
    if (result.comments.length >= MAX_COMMENTS) break;
    const author = (LABEL.exec(button.getAttribute("aria-label")) || [])[1] || "";
    let container = button.closest("article") || button.parentElement;
    for (let depth = 0; container && depth < 6 && String(container.innerText || "").trim().length < 40; depth += 1) container = container.parentElement;
    if (!container || seen.has(container)) continue;
    // Skip replies nested inside another captured comment container.
    if ([...seen].some((other) => other.contains(container))) continue;
    seen.add(container);
    const raw = String(container.innerText || "").replace(/\n{3,}/g, "\n\n").trim();
    const time = /(?:^|\s)(\d{1,3}\s?(?:s|m|h|d|w|mo|yr|y)\b)/.exec(raw);
    result.comments.push({ author, text: raw.slice(0, MAX_TEXT), relative_time: time ? time[1] : null });
  }
  result.status = buttons.length ? "ok" : "no_comments_found";
  result.note = buttons.length ? "Visible comments in DOM order; text may include the author line and UI labels." : "No comment anchor matched. The page may have no visible comments, or the markup changed; check with take_snapshot.";
  return result;
}
