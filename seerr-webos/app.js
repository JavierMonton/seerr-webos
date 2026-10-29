// Seerr for webOS - plain JS, no build step.
(function () {
"use strict";

// webOS lifecycle: v0.6.4 shipped with "handlesRelaunch": true but never
// handled the webOSRelaunch event. Per LG docs, with handlesRelaunch=true
// the platform keeps the app hidden in the background after a relaunch
// until the app calls PalmSystem.activate(). Result: first launch after a
// reboot worked, but after pressing HOME, tapping the icon again fired
// webOSRelaunch and the app stayed hidden ("nothing happens").
// Fix: appinfo.json now uses "handlesRelaunch": false (the OS brings the
// app to the foreground automatically), AND we handle the relaunch event
// explicitly as defense-in-depth (covers TVs that cached the old appinfo).
function webOSActivate() {
  try {
    if (typeof PalmSystem !== "undefined" && PalmSystem && typeof PalmSystem.activate === "function") PalmSystem.activate();
  } catch (e) {}
  try {
    if (typeof webOSSystem !== "undefined" && webOSSystem && typeof webOSSystem.activate === "function") webOSSystem.activate();
  } catch (e) {}
}
try {
  document.addEventListener("webOSRelaunch", function () { webOSActivate(); }, true);
  document.addEventListener("webOSLaunch", function () { webOSActivate(); }, true);
} catch (e) {}

var LS_KEY = "seerrwebos.cfg";
var APP_VERSION = "0.6.5";
function loadCfg() {
  var cfg = { server: "", apiKey: "", language: "en-US" };
  try {
    if (typeof SEERR_DEFAULTS !== "undefined") {
      if (SEERR_DEFAULTS.server) cfg.server = SEERR_DEFAULTS.server;
      if (SEERR_DEFAULTS.apiKey) cfg.apiKey = SEERR_DEFAULTS.apiKey;
      if (SEERR_DEFAULTS.language) cfg.language = SEERR_DEFAULTS.language;
    }
    var raw = localStorage.getItem(LS_KEY);
    if (raw) {
      var saved = JSON.parse(raw);
      if (saved.server) cfg.server = saved.server;
      if (saved.apiKey) cfg.apiKey = saved.apiKey;
      if (saved.language) cfg.language = saved.language;
    }
  } catch (e) {}
  return cfg;
}
var CFG = loadCfg();
function saveCfg() {
  try { localStorage.setItem(LS_KEY, JSON.stringify(CFG)); } catch (e) {}
}
function baseUrl() { return (CFG.server || "").replace(/\/+$/, ""); }
var PENDING_PRESET = null;
function regionOf() {
  var l = (CFG.language || "en-US").split("-");
  return (l[1] || "US").toUpperCase();
}

function el(tag, cls, text) {
  var d = document.createElement(tag);
  if (cls) d.className = cls;
  if (text !== undefined && text !== null) d.textContent = text;
  return d;
}
function toast(msg, ms) {
  var t = document.getElementById("toast");
  t.textContent = msg;
  t.classList.remove("hidden");
  clearTimeout(toast._h);
  toast._h = setTimeout(function () { t.classList.add("hidden"); }, ms || 2800);
}

function api(path, opts) {
  opts = opts || {};
  var url = baseUrl() + "/api/v1" + path;
  var headers = { "Accept": "application/json" };
  if (CFG.apiKey) headers["X-Api-Key"] = CFG.apiKey;
  if (opts.body !== undefined) headers["Content-Type"] = "application/json";
  return fetch(url, {
    method: opts.method || "GET",
    headers: headers,
    body: opts.body !== undefined ? JSON.stringify(opts.body) : undefined
  }).then(function (res) {
    if (!res.ok) {
      var err = new Error("HTTP " + res.status);
      err.status = res.status;
      return res.text().then(function (t) {
        err.body = (t || "").slice(0, 220);
        throw err;
      });
    }
    if (res.status === 204) return null;
    return res.json();
  });
}
function img(path, size) {
  if (!path) return "";
  return "https://image.tmdb.org/t/p/" + (size || "w342") + path;
}
function listOf(d) {
  if (!d) return [];
  if (Array.isArray(d)) return d;
  if (Array.isArray(d.results)) return d.results;
  if (d.results && Array.isArray(d.results.results)) return d.results.results;
  return [];
}

var STATUS = {
  1: { t: "Request", c: "" },
  2: { t: "Pending", c: "wait" },
  3: { t: "Processing", c: "wait" },
  4: { t: "Available", c: "ok" },
  5: { t: "Available", c: "ok" },
  6: { t: "Request", c: "" }
};
function statusOf(item) {
  var s = item && item.mediaInfo && typeof item.mediaInfo.status === "number"
    ? item.mediaInfo.status : 1;
  return STATUS[s] || STATUS[1];
}
function isAvail(item) {
  var s = item && item.mediaInfo && item.mediaInfo.status;
  return s === 4 || s === 5;
}
function isPending(item) {
  var s = item && item.mediaInfo && item.mediaInfo.status;
  return s === 2 || s === 3;
}
function titleOf(m) { return m.title || m.name || "Untitled"; }
function yearOf(m) {
  var d = m.releaseDate || m.firstAirDate || "";
  return d ? d.slice(0, 4) : "";
}
function genreNames(m) {
  if (!m.genres || !m.genres.length) return "";
  return m.genres.map(function (g) { return typeof g === "string" ? g : g.name; }).filter(Boolean).join(", ");
}
function certOf(d) {
  try {
    var r = (d.contentRatings && d.contentRatings.results) || [];
    for (var i = 0; i < r.length; i++) if (r[i].iso_3166_1 === "US" && r[i].rating) return r[i].rating;
    for (var j = 0; j < r.length; j++) if (r[j].iso_3166_1 === "GB" && r[j].rating) return r[j].rating;
  } catch (e) {}
  return d.certification || "";
}
function money(n) {
  if (n === undefined || n === null || n === 0) return "";
  return "$" + Number(n).toLocaleString("en-US") + ".00";
}
function pickRatings(det, extra) {
  var out = [];
  function num(v) {
    if (typeof v === "number" && isFinite(v)) return v;
    if (typeof v === "string") { var m = v.match(/[\d.]+/); if (m) return parseFloat(m[0]); }
    return null;
  }
  function findKey(obj, re) {
    if (!obj || typeof obj !== "object") return null;
    for (var k in obj) {
      if (!Object.prototype.hasOwnProperty.call(obj, k)) continue;
      if (re.test(k)) { var v = num(obj[k]); if (v !== null) return v; }
      if (typeof obj[k] === "object") { var v2 = findKey(obj[k], re); if (v2 !== null) return v2; }
    }
    return null;
  }
  var rtC = findKey(extra, /critic/i), rtA = findKey(extra, /audience/i), imdb = findKey(extra, /imdb/i);
  if (rtC !== null) out.push({ k: "RT", v: Math.round(rtC) + "%" });
  if (rtA !== null) out.push({ k: "AUD", v: Math.round(rtA) + "%" });
  if (imdb !== null) out.push({ k: "IMDb", v: (Math.round(imdb * 10) / 10) + "" });
  var tmdb = det && det.voteAverage ? Math.round(det.voteAverage * 10) : null;
  if (tmdb !== null) out.push({ k: "TMDB", v: tmdb + "%" });
  return out.slice(0, 4);
}

var stack = [];
var currentFocus = null;
function focusables() {
  var all = document.querySelectorAll("#view .f, #sidebar .f, #topbar .f");
  var out = [];
  for (var i = 0; i < all.length; i++) {
    var r = all[i].getBoundingClientRect();
    if (r.width > 0 && r.height > 0) out.push(all[i]);
  }
  return out;
}
function setFocus(node) {
  if (currentFocus && currentFocus.classList) currentFocus.classList.remove("focus");
  currentFocus = node;
  if (node) {
    node.classList.add("focus");
    try { node.scrollIntoView({ block: "nearest", inline: "nearest" }); }
    catch (e) { try { node.scrollIntoView(false); } catch (e2) {} }
  }
}
function center(node) {
  var r = node.getBoundingClientRect();
  return { x: r.left + r.width / 2, y: r.top + r.height / 2 };
}
function zoneOf(node) {
  while (node && node !== document) {
    if (node.id === "sidebar") return "side";
    if (node.id === "main" || node.id === "topbar" || node.id === "view") return "main";
    node = node.parentNode;
  }
  return "main";
}
function rowLayout(container) {
  // same on-screen top = same row
  var kids = [];
  for (var i = 0; i < container.childNodes.length; i++) {
    var n = container.childNodes[i];
    if (n.classList && n.classList.contains("f")) {
      var r = n.getBoundingClientRect();
      if (r.width > 0 && r.height > 0) kids.push(n);
    }
  }
  var rows = [], r, i, placed;
  for (i = 0; i < kids.length; i++) {
    var t = kids[i].getBoundingClientRect().top;
    placed = false;
    for (r = 0; r < rows.length; r++) {
      if (Math.abs(rows[r][0].getBoundingClientRect().top - t) <= 12) { rows[r].push(kids[i]); placed = true; break; }
    }
    if (!placed) rows.push([kids[i]]);
  }
  rows.sort(function (a, b) { return a[0].getBoundingClientRect().top - b[0].getBoundingClientRect().top; });
  for (r = 0; r < rows.length; r++) {
    rows[r].sort(function (a, b) { return a.getBoundingClientRect().left - b.getBoundingClientRect().left; });
  }
  var row = -1, idx = -1;
  for (r = 0; r < rows.length; r++) {
    for (i = 0; i < rows[r].length; i++) {
      if (rows[r][i] === currentFocus) { row = r; idx = i; }
    }
  }
  return { rows: rows, row: row, idx: idx };
}
function nearestCol(row) {
  var r0 = currentFocus.getBoundingClientRect();
  var x0 = r0.left + r0.width / 2, best = null, bestOv = -1, bestDx = Infinity, i;
  for (i = 0; i < row.length; i++) {
    var r1 = row[i].getBoundingClientRect();
    var ov = Math.min(r0.right, r1.right) - Math.max(r0.left, r1.left);
    var dx = Math.abs((r1.left + r1.width / 2) - x0);
    if (ov > bestOv || (ov === bestOv && dx < bestDx)) { bestOv = ov; bestDx = dx; best = row[i]; }
  }
  return best;
}
function move(dir) {
  var items = focusables();
  if (!items.length) return;
  if (!currentFocus || !document.contains(currentFocus)) { setFocus(items[0]); return; }
  function scoreCand(c, p) {
    var dx = p.x - c.x, dy = p.y - c.y, ok, primary, secondary;
    ok = (dir === "left" && dx < -4) || (dir === "right" && dx > 4) ||
         (dir === "up" && dy < -4) || (dir === "down" && dy > 4);
    if (!ok) return null;
    primary = (dir === "left" || dir === "right") ? Math.abs(dx) : Math.abs(dy);
    secondary = (dir === "left" || dir === "right") ? Math.abs(dy) : Math.abs(dx);
    return { primary: primary, secondary: secondary };
  }
  function pick(cands) {
    var horizontal = (dir === "left" || dir === "right");
    var c = center(currentFocus), list = [], i, p, s;
    for (i = 0; i < cands.length; i++) {
      if (cands[i] === currentFocus) continue;
      p = center(cands[i]);
      s = scoreCand(c, p);
      if (s) list.push({ node: cands[i], primary: s.primary, secondary: s.secondary });
    }
    if (!list.length) return null;
    // closest row first, then closest item inside it
    var bandMetric = horizontal ? "secondary" : "primary";
    var alongMetric = horizontal ? "primary" : "secondary";
    var minB = Infinity, k;
    for (k = 0; k < list.length; k++) if (list[k][bandMetric] < minB) minB = list[k][bandMetric];
    var tol = horizontal ? 45 : 30;
    var band = [];
    for (k = 0; k < list.length; k++) if (list[k][bandMetric] <= minB + tol) band.push(list[k]);
    if (!band.length) band = list;
    var best = null, bestScore = Infinity, score;
    for (k = 0; k < band.length; k++) {
      score = band[k][alongMetric] * 4 + band[k][bandMetric] * 0.3;
      var r0 = currentFocus.getBoundingClientRect(), r1 = band[k].node.getBoundingClientRect();
      if (dir === "up" || dir === "down") {
        var overlapX = Math.min(r0.right, r1.right) - Math.max(r0.left, r1.left);
        if (overlapX > Math.min(r0.width, r1.width) * 0.3) score -= 30;
      } else {
        var overlapY = Math.min(r0.bottom, r1.bottom) - Math.max(r0.top, r1.top);
        if (overlapY > Math.min(r0.height, r1.height) * 0.3) score -= 30;
      }
      if (score < bestScore) { bestScore = score; best = band[k].node; }
    }
    return best;
  }
  // stay inside the same group when possible
  var vertical = (dir === "up" || dir === "down");
  var pool = items;
  if (vertical) {
    var z = zoneOf(currentFocus);
    pool = items.filter(function (n) { return zoneOf(n) === z; });
    if (!pool.length) return;
  }
  var parent = currentFocus.parentNode;
  if (parent && parent.classList &&
      (parent.classList.contains("chips") || parent.classList.contains("grid") ||
       parent.classList.contains("row") || parent.classList.contains("toolbar") ||
       parent.classList.contains("btnrow") || parent.classList.contains("rownav"))) {
    var gr = rowLayout(parent);
    if (gr.row >= 0) {
      if (!vertical) {
        var side = gr.rows[gr.row];
        var ni = gr.idx + (dir === "right" ? 1 : -1);
        if (ni >= 0 && ni < side.length) { setFocus(side[ni]); return; }
      } else {
        var tr = gr.row + (dir === "down" ? 1 : -1);
        if (tr >= 0 && tr < gr.rows.length) {
          var t = nearestCol(gr.rows[tr]);
          if (t) { setFocus(t); return; }
        }
      }
    }
  }
  var bestAll = pick(pool);
  if (bestAll) setFocus(bestAll);
}
function goBack() {
  if (stack.length > 1) { stack.pop(); render(stack[stack.length - 1], true); }
}
document.addEventListener("keydown", function (ev) {
  var tag = document.activeElement && document.activeElement.tagName;
  var inInput = tag === "INPUT" || tag === "TEXTAREA" || tag === "SELECT";
  var k = ev.keyCode || ev.which;
  if (inInput && (k === 37 || k === 39)) return; // typing, don't steal arrows
  if (k === 37) { move("left"); ev.preventDefault(); }
  else if (k === 38) { move("up"); ev.preventDefault(); }
  else if (k === 39) { move("right"); ev.preventDefault(); }
  else if (k === 40) { move("down"); ev.preventDefault(); }
  else if (k === 13) {
    if (currentFocus && currentFocus.click) { currentFocus.click(); ev.preventDefault(); }
  } else if (k === 461 || k === 10009 || k === 27) { goBack(); ev.preventDefault(); }
});
document.addEventListener("mouseover", function (ev) {
  var n = ev.target;
  while (n && n !== document) {
    if (n.classList && n.classList.contains("f")) { setFocus(n); break; }
    n = n.parentNode;
  }
});

function needConfig() { return !baseUrl() || !CFG.apiKey; }
var VIEWS = {};
function card(item) {
  var c = el("div", "card f");
  c.setAttribute("tabindex", "0");
  var poster = item.posterPath ? img(item.posterPath, "w342") : "";
  var im = document.createElement("img");
  im.alt = titleOf(item);
  if (poster) im.src = poster;
  c.appendChild(im);
  var tag = el("div", "tag " + (item.mediaType === "tv" ? "tv" : "movie"),
    item.mediaType === "tv" ? "TV SHOW" : "MOVIE");
  c.appendChild(tag);
  if (isAvail(item)) c.appendChild(el("div", "st ok", "\u2713"));
  else if (isPending(item)) c.appendChild(el("div", "st wait", "\u25F7"));
  if (item.mediaType === "tv" && item.seasonsRequested && item.seasonsRequested.length) {
    var nums = item.seasonsRequested.slice().sort(function (a, b) { return a - b; });
    var label = nums.length > 4
      ? "S" + nums[0] + " +" + (nums.length - 1)
      : nums.map(function (n) { return "S" + n; }).join(" ");
    c.appendChild(el("div", "seas", label));
  }
  c.addEventListener("click", function () { openDetails(item); });
  return c;
}
function rowHead(title) {
  var h = el("div", "rowhead");
  var t = el("h2", null, title + " ");
  t.appendChild(el("span", "go", "›"));
  h.appendChild(t);
  return h;
}
function rowItems(items, limit) {
  var r = el("div", "row");
  items.slice(0, limit || 24).forEach(function (it) {
    if (it.mediaType === "person") return;
    r.appendChild(card(it));
  });
  return r;
}
function setBg(path) {
  document.getElementById("bg").style.backgroundImage = path ? "url('" + img(path, "w1280") + "')" : "";
}
function spinnerInto(parent, msg) {
  parent.innerHTML = "";
  parent.appendChild(el("div", "spinner", msg || "Loading…"));
}
function errInto(parent, e, what) {
  parent.innerHTML = "";
  var msg = "Error " + (e && e.status ? "(" + e.status + ") " : "") + (what || "loading") + ". Check Settings.";
  if (e && e.body) msg += " Detail: " + e.body;
  parent.appendChild(el("div", "empty", msg));
}


function vHome() {
  return { name: "home", build: function (root) {
    if (needConfig()) {
      root.appendChild(el("div", "empty", "Server or API key missing. See Settings (last item)."));
      return;
    }
    spinnerInto(root, "Loading…");
    Promise.all([
      api("/discover/trending").catch(function () { return null; }),
      api("/discover/movies").catch(function () { return null; }),
      api("/discover/tv").catch(function () { return null; }),
      api("/discover/movies/upcoming").catch(function () { return null; }),
      api("/discover/tv/upcoming").catch(function () { return null; })
    ]).then(function (res) {
      root.innerHTML = "";
      var names = ["Trending", "Popular Movies", "Popular TV Shows", "Upcoming Movies", "Upcoming TV Shows"];
      var any = false;
      res.forEach(function (d, i) {
        var items = listOf(d).filter(function (m) { return m.mediaType !== "person"; });
        if (!items.length) return;
        any = true;
        var rw = rowItems(items.slice(0, 24));
        root.appendChild(rowHead(names[i]));
        root.appendChild(rw);
      });
      if (!any) root.appendChild(el("div", "empty", "No data. Check server and API key in Settings."));
      root.appendChild(el("h2", "rowtitle", "Browse by genre"));
      var gbx = el("div");
      api("/genres/movie").then(function (g) {
        var list = Array.isArray(g) ? g : (g.results || []);
        var box = el("div", "chips explore");
        list.slice(0, 12).forEach(function (gn) {
          var c = el("button", "chip f", gn.name);
          c.addEventListener("click", function () { PENDING_PRESET = { kind: "movie", genre: gn.id }; push(VIEWS.movies()); });
          box.appendChild(c);
        });
        gbx.appendChild(box);
      }).catch(function () {});
      root.appendChild(gbx);
      root.appendChild(el("h2", "rowtitle", "Watch on"));
      var pbx = el("div");
      api("/watchproviders/movies?watchRegion=" + regionOf()).then(function (g) {
        var list = Array.isArray(g) ? g : (g.results || []);
        var box = el("div", "chips explore provs");
        list.slice(0, 12).forEach(function (p) {
          var id = p.provider_id !== undefined ? p.provider_id : p.id;
          var c = el("button", "chip f prov");
          var lg = p.logo_path || p.logoPath || null;
          if (lg) { var im = document.createElement("img"); im.src = img(lg, "w45"); im.alt = ""; c.appendChild(im); }
          c.appendChild(document.createTextNode(p.provider_name || p.name));
          c.addEventListener("click", (function (v) { return function () { PENDING_PRESET = { kind: "movie", provider: v }; push(VIEWS.movies()); }; })(id));
          box.appendChild(c);
        });
        pbx.appendChild(box);
      }).catch(function () {});
      root.appendChild(pbx);
      var f = focusables();
      if (f.length) setFocus(f[0]);
    }).catch(function (e) { errInto(root, e); });
  } };
}

function vBrowse(kind) {
  var isTv = kind === "tv";
  var state = { sort: "popularity.desc", genre: [], provider: [], year: "", page: 1, totalPages: Infinity, loading: false };
  var SORTS = [
    ["popularity.desc", "Popularity Descending"], ["popularity.asc", "Popularity Ascending"],
    ["vote_average.desc", "TMDB Rating Descending"], ["vote_average.asc", "TMDB Rating Ascending"],
    [isTv ? "first_air_date.desc" : "primary_release_date.desc", "Release Date Descending"],
    [isTv ? "first_air_date.asc" : "primary_release_date.asc", "Release Date Ascending"]
  ];
  function region() {
    var l = (CFG.language || "en-US").split("-");
    return (l[1] || "US").toUpperCase();
  }
  function query() {
    var q = "?page=" + state.page;
    if (state.genre.length) q += "&genre=" + encodeURIComponent(state.genre.join(","));
    if (state.provider.length) q += "&watchProviders=" + encodeURIComponent(state.provider.join(",")) + "&watchRegion=" + regionOf();
    if (state.year) {
      if (state.year.indexOf("lt:") === 0) {
        var yb = state.year.slice(3);
        if (isTv) { q += "&firstAirDateLte=" + (yb - 1) + "-12-31"; }
        else { q += "&primaryReleaseDateLte=" + (yb - 1) + "-12-31"; }
      } else if (isTv) { q += "&firstAirDateGte=" + state.year + "-01-01&firstAirDateLte=" + state.year + "-12-31"; }
      else { q += "&primaryReleaseDateGte=" + state.year + "-01-01&primaryReleaseDateLte=" + state.year + "-12-31"; }
    }
    return q;
  }
  function clientSort(items) {
    var mode = state.sort, arr = items.slice(), desc = mode.indexOf("asc") === -1;
    function num(m) {
      if (mode.indexOf("vote_average") === 0) return m.voteAverage || 0;
      if (mode.indexOf("release") === 0 || mode.indexOf("first_air") === 0) return (m.releaseDate || m.firstAirDate || "");
      return m.popularity || 0;
    }
    arr.sort(function (x, y) {
      var a = num(x), b = num(y);
      if (a < b) return desc ? 1 : -1;
      if (a > b) return desc ? -1 : 1;
      return 0;
    });
    return arr;
  }
  function base() {
    return "/discover/" + (isTv ? "tv" : "movies");
  }
  function loadMore(grid, wrap, sentinel, firstLoad) {
    if (state.loading) return;
    if (state.page > state.totalPages) return;
    state.loading = true;
    sentinel.innerHTML = "";
    sentinel.appendChild(el("div", "spinner", "Loading more…"));
    api(base() + query()).then(function (d) {
      state.loading = false;
      if (d && typeof d.totalPages === "number") state.totalPages = d.totalPages;
      var items = listOf(d).filter(function (m) { return (m.mediaType || (isTv ? "tv" : "movie")) !== "person"; });
      items.forEach(function (m) { if (!m.mediaType) m.mediaType = isTv ? "tv" : "movie"; });
      items = clientSort(items);
      if (state.page === 1 && !items.length) {
        wrap.innerHTML = "";
        sentinel.innerHTML = "";
        sentinel.appendChild(el("div", "empty", "No results."));
        return;
      }
      items.forEach(function (m) { wrap.appendChild(card(m)); });
      state.page++;
      sentinel.innerHTML = "";
      if (state.page <= state.totalPages) {
        var more = el("button", "btn f", "Load more");
        more.addEventListener("click", function () { loadMore(grid, wrap, sentinel, false); });
        sentinel.appendChild(more);
        // keep loading while the grid doesn't fill the screen
        try {
          var view = document.getElementById("view");
          if (wrap.getBoundingClientRect().bottom < view.getBoundingClientRect().bottom + 600) {
            loadMore(grid, wrap, sentinel, false);
            return;
          }
        } catch (e) {}
        if (firstLoad) {
          var f = focusables();
          if (f.length) setFocus(f[0]);
        }
      } else {
        sentinel.appendChild(el("div", "tabline", "End of list."));
      }
    }).catch(function (e) {
      state.loading = false;
      sentinel.innerHTML = "";
      if (state.page === 1) { errInto(grid, e); return; }
      var retry = el("button", "btn f", "Retry loading more");
      retry.addEventListener("click", function () { loadMore(grid, wrap, sentinel, false); });
      sentinel.appendChild(retry);
    });
  }
  function resetAndLoad(grid) {
    state.page = 1;
    state.totalPages = Infinity;
    state.loading = false;
    grid.innerHTML = "";
    var wrap = el("div", "grid");
    grid.appendChild(wrap);
    var sentinel = el("div", "sentinel");
    grid.appendChild(sentinel);
    var view = document.getElementById("view");
    view.onscroll = function () {
      try {
        if (state.loading || state.page > state.totalPages) return;
        if (view.scrollTop + view.clientHeight > view.scrollHeight - 700) {
          loadMore(grid, wrap, sentinel, false);
        }
      } catch (e) {}
    };
    loadMore(grid, wrap, sentinel, true);
  }
  return { name: isTv ? "series" : "movies", build: function (root) {
    if (needConfig()) { root.appendChild(el("div", "empty", "Server or API key missing.")); return; }
    if (PENDING_PRESET && (PENDING_PRESET.kind === undefined || PENDING_PRESET.kind === (isTv ? "tv" : "movie"))) {
      if (PENDING_PRESET.genre !== undefined) state.genre = [PENDING_PRESET.genre];
      if (PENDING_PRESET.provider !== undefined) state.provider = [PENDING_PRESET.provider];
      PENDING_PRESET = null;
    }
    root.appendChild(el("h1", "pagetitle", isTv ? "TV Shows" : "Movies"));
    var bar = el("div", "toolbar");
    var sel = document.createElement("select");
    sel.className = "dark f";
    SORTS.forEach(function (o) {
      var op = document.createElement("option");
      op.value = o[0]; op.textContent = o[1];
      if (o[0] === state.sort) op.selected = true;
      sel.appendChild(op);
    });
    sel.addEventListener("change", function () { state.sort = sel.value; resetAndLoad(grid); });
    bar.appendChild(sel);
    var nf = state.genre.length + state.provider.length + (state.year ? 1 : 0);
    var fb = el("button", "btn f", "Filters (" + nf + " active)");
    fb.addEventListener("click", function () { push(vFilter({ state: state, isTv: isTv, SORTS: SORTS, region: region })); });
    bar.appendChild(fb);
    root.appendChild(bar);
    var grid = el("div");
    root.appendChild(grid);
    resetAndLoad(grid);
  } };
}

function requestedSeasonsOf(d) {
  var map = {}, n = 0;
  try {
    var reqs = (d && d.mediaInfo && d.mediaInfo.requests) || [];
    reqs.forEach(function (r) {
      (r.seasons || []).forEach(function (s) {
        if (s && s.seasonNumber !== undefined && s.seasonNumber !== null && !map[s.seasonNumber]) {
          map[s.seasonNumber] = r.status;
          n++;
        }
      });
    });
  } catch (e) {}
  return { map: map, count: n };
}
function reqModal(item, seasons, reqMap) {
  return { name: "request", item: item, build: function (root) {
    setBg(item.backdropPath);
    root.appendChild(el("h1", "pagetitle", item.mediaType === "tv" ? "Request TV Show" : "Request Movie"));
    root.appendChild(el("h2", null, titleOf(item)));
    if (item.mediaType === "tv" && seasons && seasons.length) {
      var sel = {};
      var list = el("div");
      seasons.forEach(function (s) {
        if (s.seasonNumber === undefined || s.seasonNumber === null) return;
        var rowb = el("button", "seasonrow f");
        rowb.appendChild(el("span", "n", "Season " + s.seasonNumber));
        rowb.appendChild(el("span", "e", (s.episodeCount || "?") + " episodes"));
        var already = reqMap && reqMap[s.seasonNumber] !== undefined;
        var cur = already ? { t: "Requested", c: "" } : statusOf({ mediaInfo: s.mediaInfo });
        rowb.appendChild(el("span", "pill " + (cur.t === "Request" ? "gray" : (cur.t === "Available" ? "green" : "")), cur.t));
        rowb._sel = false;
        rowb._n = s.seasonNumber;
        rowb.addEventListener("click", function () {
          rowb._sel = !rowb._sel;
          if (rowb._sel) rowb.classList.add("sel");
          else rowb.classList.remove("sel");
        });
        rowb._toggle = function () {
          rowb._sel = !rowb._sel;
          if (rowb._sel) rowb.classList.add("sel");
          else rowb.classList.remove("sel");
        };
        list.appendChild(rowb);
      });
      root.appendChild(list);
      var btns = el("div", "btnrow");
      var all = el("button", "btn f primary", "Request all");
      all.addEventListener("click", function () { doReq("all"); });
      btns.appendChild(all);
      var some = el("button", "btn f", "Request selection");
      some.addEventListener("click", function () {
        var picks = [];
        var rs = list.querySelectorAll(".seasonrow");
        for (var i = 0; i < rs.length; i++) if (rs[i]._sel) picks.push(rs[i]._n);
        if (!picks.length) { toast("Select at least one season"); return; }
        doReq(picks);
      });
      btns.appendChild(some);
      var back = el("button", "btn f", "Cancel");
      back.addEventListener("click", goBack);
      btns.appendChild(back);
      root.appendChild(btns);
    } else {
      var btns2 = el("div", "btnrow");
      var one = el("button", "btn f primary", "Confirm request");
      one.addEventListener("click", function () { doReq(undefined); });
      btns2.appendChild(one);
      var back2 = el("button", "btn f", "Cancel");
      back2.addEventListener("click", goBack);
      btns2.appendChild(back2);
      root.appendChild(btns2);
    }
    function doReq(seasons) {
      var body = { mediaId: item.id, mediaType: item.mediaType };
      if (item.mediaType === "tv") body.seasons = seasons || "all";
      api("/request", { method: "POST", body: body }).then(function () {
        toast("Request sent");
        goBack();
      }).catch(function (e) { toast("Error (" + (e.status || "red") + ")", 3500); });
    }
    var f = focusables();
    if (f.length) setFocus(f[0]);
  } };
}

function factsRow(k, v) {
  var r = el("div", "frow");
  r.appendChild(el("div", "k", k));
  r.appendChild(el("div", "v", v));
  return r;
}
function vFilter(ctx) {
  return { name: "filters", build: function (root) {
    var st = ctx.state, isTv = ctx.isTv;
    root.appendChild(el("h1", "pagetitle", "Filters"));
    var wrap = el("div", "drawer");
    wrap.appendChild(el("h3", "sec", "Sort by"));
    var sel = document.createElement("select");
    sel.className = "dark f";
    ctx.SORTS.forEach(function (o) {
      var op = document.createElement("option");
      op.value = o[0]; op.textContent = o[1];
      if (o[0] === st.sort) op.selected = true;
      sel.appendChild(op);
    });
    sel.addEventListener("change", function () { st.sort = sel.value; st.page = 1; });
    wrap.appendChild(sel);
    wrap.appendChild(el("h3", "sec", "Genres (multiple)"));
    var gb = el("div", "chips");
    wrap.appendChild(gb);
    api("/genres/" + (isTv ? "tv" : "movie")).then(function (g) {
      var list = Array.isArray(g) ? g : (g.results || g.genres || []);
      paintMulti(gb, list.slice(0, 20), st.genre);
    }).catch(function () { gb.appendChild(el("div", "empty", "No genres")); });
    wrap.appendChild(el("h3", "sec", "Platforms (multiple)"));
    var pb = el("div", "chips");
    wrap.appendChild(pb);
    api("/watchproviders/" + (isTv ? "tv" : "movies") + "?watchRegion=" + ctx.region()).then(function (g) {
      var list = Array.isArray(g) ? g : (g.results || []);
      paintMulti(pb, list.slice(0, 20).map(function (p) {
        return { id: p.provider_id !== undefined ? p.provider_id : p.id, name: p.provider_name || p.name, logo: p.logo_path || p.logoPath || null };
      }), st.provider);
    }).catch(function () { pb.appendChild(el("div", "empty", "No providers")); });
    wrap.appendChild(el("h3", "sec", "Year"));
    var yb = el("div", "chips");
    wrap.appendChild(yb);
    (function () {
      var years = [];
      var y = new Date().getFullYear() + 1;
      for (var k = 0; k < 20; k++) years.push({ id: String(y - k), name: String(y - k) });
      years.push({ id: "lt:" + (y - 20), name: "< " + (y - 20) });
      paintSet(yb, years, st.year || "", function (v) { st.year = v; st.page = 1; });
    })();
    var btns = el("div", "btnrow");
    var clear = el("button", "btn f", "Clear all");
    clear.addEventListener("click", function () { st.genre = []; st.provider = []; st.year = ""; st.sort = ctx.SORTS[0][0]; goBack(); });
    btns.appendChild(clear);
    var back = el("button", "btn f primary", "\u2190 Back");
    back.addEventListener("click", goBack);
    btns.appendChild(back);
    wrap.appendChild(btns);
    root.appendChild(wrap);
    function paintMulti(box, list, selected) {
      box.innerHTML = "";
      function isOn(id) {
        for (var i = 0; i < selected.length; i++) if (String(selected[i]) === String(id)) return true;
        return false;
      }
      list.forEach(function (it) {
        var c = el("button", "chip f prov" + (isOn(it.id) ? " on" : ""));
        c._val = it.id;
        if (it.logo) {
          var im = document.createElement("img");
          im.src = img(it.logo, "w45");
          im.alt = "";
          c.appendChild(im);
        }
        c.appendChild(document.createTextNode(it.name));
        c.addEventListener("click", (function (v, btn) { return function () {
          var at = -1;
          for (var i = 0; i < selected.length; i++) if (String(selected[i]) === String(v)) at = i;
          if (at >= 0) { selected.splice(at, 1); btn.classList.remove("on"); }
          else { selected.push(v); btn.classList.add("on"); }
          setFocus(btn);
        }; })(it.id, c));
        box.appendChild(c);
      });
      var f = focusables();
      if (f.length && !currentFocus) setFocus(f[0]);
    }
    function paintSet(box, list, active, onPick) {
      box.innerHTML = "";
      list.forEach(function (it) {
        var c = el("button", "chip f prov" + (String(it.id) === String(active) ? " on" : ""));
        c._val = it.id;
        if (it.logo) {
          var im = document.createElement("img");
          im.src = img(it.logo, "w45");
          im.alt = "";
          c.appendChild(im);
        }
        c.appendChild(document.createTextNode(it.name));
        c.addEventListener("click", (function (v, btn) { return function () {
          onPick(v);
          var cs = box.querySelectorAll(".chip");
          for (var i = 0; i < cs.length; i++) {
            var on = String(cs[i]._val) === String(v);
            if (on) cs[i].classList.add("on");
            else cs[i].classList.remove("on");
          }
          setFocus(btn);
        }; })(it.id, c));
        box.appendChild(c);
      });
      var f = focusables();
      if (f.length && !currentFocus) setFocus(f[0]);
    }
    var f = focusables();
    if (f.length) setFocus(f[0]);
  } };
}

function vDetails(item) {
  return { name: "details", item: item, build: function (root) {
    spinnerInto(root, "Loading…");
    var isTv = item.mediaType === "tv";
    api("/" + (isTv ? "tv" : "movie") + "/" + item.id).then(function (d) {
      var ratingP = api("/" + (isTv ? "tv" : "movie") + "/" + item.id + "/ratingscombined").catch(function () { return null; });
      ratingP.then(function (extra) { paint(d, extra || {}); });
    }).catch(function (e) { errInto(root, e, "details"); });
    function paint(d, extra) {
      root.innerHTML = "";
      var backTop = el("button", "btn f ghost", "← Back");
      backTop.addEventListener("click", goBack);
      root.appendChild(backTop);
      setBg(d.backdropPath || item.backdropPath);
      var hero = el("div", "hero");
      hero.appendChild(el("div", "backdrop"));
      hero.appendChild(el("div", "shade"));
      var inner = el("div", "inner");
      var poster = el("img", "poster");
      poster.alt = titleOf(d);
      if (d.posterPath || item.posterPath) poster.src = img(d.posterPath || item.posterPath, "w342");
      inner.appendChild(poster);
      var head = el("div");
      var h1 = el("h1", null, titleOf(d));
      h1.appendChild(el("span", "yr", " (" + (yearOf(d) || yearOf(item)) + ")"));
      head.appendChild(h1);
      var meta = [];
      var cert = certOf(d);
      if (cert) meta.push(el("span", "cert", cert));
      var rt = (d.episodeRunTime && d.episodeRunTime[0]) || d.runtime;
      if (rt) meta.push(document.createTextNode(rt + " minutes"));
      if (isTv && d.numberOfSeasons) meta.push(document.createTextNode(d.numberOfSeasons + " Seasons"));
      var metaDiv = el("div", "meta");
      meta.forEach(function (m, i) {
        metaDiv.appendChild(m);
        if (i < meta.length - 1) metaDiv.appendChild(document.createTextNode("  |  "));
      });
      if (genreNames(d)) {
        var gdiv = el("div", "genres", genreNames(d));
        metaDiv.appendChild(gdiv);
      }
      head.appendChild(metaDiv);
      var acts = el("div", "heroactions");
      var star = el("button", "btn ghost f", "★");
      star.title = "Watchlist";
      star.addEventListener("click", function () {
        api("/watchlist", { method: "POST", body: { mediaId: item.id, mediaType: item.mediaType } }).then(function () {
          toast("Added to watchlist");
        }).catch(function (e) { toast("Watchlist: " + (e.status || "error"), 3000); });
      });
      acts.appendChild(star);
      var mediaSt = statusOf({ mediaInfo: d.mediaInfo || item.mediaInfo });
      var hasReq = !!(d.mediaInfo && d.mediaInfo.requests && d.mediaInfo.requests.length);
      var reqInfo = isTv ? requestedSeasonsOf(d) : null;
      if (!isTv && (mediaSt.t === "Available" || hasReq || mediaSt.t === "Pending" || mediaSt.t === "Processing")) {
        var doneLabel = mediaSt.t === "Available" ? "✓ Available"
          : (mediaSt.t === "Pending" || mediaSt.t === "Processing" ? "Requested (" + mediaSt.t + ")" : "Requested ✓");
        var done = el("button", "btn f", doneLabel);
        done.addEventListener("click", function () { toast(mediaSt.t === "Available" ? "Already available" : "Already requested"); });
        acts.appendChild(done);
      } else {
        var req = el("button", "btn f primary", "⇩ Request");
        req.addEventListener("click", function () {
          if (isTv && d.seasons && d.seasons.length) push(reqModal(item, d.seasons, reqInfo ? reqInfo.map : null));
          else push(reqModal(item, null));
        });
        acts.appendChild(req);
      }
      if (isTv && reqInfo && reqInfo.count) {
        head.appendChild(el("div", "tabline", "Requested: " + reqInfo.count + " season" + (reqInfo.count === 1 ? "" : "s")));
      }
      head.appendChild(acts);
      inner.appendChild(head);
      hero.appendChild(inner);
      root.appendChild(hero);
      root.appendChild(el("div", "tagline", d.tagline || ""));
      var cols = el("div", "cols");
      var left = el("div", "left");
      left.appendChild(el("h3", "sec", "Overview"));
      left.appendChild(el("div", "ov", d.overview || item.overview || ""));
      if (!isTv && d.credits && d.credits.crew) {
        var dirs = [], wr = [];
        d.credits.crew.forEach(function (p) {
          if (p.job === "Director") dirs.push(p.name);
          else if (p.job === "Screenplay" || p.job === "Writer") wr.push(p.name);
        });
        var cr = el("div", "credits");
        [[dirs, "Director"], [wr.slice(0, 1), "Writer"]].forEach(function (pair) {
          if (!pair[0].length) return;
          var c = el("div");
          c.appendChild(el("div", "who", pair[1]));
          c.appendChild(el("div", "whom", pair[0].join(", ")));
          cr.appendChild(c);
        });
        if (cr.childNodes.length) left.appendChild(cr);
      }
      if (isTv && d.keywords && d.keywords.length) {
        var kw = el("div", "kwpills");
        d.keywords.slice(0, 9).forEach(function (k) {
          kw.appendChild(el("span", "kwpill", (k.name || k)));
        });
        left.appendChild(kw);
      }
      if (isTv && d.seasons && d.seasons.length) {
        left.appendChild(el("h3", "sec", "Seasons"));
        var reqMapD = reqInfo ? reqInfo.map : {};
        d.seasons.forEach(function (s) {
          if (s.seasonNumber === undefined || s.seasonNumber === null) return;
          var rowb = el("button", "seasonrow f");
          rowb.appendChild(el("span", "n", "Season " + s.seasonNumber));
          rowb.appendChild(el("span", "e", (s.episodeCount || "?") + " episodes"));
          var cur = reqMapD[s.seasonNumber] !== undefined
            ? { t: "Requested", c: "" }
            : statusOf({ mediaInfo: s.mediaInfo });
          rowb.appendChild(el("span", "pill " + (cur.t === "Request" ? "gray" : (cur.t === "Available" ? "green" : "")), cur.t));
          rowb.addEventListener("click", (function (n) { return function () { push(reqModal(item, d.seasons, reqMapD)); }; })(s.seasonNumber));
          left.appendChild(rowb);
        });
      }
      cols.appendChild(left);
      var side = el("div", "side");
      if (d.collection && d.collection.name) {
        var cb = el("div", "collbanner", d.collection.name + "  ");
        if (d.collection.backdropPath) cb.style.backgroundImage = "url('" + img(d.collection.backdropPath, "w780") + "')";
        var vb = el("button", "btn f", "View");
        vb.addEventListener("click", function () { push(vCollection(d.collection)); });
        cb.appendChild(vb);
        side.appendChild(cb);
      }
      var ratings = pickRatings(d, extra);
      if (ratings.length) {
        var fr = el("div", "facts");
        var rr = el("div", "frow");
        ratings.forEach(function (r, i) {
          var cell = el("div", null, r.k + " " + r.v);
          cell.style.cssText = "flex:1;text-align:center;font-weight:700;";
          rr.appendChild(cell);
        });
        fr.appendChild(rr);
        side.appendChild(fr);
      }
      var facts = el("div", "facts");
      if (!isTv) {
        if (d.status) facts.appendChild(factsRow("Status", d.status));
        if (d.releaseDate) facts.appendChild(factsRow("Release Date", d.releaseDate));
        if (d.revenue) facts.appendChild(factsRow("Revenue", money(d.revenue)));
        if (d.budget) facts.appendChild(factsRow("Budget", money(d.budget)));
        if (d.originalLanguage) facts.appendChild(factsRow("Language", (d.originalLanguage || "").toUpperCase()));
      } else {
        if (d.status) facts.appendChild(factsRow("Status", d.status));
        if (d.firstAirDate) facts.appendChild(factsRow("First Air Date", d.firstAirDate));
        if (d.nextAirDate) facts.appendChild(factsRow("Next Air Date", d.nextAirDate));
        if (d.originalLanguage) facts.appendChild(factsRow("Original Language", d.originalLanguage));
        if (d.networks && d.networks.length) facts.appendChild(factsRow("Network", d.networks.map(function (n) { return n.name; }).join(", ")));
      }
      if (facts.childNodes.length) side.appendChild(facts);
      cols.appendChild(side);
      root.appendChild(cols);
      var f = focusables();
      if (f.length) setFocus(f[0]);
    }
  } };
}

function vCollection(coll) {
  return { name: "collection", build: function (root) {
    spinnerInto(root, "Loading…");
    api("/collection/" + coll.id).then(function (d) {
      root.innerHTML = "";
      root.appendChild(el("h1", "pagetitle", d.name || coll.name || "Collection"));
      var parts = listOf(d.parts);
      if (!parts.length) root.appendChild(el("div", "empty", "No titles."));
      var wrap = el("div", "grid");
      parts.forEach(function (p) {
        p.mediaType = p.mediaType || "movie";
        wrap.appendChild(card(p));
      });
      root.appendChild(wrap);
      var f = focusables();
      if (f.length) setFocus(f[0]);
    }).catch(function (e) { errInto(root, e); });
  } };
}

function normRequest(r) {
  var m = r.media || {};
  var seNums = [];
  try {
    (r.seasons || []).forEach(function (s) {
      if (s && s.seasonNumber !== undefined && s.seasonNumber !== null) seNums.push(s.seasonNumber);
    });
  } catch (e) {}
  return {
    id: m.tmdbId || r.tmdbId,
    mediaType: r.type || m.mediaType,
    title: m.title || m.name || r.title || "Request",
    posterPath: m.posterPath,
    backdropPath: m.backdropPath,
    seasonsRequested: seNums,
    seasonCount: r.seasonCount || seNums.length,
    mediaInfo: { status: typeof r.status === "number" ? r.status : 1 }
  };
}
function enrichRequest(m) {
  // /request only brings tmdbId and status, details fill in the rest
  if (m.posterPath && (m.title || m.name)) return Promise.resolve(m);
  if (!m.id || !m.mediaType) return Promise.resolve(m);
  var ep = "/" + (m.mediaType === "tv" ? "tv" : "movie") + "/" + m.id;
  return api(ep).then(function (d) {
    if (d) {
      m.title = d.title || d.name || m.title;
      m.posterPath = d.posterPath || m.posterPath;
      m.backdropPath = d.backdropPath || m.backdropPath;
    }
    return m;
  }).catch(function () { return m; });
}
function vRequests() {
  var state = { filter: "all", media: "all", sort: "added" };
  return { name: "requests", build: function (root) {
    root.appendChild(el("h1", "pagetitle", "Requests"));
    var bar = el("div", "toolbar");
    function sel(opts, cur, cb) {
      var s = document.createElement("select");
      s.className = "dark f";
      opts.forEach(function (o) {
        var op = document.createElement("option");
        op.value = o[0]; op.textContent = o[1];
        if (o[0] === cur) op.selected = true;
        s.appendChild(op);
      });
      s.addEventListener("change", function () { cb(s.value); load(); });
      bar.appendChild(s);
      return s;
    }
    sel([["all", "All"], ["movie", "Movies"], ["tv", "TV"]], state.media, function (v) { state.media = v; });
    sel([["pending", "Pending"], ["approved", "Approved"], ["available", "Available"], ["processing", "Processing"], ["all", "All"]], state.filter, function (v) { state.filter = v; });
    sel([["added", "Most Recent"], ["modified", "Recently Modified"]], state.sort, function (v) { state.sort = v; });
    root.appendChild(bar);
    var out = el("div");
    root.appendChild(out);
    function load() {
      spinnerInto(out);
      var q = "/request?filter=" + state.filter + "&take=20&sort=" + state.sort + "&sortDirection=desc&mediaType=" + state.media;
      api(q).then(function (d) {
        var items = listOf(d.results || d).map(normRequest).filter(function (m) { return m.id; });
        if (!items.length) {
          out.innerHTML = "";
          out.appendChild(el("div", "empty", "No results."));
          var all = el("button", "btn f primary", "Show All Requests");
          all.addEventListener("click", function () { state.filter = "all"; load(); });
          out.appendChild(all);
          var f0 = focusables();
          if (f0.length) setFocus(f0[0]);
          return;
        }
        // show the list first, fill in posters after
        out.innerHTML = "";
        var wrap = el("div", "grid");
        var cards = items.map(function (m) { var c = card(m); wrap.appendChild(c); return c; });
        out.appendChild(wrap);
        var f = focusables();
        if (f.length) setFocus(f[0]);
        Promise.all(items.map(enrichRequest)).then(function (full) {
          if (!document.contains(wrap)) return;
          wrap.innerHTML = "";
          full.forEach(function (m) { wrap.appendChild(card(m)); });
        });
      }).catch(function (e) { errInto(out, e, "requests"); });
    }
    load();
  } };
}

function vSearch() {
  var q = "";
  var timer = null;
  return { name: "search", build: function (root) {
    var back = el("button", "btn f ghost", "\u2190 Back");
    back.addEventListener("click", goBack);
    root.appendChild(back);
    var input = el("input", "txt f");
    input.type = "text";
    input.placeholder = "Search Movies & TV Shows";
    input.setAttribute("autocomplete", "off");
    input.value = q;
    input.addEventListener("click", function () { input.focus(); });
    input.addEventListener("keydown", function (ev) {
      var k = ev.keyCode || ev.which;
      if (k === 13) { ev.stopPropagation(); ev.preventDefault(); doSearch(); input.blur(); return; }
      if (k === 461 || k === 10009 || k === 27) { input.blur(); ev.stopPropagation(); ev.preventDefault(); return; }
      if (k === 38 || k === 40) {
        ev.stopPropagation(); ev.preventDefault();
        input.blur();
        var first = out.querySelector(".card.f, .row .f");
        if (first) { setFocus(first); return; }
        move(k === 38 ? "up" : "down");
        return;
      }
    });
    input.addEventListener("input", function () {
      if (timer) clearTimeout(timer);
      timer = setTimeout(doSearch, 700);
    });
    root.appendChild(input);
    var hint = el("div", "tabline", "Focus the text and press OK: the LG keyboard opens. Results appear automatically.");
    root.appendChild(hint);
    var out = el("div");
    root.appendChild(out);
    function doSearch() {
      q = input.value.trim();
      if (q.length < 2) { out.innerHTML = ""; return; }
      spinnerInto(out);
      api("/search?query=" + encodeURIComponent(q)).then(function (d) {
        var items = listOf(d).filter(function (m) { return m.mediaType === "movie" || m.mediaType === "tv"; });
        out.innerHTML = "";
        var rh = rowHead("Search Results (" + items.length + ")");
        out.appendChild(rh);
        if (!items.length) out.appendChild(el("div", "empty", "No results."));
        else out.appendChild(rowItems(items, 30));
      }).catch(function (e) { errInto(out, e, "searching"); });
    }
  } };
}

function vSettings() {
  return { name: "settings", build: function (root) {
    function field(label, val, secret) {
      var w = el("div", "field");
      w.appendChild(el("label", null, label));
      var i = el("input", "txt f");
      i.type = secret ? "password" : "text";
      i.value = val || "";
      w.appendChild(i);
      return { wrap: w, input: i };
    }
    root.appendChild(el("h1", "pagetitle", "Settings"));
    root.appendChild(el("div", "tabline", "App v" + APP_VERSION));
    var fServer = field("Server (e.g. http://192.168.1.10:5055)", CFG.server, false);
    var fKey = field("API key (Settings > General in Seerr)", CFG.apiKey, true);
    root.appendChild(fServer.wrap);
    root.appendChild(fKey.wrap);
    root.appendChild(el("div", "tabline", "Tip: instead of typing the key with the remote, you can edit SEERR_DEFAULTS in config.js inside the app folder on the TV (/media/developer/apps/usr/palm/applications/io.github.javiermonton.seerr/config.js) over SSH, then choose Reset."));
    var btns = el("div", "btnrow");
    function cur() { return { server: fServer.input.value.trim(), apiKey: fKey.input.value.trim() }; }
    var test = el("button", "btn f", "Test connection");
    test.addEventListener("click", function () {
      var c = cur();
      var oldS = CFG.server, oldK = CFG.apiKey;
      CFG.server = c.server; CFG.apiKey = c.apiKey;
      api("/status").then(function (d) {
        toast("OK: Seerr " + (d.version || "?"));
        CFG.server = oldS; CFG.apiKey = oldK;
      }).catch(function (e) {
        toast("Failed (" + (e.status || "net") + "): check URL and key", 4000);
        CFG.server = oldS; CFG.apiKey = oldK;
      });
    });
    btns.appendChild(test);
    var save = el("button", "btn f primary", "Save");
    save.addEventListener("click", function () {
      var c = cur();
      CFG.server = c.server; CFG.apiKey = c.apiKey;
      saveCfg();
      toast("Saved on TV");
    });
    btns.appendChild(save);
    var reset = el("button", "btn f", "Reset (use config.js)");
    reset.addEventListener("click", function () {
      try { localStorage.removeItem(LS_KEY); } catch (e) {}
      window.location.reload();
    });
    btns.appendChild(reset);
    root.appendChild(btns);
    root.appendChild(el("div", "tabline", "The key only lives on this TV. It never leaves it."));
  } };
}

var viewEl = document.getElementById("view");
var navEl = document.getElementById("nav");
VIEWS = { home: vHome, movies: function () { return vBrowse("movie"); }, series: function () { return vBrowse("tv"); }, requests: vRequests, search: vSearch, settings: vSettings };
var ICONS = {
  home: '<svg width="26" height="26" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><circle cx="12" cy="12" r="9"/><polygon points="15.5,8.5 13.5,13.5 8.5,15.5 10.5,10.5" fill="currentColor" stroke="none"/></svg>',
  movies: '<svg width="26" height="26" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><rect x="3" y="5" width="18" height="14" rx="2"/><line x1="7" y1="5" x2="7" y2="19"/><line x1="17" y1="5" x2="17" y2="19"/></svg>',
  series: '<svg width="26" height="26" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><rect x="3" y="4" width="18" height="12" rx="2"/><line x1="9" y1="20" x2="15" y2="20"/><line x1="12" y1="16" x2="12" y2="20"/></svg>',
  requests: '<svg width="26" height="26" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><circle cx="12" cy="12" r="9"/><polyline points="12,7 12,12 15.5,13.5"/></svg>',
  settings: '<svg width="26" height="26" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><circle cx="12" cy="12" r="3"/><path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 0 1 0 2.83 2 2 0 0 1-2.83 0l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 0 1-2 2 2 2 0 0 1-2-2v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 0 1-2.83 0 2 2 0 0 1 0-2.83l.06-.06a1.65 1.65 0 0 0 .33-1.82 1.65 1.65 0 0 0-1.51-1H3a2 2 0 0 1-2-2 2 2 0 0 1 2-2h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 0 1 0-2.83 2 2 0 0 1 2.83 0l.06.06a1.65 1.65 0 0 0 1.82.33H9a1.65 1.65 0 0 0 1-1.51V3a2 2 0 0 1 2-2 2 2 0 0 1 2 2v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 0 1 2.83 0 2 2 0 0 1 0 2.83l-.06.06a1.65 1.65 0 0 0-.33 1.82V9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 0 1 2 2 2 2 0 0 1-2 2h-.09a1.65 1.65 0 0 0-1.51 1z"/></svg>'
};
var NAV = [
  { id: "home", label: "Discover", icon: "home" },
  { id: "movies", label: "Movies", icon: "movies" },
  { id: "series", label: "TV Shows", icon: "series" },
  { id: "requests", label: "Requests", icon: "requests" },
  { id: "settings", label: "Settings", icon: "settings" }
];
function render(view, keepFocus) {
  navEl.innerHTML = "";
  var vb = document.getElementById("appver");
  if (!vb) {
    vb = el("div", "appver", "v" + APP_VERSION);
    vb.id = "appver";
    document.getElementById("sidebar").appendChild(vb);
  } else { vb.textContent = "v" + APP_VERSION; }
  NAV.forEach(function (n) {
    var b = el("button", "navbtn f" + (view.name === n.id ? " active" : ""), "");
    var ic = el("span", "ico", null);
    ic.innerHTML = ICONS[n.icon] || "";
    b.appendChild(ic);
    b.appendChild(document.createTextNode(n.label));
    b.addEventListener("click", function () { push(VIEWS[n.id]()); });
    navEl.appendChild(b);
  });
  var sp = document.getElementById("searchpill");
  sp.onclick = function () {
    if (!stack.length || stack[stack.length - 1].name !== "search") push(VIEWS.search());
  };
  viewEl.innerHTML = "";
  try { viewEl.onscroll = null; } catch (e) {}
  setBg(null);
  view.build(viewEl);
  currentFocus = null;
  if (!keepFocus) { var f = focusables(); if (f.length) setFocus(f[0]); }
}
function push(view) { stack.push(view); render(view, false); }
function openDetails(item) { push(vDetails(item)); }
// When the app comes back from the background (HOME then icon again),
// make sure it is activated and keyboard focus is on a visible element.
try {
  document.addEventListener("visibilitychange", function () {
    if (document.hidden) return;
    webOSActivate();
    try {
      if (!currentFocus || !document.contains(currentFocus)) {
        var f = focusables();
        if (f.length) setFocus(f[0]);
      }
    } catch (e) {}
  }, true);
} catch (e) {}
push(needConfig() ? vSettings() : vHome());

})();
