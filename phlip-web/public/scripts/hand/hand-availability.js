/* hand-availability.js — availability markers and create/edit sheets.
 * Globals out: openAvailabilityUiEnabled, channelAllowsAvailability, openAvailabilityComposer, …
 * Load after: hand-calendar-overlay.js; before: hand-agenda-week.js
 */

function openAvailabilityUiEnabled() {
  return false;
}

function channelAllowsAvailability(conn = activeConn(), channelOrId = null) {
  const ch = typeof resolveEventChannel === "function"
    ? resolveEventChannel(conn, channelOrId)
    : null;
  return !!(ch && ch.allowAvailability
    && ch.pinnedLocationLabel == null
    && ch.pinnedUserId == null);
}


/** § Open availability — compose a new free-time mark. */
async function openAvailabilityComposer(opts = {}) {
  if (typeof openAvailabilityUiEnabled === "function" && !openAvailabilityUiEnabled()) return;
  const conn = activeConn();
  if (!conn || !channelAllowsAvailability(conn)) {
    toast("Turn on “Open availability” in this channel’s settings first");
    return;
  }
  const ch = typeof resolveEventChannel === "function" ? resolveEventChannel(conn) : null;
  if (!ch) return;
  const day = opts.day != null ? dayStart(opts.day) : dayStart(Date.now());
  const hour = opts.hour != null ? Number(opts.hour) : 10;
  const startDefault = new Date(day);
  startDefault.setHours(Math.max(0, Math.min(23, hour)), 0, 0, 0);
  const dateVal = typeof dateInputValueFromDate === "function"
    ? dateInputValueFromDate(startDefault)
    : "";
  const durOptions = [
    { ms: 30 * 60e3, label: "30 min" },
    { ms: 60 * 60e3, label: "1 hr" },
    { ms: 2 * 60 * 60e3, label: "2 hr" },
    { ms: 3 * 60 * 60e3, label: "3 hr" },
    { ms: 4 * 60 * 60e3, label: "4 hr" },
  ];
  const whenRow = typeof dateTimeFieldRowHtml === "function"
    ? dateTimeFieldRowHtml({
      dateId: "avail-when-date",
      timeBtnId: "avail-when-time",
      dateVal,
      hour: startDefault.getHours(),
      minute: startDefault.getMinutes(),
      timeAria: "Start time",
    })
    : "";
  const opened = AshModal.open({
    className: "avail-composer-modal",
    html: `
    <div class="modal-card">
      <h4>Open availability</h4>
      <p class="cat-hint">Mark a free window. Others can signal they’re free too. A real event in this time clears the mark.</p>
      <label class="field">Starts
        ${whenRow}
      </label>
      <label class="field">For
        <select id="avail-dur">
          ${durOptions.map((o, i) =>
            `<option value="${o.ms}" ${i === 1 ? "selected" : ""}>${esc(o.label)}</option>`).join("")}
        </select>
      </label>
      <label class="field">Place <span class="muted">(optional)</span>
        <input type="text" id="avail-where" maxlength="80" placeholder="Where you could meet" />
      </label>
      <label class="field">Note <span class="muted">(optional)</span>
        <input type="text" id="avail-details" maxlength="120" placeholder="Anything helpful" />
      </label>
      <div class="actions">
        <div></div>
        <div>
          <button type="button" class="cancel" id="avail-cancel">Cancel</button>
          <button type="button" class="save" id="avail-save">Post</button>
        </div>
      </div>
    </div>`,
    singleton: "return",
  });
  if (!opened) return;
  const { overlay, close } = opened;
  if (typeof bindDateTimeFieldRow === "function") {
    bindDateTimeFieldRow(overlay, "avail-when-time", "Start time");
  }
  overlay.querySelector("#avail-cancel").onclick = close;
  overlay.querySelector("#avail-save").onclick = async () => {
    const durEl = overlay.querySelector("#avail-dur");
    const wherePlain = String(overlay.querySelector("#avail-where")?.value || "").trim();
    const detailsPlain = String(overlay.querySelector("#avail-details")?.value || "").trim();
    const whenMs = typeof readDateTimeFieldMs === "function"
      ? readDateTimeFieldMs(overlay, "avail-when-date", "avail-when-time")
      : 0;
    const duration = Number(durEl?.value) || 0;
    if (!whenMs || duration <= 0) {
      toast("Pick a start time and duration");
      return;
    }
    const id = typeof genLocalId === "function" ? genLocalId() : undefined;
    const where = wherePlain && typeof encrypt === "function"
      ? await encrypt(wherePlain, conn.key) : wherePlain;
    const details = detailsPlain && typeof encrypt === "function"
      ? await encrypt(detailsPlain, conn.key) : detailsPlain;
    send({
      type: "createAvailability",
      id, channelId: ch.id,
      when: whenMs, duration,
      where: where || "", details: details || "",
    }, conn.id);
    close();
    toast("Marked available");
  };
}

/** § Open availability — owner edit/delete or peer signal sheet. */
async function openAvailabilitySheet(availId) {
  const conn = activeConn();
  const avail = (conn?.availabilities || []).find(a => a.id === availId);
  if (!avail) return;
  if (conn.key && typeof decAvailability === "function"
      && (avail._where === undefined || avail._details === undefined)) {
    try { await decAvailability(avail, conn.key); } catch {}
  } else if (typeof hydratePlainAvailability === "function") {
    hydratePlainAvailability(avail);
  }
  const meId = conn.me?.id;
  const isOwner = avail.userId === meId;
  const mySignal = (avail.signals || []).find(s => s.userId === meId);
  const start = Number(avail.when) || 0;
  const end = start + (Number(avail.duration) || 0);
  const timeLbl = (typeof fmtTime === "function")
    ? `${fmtTime(start)}–${fmtTime(end)}` : "";
  const whereShown = (typeof shownField === "function"
    ? shownField(avail._where, avail.where)
    : (avail._where || "")).trim();
  const detailsShown = (typeof shownField === "function"
    ? shownField(avail._details, avail.details)
    : (avail._details || "")).trim();
  const whereOk = whereShown && whereShown !== "…" && whereShown !== "🔒";
  const detailsOk = detailsShown && detailsShown !== "…" && detailsShown !== "🔒";
  const metaHtml =
    (whereOk
      ? `<p class="avail-sheet-meta"><span class="avail-sheet-k">Place</span> ${esc(whereShown)}</p>`
      : "") +
    (detailsOk
      ? `<p class="avail-sheet-meta"><span class="avail-sheet-k">Note</span> ${esc(detailsShown)}</p>`
      : "");
  const signalHints = (avail.signals || [])
    .filter(s => s.startWhen)
    .map(s => `${s.name || "?"} @ ${typeof fmtTime === "function" ? fmtTime(s.startWhen) : ""}`)
    .slice(0, 6);
  const signalsHtml = signalHints.length
    ? `<p class="avail-sheet-meta"><span class="avail-sheet-k">Also free</span> ${esc(signalHints.join(" · "))}</p>`
    : "";
  const canCreate = typeof canCreateEvents === "function" && canCreateEvents();
  const createBtnHtml = canCreate
    ? `<button type="button" class="save avail-sheet-create" id="avail-create-event">Create event from this</button>`
    : "";
  const signalSeed = mySignal?.startWhen
    ? new Date(Number(mySignal.startWhen))
    : null;
  const signalDateVal = signalSeed && Number.isFinite(signalSeed.getTime())
    && typeof dateInputValueFromDate === "function"
    ? dateInputValueFromDate(signalSeed)
    : "";
  const signalHour = signalSeed && Number.isFinite(signalSeed.getTime())
    ? signalSeed.getHours()
    : (start ? new Date(start).getHours() : new Date().getHours());
  const signalMinute = signalSeed && Number.isFinite(signalSeed.getTime())
    ? signalSeed.getMinutes()
    : (start ? new Date(start).getMinutes() : new Date().getMinutes());
  const opened = AshModal.open({
    className: "avail-sheet-modal",
    html: `
    <div class="modal-card">
      <h4>${esc(avail.userName || "Someone")} available</h4>
      <p class="cat-hint">${esc(timeLbl)}</p>
      ${metaHtml}${signalsHtml}
      ${createBtnHtml}
      ${isOwner ? `
        <div class="actions" style="margin-top:12px">
          <button type="button" class="danger" id="avail-del">Remove</button>
          <div>
            <button type="button" class="cancel" id="avail-close">Close</button>
            <button type="button" class="save" id="avail-edit">Edit</button>
          </div>
        </div>` : `
        <label class="field">Propose a start <span class="muted">(optional)</span>
          ${typeof dateTimeFieldRowHtml === "function"
            ? dateTimeFieldRowHtml({
              dateId: "avail-signal-date",
              timeBtnId: "avail-signal-time",
              dateVal: signalDateVal,
              hour: signalHour,
              minute: signalMinute,
              timeAria: "Propose start time",
            })
            : ""}
        </label>
        <div class="actions">
          <div>${mySignal
            ? `<button type="button" class="cancel" id="avail-unsignal">I’m not free</button>`
            : ""}</div>
          <div>
            <button type="button" class="cancel" id="avail-close">Close</button>
            <button type="button" class="save" id="avail-signal">${mySignal ? "Update" : "Also available"}</button>
          </div>
        </div>`}
    </div>`,
    singleton: "return",
  });
  if (!opened) return;
  const { overlay, close } = opened;
  if (typeof bindDateTimeFieldRow === "function") {
    bindDateTimeFieldRow(overlay, "avail-signal-time", "Propose start time");
  }
  overlay.querySelector("#avail-close")?.addEventListener("click", close);
  overlay.querySelector("#avail-del")?.addEventListener("click", () => {
    send({ type: "deleteAvailability", availabilityId: avail.id }, conn.id);
    close();
    toast("Availability removed");
  });
  overlay.querySelector("#avail-edit")?.addEventListener("click", () => {
    close();
    openAvailabilityEdit(avail.id);
  });
  overlay.querySelector("#avail-create-event")?.addEventListener("click", () => {
    close();
    startEventFromAvailability(avail);
  });
  overlay.querySelector("#avail-unsignal")?.addEventListener("click", () => {
    send({ type: "signalAvailability", availabilityId: avail.id, remove: true }, conn.id);
    close();
  });
  overlay.querySelector("#avail-signal")?.addEventListener("click", () => {
    const startWhen = typeof readDateTimeFieldMs === "function"
      ? readDateTimeFieldMs(overlay, "avail-signal-date", "avail-signal-time")
      : null;
    const payload = { type: "signalAvailability", availabilityId: avail.id };
    if (startWhen && !Number.isNaN(startWhen)) payload.startWhen = startWhen;
    send(payload, conn.id);
    close();
    toast("You’re marked available too");
  });
}

/** Jump into event create locked to an availability’s day (+ hour). */
function startEventFromAvailability(avail) {
  if (!avail) return;
  if (typeof canCreateEvents === "function" && !canCreateEvents()) {
    toast(typeof effectiveRole === "function" && effectiveRole() === ROLE_VIEWER
      ? "View only — you can't create events"
      : "Creating events is limited to staff on this server");
    return;
  }
  const when = Number(avail.when) || Date.now();
  const day = typeof dayStart === "function" ? dayStart(when) : when;
  const hour = new Date(when).getHours();
  try {
    S.anchor = day;
    S.viewingHistory = false;
  } catch {}
  if (typeof startFlatTypePick === "function") {
    startFlatTypePick({
      createFromEvent: true,
      day,
      _gapHour: hour,
      _gapDay: day,
    });
  }
}

/** § Open availability — owner edits when/duration/place/note. */
async function openAvailabilityEdit(availId) {
  const conn = activeConn();
  const avail = (conn?.availabilities || []).find(a => a.id === availId);
  if (!avail || avail.userId !== conn?.me?.id) return;
  const start = new Date(Number(avail.when) || Date.now());
  const dateVal = typeof dateInputValueFromDate === "function"
    ? dateInputValueFromDate(start)
    : "";
  const whenRow = typeof dateTimeFieldRowHtml === "function"
    ? dateTimeFieldRowHtml({
      dateId: "avail-when-date",
      timeBtnId: "avail-when-time",
      dateVal,
      hour: start.getHours(),
      minute: start.getMinutes(),
      timeAria: "Start time",
    })
    : "";
  const durOptions = [
    { ms: 30 * 60e3, label: "30 min" },
    { ms: 60 * 60e3, label: "1 hr" },
    { ms: 2 * 60 * 60e3, label: "2 hr" },
    { ms: 3 * 60 * 60e3, label: "3 hr" },
    { ms: 4 * 60 * 60e3, label: "4 hr" },
  ];
  const curDur = Number(avail.duration) || 60 * 60e3;
  const whereVal = (typeof shownField === "function"
    ? shownField(avail._where, avail.where)
    : (avail._where || "")).trim();
  const detailsVal = (typeof shownField === "function"
    ? shownField(avail._details, avail.details)
    : (avail._details || "")).trim();
  const whereInput = (whereVal === "…" || whereVal === "🔒") ? "" : whereVal;
  const detailsInput = (detailsVal === "…" || detailsVal === "🔒") ? "" : detailsVal;
  const opened = AshModal.open({
    className: "avail-composer-modal",
    html: `
    <div class="modal-card">
      <h4>Edit availability</h4>
      <label class="field">Starts
        ${whenRow}
      </label>
      <label class="field">For
        <select id="avail-dur">
          ${durOptions.map((o) =>
            `<option value="${o.ms}" ${o.ms === curDur ? "selected" : ""}>${esc(o.label)}</option>`).join("")}
        </select>
      </label>
      <label class="field">Place <span class="muted">(optional)</span>
        <input type="text" id="avail-where" maxlength="80" value="${esc(whereInput)}" />
      </label>
      <label class="field">Note <span class="muted">(optional)</span>
        <input type="text" id="avail-details" maxlength="120" value="${esc(detailsInput)}" />
      </label>
      <div class="actions">
        <div></div>
        <div>
          <button type="button" class="cancel" id="avail-cancel">Cancel</button>
          <button type="button" class="save" id="avail-save">Save</button>
        </div>
      </div>
    </div>`,
    singleton: "return",
  });
  if (!opened) return;
  const { overlay, close } = opened;
  if (typeof bindDateTimeFieldRow === "function") {
    bindDateTimeFieldRow(overlay, "avail-when-time", "Start time");
  }
  overlay.querySelector("#avail-cancel").onclick = close;
  overlay.querySelector("#avail-save").onclick = async () => {
    const durEl = overlay.querySelector("#avail-dur");
    const wherePlain = String(overlay.querySelector("#avail-where")?.value || "").trim();
    const detailsPlain = String(overlay.querySelector("#avail-details")?.value || "").trim();
    const whenMs = typeof readDateTimeFieldMs === "function"
      ? readDateTimeFieldMs(overlay, "avail-when-date", "avail-when-time")
      : 0;
    const duration = Number(durEl?.value) || 0;
    if (!whenMs || duration <= 0) {
      toast("Pick a start time and duration");
      return;
    }
    const where = wherePlain && typeof encrypt === "function"
      ? await encrypt(wherePlain, conn.key) : wherePlain;
    const details = detailsPlain && typeof encrypt === "function"
      ? await encrypt(detailsPlain, conn.key) : detailsPlain;
    send({
      type: "updateAvailability",
      availabilityId: avail.id,
      when: whenMs, duration,
      where: where || "", details: details || "",
    }, conn.id);
    close();
    toast("Availability updated");
  };
}
