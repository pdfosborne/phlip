/* hand-create-draft.js — in-timeline create card, IME centering, field wiring.
 * Load after: hand-plan-parse.js; before: hand-create-suggest.js
 */

let _cdIconInferTimer = 0;
let _cdImeWired = false;
let _cdPopoverDismissWired = false;
let _cdLastImeH = 280;
let _cdSlotParent = null;
let _cdDateMonthCursor = 0;

function createDraftPending() {
  return (typeof S !== "undefined" && S.hand?.mode === "createDraft") ? S.hand.pending : null;
}

function createDraftDateLabel(dayTs) {
  const d = new Date(Number(dayTs) || Date.now());
  if (Number.isNaN(d.getTime())) return "";
  return d.toLocaleDateString("en-GB", { weekday: "short", day: "numeric", month: "short" });
}

function createDraftKnownPlaces() {
  const out = [];
  const seen = new Set();
  const add = (label) => {
    const v = String(label || "").trim();
    if (!v) return;
    if (typeof isCreatePlaceTbd === "function" && isCreatePlaceTbd(v)) return;
    const key = v.toLowerCase();
    if (seen.has(key)) return;
    seen.add(key);
    out.push(v);
  };
  const conn = typeof activeConn === "function" ? activeConn() : null;
  if (typeof locationsFor === "function") {
    for (const row of locationsFor(conn) || []) add(row?.label || row);
  }
  if (typeof swipeCreatePlaceOptions === "function") {
    for (const c of swipeCreatePlaceOptions()) add(c?.label || c?.place);
  }
  for (const ev of (conn?.events || [])) {
    const where = typeof shownField === "function"
      ? shownField(ev._where, ev.where)
      : (ev._where || ev.where || "");
    if (typeof parseEventPlaces === "function") {
      for (const part of parseEventPlaces(where)) add(part);
    } else {
      add(where);
    }
  }
  if (typeof PERSONAL_STARTER_LOCATIONS !== "undefined") {
    PERSONAL_STARTER_LOCATIONS.forEach(add);
  }
  return out;
}

function createDraftStringSimilarity(a, b) {
  a = String(a || "").trim().toLowerCase();
  b = String(b || "").trim().toLowerCase();
  if (!a || !b) return 0;
  if (a === b) return 1;
  const rows = a.length + 1;
  const cols = b.length + 1;
  let prev = new Array(cols);
  let cur = new Array(cols);
  for (let j = 0; j < cols; j++) prev[j] = j;
  for (let i = 1; i < rows; i++) {
    cur[0] = i;
    for (let k = 1; k < cols; k++) {
      cur[k] = Math.min(cur[k - 1] + 1, prev[k] + 1, prev[k - 1] + (a[i - 1] === b[k - 1] ? 0 : 1));
    }
    const tmp = prev;
    prev = cur;
    cur = tmp;
  }
  return 1 - (prev[cols - 1] / Math.max(a.length, b.length));
}

/** Rank a known place against typed input: prefix, contains, then fuzzy (typos). */
function createDraftLocationScore(raw, place) {
  const q = String(raw || "").trim().toLowerCase();
  const p = String(place || "").trim().toLowerCase();
  if (!q || !p || q === p) return 0;
  if (p.startsWith(q)) return 0.99;
  const words = p.split(/[\s,/]+/).filter(Boolean);
  if (words.some((w) => w.startsWith(q))) return 0.96;
  if (p.includes(q)) return 0.9;
  if (q.length < 3) return 0;
  let sim = createDraftStringSimilarity(q, p);
  if (p.length >= q.length) {
    sim = Math.max(sim, createDraftStringSimilarity(q, p.slice(0, q.length)));
  }
  for (const w of words) {
    sim = Math.max(sim, createDraftStringSimilarity(q, w));
    if (w.length >= q.length) {
      sim = Math.max(sim, createDraftStringSimilarity(q, w.slice(0, q.length)));
    }
  }
  return sim;
}

function createDraftAllowsMultiLocations() {
  return typeof allowMultiLocations === "function" && allowMultiLocations();
}

function createDraftLocationQuery(pending) {
  if (createDraftAllowsMultiLocations()) return String(pending?.locationQuery || "").trim();
  return String(pending?.where || "").trim();
}

function createDraftSelectedPlaces(pending) {
  const raw = String(pending?.where || "").trim();
  if (!raw) return [];
  return typeof parseEventPlaces === "function" ? parseEventPlaces(raw) : [raw];
}

function createDraftLocationCompletions(pending) {
  const raw = createDraftLocationQuery(pending);
  if (!raw || (typeof isCreatePlaceTbd === "function" && isCreatePlaceTbd(raw))) return [];
  const min = raw.length < 3 ? 0.88 : 0.5;
  const selected = new Set(createDraftSelectedPlaces(pending).map((v) => v.toLowerCase()));
  const multi = createDraftAllowsMultiLocations();
  return createDraftKnownPlaces()
    .filter((v) => !selected.has(String(v).toLowerCase()))
    .map((v) => {
      const score = String(v).trim().toLowerCase() === raw.toLowerCase()
        ? 1
        : createDraftLocationScore(raw, v);
      return { value: v, score };
    })
    .filter((x) => x.score >= min && (multi || x.score < 1))
    .sort((a, b) => b.score - a.score || a.value.length - b.value.length)
    .slice(0, 4);
}

/** A close match to a known place is offered as a suggestion (the chips),
 *  never a block: creating with what was written is always allowed (quick
 *  create and the create card alike). Kept for callers; always false. */
function createDraftLocationBlocked(pending) {
  return false;
}

function createDraftMapPasteName(raw, parsed) {
  if (parsed && parsed.name) return parsed.name;
  const href = (parsed && parsed.href) || "";
  const lines = String(raw || "").split(/\r?\n/);
  for (const line of lines) {
    let s = String(line || "").trim();
    if (href) s = s.split(href).join(" ");
    s = s.replace(/https?:\/\/[^\s<>"]+/gi, " ").replace(/\bgeo:[^\s<>"]+/gi, " ");
    s = s.replace(/\s+/g, " ").trim();
    if (!s || /^-?\d+(\.\d+)?\s*,\s*-?\d+/.test(s)) continue;
    if (/^[★☆\d.\s·•-]+$/.test(s)) continue;
    if (/google maps|open in maps|view (?:on|in) map/i.test(s)) continue;
    return s;
  }
  return "";
}

function applyCreateDraftLocationValue(p, raw) {
  if (!p) return;
  const text = String(raw || "").trim();
  const parsed = typeof parseMapLink === "function" ? parseMapLink(text) : null;
  if (parsed) {
    p.mapUrl = parsed.href;
    const name = createDraftMapPasteName(text, parsed) || "";
    if (name && createDraftAllowsMultiLocations() && String(p.where || "").trim()) {
      p.where = typeof toggleEventPlace === "function"
        ? (typeof eventWhereHasPlace === "function" && eventWhereHasPlace(p.where, name)
          ? p.where
          : toggleEventPlace(p.where, name))
        : p.where;
    } else if (name) {
      p.where = name;
    }
    p.locationQuery = "";
    p.locationDismissed = "";
    return;
  }
  if (createDraftAllowsMultiLocations()) {
    commitCreateDraftLocationFragment(p, text);
    if (!text && !String(p.where || "").trim()) p.mapUrl = "";
    return;
  }
  p.where = text;
  p.locationQuery = "";
  if (!text) {
    p.mapUrl = "";
    return;
  }
  createDraftRememberPlaceMap(p, text);
}

function createDraftRememberPlaceMap(p, place) {
  const known = (typeof mapUrlForKnownPlace === "function")
    ? mapUrlForKnownPlace(place)
    : "";
  if (known) p.mapUrl = known;
}

function commitCreateDraftLocationFragment(p, fragment) {
  if (!p) return;
  const text = String(fragment || "").trim();
  p.locationQuery = "";
  if (!text) return;
  if (typeof parseMapLink === "function" && parseMapLink(text)) {
    applyCreateDraftLocationValue(p, text);
    return;
  }
  if (!createDraftAllowsMultiLocations()) {
    p.where = text;
    createDraftRememberPlaceMap(p, text);
    return;
  }
  const parts = typeof parseEventPlaces === "function" ? parseEventPlaces(text) : [text];
  let where = p.where || "";
  for (const part of parts) {
    if (typeof eventWhereHasPlace === "function" && eventWhereHasPlace(where, part)) continue;
    where = typeof toggleEventPlace === "function" ? toggleEventPlace(where, part) : (where ? where + " · " + part : part);
  }
  p.where = where;
  createDraftRememberPlaceMap(p, parts[parts.length - 1] || "");
}

function toggleCreateDraftLocation(p, place) {
  if (!p) return;
  const label = String(place || "").trim();
  if (!label) return;
  p.locationQuery = "";
  p.locationDismissed = "";
  if (!createDraftAllowsMultiLocations()) {
    p.where = label;
    createDraftRememberPlaceMap(p, label);
    return;
  }
  p.where = typeof toggleEventPlace === "function" ? toggleEventPlace(p.where, label) : label;
  createDraftRememberPlaceMap(p, label);
}

async function resolveCreateDraftMapName(p) {
  if (!p || !p.mapUrl || String(p.where || "").trim()) return;
  const token = (p._mapResolveGen = (p._mapResolveGen || 0) + 1);
  const loc = document.getElementById("cd-location-input");
  if (loc && !String(p.where || "").trim()) loc.placeholder = "Finding place…";
  try {
    const resolved = typeof resolveMapLink === "function" ? await resolveMapLink(p.mapUrl) : null;
    if (p._mapResolveGen !== token) return;
    if (createDraftPending() !== p) return;
    if (resolved && resolved.name && !String(p.where || "").trim()) {
      p.where = resolved.name;
      p.locationQuery = "";
      p.locationDismissed = "";
      if (loc) loc.value = createDraftAllowsMultiLocations() ? "" : p.where;
      loc?.closest(".cd-field")?.classList.toggle("cd-needs-fill", false);
      markCreateDirty("place");
      paintCreateDraftFields();
      if (typeof renderCreateDraftSuggestions === "function") renderCreateDraftSuggestions();
      return;
    }
    if (!String(p.where || "").trim() && typeof toast === "function") {
      toast("Map attached. Add a place name.");
    }
  } catch {
    if (createDraftPending() === p && !String(p.where || "").trim() && typeof toast === "function") {
      toast("Map attached. Add a place name.");
    }
  } finally {
    if (loc) loc.placeholder = createDraftAllowsMultiLocations() ? "Add a place" : "Location";
  }
}

function ensureCreateDraftDom() {
  if (!document.getElementById("cd-dim")) {
    const dim = document.createElement("div");
    dim.id = "cd-dim";
    dim.setAttribute("aria-hidden", "true");
    document.body.appendChild(dim);
    dim.addEventListener("click", () => {
      closeCreateDraftPopovers();
    });
  }
  if (!document.getElementById("cd-layer")) {
    const layer = document.createElement("div");
    layer.id = "cd-layer";
    layer.setAttribute("aria-hidden", "true");
    layer.innerHTML = createDraftCardHtml()
      + '<div class="cd-popover" id="cd-popover" role="dialog"></div>'
      + '<div class="cd-suggestions" id="cd-suggestions" role="dialog" aria-label="Event suggestions"></div>';
    document.body.appendChild(layer);
    bindCreateDraftDom(layer);
  }
}

function createDraftCardHtml() {
  const icn = typeof ic === "function" ? ic : (n) => n;
  return `<section class="cd-card" id="cd-card" aria-label="Edit event draft">
    <div class="cd-head">
      <button type="button" class="cd-date-btn" id="cd-date-btn" aria-label="Edit event date"></button>
      <button type="button" class="cd-more-btn" id="cd-more-btn" aria-label="More options" aria-haspopup="menu">${icn("more")}</button>
      <button type="button" class="cd-close" id="cd-close" aria-label="Cancel draft">${icn("x")}</button>
    </div>
    <div class="cd-grid">
      <button type="button" class="cd-field cd-icon-field cd-needs-fill" id="cd-icon-btn" data-field="icon" aria-label="Edit event icon">
        <span class="cd-field-icon" id="cd-icon-wrap">${icn("calendar")}</span>
      </button>
      <div class="cd-field cd-title-field cd-needs-fill" data-field="title">
        <input type="text" class="cd-title-input" id="cd-title-input" placeholder="Title" aria-label="Event title" autocomplete="off" enterkeyhint="done" />
      </div>
      <div class="cd-field cd-time-field cd-needs-fill" data-field="time">
        ${icn("clock", "cd-field-icon")}
        <input type="text" class="cd-direct-input" id="cd-time-input" placeholder="TBD" aria-label="Event time" autocomplete="off" />
        <button type="button" class="cd-time-suggest" id="cd-time-grid-btn" aria-label="Pick time">${icn("chevron-down")}</button>
      </div>
      <div class="cd-field cd-location-field cd-needs-fill" data-field="location">
        <div class="cd-location-stack">
          <div class="cd-location-row">
            ${icn("pin", "cd-field-icon")}
            <input type="text" class="cd-direct-input" id="cd-location-input" placeholder="Location" aria-label="Event location" autocomplete="off" />
            <span class="cd-location-warning" id="cd-location-warning" title="Close location match found">${icn("triangle-alert")}</span>
          </div>
          <div class="cd-location-chips" id="cd-location-chips" aria-live="polite"></div>
        </div>
      </div>
    </div>
    <div class="cd-actions">
      <span class="cd-note" id="cd-note" hidden></span>
      <button type="button" class="cd-dismiss-btn" id="cd-dismiss-btn">Dismiss warning</button>
      <button type="button" class="cd-create-btn" id="cd-create-btn">Create</button>
    </div>
  </section>`;
}

function bindCreateDraftDom(layer) {
  layer.querySelector("#cd-close")?.addEventListener("click", () => closeCreateDraft(true));
  layer.querySelector("#cd-more-btn")?.addEventListener("click", (e) => {
    e.preventDefault();
    e.stopPropagation();
    openCreateDraftMoreMenu(e.currentTarget);
  });
  layer.querySelector("#cd-date-btn")?.addEventListener("click", (e) => {
    e.preventDefault();
    e.stopPropagation();
    openCreateDraftDatePopover(e.currentTarget);
  });
  layer.querySelector("#cd-icon-btn")?.addEventListener("click", (e) => {
    e.preventDefault();
    e.stopPropagation();
    openCreateDraftIconPopover(e.currentTarget);
  });
  layer.querySelector("#cd-time-grid-btn")?.addEventListener("click", (e) => {
    e.preventDefault();
    e.stopPropagation();
    openCreateDraftTimeGrid(e.currentTarget);
  });
  layer.querySelector("#cd-create-btn")?.addEventListener("click", () => {
    void commitCreateDraft();
  });
  layer.querySelector("#cd-dismiss-btn")?.addEventListener("click", () => {
    const p = createDraftPending();
    if (!p) return;
    p.locationDismissed = createDraftLocationQuery(p);
    paintCreateDraftFields();
  });
  wireCreateDraftPopoverDismiss();

  const title = layer.querySelector("#cd-title-input");
  title?.addEventListener("focus", () => onCreateDraftFieldFocus("title"));
  title?.addEventListener("input", () => {
    const p = createDraftPending();
    if (!p) return;
    p.title = title.value;
    p.subtitle = title.value;
    markCreateDirty("title");
    title.closest(".cd-field")?.classList.toggle("cd-needs-fill", !title.value.trim());
    scheduleCreateDraftIconInfer();
    paintCreateDraftActions();
    if (typeof renderCreateDraftSuggestions === "function") renderCreateDraftSuggestions();
  });
  title?.addEventListener("keydown", (e) => {
    if (e.key !== "Enter") return;
    e.preventDefault();
    const p = createDraftPending();
    if (p) {
      p.title = title.value.trim();
      p.subtitle = p.title;
    }
    inferCreateDraftIconFromTitle();
    title.blur();
    blurCreateDraftInputs();
    setCreateDraftKeyboardOpen(false);
  });
  title?.addEventListener("blur", () => {
    const p = createDraftPending();
    if (!p) return;
    p.title = title.value.trim();
    p.subtitle = p.title;
    title.value = p.title;
    if (p.title) markCreateDirty("title");
    inferCreateDraftIconFromTitle();
    title.closest(".cd-field")?.classList.remove("cd-is-focused");
    paintCreateDraftFields();
  });

  const time = layer.querySelector("#cd-time-input");
  time?.addEventListener("focus", () => onCreateDraftFieldFocus("time"));
  time?.addEventListener("input", () => {
    const p = createDraftPending();
    if (!p) return;
    p.timeText = time.value;
    markCreateDirty("time");
    if (time.value.trim()) applyCreateTimeParse(p, time.value);
    else clearCreateTime(p);
    time.closest(".cd-field")?.classList.toggle("cd-needs-fill", p.timeStartMin == null && !String(p.timeText || "").trim());
    paintCreateDraftActions();
    if (typeof renderCreateDraftSuggestions === "function") renderCreateDraftSuggestions();
  });
  time?.addEventListener("keydown", (e) => {
    if (e.key === "Enter") { e.preventDefault(); time.blur(); }
  });
  time?.addEventListener("blur", () => {
    const p = createDraftPending();
    if (!p) return;
    const raw = time.value.trim();
    if (raw && applyCreateTimeParse(p, raw)) time.value = p.timeText;
    else if (!raw) clearCreateTime(p);
    time.closest(".cd-field")?.classList.remove("cd-is-focused");
    paintCreateDraftFields();
  });

  const loc = layer.querySelector("#cd-location-input");
  loc?.addEventListener("focus", () => onCreateDraftFieldFocus("location"));
  loc?.addEventListener("paste", (e) => {
    const text = e.clipboardData?.getData("text/plain") || "";
    if (typeof parseMapLink !== "function" || !parseMapLink(text)) return;
    e.preventDefault();
    e.stopPropagation();
    const p = createDraftPending();
    if (!p) return;
    applyCreateDraftLocationValue(p, text);
    loc.value = createDraftAllowsMultiLocations() ? (p.locationQuery || "") : (p.where || "");
    p.locationDismissed = "";
    markCreateDirty("place");
    loc.closest(".cd-field")?.classList.toggle("cd-needs-fill", !String(p.where || "").trim());
    paintCreateDraftLocation();
    paintCreateDraftActions();
    if (typeof renderCreateDraftSuggestions === "function") renderCreateDraftSuggestions();
    if (p.mapUrl && !String(p.where || "").trim()) void resolveCreateDraftMapName(p);
  });
  loc?.addEventListener("input", () => {
    const p = createDraftPending();
    if (!p) return;
    if (createDraftAllowsMultiLocations()) {
      p.locationQuery = loc.value;
    } else {
      applyCreateDraftLocationValue(p, loc.value);
      if (p.mapUrl && p.where && loc.value !== p.where) loc.value = p.where;
    }
    p.locationDismissed = "";
    markCreateDirty("place");
    loc.closest(".cd-field")?.classList.toggle("cd-needs-fill", !String(p.where || p.locationQuery || "").trim());
    paintCreateDraftLocation();
    paintCreateDraftActions();
    if (typeof renderCreateDraftSuggestions === "function") renderCreateDraftSuggestions();
  });
  loc?.addEventListener("keydown", (e) => {
    if (e.key !== "Enter") return;
    e.preventDefault();
    const p = createDraftPending();
    if (!p) return;
    if (createDraftAllowsMultiLocations()) {
      commitCreateDraftLocationFragment(p, loc.value);
      loc.value = "";
      markCreateDirty("place");
      paintCreateDraftFields();
      loc.focus();
      return;
    }
    loc.blur();
  });
  loc?.addEventListener("blur", () => {
    const p = createDraftPending();
    if (!p) return;
    if (createDraftAllowsMultiLocations()) commitCreateDraftLocationFragment(p, loc.value);
    else applyCreateDraftLocationValue(p, loc.value);
    loc.value = createDraftAllowsMultiLocations() ? (p.locationQuery || "") : (p.where || "");
    if (p.where || p.mapUrl) markCreateDirty("place");
    loc.closest(".cd-field")?.classList.remove("cd-is-focused");
    paintCreateDraftFields();
    if (p.mapUrl && !String(p.where || "").trim()) void resolveCreateDraftMapName(p);
  });
  const locChips = layer.querySelector("#cd-location-chips");
  locChips?.addEventListener("mousedown", (e) => {
    if (e.target.closest && e.target.closest("[data-fix],[data-remove]")) e.preventDefault();
  });
  if (typeof wireCreateDraftPaste === "function") wireCreateDraftPaste(layer);
}

function onCreateDraftFieldFocus(field) {
  closeCreateDraftPopovers();
  const card = document.getElementById("cd-card");
  card?.querySelectorAll(".cd-field").forEach((el) => {
    el.classList.toggle("cd-is-focused", el.getAttribute("data-field") === field);
  });
  syncCreateDraftViewport();
}

function scheduleCreateDraftIconInfer() {
  clearTimeout(_cdIconInferTimer);
  _cdIconInferTimer = setTimeout(inferCreateDraftIconFromTitle, 180);
}

function createDraftTitleOverlapScore(modelTitle, typed) {
  const title = String(modelTitle || "").toLowerCase();
  const needle = String(typed || "").trim().toLowerCase();
  if (!needle || needle.length < 2 || !title) return 0;
  if (title.indexOf(needle) !== -1) return 20 + needle.length;
  let score = 0;
  needle.split(/\s+/).filter((w) => w.length >= 3).forEach((w) => {
    if (title.indexOf(w) !== -1) score += 8 + w.length;
  });
  return score;
}

function createDraftInferCatalogIcon(title) {
  const words = String(title || "").toLowerCase().replace(/[^a-z0-9\s-]/g, " ").split(/\s+/).filter((w) => w.length >= 3);
  if (!words.length) return "";
  const names = [];
  if (typeof ICON_PICKER_BROWSE_ICONS !== "undefined") {
    Object.values(ICON_PICKER_BROWSE_ICONS).forEach((list) => names.push(...(list || [])));
  }
  if (typeof CARD_ICON_CHOICES !== "undefined") names.push(...CARD_ICON_CHOICES);
  const uniq = [...new Set(names.map((n) => String(n || "").trim()).filter(Boolean))];
  let best = "";
  let bestScore = 0;
  for (const name of uniq) {
    const id = name.toLowerCase();
    const tokens = id.split("-").filter(Boolean);
    for (const w of words) {
      let score = 0;
      if (id === w) score = 100 + w.length;
      else if (id.startsWith(w + "-")) score = 60 + w.length;
      else if (tokens[0] === w) score = 50 + w.length;
      else if (id.startsWith(w) && w.length >= 4) score = 40 + w.length;
      else if (tokens.includes(w)) score = 30 + w.length;
      if (score > bestScore) {
        best = name;
        bestScore = score;
      }
    }
  }
  return best;
}

function createDraftInferIcon(title, pending) {
  const t = String(title || "").trim();
  if (!t) return "";
  if (typeof lookupTypeIcon === "function") {
    const typed = lookupTypeIcon(t, pending);
    if (typed && typed !== "custom" && typed !== "calendar") return typed;
  }
  if (typeof buildCreateDraftSuggestionModels === "function" && t.length >= 2) {
    const models = buildCreateDraftSuggestionModels(pending);
    const scored = (models || [])
      .filter((m) => m.icon && m.icon !== "calendar")
      .map((m) => ({ icon: m.icon, score: createDraftTitleOverlapScore(m.title, t) }))
      .filter((x) => x.score >= 20)
      .sort((a, b) => b.score - a.score);
    if (scored[0]) return scored[0].icon;
  }
  const conn = pending?.createConnId && typeof S !== "undefined"
    ? S.conns?.[pending.createConnId]
    : (typeof activeConn === "function" ? activeConn() : null);
  if (typeof eventTypeCards === "function" && typeof typedMatchKey === "function") {
    const key = typedMatchKey(t);
    if (key.length >= 3) {
      const cards = eventTypeCards(conn) || [];
      const hit = cards
        .filter((c) => c?.icon && !c.custom)
        .map((c) => ({ icon: c.icon, k: typedMatchKey(c.label) }))
        .filter((c) => c.k.length >= 3 && (key === c.k || key.startsWith(c.k) || key.includes(c.k)))
        .sort((a, b) => b.k.length - a.k.length)[0];
      if (hit?.icon && hit.icon !== "calendar") return hit.icon;
    }
  }
  return createDraftInferCatalogIcon(t);
}

function inferCreateDraftIconFromTitle() {
  const p = createDraftPending();
  if (!p || p.iconExplicit) return;
  const title = String(p.title || "").trim();
  if (!title) {
    p.icon = "calendar";
    p.card = p.card || {};
    p.card.icon = "calendar";
    paintCreateDraftIcon();
    return;
  }
  const inferred = createDraftInferIcon(title, p);
  const icon = (!inferred || inferred === "custom") ? "calendar" : inferred;
  p.icon = icon;
  p.card = p.card || {};
  p.card.icon = icon;
  p.card.label = title;
  paintCreateDraftIcon();
  if (typeof renderCreateDraftSuggestions === "function") renderCreateDraftSuggestions();
}

function createDraftInsertSlot() {
  document.querySelectorAll(".tl-draft-slot").forEach((el) => el.remove());
}

function syncCreateDraftSlot() {
  createDraftInsertSlot();
}

function createDraftHeaderBottom() {
  const head = document.querySelector(".main-head");
  if (head) return Math.round(head.getBoundingClientRect().bottom);
  return Math.round(12 + (Number.parseFloat(getComputedStyle(document.documentElement).getPropertyValue("env(safe-area-inset-top)")) || 0));
}

function createDraftKeyboardTop() {
  if (typeof timelineVisibleBottomPx === "function") return timelineVisibleBottomPx();
  const vv = window.visualViewport;
  if (vv) return Math.round(vv.offsetTop + vv.height);
  return window.innerHeight;
}

function createDraftSafeBottom() {
  const layout = createDraftKeyboardTop();
  const vv = window.visualViewport;
  if (!vv) return layout;
  return Math.min(layout, Math.round(vv.offsetTop + vv.height));
}

function createDraftImeInset() {
  const layoutH = window.innerHeight || 0;
  let inset = Math.max(0, layoutH - createDraftKeyboardTop());
  if (typeof timelineNativeImeCssPx === "function") {
    inset = Math.max(inset, timelineNativeImeCssPx());
  }
  return inset;
}

function createDraftSheetImeHeight(headerBottom, kbTop, cardH) {
  const remembered = Math.max(180, _cdLastImeH || 0);
  const maxUnderCard = Math.max(180, kbTop - headerBottom - cardH - 24);
  return Math.min(remembered, maxUnderCard);
}

function layoutCreateDraftCard() {
  const card = document.getElementById("cd-card");
  if (!card || !createDraftPending()) return;
  const headerBottom = createDraftHeaderBottom();
  const kbTop = createDraftSafeBottom();
  const ime = createDraftImeInset();
  const keyboardOpen = ime > 140 || document.body.classList.contains("cd-keyboard-open");
  if (ime > 140) _cdLastImeH = ime;
  // Templates live in a tray that drops from behind the card; leave room for
  // its tab under the card (no bottom sheet any more).
  const peek = keyboardOpen ? 0 : 44;
  const gap = 8;
  const top = headerBottom + gap;
  const maxH = Math.max(160, kbTop - peek - top - gap);
  document.documentElement.style.setProperty("--cd-channel-head-bottom", headerBottom + "px");
  card.style.top = top + "px";
  card.style.maxHeight = maxH + "px";
  const cardH = Math.min(card.scrollHeight || 228, maxH);
  document.documentElement.style.setProperty("--cd-card-bottom", Math.round(top + (card.getBoundingClientRect().height || cardH)) + "px");
  document.documentElement.style.setProperty("--cd-keyboard-inset", keyboardOpen ? ime + "px" : "0px");
  document.documentElement.style.setProperty("--cd-ime-height", createDraftSheetImeHeight(headerBottom, kbTop, cardH) + "px");
  layoutCreateDraftIconPopover();
}

function setCreateDraftKeyboardOpen(open) {
  const next = !!open;
  const was = document.body.classList.contains("cd-keyboard-open");
  if (next === was) return;
  document.body.classList.toggle("cd-keyboard-open", next);
  if (next) {
    const pop = document.getElementById("cd-popover");
    const keepIcon = pop?.classList.contains("cd-icon-popover") && pop.classList.contains("open");
    if (!keepIcon) closeCreateDraftPopovers();
    const sheet = document.getElementById("cd-suggestions");
    sheet?.classList.remove("expanded");
  } else if (createDraftPending()) {
    if (typeof renderCreateDraftSuggestions === "function") renderCreateDraftSuggestions();
  }
  layoutCreateDraftCard();
}

function syncCreateDraftViewport() {
  const ime = createDraftImeInset();
  const open = ime > 140;
  if (ime > 140) _cdLastImeH = ime;
  document.body.classList.toggle("cd-keyboard-open", open);
  document.documentElement.style.setProperty("--cd-keyboard-inset", open ? ime + "px" : "0px");
  layoutCreateDraftCard();
}

function wireCreateDraftIme() {
  if (_cdImeWired) return;
  _cdImeWired = true;
  window.addEventListener("resize", syncCreateDraftViewport);
  if (window.visualViewport) {
    window.visualViewport.addEventListener("resize", syncCreateDraftViewport);
    window.visualViewport.addEventListener("scroll", syncCreateDraftViewport);
  }
  window.addEventListener("ash-ime-inset", syncCreateDraftViewport);
}

function closeCreateDraftPopovers() {
  const pop = document.getElementById("cd-popover");
  document.body.classList.remove("cd-icon-picking");
  if (pop) {
    pop.classList.remove("open", "cd-icon-popover", "cd-date-popover", "cd-more-popover");
    pop.removeAttribute("role");
    document.getElementById("cd-more-btn")?.setAttribute("aria-expanded", "false");
    pop.innerHTML = "";
    pop.style.top = "";
    pop.style.left = "";
    pop.style.right = "";
    pop.style.width = "";
    pop.style.maxHeight = "";
    pop.style.height = "";
    pop.style.transform = "";
  }
}

function wireCreateDraftPopoverDismiss() {
  if (_cdPopoverDismissWired) return;
  _cdPopoverDismissWired = true;
  document.addEventListener("pointerdown", (e) => {
    if (!document.body.classList.contains("tl-creating") || !createDraftPending()) return;
    const pop = document.getElementById("cd-popover");
    if (!pop?.classList.contains("open")) return;
    const t = e.target;
    if (t && (pop === t || pop.contains(t))) return;
    if (t && typeof t.closest === "function" && t.closest(".modal-backdrop")) return;
    closeCreateDraftPopovers();
  }, true);
}

function pinCreateDraftPopoverTop(pop) {
  if (!pop) return;
  const headerBottom = createDraftHeaderBottom();
  const kbTop = createDraftSafeBottom();
  const gap = 8;
  const top = headerBottom + gap;
  const maxH = Math.max(200, kbTop - top - gap);
  pop.style.left = "50%";
  pop.style.right = "auto";
  pop.style.transform = "translateX(-50%)";
  pop.style.top = top + "px";
  pop.style.width = "min(452px, calc(100% - 28px))";
  pop.style.maxHeight = maxH + "px";
  if (pop.classList.contains("cd-icon-popover")) {
    pop.style.height = maxH + "px";
    document.body.classList.add("cd-icon-picking");
  } else {
    pop.style.height = "";
    document.body.classList.remove("cd-icon-picking");
  }
  pop.classList.add("open");
  syncCreateDraftIconScrollHint();
}

function layoutCreateDraftIconPopover() {
  const pop = document.getElementById("cd-popover");
  if (!pop || !pop.classList.contains("open") || !pop.classList.contains("cd-icon-popover")) return;
  pinCreateDraftPopoverTop(pop);
}

function syncCreateDraftIconScrollHint() {
  const hint = document.getElementById("cd-icon-scroll-hint");
  const scroll = document.querySelector("#cd-popover.cd-icon-popover.open #cat-icon-picker-scroll");
  if (!hint) return;
  if (!scroll) {
    hint.hidden = true;
    return;
  }
  const overflow = scroll.scrollHeight > scroll.clientHeight + 12;
  const atEnd = scroll.scrollTop + scroll.clientHeight >= scroll.scrollHeight - 18;
  hint.hidden = !overflow || atEnd;
}

function positionCreateDraftPopover(pop, anchor) {
  if (!pop || !anchor) return;
  pop.style.transform = "";
  pop.style.maxHeight = "";
  pop.style.width = "";
  pop.style.visibility = "hidden";
  pop.classList.add("open");
  const ar = anchor.getBoundingClientRect();
  const pr = pop.getBoundingClientRect();
  const viewBottom = createDraftKeyboardTop();
  const viewTop = window.visualViewport ? window.visualViewport.offsetTop : 0;
  const below = viewBottom - ar.bottom - 7;
  const above = ar.top - viewTop - 7;
  const useBelow = below >= pr.height || below >= above;
  let top = useBelow ? ar.bottom + 7 : ar.top - pr.height - 7;
  top = Math.max(viewTop + 8, Math.min(top, viewBottom - pr.height - 8));
  const left = Math.max(10, Math.min(ar.left, window.innerWidth - pr.width - 10));
  pop.style.top = Math.round(top) + "px";
  pop.style.left = Math.round(left) + "px";
  pop.style.visibility = "visible";
}

function createDraftDateMonthStart(dayTs) {
  const day = typeof calendarDayStart === "function"
    ? calendarDayStart(dayTs)
    : (typeof dayStart === "function" ? dayStart(dayTs) : Number(dayTs));
  const d = new Date(day);
  return new Date(d.getFullYear(), d.getMonth(), 1).getTime();
}

function paintCreateDraftDatePopover(pop, btn) {
  const p = createDraftPending();
  if (!p || !pop) return;
  if (typeof calendarMiniMonthHtml !== "function") return;
  const conn = typeof activeConn === "function" ? activeConn() : null;
  const ch = typeof activeEventChannel === "function" ? activeEventChannel() : null;
  const events = typeof collatedEvents === "function" ? collatedEvents() : (conn?.events || []);
  pop.classList.add("cd-date-popover");
  pop.innerHTML = `<div class="cd-popover-kicker"><span>Date</span></div>`
    + calendarMiniMonthHtml({
      monthCursor: _cdDateMonthCursor,
      selectedDay: p.day,
      events,
      channelId: ch?.id || null,
      disablePast: false,
      dayAttr: "data-cd-day",
      idPrefix: "cd",
    });
  positionCreateDraftPopover(pop, btn);
  pop.querySelector("#cd-month-prev")?.addEventListener("click", (e) => {
    e.preventDefault();
    e.stopPropagation();
    const d = new Date(_cdDateMonthCursor);
    _cdDateMonthCursor = new Date(d.getFullYear(), d.getMonth() - 1, 1).getTime();
    paintCreateDraftDatePopover(pop, btn);
  });
  pop.querySelector("#cd-month-next")?.addEventListener("click", (e) => {
    e.preventDefault();
    e.stopPropagation();
    const d = new Date(_cdDateMonthCursor);
    _cdDateMonthCursor = new Date(d.getFullYear(), d.getMonth() + 1, 1).getTime();
    paintCreateDraftDatePopover(pop, btn);
  });
  pop.querySelectorAll("[data-cd-day]").forEach((el) => {
    el.addEventListener("click", (e) => {
      e.preventDefault();
      e.stopPropagation();
      setCreateDraftDay(Number(el.getAttribute("data-cd-day")));
      closeCreateDraftPopovers();
    });
  });
}

/** "⋯" menu on the draft card: options that used to sit on the card itself
 *  (Confirm attendance, Draft from text). Room for more later. */
function openCreateDraftMoreMenu(btn) {
  const p = createDraftPending();
  if (!p) return;
  const pop = document.getElementById("cd-popover");
  if (!pop) return;
  const wasOpen = pop.classList.contains("open") && pop.classList.contains("cd-more-popover");
  closeCreateDraftPopovers();
  if (wasOpen) return;
  blurCreateDraftInputs();
  setCreateDraftKeyboardOpen(false);
  const icn = typeof ic === "function" ? ic : () => "";
  const editing = !!p.editEventId;
  const items = [
    `<button type="button" role="menuitemcheckbox" aria-checked="${p.confirmAttendance ? "true" : "false"}" data-cd-more="confirm">${icn("user-check")}<span>Confirm attendance</span>${p.confirmAttendance ? `<span class="cd-more-check">${icn("check")}</span>` : ""}</button>`,
  ].filter(Boolean).join("");
  pop.classList.add("cd-more-popover");
  pop.setAttribute("role", "menu");
  pop.innerHTML = `<div class="cd-more-menu">${items}</div>`;
  positionCreateDraftPopover(pop, btn);
  btn.setAttribute("aria-expanded", "true");
  pop.querySelectorAll("[data-cd-more]").forEach((item) => {
    item.addEventListener("click", (e) => {
      e.preventDefault();
      e.stopPropagation();
      const what = item.dataset.cdMore;
      closeCreateDraftPopovers();
      btn.setAttribute("aria-expanded", "false");
      if (what === "confirm") {
        const cur = createDraftPending();
        if (cur) cur.confirmAttendance = !cur.confirmAttendance;
        if (typeof toast === "function") toast(cur?.confirmAttendance ? "Attendance will be confirmed" : "Attendance confirmation off");
      } else if (what === "paste") {
        if (typeof createDraftPasteFromClipboard === "function") void createDraftPasteFromClipboard();
        else if (typeof openCreateDraftPastePopover === "function") openCreateDraftPastePopover();
      }
    });
  });
}

function openCreateDraftDatePopover(btn) {
  const p = createDraftPending();
  if (!p) return;
  closeCreateDraftPopovers();
  blurCreateDraftInputs();
  setCreateDraftKeyboardOpen(false);
  _cdDateMonthCursor = createDraftDateMonthStart(p.day);
  const pop = document.getElementById("cd-popover");
  paintCreateDraftDatePopover(pop, btn);
}

function setCreateDraftDay(dayTs) {
  const p = createDraftPending();
  if (!p) return;
  const day = typeof dayStart === "function" ? dayStart(dayTs) : Number(dayTs);
  p.day = day;
  if (p.timeStartMin != null && typeof atTime === "function") {
    p.when = atTime(day, Math.floor(p.timeStartMin / 60), p.timeStartMin % 60);
  } else if (typeof rebasePendingOntoDay === "function") {
    rebasePendingOntoDay(p, day);
  }
  createDraftInsertSlot();
  paintCreateDraftFields();
  layoutCreateDraftCard();
}

function chooseCreateDraftIcon(p, icon, name) {
  commitCreateIcon(p, icon);
  const label = String(name || "").trim();
  if (label) p.iconLabel = label;
  if (typeof recordRecentPickerIcon === "function") recordRecentPickerIcon(icon, label);
  closeCreateDraftPopovers();
  paintCreateDraftFields();
  if (typeof renderCreateDraftSuggestions === "function") renderCreateDraftSuggestions();
}

function createDraftIconSearchLabel(p) {
  if (!p) return "";
  const encoded = (s) => {
    const v = String(s || "").trim();
    if (!v) return true;
    if (/^(data:|draw:)/i.test(v)) return true;
    return typeof isDrawnIcon === "function" && isDrawnIcon(v);
  };
  const named = String(p.iconLabel || "").trim();
  if (named && !encoded(named)) return named.replace(/-/g, " ");
  const icon = String(p.icon || "").trim();
  if (encoded(icon) && typeof loadNamedDrawIcons === "function") {
    const row = loadNamedDrawIcons().find((r) => r.icon === icon);
    if (row?.name) return String(row.name).trim();
  }
  if (!p.iconExplicit || encoded(icon)) return "";
  if (typeof loadRecentPickerIcons === "function") {
    const row = loadRecentPickerIcons().find((r) => r.icon === icon);
    if (row?.name && !encoded(row.name)) return String(row.name).trim().replace(/-/g, " ");
  }
  return icon.replace(/-/g, " ");
}

function createDraftPopoverCloseHtml(label) {
  const x = typeof ic === "function" ? ic("x") : "×";
  return `<button type="button" class="cd-close" data-cd-pop-close aria-label="${esc(label)}">${x}</button>`;
}

function bindCreateDraftPopoverClose(pop) {
  pop?.querySelector("[data-cd-pop-close]")?.addEventListener("click", () => closeCreateDraftPopovers());
}

function paintCreateDraftIconCatalog(pop, p) {
  const canDraw = typeof canUserDraw !== "function" || canUserDraw();
  pop.innerHTML = `<div class="cd-popover-kicker"><span>Icon</span>${createDraftPopoverCloseHtml("Close icon picker")}</div>`
    + `<div class="cd-icon-catalog-wrap">`
    + `<div class="cd-icon-catalog" id="cd-icon-catalog"></div>`
    + `<div class="cd-icon-scroll-hint" id="cd-icon-scroll-hint" hidden>`
    + `${typeof ic === "function" ? ic("chevron-down") : ""}Scroll for more`
    + `</div></div>`;
  const catalog = pop.querySelector("#cd-icon-catalog");
  if (typeof mountIconPickerCatalog === "function") {
    mountIconPickerCatalog(catalog, {
      currentIcon: p.icon || "calendar",
      currentLabel: createDraftIconSearchLabel(p),
      autofocus: false,
      browseSectionIds: typeof ICON_PICKER_BROWSE_SECTION_IDS !== "undefined"
        ? ICON_PICKER_BROWSE_SECTION_IDS
        : ["buildings", "food-beverage", "nature", "sports", "transportation", "weather"],
      onChoose: (name, meta) => chooseCreateDraftIcon(p, name, meta?.name),
    });
  }
  const wrap = catalog?.querySelector(".cat-icon-filter-wrap");
  if (canDraw && wrap) {
    let row = wrap;
    if (wrap.tagName === "LABEL") {
      row = document.createElement("div");
      row.className = wrap.className;
      while (wrap.firstChild) row.appendChild(wrap.firstChild);
      wrap.replaceWith(row);
    }
    const draw = document.createElement("button");
    draw.type = "button";
    draw.className = "cd-icon-draw-btn";
    draw.id = "cd-icon-draw";
    draw.innerHTML = `${typeof ic === "function" ? ic("pencil") : ""}Draw`;
    row.appendChild(draw);
  }
  const scroll = catalog?.querySelector("#cat-icon-picker-scroll");
  const syncHint = () => {
    requestAnimationFrame(() => syncCreateDraftIconScrollHint());
  };
  scroll?.addEventListener("scroll", syncHint, { passive: true });
  catalog?.querySelector("#cat-icon-filter")?.addEventListener("input", syncHint);
  bindCreateDraftPopoverClose(pop);
  pop.querySelector("#cd-icon-draw")?.addEventListener("click", (e) => {
    e.preventDefault();
    e.stopPropagation();
    if (typeof canUserDraw === "function" && !canUserDraw()) {
      try { toast("Drawing is turned off on this server"); } catch {}
      return;
    }
    if (typeof openDrawIconModal !== "function") return;
    openDrawIconModal({
      initialIcon: (typeof isDrawnIcon === "function" && isDrawnIcon(p.icon)) ? p.icon : null,
      onSave: (encoded) => paintCreateDraftIconNameStep(pop, p, encoded),
    });
  });
  pinCreateDraftPopoverTop(pop);
  requestAnimationFrame(() => syncCreateDraftIconScrollHint());
}

function paintCreateDraftIconNameStep(pop, p, encoded) {
  if (!pop || !p || !encoded) return;
  pop.classList.add("cd-icon-popover", "open");
  pop.innerHTML = `<div class="cd-popover-kicker"><span>Name drawing</span>${createDraftPopoverCloseHtml("Close icon picker")}</div>`
    + `<div class="cd-icon-name-step">`
    + `<div class="cd-icon-name-preview">${typeof ic === "function" ? ic(encoded) : ""}</div>`
    + `<input type="text" class="cd-icon-name-input" id="cd-icon-draw-name" maxlength="24" placeholder="Name this icon" autocomplete="off" enterkeyhint="done" />`
    + `<button type="button" class="cd-icon-name-save" id="cd-icon-draw-save">Save</button>`
    + `</div>`;
  pinCreateDraftPopoverTop(pop);
  bindCreateDraftPopoverClose(pop);
  const input = pop.querySelector("#cd-icon-draw-name");
  const save = () => {
    const label = String(input?.value || "").trim();
    if (!label) {
      try { toast("Name this drawing"); } catch {}
      input?.focus();
      return;
    }
    if (typeof saveNamedDrawIcon === "function") saveNamedDrawIcon(label, encoded);
    chooseCreateDraftIcon(p, encoded, label);
  };
  pop.querySelector("#cd-icon-draw-save")?.addEventListener("click", save);
  input?.addEventListener("keydown", (e) => {
    if (e.key === "Enter") { e.preventDefault(); save(); }
  });
  queueMicrotask(() => input?.focus());
}

function openCreateDraftIconPopover(btn) {
  const p = createDraftPending();
  if (!p) return;
  closeCreateDraftPopovers();
  blurCreateDraftInputs();
  setCreateDraftKeyboardOpen(false);
  const pop = document.getElementById("cd-popover");
  pop.classList.add("cd-icon-popover");
  paintCreateDraftIconCatalog(pop, p);
  blurCreateDraftInputs();
  setCreateDraftKeyboardOpen(false);
}

function openCreateDraftTimeGrid(btn) {
  const p = createDraftPending();
  if (!p) return;
  closeCreateDraftPopovers();
  blurCreateDraftInputs();
  setCreateDraftKeyboardOpen(false);
  p._timeGridStep = "start";
  p._timeGridMinute = p.timeStartMin != null ? p.timeStartMin % 60 : 0;
  const pop = document.getElementById("cd-popover");
  const paint = () => {
    pop.innerHTML = renderCreateTimeGridHtml(p);
    positionCreateDraftPopover(pop, btn.closest(".cd-field") || btn);
    const afterTimeGrid = () => {
      markCreateDirty("time");
      paintCreateDraftFields();
      paint();
      if (typeof renderCreateDraftSuggestions === "function") renderCreateDraftSuggestions();
    };
    pop.querySelectorAll("[data-cd-min]").forEach((el) => {
      el.addEventListener("click", () => {
        applyCreateTimeGridMinute(p, Number(el.getAttribute("data-cd-min")));
        afterTimeGrid();
      });
    });
    pop.querySelectorAll("[data-cd-hour]").forEach((el) => {
      el.addEventListener("click", () => {
        applyCreateTimeGridHour(p, Number(el.getAttribute("data-cd-hour")));
        afterTimeGrid();
      });
    });
  };
  paint();
}

function blurCreateDraftInputs() {
  try {
    const ae = document.activeElement;
    if (ae && ae.closest && ae.closest("#cd-card")) ae.blur();
  } catch {}
  try { window.AshNative?.hideKeyboard?.(); } catch {}
}

function paintCreateDraftIcon() {
  const p = createDraftPending();
  const wrap = document.getElementById("cd-icon-wrap");
  const btn = document.getElementById("cd-icon-btn");
  if (!p || !wrap) return;
  const icon = p.icon || "calendar";
  wrap.innerHTML = typeof ic === "function" ? ic(icon, "cd-field-icon") : esc(icon);
  btn?.classList.toggle("cd-needs-fill", !p.iconExplicit && (!icon || icon === "calendar"));
  btn?.setAttribute("aria-label", "Event icon: " + (p.iconLabel || icon));
}

function paintCreateDraftLocation() {
  const p = createDraftPending();
  const chips = document.getElementById("cd-location-chips");
  const warn = document.getElementById("cd-location-warning");
  const field = document.querySelector(".cd-location-field");
  const input = document.getElementById("cd-location-input");
  if (!p || !chips) return;
  const multi = createDraftAllowsMultiLocations();
  const selected = multi ? createDraftSelectedPlaces(p) : [];
  const matches = createDraftLocationCompletions(p);
  const blocked = createDraftLocationBlocked(p);
  warn?.classList.toggle("show", blocked);
  field?.classList.toggle("cd-needs-fill", !String(p.where || "").trim() && !String(p.locationQuery || "").trim());
  if (input) {
    input.placeholder = multi ? "Add a place" : "Location";
    input.setAttribute("aria-label", multi ? "Add event location" : "Event location");
  }
  const selectedHtml = selected.map((v) =>
    `<button type="button" class="cd-location-chip is-on" data-remove="${esc(v)}" title="Remove ${esc(v)}">${esc(v)}</button>`
  ).join("");
  const matchHtml = matches.map((x) =>
    `<button type="button" class="cd-location-chip" data-fix="${esc(x.value)}" title="${esc(x.value)}">${esc(x.value)}</button>`
  ).join("");
  chips.innerHTML = selectedHtml + matchHtml;
  chips.querySelectorAll("[data-fix]").forEach((el) => {
    el.addEventListener("click", (e) => {
      e.preventDefault();
      e.stopPropagation();
      toggleCreateDraftLocation(p, el.getAttribute("data-fix") || "");
      markCreateDirty("place");
      const loc = document.getElementById("cd-location-input");
      if (loc) {
        loc.value = multi ? "" : (p.where || "");
        loc.focus();
      }
      paintCreateDraftFields();
    });
  });
  chips.querySelectorAll("[data-remove]").forEach((el) => {
    el.addEventListener("click", (e) => {
      e.preventDefault();
      e.stopPropagation();
      toggleCreateDraftLocation(p, el.getAttribute("data-remove") || "");
      markCreateDirty("place");
      const loc = document.getElementById("cd-location-input");
      if (loc) loc.focus();
      paintCreateDraftFields();
    });
  });
}

function paintCreateDraftActions() {
  const p = createDraftPending();
  const createBtn = document.getElementById("cd-create-btn");
  const dismissBtn = document.getElementById("cd-dismiss-btn");
  const note = document.getElementById("cd-note");
  const card = document.getElementById("cd-card");
  if (!p || !createBtn) return;
  const editing = !!p.editEventId;
  createBtn.textContent = editing ? "Save" : "Create";
  if (card) card.setAttribute("aria-label", editing ? "Edit event" : "Edit event draft");
  const blocked = createDraftLocationBlocked(p);
  const ready = typeof createSwipeReadyToPost === "function" ? createSwipeReadyToPost(p) : !!String(p.title || "").trim();
  if (blocked) {
    createBtn.hidden = true;
    dismissBtn?.classList.add("show");
    if (note) {
      note.hidden = false;
      note.textContent = "Close location match found.";
    }
  } else {
    createBtn.hidden = false;
    createBtn.disabled = !ready;
    dismissBtn?.classList.remove("show");
    const dismissed = !!(p.locationDismissed && p.locationDismissed === createDraftLocationQuery(p));
    if (note) {
      note.hidden = !dismissed;
      note.textContent = dismissed ? "Location warning dismissed." : "";
    }
  }
}

function paintCreateDraftFields() {
  const p = createDraftPending();
  if (!p) return;
  const dateBtn = document.getElementById("cd-date-btn");
  if (dateBtn) {
    dateBtn.innerHTML = (typeof ic === "function" ? ic("calendar") : "")
      + `<span class="cd-date-label">${esc(createDraftDateLabel(p.day))}</span>`
      + (typeof ic === "function" ? ic("chevron-down") : "");
  }
  const title = document.getElementById("cd-title-input");
  if (title && document.activeElement !== title) title.value = p.title || "";
  title?.closest(".cd-field")?.classList.toggle("cd-needs-fill", !String(p.title || "").trim());
  const time = document.getElementById("cd-time-input");
  if (time && document.activeElement !== time) time.value = p.timeText || "";
  time?.closest(".cd-field")?.classList.toggle("cd-needs-fill", p.timeStartMin == null && !String(p.timeText || "").trim());
  const loc = document.getElementById("cd-location-input");
  if (loc && document.activeElement !== loc) {
    loc.value = createDraftAllowsMultiLocations() ? (p.locationQuery || "") : (p.where || "");
  }
  paintCreateDraftIcon();
  paintCreateDraftLocation();
  paintCreateDraftActions();
}

function paintCreateDraft() {
  if (!createDraftPending()) return;
  ensureCreateDraftDom();
  paintCreateDraftFields();
  if (typeof renderCreateDraftSuggestions === "function") renderCreateDraftSuggestions();
  layoutCreateDraftCard();
}

function createDraftFindEvent(eventId) {
  if (!eventId) return null;
  const conn = (typeof ownerConnOf === "function" ? ownerConnOf(eventId) : null)
    || (typeof activeConn === "function" ? activeConn() : null);
  const g = typeof group === "function" ? group() : null;
  return (conn?.events || []).find(e => e.id === eventId)
    || (g?.events || []).find(e => e.id === eventId)
    || null;
}

function createDraftPrefillFromEvent(ev) {
  const title = typeof eventDisplayTitle === "function"
    ? eventDisplayTitle(ev)
    : (ev?._title || ev?.title || "");
  const where = typeof timelineEventPlace === "function"
    ? timelineEventPlace(ev)
    : (typeof shown === "function" ? shown(ev?._where || "") : (ev?._where || ev?.where || ""));
  const detailsRaw = String(typeof shown === "function"
    ? shown(ev?._details || "")
    : (ev?._details || "")).trim();
  const split = typeof splitEventMapDetails === "function"
    ? splitEventMapDetails(detailsRaw)
    : { rest: detailsRaw, mapUrl: "" };
  let timeText = "";
  if (ev?.when != null && ev.whenPrecision !== "day" && ev.whenPrecision !== "period"
      && ev.whenPrecision !== "unconfirmed"
      && typeof formatClockTime === "function") {
    timeText = formatClockTime(ev.when);
  }
  return {
    title,
    shortName: ev?._shortName || "",
    where,
    details: split.rest,
    mapUrl: split.mapUrl,
    timeText,
    day: ev?.when || Date.now(),
    icon: ev?.icon || "",
    duration: ev?.duration || "",
    when: ev?.when || null,
    whenPrecision: ev?.whenPrecision || "",
    whenPeriod: ev?.whenPeriod || "",
    typeId: ev?.typeId || "",
    cat: ev?.cat || "",
    confirmAttendance: !!ev?.confirmAttendance,
  };
}

function openEditEventDraft(ev, opts = {}) {
  if (!ev) return;
  if (typeof canEditEvent === "function" && !canEditEvent(ev)) {
    try { toast("You can't edit this event"); } catch {}
    return;
  }
  if (typeof openCreateDraft !== "function") return;
  const prefill = createDraftPrefillFromEvent(ev);
  const owner = (typeof ownerConnFor === "function" ? ownerConnFor(ev) : null)
    || (typeof ownerConnOf === "function" ? ownerConnOf(ev.id) : null);
  openCreateDraft({
    ...prefill,
    editEventId: ev.id,
    focusField: opts.focusField || "",
    createChannelId: ev.channelId || "",
    createConnId: owner?.id || "",
  });
}

function openCreateDraft(opts = {}) {
  const editing = !!(opts.editEventId);
  if (editing) {
    const ev = createDraftFindEvent(opts.editEventId);
    if (!ev || (typeof canEditEvent === "function" && !canEditEvent(ev))) {
      try { toast("You can't edit this event"); } catch {}
      return;
    }
  } else if (typeof canCreateEvents === "function" && !canCreateEvents()) {
    try {
      toast(typeof effectiveRole === "function" && effectiveRole() === ROLE_VIEWER
        ? "View only — you can't create events"
        : "Creating events is limited to staff on this server");
    } catch {}
    return;
  }
  if (typeof closeTimelineSheet === "function") {
    try { closeTimelineSheet(); } catch {}
  }
  const day = editing
    ? (typeof dayStart === "function"
      ? dayStart(opts.day || opts.when || Date.now())
      : (opts.day || opts.when || Date.now()))
    : (typeof seedCreateDayTs === "function"
      ? seedCreateDayTs(opts.day)
      : (opts.day || Date.now()));
  const conn = typeof activeConn === "function" ? activeConn() : null;
  const ch = typeof activeEventChannel === "function" ? activeEventChannel() : null;
  const explicitIcon = String(opts.icon || "").trim();
  const pending = {
    createFromEvent: !!opts.createFromEvent,
    editEventId: opts.editEventId || null,
    day,
    title: String(opts.title || "").slice(0, 160),
    shortName: eventShortNameInput(opts.shortName || ""),
    subtitle: "",
    icon: explicitIcon || "calendar",
    iconExplicit: !!explicitIcon,
    iconLabel: "",
    timeText: String(opts.timeText || ""),
    timeStartMin: null,
    timeEndMin: null,
    where: String(opts.where || ""),
    details: String(opts.details || opts.remainder || ""),
    mapUrl: String(opts.mapUrl || ""),
    locationDismissed: "",
    when: opts.when != null ? opts.when : null,
    whenPrecision: opts.whenPrecision != null && opts.whenPrecision !== ""
      ? opts.whenPrecision
      : (editing ? "" : "unconfirmed"),
    whenPeriod: opts.whenPeriod || "",
    duration: opts.duration != null ? opts.duration : "",
    typeId: opts.typeId || "",
    cat: opts.cat || "",
    confirmAttendance: !!opts.confirmAttendance,
    card: { icon: explicitIcon || "calendar", label: "", kind: "event" },
    dirtySlots: {},
    fromEventId: opts.fromEventId || null,
    createChannelId: opts.createChannelId
      || ch?.id
      || (typeof S !== "undefined" ? S.activeEventChannelId : null)
      || (typeof S !== "undefined" ? S.conversationsReturn?.eventChannelId : null),
    createConnId: opts.createConnId || conn?.id || (typeof S !== "undefined" ? S.activeConnId : null),
    _gapHour: opts._gapHour ?? null,
    _gapDay: opts._gapDay ?? null,
  };
  if (typeof splitEventMapDetails === "function") {
    const split = splitEventMapDetails(pending.details);
    pending.details = split.rest;
    pending.mapUrl = pending.mapUrl || split.mapUrl || "";
  }
  if (!pending.mapUrl && pending.where && typeof mapUrlForKnownPlace === "function") {
    pending.mapUrl = mapUrlForKnownPlace(pending.where) || "";
  }
  if (opts.timeText && typeof applyCreateTimeParse === "function") {
    const keepDuration = pending.duration;
    applyCreateTimeParse(pending, opts.timeText);
    if (editing && keepDuration) pending.duration = keepDuration;
  }
  pending.editSnapshot = editing
    ? {
        title: pending.title,
        shortName: pending.shortName,
        where: pending.where,
        details: pending.details,
        mapUrl: pending.mapUrl,
        when: pending.when,
        whenPrecision: pending.whenPrecision || "",
        whenPeriod: pending.whenPeriod || "",
        icon: pending.icon || "",
        duration: pending.duration || "",
        typeId: pending.typeId || "",
        cat: pending.cat || "",
        confirmAttendance: !!pending.confirmAttendance,
      }
    : null;
  if (editing && pending.where) {
    pending.locationDismissed = createDraftLocationQuery(pending);
  }
  S.hand = { mode: "createDraft", pending };
  if (pending.title && typeof markCreateDirty === "function") markCreateDirty("title");
  if (opts.timeText && typeof markCreateDirty === "function") markCreateDirty("time");
  if (pending.where && typeof markCreateDirty === "function") markCreateDirty("place");
  window.Onboarding?.sync?.();
  ensureCreateDraftDom();
  if (!editing) inferCreateDraftIconFromTitle();
  if (opts.skipUi) return;
  document.body.classList.add("tl-creating");
  document.getElementById("cd-layer")?.setAttribute("aria-hidden", "false");
  document.documentElement.style.setProperty("--cd-channel-head-bottom", createDraftHeaderBottom() + "px");
  createDraftInsertSlot();
  paintCreateDraft();
  wireCreateDraftIme();
  if (typeof timelineSetNativeKeyboardOverlay === "function") {
    timelineSetNativeKeyboardOverlay(true);
  }
  const focusMap = { title: "cd-title-input", time: "cd-time-input", place: "cd-location-input" };
  const focusId = focusMap[opts.focusField] || "cd-title-input";
  requestAnimationFrame(() => {
    layoutCreateDraftCard();
    const input = document.getElementById(focusId);
    try { input?.focus({ preventScroll: true }); } catch { try { input?.focus(); } catch {} }
    syncCreateDraftViewport();
  });
}

function closeCreateDraft(discard) {
  closeCreateDraftPopovers();
  if (typeof calendarExitPickDateMode === "function") calendarExitPickDateMode();
  document.body.classList.remove("tl-creating", "cd-keyboard-open", "cd-icon-picking");
  document.documentElement.style.removeProperty("--cd-channel-head-bottom");
  document.getElementById("cd-layer")?.setAttribute("aria-hidden", "true");
  document.querySelectorAll(".tl-draft-slot").forEach((el) => el.remove());
  _cdSlotParent = null;
  if (typeof timelineSetNativeKeyboardOverlay === "function") {
    timelineSetNativeKeyboardOverlay(false);
  }
  if (discard && typeof S !== "undefined") {
    S.hand = { mode: "context", pending: null };
    S.createDraftFromChat = null;
  }
  try { window.AshNative?.hideKeyboard?.(); } catch {}
  if (typeof Panel !== "undefined" && Panel.channelOpen?.() && typeof renderChannelPanel === "function") {
    renderChannelPanel(true);
  }
}

function createDraftSameText(a, b) {
  return String(a || "").trim() === String(b || "").trim();
}

function createDraftRefreshAfterEdit(ev) {
  if (ev && typeof conversationRefreshEventPanel === "function") {
    conversationRefreshEventPanel(ev);
  }
  if (document.getElementById("conv-event-panel")) {
    if (typeof conversationRefreshAfterMenu === "function") conversationRefreshAfterMenu();
    return;
  }
  if (typeof renderView === "function") renderView();
}

async function commitEditEventDraft(p) {
  const eventId = p.editEventId;
  const ev = createDraftFindEvent(eventId);
  const conn = (typeof ownerConnOf === "function" ? ownerConnOf(eventId) : null)
    || (p.createConnId && typeof S !== "undefined" ? S.conns?.[p.createConnId] : null)
    || (typeof activeConn === "function" ? activeConn() : null);
  if (!ev || !conn || (typeof canEditEvent === "function" && !canEditEvent(ev))) {
    try { toast("You can't edit this event"); } catch {}
    return;
  }
  if (createDraftAllowsMultiLocations() && p.locationQuery) {
    commitCreateDraftLocationFragment(p, p.locationQuery);
  }
  const title = String(p.title || "").trim();
  const whereRaw = String(p.where || "").trim();
  const where = (typeof isCreatePlaceTbd === "function" && isCreatePlaceTbd(whereRaw)) ? "" : whereRaw;
  let when = p.when;
  let whenPrecision = p.whenPrecision || "";
  if (p.timeStartMin != null && p.day != null && typeof atTime === "function") {
    when = atTime(p.day, Math.floor(p.timeStartMin / 60), p.timeStartMin % 60);
    whenPrecision = "";
  } else if (!when && p.day != null) {
    when = typeof atHour === "function" ? atHour(p.day, 12) : (Number(p.day) + 12 * 3600e3);
    whenPrecision = whenPrecision || "unconfirmed";
  }
  const matched = typeof findMatchingEventCard === "function" ? findMatchingEventCard(title, conn) : null;
  const icon = p.iconExplicit ? (p.icon || "") : (p.icon && p.icon !== "calendar" ? p.icon : (matched?.icon || p.icon || ""));
  const duration = p.duration || "";
  const typeId = matched?.typeId
    || p.typeId
    || (typeof typeIdForTitle === "function" ? typeIdForTitle(title, conn) : "")
    || "";
  const cat = matched?.cat || p.cat || p.card?.cat || "";
  const detailsSplit = typeof splitEventMapDetails === "function"
    ? splitEventMapDetails(String(p.details || "").trim())
    : { rest: String(p.details || "").trim(), mapUrl: "" };
  const mapUrl = p.mapUrl || detailsSplit.mapUrl
    || (where && typeof mapUrlForKnownPlace === "function" ? mapUrlForKnownPlace(where) : "");
  const detailsPlain = typeof mergeEventMapDetails === "function"
    ? mergeEventMapDetails(detailsSplit.rest, mapUrl)
    : detailsSplit.rest;
  const snap = p.editSnapshot || {};
  const sendEdit = (payload) => {
    if (typeof send !== "function") return "failed";
    return send(payload, conn.id);
  };
  let failed = false;
  const markFailed = (result) => {
    if (result === "failed") failed = true;
  };
  if (!createDraftSameText(eventShortNameInput(p.shortName), snap.shortName)
      || !createDraftSameText(title, snap.title)
      || !createDraftSameText(icon, snap.icon)
      || !createDraftSameText(typeId, snap.typeId)
      || !createDraftSameText(cat, snap.cat)) {
    markFailed(sendEdit({
      type: "setEventType",
      ...(!createDraftSameText(eventShortNameInput(p.shortName), snap.shortName) ? { shortName: p.shortName?.trim() ? await encrypt(eventShortNameInput(p.shortName), conn.key) : "" } : {}),
      eventId,
      title: createDraftSameText(title, snap.title) ? ev.title : (typeof encrypt === "function" ? await encrypt(title, conn.key) : title),
      typeId: typeId || "",
      icon: icon || "",
      cat: cat || "",
    }));
  }
  const snapWhen = Number(snap.when || 0);
  const nextWhen = Number(when || 0);
  const snapPrecision = String(snap.whenPrecision || "");
  const nextPrecision = String(whenPrecision || "");
  const snapPeriod = String(snap.whenPeriod || "");
  const nextPeriod = String(p.whenPeriod || "");
  if (snapWhen !== nextWhen || snapPrecision !== nextPrecision || snapPeriod !== nextPeriod) {
    markFailed(sendEdit({
      type: "setEventTimePrecision",
      eventId,
      when,
      whenPrecision,
      whenPeriod: p.whenPeriod || "",
    }));
  }
  if (!createDraftSameText(where, snap.where)) {
    const whereCipher = where && typeof encrypt === "function"
      ? await encrypt(where, conn.key)
      : (where || "");
    markFailed(sendEdit({ type: "setEventWhere", eventId, where: whereCipher }));
  }
  const snapDetails = typeof mergeEventMapDetails === "function"
    ? mergeEventMapDetails(snap.details, snap.mapUrl)
    : String(snap.details || "");
  if (!createDraftSameText(detailsPlain, snapDetails)) {
    const detailsCipher = detailsPlain && typeof encrypt === "function"
      ? await encrypt(detailsPlain, conn.key)
      : (detailsPlain || "");
    markFailed(sendEdit({ type: "setEventDetails", eventId, details: detailsCipher }));
  }
  if (!createDraftSameText(duration, snap.duration)) {
    markFailed(sendEdit({ type: "setEventDuration", eventId, duration: duration || null }));
  }
  if (!!p.confirmAttendance !== !!snap.confirmAttendance) {
    if (typeof applyConfirmAttendanceRsvps === "function") {
      applyConfirmAttendanceRsvps(ev, !!p.confirmAttendance);
    } else {
      ev.confirmAttendance = !!p.confirmAttendance;
    }
    markFailed(sendEdit({
      type: "setEventConfirmAttendance",
      eventId,
      confirmAttendance: !!p.confirmAttendance,
    }));
  }
  if (failed) {
    try { toast("Couldn't save those changes"); } catch {}
    return;
  }
  if (where && mapUrl && typeof rememberPlaceMapUrl === "function") {
    rememberPlaceMapUrl(where, mapUrl);
  }
  closeCreateDraft(true);
  createDraftRefreshAfterEdit(createDraftFindEvent(eventId) || ev);
}

function createDraftChannelWritable(ch, conn) {
  if (!ch || ch.kind !== "event") return false;
  if (ch.deviceCalendar) return false;
  if (ch.pinnedLocationLabel != null || ch.pinnedUserId != null) return false;
  if (typeof PersonalSpace !== "undefined" && typeof PersonalSpace.isPersonal === "function" && PersonalSpace.isPersonal(conn)) {
    if (typeof PersonalSpace.isHiddenChannel === "function" && PersonalSpace.isHiddenChannel(ch, conn)) return false;
    if (typeof PersonalSpace.isAcceptedChannel === "function" && PersonalSpace.isAcceptedChannel(ch, conn)) return false;
  }
  return true;
}

function createDraftChannelById(conn, id) {
  if (!id) return null;
  return (conn?.channels || []).find((ch) => ch && ch.id === id) || null;
}

/** Event channel for the board on screen, when that channel can store a new event. */
function createDraftBoardChannelId(conn) {
  const board = typeof conversationActiveEventChannel === "function" ? conversationActiveEventChannel() : null;
  return createDraftChannelWritable(board, conn) ? board.id : "";
}

async function commitCreateDraft() {
  const p = createDraftPending();
  if (!p || !createSwipeReadyToPost(p)) return;
  if (p.editEventId) {
    await commitEditEventDraft(p);
    return;
  }
  const conn = (p.createConnId && S.conns?.[p.createConnId])
    || (typeof activeConn === "function" ? activeConn() : null);
  const inBoardChat = typeof S !== "undefined" && !!S.boardChatHome;
  let channelId = createDraftBoardChannelId(conn);
  if (!channelId && !inBoardChat && createDraftChannelWritable(createDraftChannelById(conn, p.createChannelId), conn)) {
    channelId = p.createChannelId;
  }
  if (!channelId && !inBoardChat && typeof activeEventChannel === "function"
      && createDraftChannelWritable(activeEventChannel(), conn)) {
    channelId = activeEventChannel().id;
  }
  if (!channelId && !inBoardChat && createDraftChannelWritable(createDraftChannelById(conn, S.activeEventChannelId), conn)) {
    channelId = S.activeEventChannelId;
  }
  if (!channelId && !inBoardChat && typeof ensureOrCreateEventChannel === "function") {
    try { channelId = await ensureOrCreateEventChannel(); } catch {}
    if (!createDraftChannelWritable(createDraftChannelById(conn, channelId), conn)) channelId = null;
  }
  if (!conn || !channelId) {
    const personal = typeof PersonalSpace !== "undefined" && typeof PersonalSpace.isPersonal === "function" && PersonalSpace.isPersonal(conn);
    try { toast(personal || inBoardChat ? "Couldn't save that event on this board" : "Pick a channel to create in"); } catch {}
    return;
  }
  const title = String(p.title || "").trim();
  if (createDraftAllowsMultiLocations() && p.locationQuery) {
    commitCreateDraftLocationFragment(p, p.locationQuery);
  }
  const whereRaw = String(p.where || "").trim();
  const where = (typeof isCreatePlaceTbd === "function" && isCreatePlaceTbd(whereRaw)) ? "" : whereRaw;
  let when = p.when;
  let whenPrecision = p.whenPrecision || "";
  if (p.timeStartMin != null && p.day != null && typeof atTime === "function") {
    when = atTime(p.day, Math.floor(p.timeStartMin / 60), p.timeStartMin % 60);
    whenPrecision = "";
  } else if (!when && p.day != null) {
    when = typeof atHour === "function" ? atHour(p.day, 12) : (Number(p.day) + 12 * 3600e3);
    whenPrecision = "unconfirmed";
  }
  const matched = typeof findMatchingEventCard === "function" ? findMatchingEventCard(title, conn) : null;
  const icon = p.iconExplicit ? (p.icon || "") : (p.icon && p.icon !== "calendar" ? p.icon : (matched?.icon || p.icon || ""));
  const duration = p.duration || "";
  const typeId = matched?.typeId
    || (typeof typeIdForTitle === "function" ? typeIdForTitle(title, conn) : "")
    || "";
  const cat = matched?.cat || p.card?.cat || "";
  const eventId = typeof genLocalId === "function" ? genLocalId() : undefined;
  const detailsSplit = typeof splitEventMapDetails === "function"
    ? splitEventMapDetails(String(p.details || "").trim())
    : { rest: String(p.details || "").trim(), mapUrl: "" };
  const mapUrl = p.mapUrl || detailsSplit.mapUrl
    || (where && typeof mapUrlForKnownPlace === "function" ? mapUrlForKnownPlace(where) : "");
  const detailsPlain = typeof mergeEventMapDetails === "function"
    ? mergeEventMapDetails(detailsSplit.rest, mapUrl)
    : detailsSplit.rest;
  if (where && mapUrl && typeof rememberPlaceMapUrl === "function") {
    rememberPlaceMapUrl(where, mapUrl);
  }
  if (where && typeof recordLocationUse === "function") {
    recordLocationUse(where, cat, title);
  }
  const locationLabelId = (typeof curatedLocationLabelId === "function"
    ? curatedLocationLabelId(where, conn)
    : "") || "";
  const payload = {
    type: "createEvent",
    shortName: p.shortName?.trim() ? await encrypt(eventShortNameInput(p.shortName), conn.key) : "",
    id: eventId,
    channelId,
    title: typeof encrypt === "function" ? await encrypt(title, conn.key) : title,
    icon: icon || "",
    when,
    where: where && typeof encrypt === "function" ? await encrypt(where, conn.key) : (where || ""),
    details: detailsPlain && typeof encrypt === "function" ? await encrypt(detailsPlain, conn.key) : (detailsPlain || ""),
    duration,
    whenPrecision,
    whenPeriod: p.whenPeriod || "",
    rsvp: "going",
    typeId,
    cat,
    confirmAttendance: !!p.confirmAttendance,
    ...(locationLabelId ? { locationLabelId } : {}),
  };
  const result = send(payload, conn.id);
  const saved = !conn.local || !!(eventId && (conn.events || []).some((ev) => ev && ev.id === eventId));
  if (result === "failed" || !saved) {
    try { toast("Couldn't create that event"); } catch {}
    return;
  }
  const fromChat = typeof S !== "undefined" ? S.createDraftFromChat : null;
  if (eventId && fromChat?.channelId) {
    const owner = (fromChat.connId && S.conns?.[fromChat.connId]) || conn;
    const ids = Array.isArray(fromChat.messageIds) && fromChat.messageIds.length
      ? fromChat.messageIds
      : (fromChat.messageId ? [fromChat.messageId] : []);
    if (ids.length && typeof attachChatMessagesToEvent === "function") {
      // Its messages are tagged next; the event arrives first, so All chat
      // mustn't also post its own "event" message for it (a duplicate).
      if (!S.boardSeededEvents) S.boardSeededEvents = Object.create(null);
      S.boardSeededEvents[eventId] = 1;
      attachChatMessagesToEvent(fromChat.channelId, ids, eventId, owner);
    } else if (fromChat.messageId && typeof attachChatThreadToEvent === "function") {
      attachChatThreadToEvent(fromChat.channelId, fromChat.messageId, eventId, owner);
    }
    S.eventChatNudge = { eventId, title: title || "this event" };
  }
  if (typeof S !== "undefined") S.createDraftFromChat = null;
  if (typeof recordSubtitleUse === "function" && title) recordSubtitleUse(title);
  if (typeof recordTimeUse === "function" && when) {
    recordTimeUse(title, when, whenPrecision, p.whenPeriod);
  }
  closeCreateDraft(true);
  if (fromChat && typeof renderView === "function") renderView();
}

