/* ---- CardFeel: card-flick / timeline / confirm sounds (haptics removed for now) ---- */
const CardFeel = (() => {
  let active = false;
  let audioCtx = null;
  let cardPlayAudio = null;
  let lastFocusSoundAt = 0;
  const CARD_PLAY_SOUND_URL = "sounds/card-play.mp3";

  function soundAllowed(channel) {
    if (S.feelPrefs?.muteSound || soundStrength() <= 0.02) return false;
    if (channel && !feelChannelOn(S.feelPrefs, channel)) return false;
    return true;
  }
  function soundStrength() {
    return clamp01(S.feelPrefs?.soundStrength, 0.55);
  }

  function ensureAudio() {
    if (audioCtx) return;
    try {
      const AC = window.AudioContext || window.webkitAudioContext;
      if (!AC) return;
      audioCtx = new AC();
    } catch {
      audioCtx = null;
    }
  }

  function resumeAudio() {
    ensureAudio();
    if (audioCtx?.state === "suspended") {
      try { audioCtx.resume(); } catch {}
    }
  }

  /** One-shot sound when a card is committed to the board. */
  function playCardFlick({ velocity = 0.5 } = {}) {
    if (!soundAllowed("flick")) return;
    const v = Math.max(0.25, Math.min(1, velocity));
    const vol = soundStrength();
    try {
      if (!cardPlayAudio) {
        cardPlayAudio = new Audio(CARD_PLAY_SOUND_URL);
        cardPlayAudio.preload = "auto";
      }
      cardPlayAudio.pause();
      cardPlayAudio.currentTime = 0;
      // A quick flick can read slightly stronger, without exceeding the user's
      // global sound-strength choice.
      cardPlayAudio.volume = Math.min(1, (0.5 + v * 0.2) * vol);
      void cardPlayAudio.play().catch(() => {});
    } catch {}
  }

  /** Quiet detent click for timeline focus changes. */
  function playTimelineClick(kind) {
    if (!soundAllowed("scroll")) return;
    resumeAudio();
    if (!audioCtx) return;
    const t0 = audioCtx.currentTime;
    const isEvent = kind === "event";
    const vol = soundStrength();
    try {
      const osc = audioCtx.createOscillator();
      osc.type = "sine";
      osc.frequency.value = isEvent
        ? 1650 + Math.random() * 120
        : 1180 + Math.random() * 80;
      const g = audioCtx.createGain();
      const peak = (isEvent ? 0.045 : 0.028) * vol;
      g.gain.setValueAtTime(0.0001, t0);
      g.gain.exponentialRampToValueAtTime(Math.max(0.0002, peak), t0 + 0.0015);
      g.gain.exponentialRampToValueAtTime(0.0001, t0 + (isEvent ? 0.022 : 0.016));
      osc.connect(g);
      g.connect(audioCtx.destination);
      osc.start(t0);
      osc.stop(t0 + 0.03);
    } catch {}
  }

  /** Soft “posted” chirp when a plan is created — lighter than the card-flick. */
  function playSoftConfirmSound() {
    if (!soundAllowed("confirm")) return;
    resumeAudio();
    if (!audioCtx) return;
    const t0 = audioCtx.currentTime;
    const vol = soundStrength();
    const master = audioCtx.createGain();
    master.gain.value = 0.7 * vol;
    master.connect(audioCtx.destination);
    const tone = (freq, at, peak, dur) => {
      try {
        const osc = audioCtx.createOscillator();
        osc.type = "sine";
        osc.frequency.value = freq;
        const g = audioCtx.createGain();
        g.gain.setValueAtTime(0.0001, t0 + at);
        g.gain.exponentialRampToValueAtTime(Math.max(0.0002, peak), t0 + at + 0.008);
        g.gain.exponentialRampToValueAtTime(0.0001, t0 + at + dur);
        osc.connect(g);
        g.connect(master);
        osc.start(t0 + at);
        osc.stop(t0 + at + dur + 0.02);
      } catch {}
    };
    tone(720, 0, 0.09, 0.05);
    tone(1080, 0.04, 0.07, 0.07);
  }

  function softConfirm() {
    playSoftConfirmSound();
  }

  /**
   * Soft “armed / ready to send” tick — quieter and shorter than softConfirm,
   * used when create becomes postable or a reaction is staged for empty-space send.
   */
  function playReadyArmedSound() {
    if (!soundAllowed("confirm")) return;
    resumeAudio();
    if (!audioCtx) return;
    const t0 = audioCtx.currentTime;
    const vol = soundStrength();
    try {
      const osc = audioCtx.createOscillator();
      osc.type = "sine";
      osc.frequency.setValueAtTime(880, t0);
      osc.frequency.exponentialRampToValueAtTime(1180, t0 + 0.05);
      const g = audioCtx.createGain();
      g.gain.setValueAtTime(0.0001, t0);
      g.gain.exponentialRampToValueAtTime(Math.max(0.0002, 0.055 * vol), t0 + 0.006);
      g.gain.exponentialRampToValueAtTime(0.0001, t0 + 0.07);
      osc.connect(g);
      g.connect(audioCtx.destination);
      osc.start(t0);
      osc.stop(t0 + 0.09);
    } catch {}
  }

  /** Whoosh as a reaction flies into the event — filtered noise with a quick pitch drop. */
  function playReactionSwoosh() {
    if (!soundAllowed("confirm")) return;
    resumeAudio();
    if (!audioCtx) return;
    const t0 = audioCtx.currentTime;
    const vol = soundStrength();
    try {
      const dur = 0.14;
      const n = Math.max(1, Math.floor(audioCtx.sampleRate * dur));
      const buf = audioCtx.createBuffer(1, n, audioCtx.sampleRate);
      const data = buf.getChannelData(0);
      for (let i = 0; i < n; i++) {
        const env = Math.pow(1 - i / n, 1.6);
        data[i] = (Math.random() * 2 - 1) * env;
      }
      const src = audioCtx.createBufferSource();
      src.buffer = buf;
      const bp = audioCtx.createBiquadFilter();
      bp.type = "bandpass";
      bp.Q.value = 1.1;
      bp.frequency.setValueAtTime(2400, t0);
      bp.frequency.exponentialRampToValueAtTime(420, t0 + dur);
      const g = audioCtx.createGain();
      g.gain.setValueAtTime(0.0001, t0);
      g.gain.exponentialRampToValueAtTime(Math.max(0.0002, 0.22 * vol), t0 + 0.012);
      g.gain.exponentialRampToValueAtTime(0.0001, t0 + dur);
      src.connect(bp);
      bp.connect(g);
      g.connect(audioCtx.destination);
      src.start(t0);
      src.stop(t0 + dur + 0.02);
    } catch {}
    // Soft trailing tone so it feels like it “lands”.
    try {
      const osc = audioCtx.createOscillator();
      osc.type = "sine";
      osc.frequency.setValueAtTime(520, t0 + 0.06);
      osc.frequency.exponentialRampToValueAtTime(280, t0 + 0.16);
      const g = audioCtx.createGain();
      g.gain.setValueAtTime(0.0001, t0 + 0.06);
      g.gain.exponentialRampToValueAtTime(Math.max(0.0002, 0.06 * vol), t0 + 0.08);
      g.gain.exponentialRampToValueAtTime(0.0001, t0 + 0.18);
      osc.connect(g);
      g.connect(audioCtx.destination);
      osc.start(t0 + 0.06);
      osc.stop(t0 + 0.2);
    } catch {}
  }

  return {
    begin() {
      active = true;
      resumeAudio();
    },
    drag(_dx, _dy) {
      // Drag itself is silent — flick sound fires on commit.
    },
    end({ committed, velocity } = {}) {
      if (!active) return;
      active = false;
      if (committed) playCardFlick({ velocity: velocity ?? 0.6 });
    },
    cancel() {
      if (!active) return;
      active = false;
    },
    click() {},
    /** Soft confirm when a new event is posted. */
    eventCreated() {
      softConfirm();
    },
    /** Play once per event object (optimistic paint + eventCreated merge). */
    eventCreatedOnce(ev) {
      if (!ev || ev._ashCreatedSound) return;
      ev._ashCreatedSound = true;
      this.eventCreated();
    },
    /** Soft confirm for RSVP / chat send (same feel as event create). */
    softConfirm() {
      softConfirm();
    },
    /** Create/react became ready for empty-space send. */
    readyArmed() {
      playReadyArmedSound();
    },
    /** Reaction sent into an event — swoosh. */
    reactionSent() {
      playReactionSwoosh();
    },
    /** Timeline focus band crossed a new item — soft for gaps, clearer for events. */
    focusSelect(key) {
      if (!key || active) return;
      const now = performance.now();
      if (now - lastFocusSoundAt < 42) return;
      if (key.startsWith("ev:")) {
        lastFocusSoundAt = now;
        playTimelineClick("event");
      } else if (key.startsWith("gap:")) {
        lastFocusSoundAt = now;
        playTimelineClick("slot");
      }
    },
    previewSound(channel = "scroll") {
      if (channel === "flick") playCardFlick({ velocity: 0.55 });
      else if (channel === "confirm") playSoftConfirmSound();
      else playTimelineClick("slot");
    },
  };
})();
const presentationConn = () => S.conns[S.activeConnId];
const activeConn = () => {
  const projected = typeof activeProjectionContext === "function"
    ? activeProjectionContext()
    : null;
  return projected?.contentConn || presentationConn();
};

// Accessor layer: these pass through to the active connection so the many
// existing singleton reads (renders, helpers) keep working unmodified.
// handle(conn, m) is the deliberate exception — it reads/writes conn.* directly
// so a background conn's message never mutates whatever's on screen.
for (const f of ["me", "hostName", "online", "pendingReqs", "invite", "key", "token", "pass"]) {
  Object.defineProperty(S, f, {
    get() { return activeConn()?.[f]; },
    set(v) { const c = activeConn(); if (c) c[f] = v; },
  });
}
Object.defineProperty(S, "messages", {
  get() { return activeConn()?.messages; },
});
// Display-only merge across every conn when personal is active (member/notif
// ids are 48-bit random hex — collisions are theoretical, never deduped).
Object.defineProperty(S, "members", {
  get() {
    const c = activeConn();
    if (!c) return [];
    if (!PersonalSpace.isPersonal(c)) return Array.isArray(c.members) ? c.members : [];
    const seen = new Map();
    for (const cc of Object.values(S.conns)) {
      for (const u of (cc.members || [])) if (!seen.has(u.id)) seen.set(u.id, u);
    }
    return [...seen.values()];
  },
});

/** Keep conn.me on the members list — presence/cache races can otherwise leave local hosts at 0. */
function normalizeConnMembers(conn, members) {
  const list = Array.isArray(members) ? members.map(u => {
    const copy = { ...u };
    // livePic is presence-only; never invent it from a stale conn.me when the
    // payload omitted it (offline / cleared).
    return copy;
  }) : [];
  if (conn?.me?.id && !list.some(u => u.id === conn.me.id)) {
    list.unshift({
      id: conn.me.id,
      name: conn.me.name || "Host",
      isHost: !!conn.me.isHost,
      role: conn.me.role || (conn.me.isHost ? "host" : "user"),
      profilePic: conn.me.profilePic || undefined,
      livePic: conn.me.livePic || undefined,
      offlineAvatar: conn.me.offlineAvatar || undefined,
      cardBack: conn.me.cardBack || undefined,
      eventCardStyle: conn.me.eventCardStyle || undefined,
    });
  }
  return list;
}
Object.defineProperty(S, "notifications", {
  get() {
    const c = activeConn();
    if (!c) return [];
    const keep = (n, cc) => !n.fromUserId || !isBlocked(n.fromUserId, cc);
    if (!PersonalSpace.isPersonal(c)) {
      return (c.notifications || [])
        .filter(n => keep(n, c))
        .map(n => ({ ...n, _connId: c.id }));
    }
    const merged = [];
    for (const cc of Object.values(S.conns))
      for (const n of (cc.notifications || [])) {
        if (!keep(n, cc)) continue;
        merged.push({ ...n, _connId: cc.id });
      }
    return merged;
  },
});
// Abuse reports, tagged with their owning conn. On personal, folds in every
// server the signed-in person moderates so the inbox spans all of them.
Object.defineProperty(S, "reports", {
  get() {
    const c = activeConn();
    if (!c || PersonalSpace.isPersonal(c)) return [];
    return (c.reports || []).map(r => ({ ...r, _connId: c.id }));
  },
});

// The active conn's flat channels/events. Personal folds in remote
// events only when you’ve linked their event channels under Channel settings.
function board() {
  const c = activeConn();
  if (!c) return { channels: [], events: [] };
  if (PersonalSpace.isPersonal(c)) return { channels: c.channels || [], events: collatedEvents() };
  return { channels: c.channels || [], events: c.events || [] };
}

// The conn that owns/hosts a given event id, regardless of which conn is active
// — e.g. for routing an interaction or picking which conn's key encrypts it.
function ownerConnOf(eventId) {
  for (const c of Object.values(S.conns))
    if ((c.events || []).some(e => e.id === eventId)) return c;
  return null;
}

// ev._myId is set on remote events folded into the personal collated timeline
// (see collatedEvents) — each server mints its own id for "me", so ev.rsvps
// must be read/written under the right one instead of the active conn's.
const myIdOf = (ev) => ev._myId || S.me.id;

// The conn that actually owns/hosts a given (possibly collated) event —
// itself for a normal single-server view, the tagged remote conn when it's
// folded into the personal timeline.
const ownerConnFor = (ev) => ev?._connId
  ? S.conns[ev._connId]
  : activeConn();


/** Shared display clock: 7pm, 7:05pm; stored/input values remain numeric. */
function formatClockTime(ts) {
  const date = new Date(ts);
  const hour = date.getHours();
  const minute = date.getMinutes();
  return String(hour % 12 || 12) + (minute ? ":" + String(minute).padStart(2, "0") : "")
    + (hour < 12 ? "am" : "pm");
}

/** Display label uses the same clock format as event rows and chat. */
function formatTimeFieldLabel(hour = 12, minute = 0) {
  const h24 = Math.max(0, Math.min(23, Number(hour) || 0));
  const m = Math.max(0, Math.min(59, Number(minute) || 0));
  const snapped = Math.round(m / 5) * 5;
  const mm = snapped >= 60 ? 55 : snapped;
  return formatClockTime(new Date(2000, 0, 1, h24, mm).getTime());
}

const TIME_PICKER_PREF_KEY = "ash_time_picker_v1";

/** Browser → dial; Android WebView (AshNative) → wheel. */
function defaultTimePickerStyle() {
  try {
    if (window.AshNative) return "wheel";
  } catch { /* ignore */ }
  return "dial";
}

function timePickerStyle() {
  try {
    const v = String(localStorage.getItem(TIME_PICKER_PREF_KEY) || "").trim();
    if (v === "dial" || v === "wheel") return v;
  } catch { /* ignore */ }
  return defaultTimePickerStyle();
}


/** Snap minutes to a 5-minute step (0–55). */
function snapTimeMinutes5(minute) {
  const m = Math.max(0, Math.min(59, Number(minute) || 0));
  const snapped = Math.round(m / 5) * 5;
  return snapped >= 60 ? 55 : snapped;
}


/**
 * Wire a form time button: click opens the wheel sheet; `get`/`set` use
 * `{ hour, minute }`. Button text updates via formatTimeFieldLabel.
 */
function bindTimeFieldButton(btn, opts = {}) {
  if (!btn) return;
  const title = opts.title || "Choose time";
  const syncLabel = () => {
    const cur = typeof opts.get === "function" ? opts.get() : null;
    const h = cur?.hour != null ? cur.hour : 12;
    const m = cur?.minute != null ? cur.minute : 0;
    btn.textContent = formatTimeFieldLabel(h, m);
    btn.dataset.hour = String(h);
    btn.dataset.minute = String(snapTimeMinutes5(m));
  };
  syncLabel();
  btn.addEventListener("click", async (e) => {
    e.preventDefault();
    e.stopPropagation();
    const cur = typeof opts.get === "function" ? opts.get() : null;
    const picked = await pickNativeTime(
      cur?.hour != null ? cur.hour : 12,
      cur?.minute != null ? cur.minute : 0,
      { title },
    );
    if (!picked) return;
    if (typeof opts.set === "function") opts.set(picked);
    syncLabel();
  });
}

/** Date + time-button row HTML (replaces datetime-local). */
function dateTimeFieldRowHtml({ dateId, timeBtnId, dateVal, hour = 12, minute = 0, timeAria = "Time" }) {
  const h = Math.max(0, Math.min(23, Number(hour) || 0));
  const m = snapTimeMinutes5(minute);
  const label = formatTimeFieldLabel(h, m);
  const dateEsc = typeof esc === "function" ? esc(dateVal || "") : String(dateVal || "");
  const labelEsc = typeof esc === "function" ? esc(label) : label;
  const ariaEsc = typeof esc === "function" ? esc(timeAria) : timeAria;
  return `<div class="datetime-field-row">
    <input type="date" id="${dateId}" value="${dateEsc}" />
    <button type="button" class="time-field-btn" id="${timeBtnId}" data-hour="${h}" data-minute="${m}" aria-label="${ariaEsc}">${labelEsc}</button>
  </div>`;
}

function bindDateTimeFieldRow(overlay, timeBtnId, title = "Choose time") {
  const btn = overlay?.querySelector(`#${timeBtnId}`);
  if (!btn) return;
  bindTimeFieldButton(btn, {
    title,
    get: () => ({
      hour: Number(btn.dataset.hour) || 0,
      minute: Number(btn.dataset.minute) || 0,
    }),
    set: ({ hour, minute }) => {
      btn.dataset.hour = String(hour);
      btn.dataset.minute = String(snapTimeMinutes5(minute));
    },
  });
}

/** Combine date input + time button into epoch ms, or 0 if invalid. */
function readDateTimeFieldMs(overlay, dateId, timeBtnId) {
  const dateStr = String(overlay?.querySelector(`#${dateId}`)?.value || "").trim();
  const btn = overlay?.querySelector(`#${timeBtnId}`);
  if (!dateStr || !btn) return 0;
  const parts = dateStr.split("-").map(Number);
  if (parts.length !== 3 || parts.some((n) => !Number.isFinite(n))) return 0;
  const [y, mo, d] = parts;
  const h = Number(btn.dataset.hour);
  const m = Number(btn.dataset.minute);
  if (!Number.isFinite(h) || !Number.isFinite(m)) return 0;
  const dt = new Date(y, mo - 1, d, h, m, 0, 0);
  const ms = dt.getTime();
  return Number.isFinite(ms) ? ms : 0;
}

function dateInputValueFromDate(d) {
  const x = d instanceof Date ? d : new Date(d);
  if (!Number.isFinite(x.getTime())) return "";
  const pad = (n) => String(n).padStart(2, "0");
  return `${x.getFullYear()}-${pad(x.getMonth() + 1)}-${pad(x.getDate())}`;
}

/** In-app time picker — dial or wheel from user preference. */
function pickNativeTime(hour = 12, minute = 0, opts = {}) {
  if (timePickerStyle() === "dial") return pickDialTime(hour, minute, opts);
  return pickWheelTime(hour, minute, opts);
}

/** 24h dual-ring dial (hour outer 0–11 / inner 12–23; minutes on 5-min ring). */
function pickDialTime(hour = 12, minute = 0, opts = {}) {
  let h = Math.max(0, Math.min(23, Number(hour) || 0));
  let m = snapTimeMinutes5(minute);
  let mode = "hour";
  const title = String(opts.title || "Choose time").trim() || "Choose time";
  const titleEsc = typeof esc === "function" ? esc(title) : title;
  const pad2 = (n) => String(n).padStart(2, "0");

  // Outer: 12 at top, then 1…11. Inner: 24 at top (= hour 0), then 13…23.
  const hourOuter = [
    { hour: 12, label: "12", i: 0 },
    ...Array.from({ length: 11 }, (_, i) => ({ hour: i + 1, label: String(i + 1), i: i + 1 })),
  ];
  const hourInner = [
    { hour: 0, label: "24", i: 0 },
    ...Array.from({ length: 11 }, (_, i) => ({ hour: i + 13, label: String(i + 13), i: i + 1 })),
  ];
  const minuteItems = Array.from({ length: 12 }, (_, i) => i * 5);

  const hourBtn = ({ hour, label, i }, ring) =>
    `<button type="button" class="time-dial-num ${ring}" data-value="${hour}" style="--i:${i}" aria-label="${pad2(hour)}">${label}</button>`;
  const minuteBtn = (value, i) =>
    `<button type="button" class="time-dial-num outer" data-value="${value}" style="--i:${i}" aria-label="${pad2(value)}">${pad2(value)}</button>`;

  return new Promise((resolve) => {
    let settled = false;
    const finish = (val) => {
      if (settled) return;
      settled = true;
      resolve(val);
    };

    const opened = AshModal.open({
      className: "ask-time-sheet",
      html: `
      <div class="ask-time-sheet-card ask-time-dial-card" role="dialog" aria-modal="true" aria-labelledby="ask-time-title">
        <div class="ask-time-sheet-handle" aria-hidden="true"></div>
        <div class="ask-time-sheet-head">
          <button type="button" class="ask-time-sheet-cancel" id="ask-time-cancel">Cancel</button>
          <h4 id="ask-time-title">${titleEsc}</h4>
          <button type="button" class="ask-time-sheet-save" id="ask-time-save">Save</button>
        </div>
        <div class="time-dial-digital" role="group" aria-label="Selected time">
          <button type="button" class="time-dial-seg is-active" id="ask-time-h" aria-label="Hour">${pad2(h)}</button>
          <span class="time-dial-colon" aria-hidden="true">:</span>
          <button type="button" class="time-dial-seg" id="ask-time-m" aria-label="Minute">${pad2(m)}</button>
        </div>
        <div class="time-dial" id="ask-time-dial" data-mode="hour">
          <div class="time-dial-face" id="ask-time-face">
            <div class="time-dial-hand" id="ask-time-hand" aria-hidden="true"></div>
            <div class="time-dial-knob" id="ask-time-knob" aria-hidden="true"></div>
            <div class="time-dial-center" aria-hidden="true"></div>
            <div class="time-dial-ring time-dial-ring-hour" id="ask-time-hour-ring">
              ${hourOuter.map((n) => hourBtn(n, "outer")).join("")}
              ${hourInner.map((n) => hourBtn(n, "inner")).join("")}
            </div>
            <div class="time-dial-ring time-dial-ring-minute" id="ask-time-minute-ring" hidden>
              ${minuteItems.map((v, i) => minuteBtn(v, i)).join("")}
            </div>
          </div>
        </div>
      </div>`,
      singleton: "return",
      graceMs: 450,
      closeOnEscape: true,
      onClose: () => finish(null),
    });
    if (!opened) { finish(null); return; }
    const { overlay, close } = opened;
    const done = (val) => {
      finish(val);
      close();
    };

    const dial = overlay.querySelector("#ask-time-dial");
    const face = overlay.querySelector("#ask-time-face");
    const hand = overlay.querySelector("#ask-time-hand");
    const knob = overlay.querySelector("#ask-time-knob");
    const hourRing = overlay.querySelector("#ask-time-hour-ring");
    const minuteRing = overlay.querySelector("#ask-time-minute-ring");
    const hBtn = overlay.querySelector("#ask-time-h");
    const mBtn = overlay.querySelector("#ask-time-m");

    const slotDeg = (slot) => ((slot % 12) * 30);
    const paint = () => {
      hBtn.textContent = pad2(h);
      mBtn.textContent = pad2(m);
      hBtn.classList.toggle("is-active", mode === "hour");
      mBtn.classList.toggle("is-active", mode === "minute");
      dial.dataset.mode = mode;
      hourRing.hidden = mode !== "hour";
      minuteRing.hidden = mode !== "minute";
      const slot = mode === "hour" ? (h % 12) : Math.round(m / 5) % 12;
      const deg = slotDeg(slot);
      // Inner ring: 13–23 and midnight (0 / label 24). Noon (12) stays on outer.
      const inner = mode === "hour" && (h === 0 || h >= 13);
      dial.classList.toggle("is-inner", inner);
      hand.style.setProperty("--deg", `${deg}deg`);
      knob.style.setProperty("--deg", `${deg}deg`);
      const ring = mode === "hour" ? hourRing : minuteRing;
      ring.querySelectorAll(".time-dial-num").forEach((btn) => {
        const v = Number(btn.dataset.value);
        const on = mode === "hour" ? v === h : v === m;
        btn.classList.toggle("is-selected", on);
      });
    };

    const setMode = (next) => {
      mode = next === "minute" ? "minute" : "hour";
      paint();
    };

    const valueFromPointer = (clientX, clientY) => {
      const r = face.getBoundingClientRect();
      const cx = r.left + r.width / 2;
      const cy = r.top + r.height / 2;
      const dx = clientX - cx;
      const dy = clientY - cy;
      const dist = Math.sqrt(dx * dx + dy * dy);
      let deg = Math.atan2(dx, -dy) * (180 / Math.PI);
      if (deg < 0) deg += 360;
      const slot = Math.round(deg / 30) % 12;
      if (mode === "minute") return slot * 5;
      const mid = r.width * 0.28;
      if (dist < mid) {
        // Inner: top = 24 → hour 0; else 13–23.
        return slot === 0 ? 0 : slot + 12;
      }
      // Outer: top = 12; else 1–11.
      return slot === 0 ? 12 : slot;
    };

    let dragging = false;
    const applyPointer = (clientX, clientY, { commitHour } = {}) => {
      const v = valueFromPointer(clientX, clientY);
      if (mode === "minute") m = snapTimeMinutes5(v);
      else h = Math.max(0, Math.min(23, v));
      paint();
      if (commitHour && mode === "hour") setMode("minute");
    };

    face.addEventListener("pointerdown", (e) => {
      if (e.button != null && e.button !== 0) return;
      if (e.target.closest(".time-dial-num")) return;
      dragging = true;
      try { face.setPointerCapture(e.pointerId); } catch { /* ignore */ }
      applyPointer(e.clientX, e.clientY);
      e.preventDefault();
    });
    face.addEventListener("pointermove", (e) => {
      if (!dragging) return;
      applyPointer(e.clientX, e.clientY);
    });
    const endDrag = (e) => {
      if (!dragging) return;
      dragging = false;
      applyPointer(e.clientX, e.clientY, { commitHour: true });
    };
    face.addEventListener("pointerup", endDrag);
    face.addEventListener("pointercancel", () => { dragging = false; });

    hourRing.addEventListener("click", (e) => {
      const btn = e.target.closest(".time-dial-num");
      if (!btn) return;
      e.preventDefault();
      e.stopPropagation();
      h = Number(btn.dataset.value);
      paint();
      setMode("minute");
    });
    minuteRing.addEventListener("click", (e) => {
      const btn = e.target.closest(".time-dial-num");
      if (!btn) return;
      e.preventDefault();
      e.stopPropagation();
      m = snapTimeMinutes5(Number(btn.dataset.value));
      paint();
    });

    hBtn.onclick = () => setMode("hour");
    mBtn.onclick = () => setMode("minute");
    overlay.querySelector("#ask-time-cancel").onclick = () => done(null);
    overlay.querySelector("#ask-time-save").onclick = () => done({ hour: h, minute: m });
    paint();
  });
}

/** In-app bottom-sheet time wheel (24h hour / 5-min). Never uses native pickers.
 *  Resolves `{ hour, minute }` or null if cancelled. */
function pickWheelTime(hour = 12, minute = 0, opts = {}) {
  const h0 = Math.max(0, Math.min(23, Number(hour) || 0));
  const m0 = snapTimeMinutes5(minute);
  const title = String(opts.title || "Choose time").trim() || "Choose time";
  const titleEsc = typeof esc === "function" ? esc(title) : title;

  const ITEM = 44;
  const VISIBLE = 5;
  const PAD = ITEM * Math.floor(VISIBLE / 2);

  const hourItems = Array.from({ length: 24 }, (_, i) => i);
  const minuteItems = Array.from({ length: 12 }, (_, i) => i * 5);

  const wheelHtml = (id, items, format) => {
    const rows = items.map((v, i) =>
      `<div class="time-wheel-item" data-index="${i}" data-value="${v}">${format(v)}</div>`).join("");
    return `<div class="time-wheel" id="${id}" role="listbox" tabindex="0">${rows}</div>`;
  };

  return new Promise((resolve) => {
    let settled = false;
    const finish = (val) => {
      if (settled) return;
      settled = true;
      resolve(val);
    };

    const opened = AshModal.open({
      className: "ask-time-sheet",
      html: `
      <div class="ask-time-sheet-card" role="dialog" aria-modal="true" aria-labelledby="ask-time-title">
        <div class="ask-time-sheet-handle" aria-hidden="true"></div>
        <div class="ask-time-sheet-head">
          <button type="button" class="ask-time-sheet-cancel" id="ask-time-cancel">Cancel</button>
          <h4 id="ask-time-title">${titleEsc}</h4>
          <button type="button" class="ask-time-sheet-save" id="ask-time-save">Save</button>
        </div>
        <div class="time-wheel-cols time-wheel-cols--24h">
          <div class="time-wheel-band" aria-hidden="true"></div>
          ${wheelHtml("ask-time-hour", hourItems, (v) => String(v).padStart(2, "0"))}
          ${wheelHtml("ask-time-minute", minuteItems, (v) => String(v).padStart(2, "0"))}
        </div>
      </div>`,
      singleton: "return",
      graceMs: 450,
      closeOnEscape: true,
      onClose: () => finish(null),
    });
    if (!opened) { finish(null); return; }
    const { overlay, close } = opened;
    // Finish before close — AshModal's onClose also calls finish(null); settling
    // first keeps Save from being overwritten by a cancel resolve.
    const done = (val) => {
      finish(val);
      close();
    };

    const hourEl = overlay.querySelector("#ask-time-hour");
    const minuteEl = overlay.querySelector("#ask-time-minute");

    // Source of truth for Save (scrollTop can lag during smooth snap / tap).
    const selected = {
      hour: Math.max(0, hourItems.indexOf(h0)),
      minute: Math.max(0, minuteItems.indexOf(m0)),
    };
    if (selected.hour < 0) selected.hour = 0;
    if (selected.minute < 0) selected.minute = 0;

    const setupWheel = (el) => {
      if (!el) return;
      el.style.setProperty("--time-wheel-item", `${ITEM}px`);
      el.style.paddingTop = `${PAD}px`;
      el.style.paddingBottom = `${PAD}px`;
    };
    setupWheel(hourEl);
    setupWheel(minuteEl);

    const scrollToIndex = (el, index, smooth) => {
      if (!el) return;
      const i = Math.max(0, Math.min(el.children.length - 1, index));
      el.scrollTo({ top: i * ITEM, behavior: smooth ? "smooth" : "auto" });
    };
    const indexFromScroll = (el) => {
      if (!el) return 0;
      const max = Math.max(0, el.children.length - 1);
      return Math.max(0, Math.min(max, Math.round(el.scrollTop / ITEM)));
    };
    const markSelected = (el, i) => {
      el.querySelectorAll(".time-wheel-item").forEach((node, idx) => {
        node.classList.toggle("is-selected", idx === i);
      });
    };
    const selectIndex = (el, key, i) => {
      if (!el) return;
      const max = Math.max(0, el.children.length - 1);
      const idx = Math.max(0, Math.min(max, i));
      selected[key] = idx;
      scrollToIndex(el, idx, true);
      markSelected(el, idx);
    };
    const wireSnap = (el, key) => {
      if (!el) return;
      let timer = 0;
      const snap = () => {
        selectIndex(el, key, indexFromScroll(el));
      };
      el.addEventListener("scroll", () => {
        clearTimeout(timer);
        timer = setTimeout(snap, 80);
      }, { passive: true });
      el.addEventListener("scrollend", snap, { passive: true });
      // Tap an option to select it. Ignore gestures that scrolled the wheel.
      let ptr = null;
      el.addEventListener("pointerdown", (e) => {
        const item = e.target.closest(".time-wheel-item");
        if (!item || !el.contains(item)) return;
        ptr = { x: e.clientX, y: e.clientY, scrollTop: el.scrollTop, item };
      }, { passive: true });
      const trySelectFromPtr = (e) => {
        if (!ptr) return;
        const { x, y, scrollTop, item } = ptr;
        ptr = null;
        if (Math.abs(e.clientX - x) > 12 || Math.abs(e.clientY - y) > 12) return;
        if (Math.abs(el.scrollTop - scrollTop) > 6) return;
        const i = Number(item.dataset.index);
        if (!Number.isFinite(i)) return;
        selectIndex(el, key, i);
      };
      el.addEventListener("pointerup", trySelectFromPtr);
      el.addEventListener("pointercancel", () => { ptr = null; }, { passive: true });
      el.addEventListener("click", (e) => {
        const item = e.target.closest(".time-wheel-item");
        if (!item || !el.contains(item)) return;
        const i = Number(item.dataset.index);
        if (!Number.isFinite(i)) return;
        e.preventDefault();
        selectIndex(el, key, i);
      });
    };
    wireSnap(hourEl, "hour");
    wireSnap(minuteEl, "minute");

    requestAnimationFrame(() => {
      scrollToIndex(hourEl, selected.hour, false);
      scrollToIndex(minuteEl, selected.minute, false);
      markSelected(hourEl, selected.hour);
      markSelected(minuteEl, selected.minute);
    });

    overlay.querySelector("#ask-time-cancel").onclick = () => done(null);
    overlay.querySelector("#ask-time-save").onclick = () => {
      const h24 = hourItems[selected.hour] ?? 0;
      const minv = minuteItems[selected.minute] || 0;
      done({ hour: h24, minute: minv });
    };
  });
}
