/* Explicit, read-only device-calendar snapshots in one personal event channel. */
const DEVICE_CALENDAR_CHANNEL_ID = "pch-device-calendar";
function isDeviceCalendarChannel(ch, conn = activeConn()) {
  return conn?.id === "personal" && (typeof ch === "string" ? ch : ch?.id) === DEVICE_CALENDAR_CHANNEL_ID;
}
function ensureDeviceCalendarChannel(channels) {
  let ch = channels.find(c => c.id === DEVICE_CALENDAR_CHANNEL_ID);
  if (ch) return false;
  channels.push({ id: DEVICE_CALENDAR_CHANNEL_ID, name: "Device calendar", kind: "event", deviceCalendar: true });
  return true;
}
function deviceCalendarLocalDay(ms) {
  const d = new Date(ms);
  return new Date(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate()).getTime();
}
function deviceCalendarDefaultPrefs() {
  return { calendarIds: [], fromDays: 30, toDays: 365, includeAllDay: true, titleContains: "" };
}
function deviceCalendarNormalizePrefs(raw) {
  const base = deviceCalendarDefaultPrefs();
  const src = raw && typeof raw === "object" ? raw : {};
  const ids = Array.isArray(src.calendarIds)
    ? src.calendarIds.map(id => String(id || "").trim()).filter(id => /^\d+$/.test(id))
    : [];
  const fromDays = Math.min(730, Math.max(1, Math.round(Number(src.fromDays) || base.fromDays)));
  const toDays = Math.min(730, Math.max(1, Math.round(Number(src.toDays) || base.toDays)));
  return {
    calendarIds: [...new Set(ids)],
    fromDays,
    toDays,
    includeAllDay: src.includeAllDay !== false,
    titleContains: String(src.titleContains || "").trim().slice(0, 120),
  };
}
function deviceCalendarPrefsFromChannel(ch) {
  return deviceCalendarNormalizePrefs(ch || {});
}
function deviceCalendarHasSavedCalendars(ch) {
  return deviceCalendarPrefsFromChannel(ch).calendarIds.length > 0;
}
function deviceCalendarApplyPrefs(rows, prefs) {
  const p = deviceCalendarNormalizePrefs(prefs);
  const idSet = new Set(p.calendarIds);
  const needle = p.titleContains.toLowerCase();
  return (rows || []).filter(row => {
    if (idSet.size && !idSet.has(String(row.calendarId || ""))) return false;
    if (!p.includeAllDay && row.allDay) return false;
    if (needle && !String(row.title || "").toLowerCase().includes(needle)) return false;
    return true;
  });
}
function deviceCalendarSnapshot(payload, meId, prefs) {
  if (!payload?.ok || !Array.isArray(payload.events)) throw new Error(payload?.error || "Invalid calendar response");
  const seen = new Set();
  return deviceCalendarApplyPrefs(payload.events, prefs).map(row => {
    const start = Number(row.startMs), end = Number(row.endMs);
    if (!row.eventId || !row.calendarId || !Number.isFinite(start) || !Number.isFinite(end) || end < start) throw new Error("Invalid calendar event; previous import kept");
    const when = row.allDay ? deviceCalendarLocalDay(start) : start;
    const until = row.allDay ? deviceCalendarLocalDay(end) : end;
    const id = "device-cal:" + row.calendarId + ":" + row.eventId + ":" + start;
    const title = String(row.title || "").trim().slice(0, 500) || "Calendar event";
    const where = String(row.location || "").trim().slice(0, 1000);
    return { id, channelId: DEVICE_CALENDAR_CHANNEL_ID, calendarImported: true, createdBy: "device-calendar",
      originKind: "device", title, _title: title, where, _where: where, details: "", _details: "", icon: "calendar",
      when, whenPrecision: row.allDay ? "day" : "", duration: Math.max(1, until - when), calendarEndMs: until,
      rsvps: { [meId]: "going" }, notes: [], createdAt: start };
  }).filter(ev => { if (seen.has(ev.id)) return false; seen.add(ev.id); return true; });
}
function deviceCalendarSavePrefs(ch, prefs) {
  const next = deviceCalendarNormalizePrefs(prefs);
  ch.calendarIds = next.calendarIds;
  ch.fromDays = next.fromDays;
  ch.toDays = next.toDays;
  ch.includeAllDay = next.includeAllDay;
  ch.titleContains = next.titleContains;
}
const DeviceCalendarImport = (() => {
  let request = null, timer = null, pendingPrefs = null;
  function channel() {
    return S.conns.personal?.channels?.find(c => c.id === DEVICE_CALENDAR_CHANNEL_ID) || null;
  }
  function nativeReady() {
    return typeof window.AshNative?.importDeviceCalendar === "function"
      || typeof window.AshNative?.importDeviceCalendarFiltered === "function";
  }
  function showInfo() {
    const ch = channel();
    const last = ch?.lastImportedAt ? "Last imported " + new Date(ch.lastImportedAt).toLocaleString() + "." : "No calendar imported yet.";
    const prefs = deviceCalendarPrefsFromChannel(ch);
    const picked = prefs.calendarIds.length
      ? prefs.calendarIds.length + " calendar" + (prefs.calendarIds.length === 1 ? "" : "s") + " selected."
      : "No calendars selected yet.";
    const range = "Reads the last " + prefs.fromDays + " days through the next " + prefs.toDays + " days"
      + (prefs.includeAllDay ? ", including all-day events." : ", skipping all-day events.")
      + (prefs.titleContains ? " Title filter: “" + prefs.titleContains + "”." : "");
    const modal = AshModal.open({ className: "device-calendar-info", trapFocus: true, restoreFocus: true,
      html: '<section class="ob-group-choice" role="dialog" aria-modal="true" aria-labelledby="device-calendar-info-title"><h2 id="device-calendar-info-title">Device calendar</h2><p>See events from the calendars synced to this phone alongside your Phlip plans in My calendar.</p><p>' + esc(picked) + " " + esc(range) + '</p><p>This is a local, read-only copy. Edit events in your calendar app, then choose Re-import to refresh changes and remove deleted events. Phlip does not change your calendar or share this channel with groups.</p><p>' + esc(last) + '</p><p id="device-calendar-status" role="status"></p><div id="device-calendar-info-actions"></div></section>' });
    if (!modal) return;
    const root = modal.overlay.querySelector("#device-calendar-info-actions");
    const add = (label, cls, fn) => {
      const b = document.createElement("button");
      b.type = "button";
      if (cls) b.className = cls;
      b.textContent = label;
      b.disabled = !!request;
      b.onclick = () => { modal.close(); fn(); };
      root.appendChild(b);
    };
    add(ch?.lastImportedAt ? "Re-import" : "Import", "", () => start());
    add("Change calendars", "", () => start({ change: true }));
    add("Close", "ob-text-button", () => {});
  }
  function finish(message) {
    clearTimeout(timer); request = null; pendingPrefs = null;
    window.__ashOnCalendarPermission = null;
    toast(message); renderAll();
  }
  function receive(id, payload) {
    if (!request || request !== id) return;
    try {
      const conn = S.conns.personal;
      if (!conn?.me?.id) throw new Error("Personal space is unavailable");
      const ch = conn.channels.find(c => c.id === DEVICE_CALENDAR_CHANNEL_ID);
      const prefs = pendingPrefs || deviceCalendarPrefsFromChannel(ch);
      const events = deviceCalendarSnapshot(payload, conn.me.id, prefs);
      const previous = conn.events, previousStamp = ch.lastImportedAt;
      const previousPrefs = {
        calendarIds: (ch.calendarIds || []).slice(),
        fromDays: ch.fromDays, toDays: ch.toDays,
        includeAllDay: ch.includeAllDay, titleContains: ch.titleContains,
      };
      conn.events = previous.filter(e => !e.calendarImported || e.channelId !== DEVICE_CALENDAR_CHANNEL_ID).concat(events);
      ch.lastImportedAt = Date.now();
      deviceCalendarSavePrefs(ch, prefs);
      try { savePersonal(conn); } catch (error) {
        conn.events = previous;
        ch.lastImportedAt = previousStamp;
        deviceCalendarSavePrefs(ch, previousPrefs);
        throw error;
      }
      finish(events.length ? "Imported " + events.length + " calendar events" : "No calendar events found in this date range");
    } catch (error) { finish(error.message || "Import failed; previous import kept"); }
  }
  function receiveCalendars(id, payload) {
    if (!request || request !== id) return;
    clearTimeout(timer);
    request = null;
    window.__ashOnCalendarPermission = null;
    if (!payload?.ok || !Array.isArray(payload.calendars)) {
      finish(payload?.error || "Could not list calendars on this phone.");
      return;
    }
    openWizard(payload.calendars, deviceCalendarPrefsFromChannel(channel()));
  }
  function withPermission(then) {
    if (request) return;
    if (!nativeReady()) { toast("Calendar import is available in the Android app."); return; }
    request = String(Date.now()) + "-" + Math.random().toString(36).slice(2);
    const id = request;
    timer = setTimeout(() => finish("Calendar import timed out. Try again."), 60000);
    const run = () => { if (request !== id) return; then(id); };
    try {
      if (AshNative.hasCalendarPermission()) run();
      else {
        window.__ashOnCalendarPermission = granted => {
          if (request !== id) return;
          if (granted) run();
          else finish("Calendar access was not allowed. Your previous import is unchanged.");
        };
        AshNative.requestCalendarPermission();
      }
    } catch { finish("Could not request calendar access"); }
  }
  function runImport(prefs) {
    const next = deviceCalendarNormalizePrefs(prefs);
    if (!next.calendarIds.length) { toast("Choose at least one calendar to import."); return; }
    withPermission((id) => {
      pendingPrefs = next;
      toast("Importing device calendar…");
      try {
        if (typeof AshNative.importDeviceCalendarFiltered === "function") {
          AshNative.importDeviceCalendarFiltered(id, JSON.stringify(next));
        } else {
          AshNative.importDeviceCalendar(id);
        }
      } catch { finish("Could not start calendar import"); }
    });
  }
  function listCalendars() {
    withPermission((id) => {
      try {
        if (typeof AshNative.listDeviceCalendars !== "function") {
          finish("Calendar import is available in the Android app.");
          return;
        }
        AshNative.listDeviceCalendars(id);
      } catch { finish("Could not list calendars"); }
    });
  }
  function start(opts = {}) {
    if (request) return;
    if (!nativeReady()) { toast("Calendar import is available in the Android app."); return; }
    const ch = channel();
    if (!opts.change && deviceCalendarHasSavedCalendars(ch)) {
      runImport(deviceCalendarPrefsFromChannel(ch));
      return;
    }
    listCalendars();
  }
  function colorSwatch(color) {
    const n = Number(color);
    if (!Number.isFinite(n)) return "#6b7280";
    const hex = (n >>> 0).toString(16).padStart(8, "0").slice(-6);
    return "#" + hex;
  }
  function openWizard(calendars, prefs) {
    const grouped = new Map();
    for (const cal of calendars) {
      const account = String(cal.accountName || "On this phone").trim() || "On this phone";
      if (!grouped.has(account)) grouped.set(account, []);
      grouped.get(account).push(cal);
    }
    const selected = new Set(prefs.calendarIds.length
      ? prefs.calendarIds
      : calendars.filter(c => c.visible !== false).map(c => String(c.id)));
    const state = { ...deviceCalendarNormalizePrefs(prefs), calendarIds: [...selected] };
    const modal = AshModal.open({ className: "device-calendar-info", trapFocus: true, restoreFocus: true,
      html: '<section class="ob-group-choice device-cal-wizard" role="dialog" aria-modal="true" aria-labelledby="device-cal-wizard-title"><h2 id="device-cal-wizard-title">Choose calendars</h2><div id="device-cal-wizard-body"></div><p id="device-calendar-status" role="status"></p><div id="device-cal-wizard-actions"></div></section>' });
    if (!modal) return;
    const body = modal.overlay.querySelector("#device-cal-wizard-body");
    const actions = modal.overlay.querySelector("#device-cal-wizard-actions");
    const title = modal.overlay.querySelector("#device-cal-wizard-title");
    let step = "calendars";
    const selectedIds = () => [...modal.overlay.querySelectorAll('input[name="device-cal-id"]:checked')].map(el => el.value);
    const paintActions = (primaryLabel, onPrimary, extra) => {
      actions.innerHTML = "";
      const primary = document.createElement("button");
      primary.type = "button";
      primary.textContent = primaryLabel;
      primary.onclick = onPrimary;
      actions.appendChild(primary);
      if (extra) {
        extra.forEach(item => {
          const b = document.createElement("button");
          b.type = "button";
          b.className = item.cls || "ob-text-button";
          b.textContent = item.label;
          b.onclick = item.fn;
          actions.appendChild(b);
        });
      }
    };
    const paintCalendars = () => {
      step = "calendars";
      title.textContent = "Choose calendars";
      if (!calendars.length) {
        body.innerHTML = "<p>No calendars were found on this phone. Sync a calendar app, then try again.</p>";
        paintActions("Close", () => modal.close());
        return;
      }
      let html = '<p>Events you import appear in Device calendar and in My calendar. Pick which calendars to include.</p><div class="device-cal-list">';
      for (const [account, list] of grouped) {
        html += '<fieldset class="device-cal-account"><legend>' + esc(account) + "</legend>";
        for (const cal of list) {
          const id = String(cal.id);
          const on = selected.has(id) ? " checked" : "";
          html += '<label class="check-row device-cal-row"><span class="device-cal-swatch" style="background:' + esc(colorSwatch(cal.color)) + '"></span>'
            + '<input type="checkbox" name="device-cal-id" value="' + esc(id) + '"' + on + ">"
            + '<span>' + esc(cal.name || "Calendar") + (cal.primary ? " <em>Primary</em>" : "") + "</span></label>";
        }
        html += "</fieldset>";
      }
      html += "</div>";
      body.innerHTML = html;
      paintActions("Next", () => {
        const ids = selectedIds();
        if (!ids.length) { toast("Choose at least one calendar."); return; }
        ids.forEach(id => selected.add(id));
        for (const id of [...selected]) if (!ids.includes(id)) selected.delete(id);
        state.calendarIds = ids;
        paintFilters();
      }, [{ label: "Cancel", fn: () => modal.close() }]);
    };
    const paintFilters = () => {
      step = "filters";
      title.textContent = "Filter events";
      const preset = (state.fromDays === 7 && state.toDays === 90) ? "7-90"
        : (state.fromDays === 30 && state.toDays === 365) ? "30-365" : "custom";
      body.innerHTML = '<p>These filters apply to the calendars you picked. Imported events stay read-only in My calendar.</p>'
        + '<div class="field"><label for="device-cal-range">Date range</label>'
        + '<select id="device-cal-range">'
        + '<option value="30-365"' + (preset === "30-365" ? " selected" : "") + ">Last 30 days through next year</option>"
        + '<option value="7-90"' + (preset === "7-90" ? " selected" : "") + ">Last 7 days through next 90 days</option>"
        + '<option value="custom"' + (preset === "custom" ? " selected" : "") + ">Custom</option>"
        + "</select></div>"
        + '<div class="row device-cal-custom" id="device-cal-custom"' + (preset === "custom" ? "" : " hidden") + ">"
        + '<div class="field"><label for="device-cal-from">Days back</label><input id="device-cal-from" type="number" min="1" max="730" value="' + esc(String(state.fromDays)) + '"></div>'
        + '<div class="field"><label for="device-cal-to">Days ahead</label><input id="device-cal-to" type="number" min="1" max="730" value="' + esc(String(state.toDays)) + '"></div>'
        + "</div>"
        + '<label class="check-row"><input type="checkbox" id="device-cal-all-day"' + (state.includeAllDay ? " checked" : "") + "> Include all-day events</label>"
        + '<div class="field"><label for="device-cal-title">Title contains</label>'
        + '<input id="device-cal-title" type="text" maxlength="120" placeholder="Optional" value="' + esc(state.titleContains) + '"></div>';
      const range = body.querySelector("#device-cal-range");
      const custom = body.querySelector("#device-cal-custom");
      range?.addEventListener("change", () => {
        custom.hidden = range.value !== "custom";
        if (range.value === "30-365") { state.fromDays = 30; state.toDays = 365; }
        if (range.value === "7-90") { state.fromDays = 7; state.toDays = 90; }
      });
      paintActions("Import", () => {
        if (range?.value === "custom") {
          state.fromDays = Number(body.querySelector("#device-cal-from")?.value) || state.fromDays;
          state.toDays = Number(body.querySelector("#device-cal-to")?.value) || state.toDays;
        }
        state.includeAllDay = !!body.querySelector("#device-cal-all-day")?.checked;
        state.titleContains = String(body.querySelector("#device-cal-title")?.value || "").trim();
        modal.close();
        runImport(state);
      }, [
        { label: "Back", fn: paintCalendars },
        { label: "Cancel", fn: () => modal.close() },
      ]);
    };
    paintCalendars();
  }
  return { start, runImport, receive, receiveCalendars, showInfo, busy: () => !!request };
})();
window.DeviceCalendarImport = DeviceCalendarImport;
