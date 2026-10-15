/* channel-timeline-cards.js — Cards layout: Simple faces in a contained carousel.
 * Globals out: timelineCardDeckHTML, timelinePaintCardDeck, timelineCardDeckJumpToDay,
 *   timelineCardDeckCurrentId
 * Load after: channel-timeline-view.js
 */

let timelineCardDeckIds = [];
let timelineCardDeckIndex = 0;
let timelineCardDeckSuppressClickUntil = 0;

function timelineCardDeckEvents(events) {
  return (events || []).filter(function (ev) {
    return ev && ev.id && !ev._availability && !ev._timeBlock;
  });
}

function timelineCardDeckCurrentId() {
  return timelineCardDeckIds[timelineCardDeckIndex] || null;
}

function timelineCardDeckFaceHTML(ev) {
  if (!ev) return '<div class="tl-card-deck-slide is-empty" aria-hidden="true"></div>';
  const face = typeof eventCardHTML === "function"
    ? eventCardHTML(ev, ev.when, {
        size: "full",
        form: "simple",
        omitPendingBanner: true,
        preserveEmptySlots: false,
      })
    : "";
  const title = typeof timelineEventTitle === "function" ? timelineEventTitle(ev) : "Event";
  return '<div class="tl-card-deck-slide" data-id="' + esc(ev.id) + '" role="group" aria-label="' + esc(title) + '">'
    + '<div class="tl-card-deck-face">' + face + "</div></div>";
}

function timelineCardDeckEmptyHTML() {
  return '<div class="tl-card-deck is-empty" id="tl-card-deck" role="region" aria-label="Event cards">'
    + '<p class="tl-card-deck-empty">No upcoming events</p></div>';
}

function timelineCardDeckIndexFor(events, preferredId, day) {
  if (!events.length) return 0;
  if (preferredId) {
    const found = events.findIndex(function (ev) { return ev.id === preferredId; });
    if (found >= 0) return found;
  }
  if (day != null) {
    const want = timelineDay(day);
    const onDay = events.findIndex(function (ev) { return timelineDay(ev.when) >= want; });
    if (onDay >= 0) return onDay;
    return events.length - 1;
  }
  const today = timelineDay(Date.now());
  const upcoming = events.findIndex(function (ev) { return timelineDay(ev.when) >= today; });
  return upcoming >= 0 ? upcoming : 0;
}

function timelineCardDeckHTML(events, opts) {
  const list = timelineCardDeckEvents(events);
  timelineCardDeckIds = list.map(function (ev) { return ev.id; });
  const preferred = (opts && opts.eventId) || timelineFocusedEventId || timelineCardDeckCurrentId();
  const day = opts && opts.day;
  timelineCardDeckIndex = timelineCardDeckIndexFor(list, preferred, day);
  if (!list.length) return timelineCardDeckEmptyHTML();
  const ev = list[timelineCardDeckIndex];
  const prev = timelineCardDeckIndex > 0 ? list[timelineCardDeckIndex - 1] : null;
  const next = timelineCardDeckIndex < list.length - 1 ? list[timelineCardDeckIndex + 1] : null;
  const atStart = timelineCardDeckIndex <= 0;
  const atEnd = timelineCardDeckIndex >= list.length - 1;
  const count = (timelineCardDeckIndex + 1) + " / " + list.length;
  return '<div class="tl-card-deck" id="tl-card-deck" role="region" aria-roledescription="carousel"'
    + ' aria-label="Event cards" tabindex="0">'
    + '<p class="tl-card-deck-count" aria-live="polite">' + esc(count) + "</p>"
    + '<div class="tl-card-deck-stage">'
    + '<button type="button" class="tl-card-deck-nav tl-card-deck-prev" aria-label="Previous event"'
    + (atStart ? " disabled" : "") + ">" + ic("chevronLeft") + "</button>"
    + '<div class="tl-card-deck-viewport">'
    + '<div class="tl-card-deck-track">'
    + timelineCardDeckFaceHTML(prev)
    + timelineCardDeckFaceHTML(ev)
    + timelineCardDeckFaceHTML(next)
    + "</div></div>"
    + '<button type="button" class="tl-card-deck-nav tl-card-deck-next" aria-label="Next event"'
    + (atEnd ? " disabled" : "") + ">" + ic("chevronRight") + "</button>"
    + "</div></div>";
}

function timelineCardDeckMountEl(html) {
  const holder = document.createElement("div");
  holder.innerHTML = html;
  return holder.firstElementChild;
}

function timelineSyncCardDeckFocus() {
  const id = timelineCardDeckCurrentId();
  if (id && typeof timelineSetFocus === "function") {
    timelineSetFocus(id, { instant: true });
  }
}

function timelinePaintCardDeck(view, events, opts) {
  const host = view || document.querySelector(".timeline-view-mode");
  if (!host) return;
  const html = timelineCardDeckHTML(events, opts);
  const existing = host.querySelector(".tl-card-deck");
  const keepFocus = !!(existing && document.activeElement && existing.contains(document.activeElement));
  const next = timelineCardDeckMountEl(html);
  if (existing && next && typeof timelineSameMarkup === "function" && timelineSameMarkup(existing, next)) {
    timelineWireCardDeck(existing);
    timelineSyncCardDeckFocus();
    return;
  }
  if (existing) existing.replaceWith(next);
  else {
    const slot = host.querySelector("#tl-feed-slot");
    if (slot) slot.replaceWith(next);
    else host.querySelector(".tl-events-wrap")?.appendChild(next);
  }
  timelineWireCardDeck(next);
  timelineSyncCardDeckFocus();
  if (keepFocus && next && !next.classList.contains("is-empty")) {
    try { next.focus({ preventScroll: true }); } catch {}
  }
}

function timelineCardDeckJumpToDay(day) {
  const view = document.querySelector(".timeline-view-mode");
  const events = timelineCardDeckIds.map(function (id) {
    return typeof timelineFindEvent === "function" ? timelineFindEvent(id) : null;
  }).filter(Boolean);
  timelinePaintCardDeck(view, events, { day: day });
}

function timelineCardDeckStep(dir) {
  const next = timelineCardDeckIndex + (dir < 0 ? -1 : 1);
  if (next < 0 || next >= timelineCardDeckIds.length) return false;
  timelineCardDeckIndex = next;
  const view = document.querySelector(".timeline-view-mode");
  const events = timelineCardDeckIds.map(function (id) {
    return typeof timelineFindEvent === "function" ? timelineFindEvent(id) : null;
  }).filter(Boolean);
  timelinePaintCardDeck(view, events, { eventId: timelineCardDeckCurrentId() });
  return true;
}

function timelineCardDeckAnimateStep(track, dir, done) {
  if (!track) {
    done();
    return;
  }
  const reduced = typeof timelinePrefersReducedMotion === "function" && timelinePrefersReducedMotion();
  if (reduced) {
    done();
    return;
  }
  let finished = false;
  const finish = function () {
    if (finished) return;
    finished = true;
    track.removeEventListener("transitionend", finish);
    done();
  };
  const target = dir > 0 ? "-200%" : "0%";
  track.style.transition = "transform var(--dur-panel) var(--ease-enter)";
  track.style.transform = "translateX(" + target + ")";
  track.addEventListener("transitionend", finish);
  setTimeout(finish, 280);
}

function timelineWireCardDeck(deck) {
  if (!deck || deck.classList.contains("is-empty")) return;
  const bind = typeof onceFlag === "function"
    ? onceFlag(deck, "tlCardDeck")
    : !deck.dataset.tlCardDeck;
  if (!bind) return;
  if (typeof onceFlag !== "function") deck.dataset.tlCardDeck = "1";

  const viewport = deck.querySelector(".tl-card-deck-viewport");
  const track = deck.querySelector(".tl-card-deck-track");
  const prevBtn = deck.querySelector(".tl-card-deck-prev");
  const nextBtn = deck.querySelector(".tl-card-deck-next");
  const G = typeof AshGesture !== "undefined" ? AshGesture : null;
  const slop = (G && G.TAP_SLOP) || 12;
  const holdMs = (G && G.HOLD_MS) || 500;
  const grace = (G && G.OUTSIDE_TAP_MS) || 450;

  prevBtn?.addEventListener("click", function (event) {
    event.preventDefault();
    timelineCardDeckStep(-1);
  });
  nextBtn?.addEventListener("click", function (event) {
    event.preventDefault();
    timelineCardDeckStep(1);
  });

  deck.addEventListener("keydown", function (event) {
    if (event.key === "ArrowLeft") {
      event.preventDefault();
      timelineCardDeckStep(-1);
    } else if (event.key === "ArrowRight") {
      event.preventDefault();
      timelineCardDeckStep(1);
    } else if (event.key === "Enter" || event.key === " ") {
      const id = timelineCardDeckCurrentId();
      if (!id) return;
      event.preventDefault();
      if (typeof openTimelineSheet === "function") {
        openTimelineSheet(id, "chat", { focusComposer: false });
      }
    } else if (event.key === "F10" && event.shiftKey) {
      const id = timelineCardDeckCurrentId();
      const ev = typeof timelineFindEvent === "function" ? timelineFindEvent(id) : null;
      if (!ev) return;
      event.preventDefault();
      const face = deck.querySelector(".tl-card-deck-slide[data-id] .tl-card-deck-face");
      if (typeof timelineOpenQuickMenu === "function") timelineOpenQuickMenu(ev, face || deck);
    }
  });

  if (!viewport || !track) return;

  let sx = 0;
  let sy = 0;
  let st = 0;
  let tracking = false;
  let locked = false;
  let dragging = false;
  let lastX = 0;
  let longTimer = 0;
  const clearLong = function () {
    if (longTimer) clearTimeout(longTimer);
    longTimer = 0;
  };
  const stop = function () {
    tracking = false;
    locked = false;
    dragging = false;
    deck.classList.remove("is-dragging");
    track.style.willChange = "";
  };

  viewport.addEventListener("pointerdown", function (event) {
    if (event.pointerType === "mouse" && event.button !== 0) return;
    if (event.target.closest(".tl-card-deck-nav")) return;
    if (event.target.closest("a[data-event-map], a.event-card-map-link")) return;
    sx = lastX = event.clientX;
    sy = event.clientY;
    st = performance.now();
    tracking = true;
    locked = false;
    dragging = false;
    clearLong();
    const row = event.target.closest(".tl-card-deck-slide[data-id]");
    if (row) {
      longTimer = setTimeout(function () {
        longTimer = 0;
        if (dragging) return;
        const ev = typeof timelineFindEvent === "function"
          ? timelineFindEvent(row.dataset.id)
          : null;
        if (ev && typeof timelineOpenQuickMenu === "function") {
          timelineOpenQuickMenu(ev, row);
          timelineCardDeckSuppressClickUntil = performance.now() + grace;
        }
      }, holdMs);
    }
    try { viewport.setPointerCapture(event.pointerId); } catch {}
  });

  viewport.addEventListener("pointermove", function (event) {
    if (!tracking) return;
    lastX = event.clientX;
    const dx = event.clientX - sx;
    const dy = event.clientY - sy;
    if (longTimer && Math.hypot(dx, dy) > slop) clearLong();
    const axis = G && typeof G.axisLocked === "function"
      ? G.axisLocked(dx, dy)
      : (Math.abs(dx) >= slop && Math.abs(dx) >= Math.abs(dy) * 1.2);
    if (!locked) {
      if (Math.abs(dy) > slop && Math.abs(dy) >= Math.abs(dx)) {
        timelineCardDeckSuppressClickUntil = performance.now() + grace;
        stop();
        return;
      }
      if (axis && Math.abs(dx) > Math.abs(dy)) {
        locked = true;
        dragging = true;
        deck.classList.add("is-dragging");
        track.style.willChange = "transform";
        track.style.transition = "none";
      } else {
        return;
      }
    }
    event.preventDefault();
    track.style.transform = "translateX(calc(-100% + " + dx + "px))";
  });

  const endDrag = function (event) {
    if (!tracking && !locked) {
      clearLong();
      return;
    }
    const dx = (event && typeof event.clientX === "number" ? event.clientX : lastX) - sx;
    const dt = performance.now() - st;
    const wasLocked = locked;
    clearLong();
    stop();
    track.style.willChange = "";
    if (!wasLocked) {
      track.style.transition = "";
      track.style.transform = "translateX(-100%)";
      return;
    }
    timelineCardDeckSuppressClickUntil = performance.now() + grace;
    const travel = viewport.getBoundingClientRect().width || 1;
    const committed = G && typeof G.shouldCommit === "function"
      ? G.shouldCommit({ distance: dx, travel: travel, dt: dt })
      : Math.abs(dx) >= travel * 0.25;
    const dir = dx < 0 ? 1 : -1;
    const can = dir < 0
      ? timelineCardDeckIndex > 0
      : timelineCardDeckIndex < timelineCardDeckIds.length - 1;
    if (committed && can) {
      timelineCardDeckAnimateStep(track, dir, function () {
        timelineCardDeckStep(dir);
      });
      return;
    }
    track.style.transition = "transform var(--dur-panel) var(--ease-standard)";
    track.style.transform = "translateX(-100%)";
  };

  viewport.addEventListener("pointerup", endDrag);
  viewport.addEventListener("pointercancel", function () {
    clearLong();
    if (!tracking) return;
    stop();
    track.style.transition = "transform var(--dur-panel) var(--ease-standard)";
    track.style.transform = "translateX(-100%)";
  });

  viewport.addEventListener("click", function (event) {
    if (performance.now() < timelineCardDeckSuppressClickUntil) {
      event.preventDefault();
      event.stopPropagation();
      return;
    }
    if (event.target.closest(".tl-card-deck-nav")) return;
    if (event.target.closest("a[data-event-map], a.event-card-map-link")) return;
    const id = timelineCardDeckCurrentId();
    if (id && typeof openTimelineSheet === "function") {
      openTimelineSheet(id, "chat", { focusComposer: false });
    }
  });

  viewport.addEventListener("contextmenu", function (event) {
    const slide = event.target.closest(".tl-card-deck-slide[data-id]");
    if (!slide) return;
    const ev = typeof timelineFindEvent === "function" ? timelineFindEvent(slide.dataset.id) : null;
    if (!ev || typeof timelineOpenQuickMenu !== "function") return;
    event.preventDefault();
    timelineOpenQuickMenu(ev, slide);
  });

  track.style.transform = "translateX(-100%)";
}
