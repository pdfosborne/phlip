/* event-card-styles.js — editable event-card presets shared by DOM + canvas. */

const EVENT_CARD_STYLE_STORAGE_KEY = "ash_event_card_styles_v3";
const EVENT_CARD_STYLE_VERSION = 3;

const EVENT_CARD_LAYOUT = Object.freeze({
  aspect: 340 / 476,
  radiusRatio: 22 / 340,
  strokeRatio: 1.5 / 340,
  boxInsetRatio: 12 / 340,
  boxHeightRatio: 234 / 476,
  boxRadiusRatio: 10 / 340,
  simpleTitleRatio: 52 / 340,
  picturedTitleRatio: 32 / 340,
  titleMinRatio: 0.55,
  metaWhenRatio: 16 / 340,
  metaWhereRatio: 14.5 / 340,
  iconSimpleRatio: 30 / 340,
  iconPicturedRatio: 26 / 340,
});

function eventCardLayoutMetrics(width, height, pictured = false) {
  const w = Math.max(1, Number(width) || 1);
  const h = Math.max(1, Number(height) || 1);
  const titleSize = w * (pictured ? EVENT_CARD_LAYOUT.picturedTitleRatio : EVENT_CARD_LAYOUT.simpleTitleRatio);
  const boxHeight = h * EVENT_CARD_LAYOUT.boxHeightRatio;
  return {
    width: w, height: h,
    radius: w * EVENT_CARD_LAYOUT.radiusRatio,
    stroke: Math.max(1, w * EVENT_CARD_LAYOUT.strokeRatio),
    boxInset: w * EVENT_CARD_LAYOUT.boxInsetRatio,
    boxHeight,
    boxRadius: w * EVENT_CARD_LAYOUT.boxRadiusRatio,
    titleSize,
    titleMinSize: titleSize * EVENT_CARD_LAYOUT.titleMinRatio,
    metaWhenSize: w * EVENT_CARD_LAYOUT.metaWhenRatio,
    metaWhereSize: w * EVENT_CARD_LAYOUT.metaWhereRatio,
    iconSize: w * (pictured ? EVENT_CARD_LAYOUT.iconPicturedRatio : EVENT_CARD_LAYOUT.iconSimpleRatio),
    heroH: pictured ? h - boxHeight : h * 0.48,
    subtitleH: 0,
    detailsH: pictured ? boxHeight : h * 0.22,
    detailsIconSize: w * (17 / 340),
    detailsTextSize: w * EVENT_CARD_LAYOUT.metaWhereRatio,
    detailsLineHeight: w * EVENT_CARD_LAYOUT.metaWhereRatio * 1.15,
    detailsRowHeight: w * (19 / 340),
    detailsRowStep: w * (28 / 340),
    detailsInset: w * (18 / 340),
    detailsRowGap: w * (7 / 340),
    heroGap: 0,
    heroOpticalShift: 0,
    subtitleSize: titleSize,
    subtitleMinSize: titleSize * EVENT_CARD_LAYOUT.titleMinRatio,
  };
}

function eventCardFitCanvasFont(ctx, text, maxWidth, preferred, minimum, fontAtSize) {
  let size = Math.max(minimum, preferred);
  ctx.font = fontAtSize(size);
  while (size > minimum && ctx.measureText(String(text || "")).width > maxWidth) {
    size -= 0.5;
    ctx.font = fontAtSize(size);
  }
  return Math.max(minimum, size);
}

const EVENT_CARD_FONTS = [
  { id: "atkinson", label: "Readable", css: '"Atkinson Hyperlegible", system-ui, -apple-system, "Segoe UI", sans-serif', canvas: '"Atkinson Hyperlegible", system-ui, sans-serif' },
  { id: "inter", label: "Clean", css: 'Inter, system-ui, -apple-system, "Segoe UI", sans-serif', canvas: 'Inter, system-ui, sans-serif' },
  { id: "rounded", label: "Rounded", css: '"Nunito Sans", ui-rounded, system-ui, sans-serif', canvas: '"Nunito Sans", ui-rounded, system-ui, sans-serif' },
  { id: "serif", label: "Editorial", css: 'Lora, Georgia, "Times New Roman", serif', canvas: 'Lora, Georgia, serif' },
  { id: "mono", label: "Mono", css: '"IBM Plex Mono", ui-monospace, Menlo, Consolas, monospace', canvas: '"IBM Plex Mono", ui-monospace, monospace' },
];

const EVENT_CARD_COLOR_KEYS = [
  "imageBg", "imageFg", "badgeBg", "badgeText", "subtitleBg", "subtitleText", "infoBg", "detailText", "border",
];
const EVENT_CARD_FONT_KEYS = ["titleFont", "badgeFont", "detailsFont"];

const EVENT_CARD_BUILTIN_PRESETS = [
  {
    id: "light", name: "Light", builtin: true, treat: "light",
    colors: { imageBg: "#120F1E", imageFg: "#120F1E", badgeBg: "#FFFFFF", badgeText: "#120F1E", subtitleBg: "#FFFFFF", subtitleText: "#120F1E", infoBg: "#FFFFFF", detailText: "#6F6D79", border: "#120F1E" },
    fonts: { titleFont: "atkinson", badgeFont: "atkinson", detailsFont: "atkinson" },
  },
  {
    id: "dark", name: "Dark", builtin: true, treat: "dark",
    colors: { imageBg: "#120F1E", imageFg: "#FFFFFF", badgeBg: "#120F1E", badgeText: "#FFFFFF", subtitleBg: "#120F1E", subtitleText: "#FFFFFF", infoBg: "#120F1E", detailText: "#CCC9D1", border: "#FFFFFF" },
    fonts: { titleFont: "atkinson", badgeFont: "atkinson", detailsFont: "atkinson" },
  },
  {
    id: "transparent", name: "Transparent", builtin: true, treat: "transparent",
    colors: { imageBg: "#120F1E", imageFg: "#FFFFFF", badgeBg: "#0D0A17", badgeText: "#FFFFFF", subtitleBg: "#0D0A17", subtitleText: "#FFFFFF", infoBg: "#0D0A17", detailText: "#E0DEE5", border: "#FFFFFF" },
    fonts: { titleFont: "atkinson", badgeFont: "atkinson", detailsFont: "atkinson" },
  },
];

function normalizeEventCardPresetId(id) {
  const v = String(id || "").trim();
  const lower = v.toLowerCase();
  if (lower === "dark") return "dark";
  if (lower === "transparent") return "transparent";
  if (lower === "light") return "light";
  if (lower.startsWith("custom")) return v;
  return "light";
}

function eventCardTreatId(preset) {
  const t = String(preset?.treat || "").toLowerCase();
  if (t === "dark" || t === "transparent" || t === "light") return t;
  return normalizeEventCardPresetId(preset?.id);
}

function normalizeEventCardHex(value, fallback = "#000000") {
  const text = String(value || "").trim();
  return /^#[0-9a-f]{6}$/i.test(text) ? text.toUpperCase() : fallback;
}

function eventCardFontDef(id) {
  return EVENT_CARD_FONTS.find(font => font.id === id) || EVENT_CARD_FONTS[0];
}

function normalizeEventCardPreset(raw, fallback = EVENT_CARD_BUILTIN_PRESETS[0]) {
  const source = raw && typeof raw === "object" ? raw : fallback;
  const sourceId = String(source.id || fallback.id);
  const migratedId = normalizeEventCardPresetId(sourceId);
  if (EVENT_CARD_BUILTIN_PRESETS.some(item => item.id === sourceId.toLowerCase())) {
    const builtin = EVENT_CARD_BUILTIN_PRESETS.find(item => item.id === migratedId) || fallback;
    return {
      id: builtin.id,
      name: builtin.name,
      builtin: true,
      treat: builtin.treat,
      colors: { ...builtin.colors },
      fonts: { ...builtin.fonts },
      options: { subtitleBorder: true },
      createdAt: Number(source.createdAt) || undefined,
      updatedAt: Number(source.updatedAt) || undefined,
    };
  }
  const colors = {};
  for (const key of EVENT_CARD_COLOR_KEYS) {
    colors[key] = normalizeEventCardHex(source.colors?.[key], fallback.colors[key]);
  }
  const fonts = {};
  for (const key of EVENT_CARD_FONT_KEYS) {
    fonts[key] = eventCardFontDef(source.fonts?.[key] || fallback.fonts[key]).id;
  }
  return {
    id: sourceId.replace(/[^a-z0-9:_-]/gi, "").slice(0, 80) || fallback.id,
    name: String(source.name || fallback.name).trim().slice(0, 40) || fallback.name,
    builtin: !!source.builtin,
    treat: eventCardTreatId({ id: migratedId, treat: source.treat }),
    colors,
    fonts,
    options: { subtitleBorder: source.options?.subtitleBorder !== false },
    createdAt: Number(source.createdAt) || undefined,
    updatedAt: Number(source.updatedAt) || undefined,
  };
}

function defaultEventCardStyleState() {
  return { version: EVENT_CARD_STYLE_VERSION, activePresetId: "light", customPresets: [] };
}

function loadEventCardStyleState() {
  const fallback = defaultEventCardStyleState();
  try {
    const parsed = JSON.parse(localStorage.getItem(EVENT_CARD_STYLE_STORAGE_KEY) || "null");
    if (!parsed || Number(parsed.version) !== EVENT_CARD_STYLE_VERSION) return fallback;
    const customPresets = Array.isArray(parsed.customPresets)
      ? parsed.customPresets.map(item => normalizeEventCardPreset({
        ...item,
        builtin: false,
      })).filter(item => item.id)
      : [];
    const ids = new Set([...EVENT_CARD_BUILTIN_PRESETS.map(item => item.id), ...customPresets.map(item => item.id)]);
    const normalizedActive = normalizeEventCardPresetId(parsed.activePresetId);
    const activePresetId = ids.has(normalizedActive) ? normalizedActive
      : (ids.has(parsed.activePresetId) ? parsed.activePresetId : "light");
    return { version: EVENT_CARD_STYLE_VERSION, activePresetId, customPresets };
  } catch { return fallback; }
}

function saveEventCardStyleState(state) {
  const customPresets = (state?.customPresets || []).map(item => normalizeEventCardPreset({ ...item, builtin: false }));
  const ids = new Set([...EVENT_CARD_BUILTIN_PRESETS.map(item => item.id), ...customPresets.map(item => item.id)]);
  const normalizedActive = normalizeEventCardPresetId(state?.activePresetId);
  const next = {
    version: EVENT_CARD_STYLE_VERSION,
    activePresetId: ids.has(normalizedActive) ? normalizedActive
      : (ids.has(state?.activePresetId) ? state.activePresetId : "light"),
    customPresets,
  };
  try {
    const ok = typeof storageSetJson === "function"
      ? storageSetJson(EVENT_CARD_STYLE_STORAGE_KEY, next)
      : (localStorage.setItem(EVENT_CARD_STYLE_STORAGE_KEY, JSON.stringify(next)), true);
    if (ok === false) throw new Error("storage denied");
  } catch {
    try { if (typeof toast === "function") toast("Couldn’t save the card preset on this device"); } catch {}
  }
  applyActiveEventCardStyle(next);
  try { if (typeof syncMyEventCardStyle === "function") syncMyEventCardStyle(); } catch {}
  try { if (typeof purgeCardImageCache === "function") purgeCardImageCache(); } catch {}
  return next;
}

function allEventCardPresets(state = loadEventCardStyleState()) {
  return [...EVENT_CARD_BUILTIN_PRESETS, ...(state.customPresets || [])];
}

function activeEventCardPreset(state = loadEventCardStyleState()) {
  return allEventCardPresets(state).find(item => item.id === state.activePresetId) || EVENT_CARD_BUILTIN_PRESETS[0];
}

function eventCardPresetSnapshot(preset = activeEventCardPreset()) {
  const p = normalizeEventCardPreset(preset);
  return {
    id: p.id,
    name: p.name,
    treat: eventCardTreatId(p),
    colors: { ...p.colors },
    fonts: { ...p.fonts },
    options: { subtitleBorder: p.options?.subtitleBorder !== false },
  };
}

function simpleEventCardPreset() {
  return eventCardPresetSnapshot(EVENT_CARD_BUILTIN_PRESETS[0]);
}

function eventCardPresetForEvent(ev) {
  return ev?.eventCardStyle
    ? normalizeEventCardPreset(ev.eventCardStyle, EVENT_CARD_BUILTIN_PRESETS[0])
    : activeEventCardPreset();
}

function eventCardPresetForRoutine(routine) {
  return routine?.eventCardStyle
    ? normalizeEventCardPreset(routine.eventCardStyle, EVENT_CARD_BUILTIN_PRESETS[0])
    : activeEventCardPreset();
}

/** Device preference is authoritative and is mirrored to every joined server. */
function syncMyEventCardStyle(conn = null) {
  const preset = eventCardPresetSnapshot(activeEventCardPreset());
  const fingerprint = eventCardStyleFingerprint(preset);
  const targets = conn ? [conn] : Object.values(S.conns || {});
  for (const c of targets) {
    if (!c || (typeof PersonalSpace !== "undefined" && PersonalSpace.isPersonal(c))) continue;
    if (c.me) c.me.eventCardStyle = preset;
    if (Array.isArray(c.members)) {
      c.members = c.members.map(member => member?.id === c.me?.id
        ? { ...member, eventCardStyle: preset }
        : member);
    }
    if (c.status !== "online" || c._lastEventCardStyleSent === fingerprint) continue;
    c._lastEventCardStyleSent = fingerprint;
    try { sendTo(c, { type: "setUserEventCardStyle", eventCardStyle: preset }); } catch {
      c._lastEventCardStyleSent = "";
    }
  }
  return preset;
}

function eventCardStyleFingerprint(preset = activeEventCardPreset()) {
  return JSON.stringify([preset.id, eventCardTreatId(preset), EVENT_CARD_COLOR_KEYS.map(k => preset.colors[k]), EVENT_CARD_FONT_KEYS.map(k => preset.fonts[k]), preset.options?.subtitleBorder !== false]);
}


function eventCardEffectivePreset(preset = activeEventCardPreset(), ev = null) {
  return normalizeEventCardPreset(preset);
}

function eventCardStyleCssText(preset = activeEventCardPreset(), ev = null) {
  const p = eventCardEffectivePreset(preset, ev);
  const treat = eventCardTreatId(p);
  return [
    `--event-card-treat:${treat}`,
    `--event-card-image-bg:${p.colors.imageBg}`, `--event-card-image-fg:${p.colors.imageFg}`,
    `--event-card-date-bg:${p.colors.badgeBg}`, `--event-card-date-fg:${p.colors.badgeText}`,
    `--event-card-subtitle-bg:${p.colors.subtitleBg}`, `--event-card-subtitle:${p.colors.subtitleText}`,
    `--event-card-subtitle-border-width:${p.options.subtitleBorder ? "1px" : "0px"}`,
    `--event-card-info-bg:${p.colors.infoBg}`,
    `--event-card-detail:${p.colors.detailText}`, `--event-card-border:${p.colors.border}`,
    `--ec-title-font:${eventCardFontDef(p.fonts.titleFont).css}`,
    `--ec-badge-font:${eventCardFontDef(p.fonts.badgeFont).css}`,
    `--ec-details-font:${eventCardFontDef(p.fonts.detailsFont).css}`,
  ].join(";");
}

function applyActiveEventCardStyle(state = loadEventCardStyleState()) {
  const preset = activeEventCardPreset(state);
  const root = document.documentElement;
  root.dataset.eventCardPreset = preset.id;
  root.dataset.eventCardTreat = eventCardTreatId(preset);
  for (const part of eventCardStyleCssText(preset).split(";")) {
    const at = part.indexOf(":");
    if (at > 0) root.style.setProperty(part.slice(0, at), part.slice(at + 1));
  }
  return preset;
}


function fitEventCardSingleLine(element, preferred, minimum) {
  if (!element || !element.textContent.trim() || !element.clientWidth) return;
  const available = Math.max(0, element.clientWidth - 2);
  let low = minimum, high = preferred;
  element.style.fontSize = `${preferred}px`;
  if (element.scrollWidth <= available) return;
  for (let i = 0; i < 8; i += 1) {
    const mid = (low + high) / 2;
    element.style.fontSize = `${mid}px`;
    if (element.scrollWidth <= available) low = mid;
    else high = mid;
  }
  element.style.fontSize = `${low}px`;
}

function fitEventCardTypography(card) {
  if (!card?.classList?.contains("event-card-template") || !card.clientHeight) return;
  if (card.closest?.(".tl-card-preview") || card.closest?.(".conv-event-mini")) return;
  const pictured = card.classList.contains("event-card-pictured");
  const metrics = eventCardLayoutMetrics(card.clientWidth, card.clientHeight, pictured);
  fitEventCardSingleLine(card.querySelector(".event-card-title"), metrics.titleSize, metrics.titleMinSize);
}

function installEventCardLayoutObservers() {
  const schedule = root => requestAnimationFrame(() => {
    if (root?.matches?.(".event-card-template")) fitEventCardTypography(root);
    root?.querySelectorAll?.(".event-card-template").forEach(fitEventCardTypography);
  });
  const resize = typeof ResizeObserver === "function"
    ? new ResizeObserver(entries => entries.forEach(entry => fitEventCardTypography(entry.target)))
    : null;
  const watch = root => {
    const cards = root?.matches?.(".event-card-template") ? [root] : [...(root?.querySelectorAll?.(".event-card-template") || [])];
    cards.forEach(card => { resize?.observe(card); schedule(card); });
  };
  const unwatch = root => {
    if (!resize) return;
    const cards = root?.matches?.(".event-card-template") ? [root] : [...(root?.querySelectorAll?.(".event-card-template") || [])];
    cards.forEach(card => resize.unobserve(card));
  };
  watch(document);
  new MutationObserver(records => records.forEach(record => {
    record.addedNodes.forEach(node => { if (node.nodeType === 1) watch(node); });
    record.removedNodes.forEach(node => { if (node.nodeType === 1) unwatch(node); });
  })).observe(document.documentElement, { childList: true, subtree: true });
  try { document.fonts?.ready?.then(() => schedule(document)); } catch {}
}


try { applyActiveEventCardStyle(); } catch {}
try { installEventCardLayoutObservers(); } catch {}
