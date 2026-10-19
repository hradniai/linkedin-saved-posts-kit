/*
 * Saved Posts capture hook (in-page init script).
 *
 * Pass the WHOLE content of this file as the `initScript` argument of the
 * Chrome DevTools MCP `navigate_page` tool (or `--initScript` in the CLI).
 * It runs before LinkedIn's own scripts on the next document and records the
 * bodies of responses whose URL contains MARKER. It reads no cookies, no
 * headers and makes no request of its own.
 *
 * Data is kept in window.__sp and drained by scripts/collect-in-page.js.
 * Memory is bounded: at most MAX_HELD_CAPTURES entries and MAX_HELD_CHARS
 * characters are held at once; anything above is counted in `dropped`.
 */
(function savedPostsCaptureHook() {
  "use strict";

  // ---- Configuration (edit here if LinkedIn renames the query) ----------
  var MARKER = "SEARCH_MY_ITEMS_SAVED_POSTS";
  var MAX_HELD_CAPTURES = 120;
  var MAX_BODY_CHARS = 4000000;
  var MAX_HELD_CHARS = 40000000;
  // ------------------------------------------------------------------------

  if (window.__sp && window.__sp.installed) return;

  var state = {
    installed: true,
    version: 1,
    marker: MARKER,
    captures: [],
    heldChars: 0,
    seen: 0,
    dropped: 0,
    readErrors: 0,
    drain: function drain() {
      var out = state.captures;
      state.captures = [];
      state.heldChars = 0;
      return out;
    },
  };
  try {
    Object.defineProperty(window, "__sp", { value: state, configurable: false, enumerable: false, writable: false });
  } catch (_error) {
    window.__sp = state;
  }

  function matches(url) {
    return typeof url === "string" && url.indexOf(MARKER) !== -1;
  }

  function absolute(url) {
    try { return new URL(String(url), location.href).href; } catch (_error) { return String(url); }
  }

  function push(url, status, body, via) {
    state.seen += 1;
    if (typeof body !== "string") { state.readErrors += 1; return; }
    if (body.length > MAX_BODY_CHARS || state.captures.length >= MAX_HELD_CAPTURES ||
        state.heldChars + body.length > MAX_HELD_CHARS) {
      state.dropped += 1;
      return;
    }
    state.heldChars += body.length;
    state.captures.push({ url: absolute(url), status: status, body: body, via: via, at: Date.now() });
  }

  function readXhrBody(xhr, done) {
    try {
      var type = xhr.responseType;
      if (type === "" || type === "text") { done(xhr.responseText); return; }
      if (type === "json") { done(xhr.response == null ? null : JSON.stringify(xhr.response)); return; }
      if (type === "blob") {
        if (xhr.response && typeof xhr.response.text === "function") {
          xhr.response.text().then(done, function () { done(null); });
        } else { done(null); }
        return;
      }
      if (type === "arraybuffer") {
        done(xhr.response ? new TextDecoder("utf-8").decode(new Uint8Array(xhr.response)) : null);
        return;
      }
      done(null);
    } catch (_error) {
      done(null);
    }
  }

  var XHR = window.XMLHttpRequest;
  if (XHR && XHR.prototype) {
    var originalOpen = XHR.prototype.open;
    var originalSend = XHR.prototype.send;
    XHR.prototype.open = function (method, url) {
      try { this.__spUrl = String(url); } catch (_error) { /* keep page behaviour */ }
      return originalOpen.apply(this, arguments);
    };
    XHR.prototype.send = function () {
      var xhr = this;
      try {
        if (matches(xhr.__spUrl)) {
          xhr.addEventListener("loadend", function () {
            readXhrBody(xhr, function (body) { push(xhr.__spUrl, xhr.status, body, "xhr"); });
          });
        }
      } catch (_error) { /* keep page behaviour */ }
      return originalSend.apply(this, arguments);
    };
  }

  var originalFetch = window.fetch;
  if (typeof originalFetch === "function") {
    window.fetch = function (input, init) {
      var url = "";
      try { url = typeof input === "string" ? input : (input && input.url) || String(input); } catch (_error) { url = ""; }
      var promise = originalFetch.apply(this, arguments);
      if (matches(url)) {
        promise.then(function (response) {
          try {
            response.clone().text().then(function (body) { push(url, response.status, body, "fetch"); }, function () { push(url, response.status, null, "fetch"); });
          } catch (_error) { state.readErrors += 1; }
        }, function () { /* the page handles its own failure */ });
      }
      return promise;
    };
  }
})();
