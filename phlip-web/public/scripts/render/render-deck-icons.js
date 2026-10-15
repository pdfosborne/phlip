/* render-deck-icons.js — deck replacement picks + category icon picker.
 * Load after: render-join*.js; before: render-deck-editor-body.js
 */


/** Lucide category sections for the picker, with Phosphor sports + objects glyphs. */
function iconPickerSections() {
  const sections = (typeof ICON_PICKER_SECTIONS !== "undefined" && Array.isArray(ICON_PICKER_SECTIONS))
    ? ICON_PICKER_SECTIONS.slice()
    : [];
  const sports = (typeof PHOSPHOR_SPORTS_NAMES !== "undefined" && PHOSPHOR_SPORTS_NAMES.length)
    ? PHOSPHOR_SPORTS_NAMES
    : null;
  const objects = (typeof PHOSPHOR_OBJECTS_NAMES !== "undefined" && PHOSPHOR_OBJECTS_NAMES.length)
    ? PHOSPHOR_OBJECTS_NAMES
    : null;
  const next = sports
    ? sections.map((sec) => (sec.id === "sports" ? { ...sec, icons: sports.slice() } : sec))
    : sections;
  if (!objects) return next;
  const objectsSec = { id: "objects", title: "Objects", icons: objects.slice() };
  const sportsIdx = next.findIndex((sec) => sec.id === "sports");
  if (sportsIdx < 0) return next.concat(objectsSec);
  return [...next.slice(0, sportsIdx + 1), objectsSec, ...next.slice(sportsIdx + 1)];
}

/** Unfiltered create-draft picker: event-useful Lucide groups only. */
const ICON_PICKER_BROWSE_SECTION_IDS = [
  "buildings",
  "food-beverage",
  "nature",
  "sports",
  "transportation",
  "weather",
];

const ICON_PICKER_BROWSE_ICONS = {
  buildings: [
    "house", "building", "building-2", "hotel", "hospital", "school", "store",
    "church", "landmark", "castle", "theater", "university", "factory", "warehouse",
  ],
  "food-beverage": [
    "coffee", "utensils", "pizza", "beer", "wine", "martini", "hamburger", "sandwich",
    "cooking-pot", "chef-hat", "cake", "ice-cream-cone", "apple", "croissant", "cup-soda", "donut",
  ],
  nature: [
    "tree-deciduous", "tree-pine", "tree-palm", "trees", "flower", "flower-2", "leaf",
    "mountain", "mountain-snow", "tent", "sprout", "binoculars",
  ],
  sports: (typeof PHOSPHOR_SPORTS_NAMES !== "undefined" && PHOSPHOR_SPORTS_NAMES.length)
    ? PHOSPHOR_SPORTS_NAMES.slice()
    : ["dumbbell", "trophy", "medal", "volleyball", "award", "land-plot", "waves-ladder"],
  transportation: [
    "car", "bus", "train-front", "tram-front", "plane", "bike", "ship", "sailboat",
    "fuel", "ambulance", "truck", "cable-car",
  ],
  weather: [
    "sun", "sunrise", "sunset", "cloud-sun", "cloud-rain", "cloud-lightning", "snowflake",
    "moon-star", "umbrella", "wind", "rainbow", "thermometer",
  ],
};

function iconPickerBrowseSections(catalog, browseSectionIds) {
  if (!browseSectionIds || !browseSectionIds.length) return catalog;
  const allow = new Set(browseSectionIds);
  const next = (catalog || []).filter((sec) => allow.has(sec.id)).map((sec) => {
    const source = new Set(sec.icons || []);
    const preferred = ICON_PICKER_BROWSE_ICONS[sec.id] || sec.icons || [];
    const icons = preferred.filter((name) => source.has(name) && !String(name).endsWith("-off"));
    return { ...sec, icons: icons.length ? icons : (sec.icons || []).filter((name) => !String(name).endsWith("-off")) };
  });
  return next.length ? next : catalog;
}

function armIconPickerFilter(filterEl, autofocus) {
  if (!filterEl) return;
  const selectSeed = () => {
    try {
      if (filterEl.value) filterEl.select();
    } catch {}
  };
  if (autofocus) {
    queueMicrotask(() => {
      filterEl.focus();
      selectSeed();
    });
    return;
  }
  const lock = () => {
    filterEl.setAttribute("readonly", "readonly");
    filterEl.setAttribute("inputmode", "none");
  };
  const unlock = () => {
    filterEl.removeAttribute("readonly");
    filterEl.setAttribute("inputmode", "search");
  };
  lock();
  let allowFocus = false;
  filterEl.addEventListener("pointerdown", (e) => {
    if (!filterEl.hasAttribute("readonly")) return;
    e.preventDefault();
    allowFocus = true;
    unlock();
    filterEl.focus();
    selectSeed();
  });
  filterEl.addEventListener("focus", () => {
    if (allowFocus) return;
    filterEl.blur();
    try { window.AshNative?.hideKeyboard?.(); } catch {}
  });
}

const NAMED_DRAW_ICONS_KEY = "ash_named_draw_icons_v1";
const RECENT_PICKER_ICONS_KEY = "ash_recent_picker_icons_v1";
const RECENT_PICKER_ICONS_MAX = 16;
const NAMED_DRAW_ICONS_MAX = 40;

function iconPickerQueryHay(q, ...parts) {
  if (!q) return true;
  const n = parts.filter(Boolean).join(" ").toLowerCase().replace(/\s+/g, "-");
  return n.includes(q) || n.replace(/-/g, " ").includes(q.replace(/-/g, " "));
}

function loadNamedDrawIcons() {
  const raw = typeof loadJSON === "function" ? loadJSON(NAMED_DRAW_ICONS_KEY, []) : [];
  if (!Array.isArray(raw)) return [];
  return raw.filter((row) => row && String(row.name || "").trim() && String(row.icon || "").trim())
    .map((row) => ({ name: String(row.name).trim(), icon: String(row.icon).trim() }));
}

function saveNamedDrawIcon(name, icon) {
  const label = String(name || "").trim();
  const value = String(icon || "").trim();
  if (!label || !value) return;
  const next = loadNamedDrawIcons().filter((row) => row.name.toLowerCase() !== label.toLowerCase());
  next.unshift({ name: label, icon: value });
  try {
    persistJSON(NAMED_DRAW_ICONS_KEY, next.slice(0, NAMED_DRAW_ICONS_MAX));
  } catch {}
}

function loadRecentPickerIcons() {
  const raw = typeof loadJSON === "function" ? loadJSON(RECENT_PICKER_ICONS_KEY, []) : [];
  if (!Array.isArray(raw)) return [];
  return raw.filter((row) => row && String(row.icon || "").trim())
    .map((row) => ({
      icon: String(row.icon).trim(),
      name: String(row.name || "").trim(),
    }));
}

function recordRecentPickerIcon(icon, name) {
  const value = String(icon || "").trim();
  if (!value) return;
  const label = String(name || "").trim();
  const next = loadRecentPickerIcons().filter((row) => row.icon !== value);
  next.unshift({ icon: value, name: label });
  try {
    persistJSON(RECENT_PICKER_ICONS_KEY, next.slice(0, RECENT_PICKER_ICONS_MAX));
  } catch {}
}

/**
 * Fill a scroll root with categorized Lucide icons + optional filter.
 * @param {HTMLElement} root
 * @param {{ currentIcon?: string, onChoose: (name: string, meta?: { name?: string }) => void, recents?: { icon: string, name?: string }[], named?: { icon: string, name: string }[] }} opts
 */
function mountIconPickerCatalog(root, {
  currentIcon = null,
  currentLabel = "",
  onChoose,
  autofocus = true,
  recents = null,
  named = null,
  browseSectionIds = null,
  placeholder = "Search for more icons…",
} = {}) {
  if (!root) return;
  const sections = iconPickerSections();
  const fallback = (typeof CARD_ICON_CHOICES !== "undefined" && CARD_ICON_CHOICES.length)
    ? [{ id: "all", title: "Icons", icons: CARD_ICON_CHOICES.slice() }]
    : [{ id: "all", title: "Icons", icons: ["pin", "calendar", "party", "dinner", "sport", "film", "games", "hike"] }];
  const catalog = sections.length ? sections : fallback;
  const recentRows = Array.isArray(recents) ? recents : loadRecentPickerIcons();
  const namedRows = Array.isArray(named) ? named : loadNamedDrawIcons();
  const seeded = String(currentLabel || "").trim();

  root.innerHTML = `
    <label class="cat-icon-filter-wrap">
      <input type="search" class="cat-icon-filter" id="cat-icon-filter" placeholder="${esc(placeholder)}" autocomplete="off" enterkeyhint="search" aria-label="${esc(placeholder)}">
    </label>
    <div class="cat-icon-picker-scroll" id="cat-icon-picker-scroll"></div>`;
  const filterEl = root.querySelector("#cat-icon-filter");
  const scroll = root.querySelector("#cat-icon-picker-scroll");
  if (filterEl && seeded) filterEl.value = seeded;
  let filterArmed = !seeded;

  const appendChoice = (grid, icon, label) => {
    const btn = document.createElement("button");
    btn.type = "button";
    btn.className = "cat-icon-choice" + (icon === currentIcon ? " on" : "");
    btn.innerHTML = typeof ic === "function" ? ic(icon) : esc(label || icon);
    btn.title = label || icon;
    btn.setAttribute("aria-label", label || icon);
    btn.onclick = () => onChoose?.(icon, { name: label || "" });
    grid.appendChild(btn);
  };

  const appendBlock = (title, rows) => {
    if (!rows.length) return false;
    const block = document.createElement("section");
    block.className = "cat-icon-section";
    block.innerHTML = `<h5 class="cat-icon-section-title">${esc(title)}</h5>
      <div class="cat-icon-grid cat-icon-section-grid"></div>`;
    const grid = block.querySelector(".cat-icon-section-grid");
    for (const row of rows) appendChoice(grid, row.icon, row.name);
    scroll.appendChild(block);
    return true;
  };

  const paint = () => {
    const raw = String(filterEl?.value || "").trim();
    if (!filterArmed && raw !== seeded) filterArmed = true;
    const q = (!filterArmed || !raw) ? "" : raw.toLowerCase().replace(/\s+/g, "-");
    const visible = q ? catalog : iconPickerBrowseSections(catalog, browseSectionIds);
    scroll.innerHTML = "";
    let any = false;
    const recentHits = recentRows.filter((row) => iconPickerQueryHay(q, row.name, row.icon));
    any = appendBlock("Recent", recentHits) || any;
    const recentIcons = new Set(recentHits.map((row) => row.icon));
    const namedHits = namedRows.filter((row) => {
      if (recentIcons.has(row.icon) && !q) return false;
      return iconPickerQueryHay(q, row.name, row.icon);
    });
    any = appendBlock("Yours", namedHits) || any;
    for (const sec of visible) {
      const sectionHit = iconPickerQueryHay(q, sec.title, sec.id);
      const icons = (sec.icons || []).filter((name) => sectionHit || iconPickerQueryHay(q, name));
      if (!icons.length) continue;
      any = true;
      const block = document.createElement("section");
      block.className = "cat-icon-section";
      block.innerHTML = `<h5 class="cat-icon-section-title">${esc(sec.title || sec.id)}</h5>
        <div class="cat-icon-grid cat-icon-section-grid"></div>`;
      const grid = block.querySelector(".cat-icon-section-grid");
      for (const name of icons) appendChoice(grid, name, name);
      scroll.appendChild(block);
    }
    if (!any) {
      scroll.innerHTML = `<p class="cat-hint">No icons match.</p>`;
    }
  };

  filterEl?.addEventListener("input", paint);
  paint();
  armIconPickerFilter(filterEl, autofocus);
}

/** Icon grid in a popup — used by Card manager / channel icons / create-flow. */
function openCatIconPicker({ currentIcon, title = "Choose icon", allowDraw = true, onPick } = {}) {
  const canDraw = allowDraw && (typeof canUserDraw !== "function" || canUserDraw());
  const opened = AshModal.open({
    className: "cat-icon-picker",
    html: `
    <div class="modal-card cat-icon-picker-card" role="dialog" aria-modal="true" aria-label="${esc(title)}">
      <h4>${esc(title)}</h4>
      <div class="cat-icon-picker-body" id="cat-icon-picker-body"></div>
      <div class="actions cat-icon-picker-actions">
        <span></span>
        <div class="cat-icon-picker-action-btns">
          ${canDraw ? `<button type="button" class="cancel" id="cat-icon-draw">Draw</button>` : ""}
          <button type="button" class="cancel" id="cat-icon-custom">Plain</button>
          <button type="button" class="cancel" id="cat-icon-close">Cancel</button>
        </div>
      </div>
    </div>`,
    singleton: "return",
  });
  if (!opened) return;
  const { overlay, close } = opened;

  overlay.querySelector("#cat-icon-close").onclick = close;
  overlay.querySelector("#cat-icon-custom").onclick = () => { close(); onPick?.("custom"); };

  const body = overlay.querySelector("#cat-icon-picker-body");
  mountIconPickerCatalog(body, {
    currentIcon,
    onChoose: (name) => { close(); onPick?.(name); },
  });

  // Current drawn icon as a quick re-pick at the top of the scroll.
  if (typeof isDrawnIcon === "function" && isDrawnIcon(currentIcon)) {
    const scroll = body?.querySelector("#cat-icon-picker-scroll");
    if (scroll) {
      const row = document.createElement("div");
      row.className = "cat-icon-drawn-row";
      const btn = document.createElement("button");
      btn.type = "button";
      btn.className = "cat-icon-choice on";
      btn.innerHTML = ic(currentIcon);
      btn.title = "Current drawing";
      btn.onclick = () => { close(); onPick?.(currentIcon); };
      row.appendChild(btn);
      scroll.insertBefore(row, scroll.firstChild);
    }
  }

  overlay.querySelector("#cat-icon-draw")?.addEventListener("click", () => {
    if (typeof canUserDraw === "function" && !canUserDraw()) {
      toast("Drawing is turned off on this server");
      return;
    }
    close();
    openDrawIconModal({
      initialIcon: (typeof isDrawnIcon === "function" && isDrawnIcon(currentIcon)) ? currentIcon : null,
      onSave: (encoded) => onPick?.(encoded),
    });
  });
}
