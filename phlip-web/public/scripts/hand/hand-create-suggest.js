/* hand-create-suggest.js — full-event suggestion sheet for create draft.
 * Load after: hand-create-draft.js; before: hand-create-building.js
 */

let _cdSheetExpanded = false;

function createDraftSuggestTitleHtml(title, typed) {
  const suggested = String(title || "");
  const needle = String(typed || "").trim();
  if (!needle) return esc(suggested);
  const lower = suggested.toLowerCase();
  const typedLower = needle.toLowerCase();
  const ranges = [];
  const exact = lower.indexOf(typedLower);
  if (exact !== -1) ranges.push([exact, exact + needle.length]);
  else {
    typedLower.split(/\s+/).filter((w) => w.length >= 2).forEach((word) => {
      let start = 0;
      let idx;
      while ((idx = lower.indexOf(word, start)) !== -1) {
        ranges.push([idx, idx + word.length]);
        start = idx + word.length;
      }
    });
  }
  if (!ranges.length) return esc(suggested);
  ranges.sort((a, b) => a[0] - b[0] || b[1] - a[1]);
  const merged = [];
  ranges.forEach((r) => {
    const last = merged[merged.length - 1];
    if (last && r[0] <= last[1]) last[1] = Math.max(last[1], r[1]);
    else merged.push(r.slice());
  });
  let out = "";
  let pos = 0;
  merged.forEach((r) => {
    out += esc(suggested.slice(pos, r[0]));
    out += '<span class="cd-title-overlap">' + esc(suggested.slice(r[0], r[1])) + "</span>";
    pos = r[1];
  });
  return out + esc(suggested.slice(pos));
}

function createDraftEventTimeLabel(ev) {
  if (!ev || ev.when == null) return "";
  if (ev.whenPrecision === "unconfirmed") return "";
  const start = new Date(Number(ev.when));
  if (Number.isNaN(start.getTime())) return "";
  const startMin = start.getHours() * 60 + start.getMinutes();
  let endMin = null;
  if (typeof eventEndWhen === "function") {
    const end = eventEndWhen(ev);
    if (end) {
      const ed = new Date(end);
      endMin = ed.getHours() * 60 + ed.getMinutes();
    }
  }
  return formatCreateTimeRange(startMin, endMin);
}

function createDraftEventPlace(ev) {
  if (!ev) return "";
  if (typeof timelineEventPlace === "function") return timelineEventPlace(ev) || "";
  return (typeof shownField === "function" ? shownField(ev._where, ev.where) : (ev._where || ev.where || "")) || "";
}

function createDraftEventTitle(ev) {
  if (!ev) return "";
  const sub = typeof eventSubtitleText === "function" ? eventSubtitleText(ev) : "";
  if (sub) return sub;
  if (typeof timelineEventTitle === "function") return timelineEventTitle(ev);
  return (typeof shownField === "function" ? shownField(ev._title, ev.title) : (ev._title || ev.title || "")) || "";
}

function createDraftSuggestScore(model, pending) {
  let score = model.baseScore || 0;
  const typed = String(pending?.title || "").trim().toLowerCase();
  const title = String(model.title || "").toLowerCase();
  if (typed && title) {
    if (title.indexOf(typed) !== -1) score += 8;
    typed.split(/\s+/).filter((w) => w.length >= 2).forEach((w) => {
      if (title.indexOf(w) !== -1) score += 3;
    });
  }
  if (pending?.icon && model.icon && pending.icon === model.icon) score += 4;
  const loc = String(pending?.where || "").trim().toLowerCase();
  if (loc && String(model.location || "").toLowerCase().indexOf(loc) !== -1) score += 2;
  if (pending?.timeText && model.time && String(model.time).toLowerCase().indexOf(String(pending.timeText).toLowerCase()) !== -1) {
    score += 1;
  }
  return score;
}

function createDraftTitleMatchPct(modelTitle, typed) {
  const a = String(modelTitle || "").trim().toLowerCase();
  const b = String(typed || "").trim().toLowerCase();
  if (!a || !b) return 0;
  if (a === b) return 100;
  let pct = 0;
  if (a.indexOf(b) !== -1 || b.indexOf(a) !== -1) {
    pct = Math.round((Math.min(a.length, b.length) / Math.max(a.length, b.length)) * 100);
  }
  const tokensA = a.split(/\s+/).filter((w) => w.length >= 2);
  const tokensB = b.split(/\s+/).filter((w) => w.length >= 2);
  if (tokensA.length && tokensB.length) {
    const setA = new Set(tokensA);
    let shared = 0;
    tokensB.forEach((w) => { if (setA.has(w)) shared += 1; });
    const tokenPct = Math.round((shared / Math.max(tokensA.length, tokensB.length)) * 100);
    if (tokenPct > pct) pct = tokenPct;
  }
  return Math.max(0, Math.min(100, pct));
}

function createDraftTemplateBtnState(pending) {
  const typed = String(pending?.title || "").trim();
  const idle = { icon: "square-dashed-plus", label: "templates", pct: null, aria: "templates" };
  if (!typed) return idle;
  const models = (buildCreateDraftSuggestionModels(pending) || []).map((m) => ({
    ...m,
    matchPct: createDraftTitleMatchPct(m.title, typed),
  }));
  const matching = models.filter((m) => m.matchPct > 0);
  const strong = matching.filter((m) => m.matchPct >= 85);
  if (strong.length === 1) {
    const hit = strong[0];
    const pct = hit.matchPct;
    const title = String(hit.title || "").trim() || "templates";
    return {
      icon: hit.icon || "square-dashed-plus",
      label: title,
      pct,
      aria: title + " " + pct + "%",
    };
  }
  if (!matching.length) return idle;
  const n = matching.length;
  const label = n === 1 ? "1 suggestion" : n + " suggestions";
  return { icon: "square-dashed-plus", label, pct: null, aria: label };
}

function buildCreateDraftSuggestionModels(pending) {
  const models = [];
  const seen = new Set();
  const add = (model) => {
    const key = [model.title, model.icon, model.time, model.location].join("|").toLowerCase();
    if (!model.title || seen.has(key)) return;
    seen.add(key);
    models.push(model);
  };

  const conn = (pending?.createConnId && S.conns?.[pending.createConnId])
    || (typeof activeConn === "function" ? activeConn() : null);
  const channelId = pending?.createChannelId
    || (typeof activeEventChannel === "function" ? activeEventChannel()?.id : null)
    || S.activeEventChannelId;

  const scope = typeof subtitleCreateScope === "function" ? subtitleCreateScope() : { conn, channelId };
  const events = typeof harvestTypeEvents === "function"
    ? harvestTypeEvents(scope)
    : (conn?.events || []);
  const counts = new Map();
  (events || []).forEach((ev) => {
    const title = createDraftEventTitle(ev);
    if (!title) return;
    const key = title.toLowerCase();
    const cur = counts.get(key) || { n: 0, last: 0, ev, title };
    cur.n += 1;
    cur.last = Math.max(cur.last, Number(ev.when) || Number(ev.updatedAt) || 0);
    if ((Number(ev.when) || 0) >= cur.last) cur.ev = ev;
    counts.set(key, cur);
  });
  [...counts.values()]
    .sort((a, b) => b.n - a.n || b.last - a.last)
    .slice(0, 12)
    .forEach((row) => {
      const ev = row.ev;
      const inChannel = !!(channelId && ev.channelId === channelId);
      const often = row.n >= 3;
      const recent = Date.now() - row.last < 14 * 86400000;
      let reason = { icon: "flame", text: "Often" };
      if (inChannel) reason = { icon: "messages-square", text: "Channel" };
      else if (recent && !often) reason = { icon: "history", text: "Recent" };
      else if (!inChannel && conn && !PersonalSpace?.isPersonal?.(conn)) reason = { icon: "server", text: "Server" };
      add({
        id: "ev-" + (ev.id || row.title),
        title: row.title,
        icon: typeof eventIcon === "function" ? eventIcon(ev) : (ev.icon || "calendar"),
        time: createDraftEventTimeLabel(ev),
        location: createDraftEventPlace(ev),
        reason,
        kind: "used",
        baseScore: often ? 6 : (inChannel ? 5 : 3),
        source: ev,
      });
    });

  if (typeof eventTypeCards === "function") {
    const ch = channelId && Array.isArray(conn?.channels)
      ? conn.channels.find((c) => c.id === channelId)
      : null;
    const typeCards = (eventTypeCards(conn) || []).filter((card) => {
      if (!card || card.custom || card.somethingElse || !card.label) return false;
      if (ch && Array.isArray(ch.enabledCardIds) && typeof eventTypeAllowedByEnabledIds === "function") {
        return eventTypeAllowedByEnabledIds(card, ch.enabledCardIds);
      }
      return true;
    });
    typeCards.forEach((card, idx) => {
      const loc = Array.isArray(card.allowedLocations) && card.allowedLocations.length === 1
        ? card.allowedLocations[0]
        : "";
      add({
        id: "type-" + (card.typeId || card.label || idx),
        title: card.label,
        icon: card.icon || "calendar",
        time: "",
        location: loc,
        reason: { icon: "sparkles", text: "Template" },
        kind: "template",
        baseScore: Math.max(1, 4 - Math.floor(idx / 3)),
        source: card,
      });
    });
  }

  return models
    .map((m) => ({ ...m, score: createDraftSuggestScore(m, pending) }))
    .sort((a, b) => b.score - a.score || String(a.title).localeCompare(b.title));
}

function applyCreateDraftSuggestion(model) {
  const p = createDraftPending();
  if (!p || !model) return;
  p.title = model.title || p.title;
  p.subtitle = p.title;
  if (model.icon) {
    p.icon = model.icon;
    p.iconExplicit = true;
    p.card = p.card || {};
    p.card.icon = model.icon;
    p.card.label = p.title;
  }
  if (!createDraftHasManual(p, "time") && model.time) {
    applyCreateTimeParse(p, model.time);
  }
  if (!createDraftHasManual(p, "place") && model.location
      && !(typeof isCreatePlaceTbd === "function" && isCreatePlaceTbd(model.location))) {
    p.where = model.location;
    if (typeof applyCreateDraftLocationValue === "function") {
      applyCreateDraftLocationValue(p, model.location);
    }
  }
  paintCreateDraftFields();
  renderCreateDraftSuggestions();
}

function renderCreateDraftSuggestions() {
  const sheet = document.getElementById("cd-suggestions");
  const p = createDraftPending();
  if (!sheet || !p) return;
  if (document.body.classList.contains("cd-keyboard-open") && !_cdSheetExpanded) {
    /* keep last markup; still mark open so expand can restore */
  }
  const models = buildCreateDraftSuggestionModels(p);
  const hideTime = createDraftHasManual(p, "time") && !!String(p.timeText || "").trim();
  const hideLoc = createDraftHasManual(p, "place") && !!String(p.where || "").trim();
  const currentIcon = p.icon || "calendar";

  const rowHtml = (model) => {
    const iconMatch = model.icon && model.icon === currentIcon ? " cd-icon-match" : "";
    const timeCls = hideTime ? " cd-use-unused" : "";
    const locCls = hideLoc ? " cd-use-unused" : "";
    const meta = [
      model.time ? `<span class="${timeCls}">${esc(model.time)}</span>` : "",
      model.location ? `<span class="${locCls}">${esc(model.location)}</span>` : "",
    ].filter(Boolean).join('<span class="cd-use-sep' + ((hideTime && hideLoc) ? " cd-use-unused" : "") + '"> · </span>');
    const typed = String(p.title || "").trim();
    const matchPct = createDraftTitleMatchPct(model.title, typed);
    const matchHtml = typed
      ? `<span class="cd-suggest-reason cd-suggest-match">${esc(String(matchPct))}%</span>`
      : "";
    return `<div class="cd-suggest-row">`
      + `<span class="cd-suggest-icon${iconMatch}">${typeof ic === "function" ? ic(model.icon || "calendar") : ""}</span>`
      + `<span class="cd-suggest-body">`
      + `<span class="cd-suggest-titleline"><span class="cd-suggest-title">${createDraftSuggestTitleHtml(model.title, p.title)}</span>`
      + `${matchHtml}</span>`
      + `<span class="cd-suggest-meta">${meta}</span></span>`
      + `<button type="button" class="cd-suggest-use" data-cd-use="${esc(model.id)}">Use</button>`
      + `</div>`;
  };

  const list = models.length
    ? `<div class="cd-suggest-list">${models.map(rowHtml).join("")}</div>`
    : `<div class="cd-sheet-empty">No suggestions yet.</div>`;

  // Templates tray: a tab hangs under the draft card; tapping it drops the
  // list down from behind the card. The tab names the best match as you type.
  const st = typeof createDraftTemplateBtnState === "function"
    ? createDraftTemplateBtnState(p)
    : { icon: "square-dashed-plus", label: "templates", pct: null, aria: "templates" };
  const label = st.label === "templates" ? "Templates" : st.label;
  const pct = st.pct != null ? `<span class="cd-tray-pct">${esc(String(st.pct))}%</span>` : "";
  sheet.innerHTML = `<div class="cd-tray-panel">`
    + `<div class="cd-sheet-shell cd-tray-list">${list}</div>`
    + `<button type="button" class="cd-tray-tab${st.pct != null ? " has-match" : ""}" id="cd-sheet-toggle" aria-expanded="${_cdSheetExpanded ? "true" : "false"}" aria-label="${esc((_cdSheetExpanded ? "Hide " : "Show ") + (st.aria || "templates"))}">`
    + `${typeof ic === "function" ? ic(st.icon || "square-dashed-plus") : ""}<span class="cd-tray-label">${esc(label)}</span>${pct}`
    + `<span class="cd-tray-chevron">${typeof ic === "function" ? ic("chevron-down") : ""}</span>`
    + `</button></div>`;
  sheet.classList.toggle("expanded", !!_cdSheetExpanded);
  sheet.classList.add("open");
  const toggle = () => {
    _cdSheetExpanded = !_cdSheetExpanded;
    renderCreateDraftSuggestions();
    layoutCreateDraftCard();
  };
  const head = sheet.querySelector("#cd-sheet-toggle");
  head?.addEventListener("click", (e) => { e.preventDefault(); e.stopPropagation(); toggle(); });
  sheet.querySelectorAll("[data-cd-use]").forEach((btn) => {
    btn.addEventListener("click", (e) => {
      e.stopPropagation();
      const id = btn.getAttribute("data-cd-use");
      const model = models.find((m) => m.id === id);
      if (model) applyCreateDraftSuggestion(model);
      _cdSheetExpanded = false;
      renderCreateDraftSuggestions();
    });
  });
}
