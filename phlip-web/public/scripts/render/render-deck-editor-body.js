/* render-deck-editor-body.js — openPlacesManager, openDrawingsManager.
 * Load after: render-deck-icons.js; before: render-deck-editor.js facade
 */

function openPlacesManager() {
  const conn = activeConn();
  if (!canManageServer(conn)) return;
  try {
    openPlacesManagerBody(conn);
  } catch (err) {
    console.error(err);
    try { closeSideOverlay(); } catch {}
    toast(err?.message || "Couldn’t open Places");
  }
}

function openDrawingsManager() {
  const conn = activeConn();
  if (!canManageServer(conn)) return;
  try {
    openDrawingsManagerBody(conn);
  } catch (err) {
    console.error(err);
    try { closeSideOverlay(); } catch {}
    toast(err?.message || "Couldn’t open Drawings");
  }
}

function preservedPlaceCategoryId(label, existing) {
  const raw = String(existing || "").trim();
  if (raw) {
    return typeof remapPlaceCategoryId === "function" ? remapPlaceCategoryId(raw) : raw;
  }
  if (typeof inferLocationCategoryId === "function") return inferLocationCategoryId(label) || "other";
  return "other";
}

let _placesRepaint = null;
function repaintPlacesOverlay() {
  if (typeof _placesRepaint === "function") _placesRepaint();
}

function openPlacesManagerBody(conn, hostEl) {
  const personal = typeof PersonalSpace !== "undefined" && PersonalSpace.isPersonal(conn);
  const source = typeof harvestUsedPlaces === "function"
    ? harvestUsedPlaces(conn)
    : locationsFor(conn);
  const draftPlaces = source.map(l => ({
    label: l.label || "",
    orig: l.label || "",
    address: l.address || "",
    mapUrl: l.mapUrl || "",
    mapCheckedName: "",
    categoryId: preservedPlaceCategoryId(l.label || "", l.categoryId),
    uses: l.uses && typeof l.uses === "object" ? { ...l.uses } : {},
  }));
  const PLACE_DUP_IGNORE_KEY = "ash_place_dup_ignore_v1";
  const ignoredDupStems = (() => {
    try {
      const raw = storageGetJson(PLACE_DUP_IGNORE_KEY, []);
      return new Set(Array.isArray(raw) ? raw.map(s => String(s || "")).filter(Boolean) : []);
    } catch {
      return new Set();
    }
  })();
  const persistIgnoredDupStems = () => {
    try { storageSetJson(PLACE_DUP_IGNORE_KEY, [...ignoredDupStems]); } catch {}
  };

  const placeBookingCount = (label) => {
    let n = 0;
    for (const ev of conn?.events || []) {
      const hit = typeof eventMatchesPinnedLocation === "function"
        ? eventMatchesPinnedLocation(ev, label, conn)
        : false;
      if (hit) n += 1;
    }
    return n;
  };

  const placeMapHrefs = (row) => {
    const hrefs = [];
    const add = (raw) => {
      const parsed = typeof parseMapLink === "function" ? parseMapLink(raw) : null;
      const href = parsed?.href || "";
      if (!href || hrefs.includes(href)) return;
      hrefs.push(href);
    };
    add(row?.mapUrl);
    const label = String(row?.label || "").trim();
    if (!label) return hrefs;
    for (const ev of conn?.events || []) {
      if (typeof eventMatchesPinnedLocation !== "function" || !eventMatchesPinnedLocation(ev, label, conn)) continue;
      if (typeof eventMapUrl === "function") add(eventMapUrl(ev));
    }
    return hrefs;
  };

  const pinFor = (label) => (conn.channels || []).find(c =>
    c && c.pinnedLocationLabel
    && String(c.pinnedLocationLabel).toLowerCase() === String(label || "").trim().toLowerCase()) || null;

  const placeMapStatus = (row) => {
    const hrefs = placeMapHrefs(row);
    if (!hrefs.length) return "No map";
    if (hrefs.length > 1) return "Several maps";
    if (row.mapCheckedName && typeof placeMapNameAgrees === "function"
      && !placeMapNameAgrees(row.label, row.mapCheckedName)) return "Map name differs";
    if (row.mapUrl) return "Map attached";
    return "Map on a booking";
  };

  const placeDuplicateClusters = () => {
    const byKey = new Map();
    draftPlaces.forEach((p, i) => {
      const keys = typeof placeClusterKeys === "function" ? placeClusterKeys(p.label) : [];
      const item = {
        i,
        label: String(p.label || "").trim(),
        uses: placeBookingCount(p.label),
      };
      for (const key of keys) {
        if (!byKey.has(key)) byKey.set(key, []);
        byKey.get(key).push(item);
      }
    });
    return [...byKey.entries()]
      .filter(([key, group]) => group.length >= 2 && !ignoredDupStems.has(key))
      .map(([key, group]) => ({
        key,
        items: group.sort((a, b) => b.uses - a.uses || a.label.localeCompare(b.label)),
      }));
  };

  const placeRowsPayload = () => {
    const placeRows = [];
    const seen = new Set();
    for (const row of draftPlaces) {
      const label = String(row.label || "").trim().slice(0, 60);
      if (!label) continue;
      const key = label.toLowerCase();
      if (seen.has(key)) continue;
      seen.add(key);
      const parsed = typeof parseMapLink === "function" ? parseMapLink(row.mapUrl) : null;
      placeRows.push({
        label,
        orig: row.orig,
        address: String(row.address || "").trim().slice(0, 80),
        categoryId: preservedPlaceCategoryId(label, row.categoryId),
        mapUrl: parsed?.href || "",
        uses: row.uses || {},
      });
    }
    return placeRows;
  };

  const inputRenames = () => draftPlaces.flatMap(row => {
    const label = String(row.label || "").trim();
    const orig = String(row.orig || "").trim();
    if (!label || !orig || label.toLowerCase() === orig.toLowerCase()) return [];
    return [{ from: orig, to: label }];
  });

  const savePlaceList = (renames) => {
    const placeRows = placeRowsPayload();
    const renameList = [];
    const seen = new Set();
    for (const pair of [...inputRenames(), ...(renames || [])]) {
      const from = String(pair?.from || "").trim();
      const to = String(pair?.to || "").trim();
      if (!from || !to || from.toLowerCase() === to.toLowerCase()) continue;
      const key = from.toLowerCase() + "->" + to.toLowerCase();
      if (seen.has(key)) continue;
      seen.add(key);
      renameList.push({ from, to });
    }
    if (personal) {
      const prevByOrig = new Map(
        draftPlaces.map(row => [row.orig, (LOCATIONS || []).find(l => l.label === row.orig)]).filter(([, l]) => l)
      );
      const prevByKey = new Map((LOCATIONS || []).map(l => [String(l.label || "").toLowerCase(), l]));
      const next = [];
      const used = new Set();
      for (const row of placeRows) {
        const key = row.label.toLowerCase();
        if (used.has(key)) continue;
        used.add(key);
        const prev = (row.orig && prevByOrig.get(row.orig)) || prevByKey.get(key);
        const entry = prev
          ? { ...prev, label: row.label, address: row.address || prev.address || "", categoryId: row.categoryId }
          : { label: row.label, address: row.address || "", categoryId: row.categoryId, uses: row.uses || {} };
        if (row.mapUrl) entry.mapUrl = row.mapUrl;
        else delete entry.mapUrl;
        next.push(entry);
      }
      LOCATIONS = next;
      storageSetJson("ash_locations_v1", LOCATIONS);
      for (const pair of renameList) {
        const alias = pinFor(pair.from);
        const keep = pinFor(pair.to);
        if (alias && keep && alias.id !== keep.id) {
          send({ type: "deleteChannel", channelId: alias.id }, conn.id);
        }
        if (typeof applyLocalPlaceRename === "function") applyLocalPlaceRename(conn, pair.from, pair.to);
      }
      if (typeof savePersonal === "function") savePersonal(conn);
      try { renderAll(); } catch {}
      return renameList;
    }
    for (const pair of renameList) {
      const alias = pinFor(pair.from);
      const keep = pinFor(pair.to);
      if (alias && keep && alias.id !== keep.id) {
        send({ type: "deleteChannel", channelId: alias.id }, conn.id);
      }
    }
    send({
      type: "updateLocations",
      locations: placeRows.map(r => ({
        label: r.label,
        categoryId: r.categoryId,
        ...(r.mapUrl ? { mapUrl: r.mapUrl } : {}),
      })),
      ...(renameList.length ? { renames: renameList } : {}),
    }, conn.id);
    return renameList;
  };

  const rewriteVisiblePlace = async (from, to) => {
    if (!conn || conn.local || personal || typeof replacePlaceLabel !== "function") return;
    for (const ev of conn.events || []) {
      const plain = String(ev._where || "").trim();
      const next = replacePlaceLabel(plain, from, to);
      if (next == null) continue;
      if (typeof canEditEvent === "function" && !canEditEvent(ev, conn)) continue;
      let where = next;
      if (typeof encrypt === "function" && conn.key) {
        try { where = await encrypt(next, conn.key); } catch { where = next; }
      }
      send({ type: "setEventWhere", eventId: ev.id, where }, conn.id);
    }
  };

  const applyRenames = async (extra) => {
    const list = savePlaceList(extra);
    for (const row of draftPlaces) {
      const label = String(row.label || "").trim();
      if (label) row.orig = label;
    }
    for (const pair of list) await rewriteVisiblePlace(pair.from, pair.to);
  };

  const placesMarkup = `
      <p class="cat-hint">${personal
        ? "Your places can be renamed, merged, and pinned. Places from boards you show here can be pinned, not edited."
        : "Places used on this server. Check map links, merge similar names, and pin a place to see its bookings."}</p>
      <div class="place-tools"><button type="button" id="place-check-maps">Check maps</button></div>
      <div id="deck-dup-banner"></div>
      <div id="deck-rows" class="deck-editor-list"></div>`;
  let overlay = hostEl || null;
  if (overlay) {
    overlay.classList.add("deck-editor-side-body");
    overlay.innerHTML = placesMarkup;
  } else {
    const openedHost = openSideOverlay({
      kind: "places",
      title: "Places",
      bodyClass: ["side-overlay-categories", "deck-editor-side-body"],
      mount: (body) => { body.innerHTML = placesMarkup; },
    });
    if (!openedHost || sideOverlayKind !== "places") return;
    overlay = openedHost;
    const headActions = document.getElementById("side-overlay-actions");
    if (headActions) {
      headActions.innerHTML = "";
      headActions.hidden = true;
    }
  }
  const dupBannerEl = overlay.querySelector("#deck-dup-banner");

  const renderDupBanner = () => {
    if (!dupBannerEl) return;
    const cards = [];
    const clusters = placeDuplicateClusters();
    if (clusters.length) {
      const c = clusters[0];
      const preview = c.items.slice(0, 3).map(i => i.label).join(", ");
      cards.push(`
        <div class="deck-dup-card" data-dup-card="${esc(c.key)}">
          <div class="deck-dup-copy">
            <span class="deck-dup-ico" aria-hidden="true">${ic("share")}</span>
            <div>
              <div class="deck-dup-title">${c.items.length} places look like duplicates</div>
              <div class="deck-dup-preview">${esc(preview)}</div>
              <div class="deck-dup-ask">Merge them, or ignore if the similar names are intentional. Numbered places such as Court 1 and Court 2 stay separate.</div>
            </div>
          </div>
          <div class="deck-dup-actions">
            <button type="button" class="save" data-dup-review="${esc(c.key)}">Review</button>
            <button type="button" class="cancel" data-dup-ignore="${esc(c.key)}">Ignore</button>
          </div>
        </div>`);
    }
    const unused = draftPlaces.filter(p => {
      const label = String(p.label || "").trim();
      return label && placeBookingCount(label) === 0 && !pinFor(label);
    });
    if (unused.length) {
      const preview = unused.slice(0, 3).map(p => p.label).join(", ");
      cards.push(`
        <div class="deck-dup-card" data-unused-card>
          <div class="deck-dup-copy">
            <span class="deck-dup-ico" aria-hidden="true">${ic("trash")}</span>
            <div>
              <div class="deck-dup-title">${unused.length} ${unused.length === 1 ? "place isn't" : "places aren't"} used on a booking</div>
              <div class="deck-dup-preview">${esc(preview)}</div>
              <div class="deck-dup-ask">Remove them from the list. Bookings are not deleted.</div>
            </div>
          </div>
          <div class="deck-dup-actions">
            <button type="button" class="save" data-unused-review>Review</button>
          </div>
        </div>`);
    }
    const several = draftPlaces.find(p => placeMapHrefs(p).length > 1);
    if (several) {
      const hrefs = placeMapHrefs(several);
      cards.push(`
        <div class="deck-dup-card" data-map-card>
          <div class="deck-dup-copy">
            <span class="deck-dup-ico" aria-hidden="true">${ic("link")}</span>
            <div>
              <div class="deck-dup-title">${esc(several.label || "A place")} has several map links</div>
              <div class="deck-dup-ask">Keep one link on the place.</div>
            </div>
          </div>
          <div class="deck-dup-actions">
            ${hrefs.map((href, i) => `<button type="button" class="save" data-map-use="${i}">Use link ${i + 1}</button>`).join("")}
          </div>
        </div>`);
    }
    dupBannerEl.innerHTML = cards.join("");
    const cluster = clusters[0];
    dupBannerEl.querySelector("[data-dup-ignore]")?.addEventListener("click", () => {
      if (!cluster) return;
      ignoredDupStems.add(cluster.key);
      persistIgnoredDupStems();
      toast("Similar names kept — won't ask again");
      renderMainList();
    });
    dupBannerEl.querySelector("[data-dup-review]")?.addEventListener("click", async () => {
      if (!cluster) return;
      const keep = cluster.items[0];
      const others = cluster.items.slice(1);
      if (!(await ashConfirm(
        `Merge into “${keep.label}”? Removes: ${others.map(o => o.label).join(", ")}. Bookings use the kept name.`,
        { danger: false },
      ))) return;
      const keepRow = draftPlaces[keep.i];
      if (!keepRow) return;
      for (const o of others) {
        const row = draftPlaces[o.i];
        if (!row || row === keepRow) continue;
        for (const [k, v] of Object.entries(row.uses || {})) {
          keepRow.uses[k] = (Number(keepRow.uses[k]) || 0) + (Number(v) || 0);
        }
        if (!keepRow.mapUrl && row.mapUrl) keepRow.mapUrl = row.mapUrl;
      }
      const drop = new Set(others.map(o => o.i));
      const renames = others.map(o => ({ from: o.label, to: keep.label }));
      for (let i = draftPlaces.length - 1; i >= 0; i--) {
        if (drop.has(i)) draftPlaces.splice(i, 1);
      }
      await applyRenames(renames);
      renderMainList();
    });
    dupBannerEl.querySelector("[data-unused-review]")?.addEventListener("click", async () => {
      const names = unused.map(p => p.label).join(", ");
      if (!(await ashConfirm(`Remove unused places? ${names}`, { danger: true, ok: "Remove" }))) return;
      const drop = new Set(unused);
      for (let i = draftPlaces.length - 1; i >= 0; i--) {
        if (drop.has(draftPlaces[i])) draftPlaces.splice(i, 1);
      }
      renderMainList();
    });
    if (several) {
      const hrefs = placeMapHrefs(several);
      dupBannerEl.querySelectorAll("[data-map-use]").forEach(btn => {
        btn.addEventListener("click", () => {
          const href = hrefs[Number(btn.dataset.mapUse)];
          if (!href) return;
          several.mapUrl = href;
          several.mapCheckedName = "";
          renderMainList();
        });
      });
    }
  };

  const paintPlaceRow = (row, { readOnly = false, sourceNote = "" } = {}) => {
    const label = String(row.label || "").trim();
    const pinned = !!pinFor(label);
    const bookings = readOnly ? 0 : placeBookingCount(label);
    const hrefs = readOnly
      ? (typeof parseMapLink === "function" && parseMapLink(row.mapUrl) ? [parseMapLink(row.mapUrl).href] : [])
      : placeMapHrefs(row);
    const status = readOnly
      ? (hrefs.length ? "Map attached" : "No map")
      : placeMapStatus(row);
    const meta = [
      readOnly ? "" : `${bookings} ${bookings === 1 ? "booking" : "bookings"}`,
      status,
      sourceNote,
      !readOnly && row.address ? row.address : "",
      !readOnly && row.mapCheckedName && status === "Map name differs" ? row.mapCheckedName : "",
    ].filter(Boolean).join(" · ");
    const openHref = row.mapUrl || (hrefs.length === 1 ? hrefs[0] : "");
    const el = document.createElement("div");
    el.className = "cat-item-row cat-place-row" + (pinned ? " is-pinned" : "") + (readOnly ? " is-readonly" : "");
    el.innerHTML = `
      <div class="cat-item-main">
        ${readOnly
          ? `<div class="cat-item-name-input">${esc(label || "Place")}</div>`
          : `<input class="deck-place-name cat-item-name-input" maxlength="48" value="${esc(row.label || "")}" placeholder="Place name">`}
        <div class="place-row-meta">${esc(meta)}</div>
      </div>
      <div class="place-row-actions">
        <button type="button" class="cat-item-action place-pin-btn${pinned ? " is-on" : ""}" data-pin aria-pressed="${pinned ? "true" : "false"}" title="${pinned ? "Unpin" : "Pin"}" aria-label="${pinned ? "Unpin" : "Pin this place"}">${ic("thumbtack")}${pinned ? `<span class="place-pin-label">Pinned</span>` : ""}</button>
        ${readOnly && !openHref ? "" : `<button type="button" class="cat-item-action" data-map title="${openHref ? "Map link" : "Add map link"}" aria-label="${openHref ? "Map link" : "Add map link"}">${ic("link")}</button>`}
        ${readOnly ? "" : `<button type="button" class="cat-item-action cat-item-del" data-del title="Delete" aria-label="Delete">${ic("cancel")}</button>`}
      </div>`;
    const mapBtn = el.querySelector("[data-map]");
    if (mapBtn) {
      mapBtn.onclick = async () => {
        if (readOnly) {
          if (openHref) window.open(openHref, "_blank", "noopener");
          return;
        }
        const current = row.mapUrl || (placeMapHrefs(row).length === 1 ? placeMapHrefs(row)[0] : "");
        const pasted = await ashPrompt(
          current ? "Replace the map link. Leave it blank to clear it." : "Paste a Google Maps, Apple Maps, or OpenStreetMap link.",
          { value: current, placeholder: "https://maps.google.com/…", maxlength: 500, ok: current ? "Save" : "Attach" },
        );
        if (pasted == null) return;
        const text = String(pasted).trim();
        if (!text) {
          row.mapUrl = "";
          row.mapCheckedName = "";
          renderMainList();
          return;
        }
        const parsed = typeof parseMapLink === "function" ? parseMapLink(text) : null;
        if (!parsed) {
          toast("That isn’t a map link");
          return;
        }
        row.mapUrl = parsed.href;
        row.mapCheckedName = parsed.name || "";
        renderMainList();
      };
    }
    if (!readOnly) {
      el.querySelector(".cat-item-name-input").oninput = (e) => { row.label = e.target.value; };
      el.querySelector("[data-del]").onclick = async () => {
        const name = (row.label || "").trim() || "this place";
        const used = placeBookingCount(name);
        const note = used ? " Bookings stay on their boards." : "";
        if (!(await ashConfirm(`Delete place "${name}"?${note}`, { danger: true }))) return;
        const pi = draftPlaces.indexOf(row);
        if (pi >= 0) draftPlaces.splice(pi, 1);
        if (typeof clearTypedBacklogFor === "function" && name) clearTypedBacklogFor("place", name, conn.id);
        renderMainList();
      };
    }
    el.querySelector("[data-pin]").onclick = () => {
      const name = String(row.label || "").trim();
      if (!name) return;
      const existing = pinFor(name);
      if (existing) {
        const viewing = typeof S !== "undefined"
          && S.activeView?.kind === "channel"
          && S.activeView.id === existing.id;
        send({ type: "deleteChannel", channelId: existing.id }, conn.id);
        const idx = (conn.channels || []).findIndex(c => c.id === existing.id);
        if (idx >= 0) conn.channels.splice(idx, 1);
        toast(`Unpinned "${name}"`);
        if (viewing && typeof renderView === "function") {
          try { renderView(false, { force: true }); } catch {}
        }
      } else if (typeof createPinnedLocationChannel === "function") {
        createPinnedLocationChannel(name);
        if (!pinFor(name)) {
          if (!Array.isArray(conn.channels)) conn.channels = [];
          conn.channels.push({
            id: "pin-pending-" + name.toLowerCase(),
            name: name.slice(0, 32),
            kind: "event",
            pinnedLocationLabel: name,
            enabledLocations: [name],
            boardId: null,
          });
        }
      }
      const showPinned = !!pinFor(name);
      paintPinControl(placeRowByName(name) || el, showPinned);
      requestAnimationFrame(() => renderMainList());
    };
    return el;
  };

  const paintPinControl = (rowEl, pinned) => {
    if (!rowEl) return;
    rowEl.classList.toggle("is-pinned", !!pinned);
    const btn = rowEl.querySelector("[data-pin]");
    if (!btn) return;
    btn.classList.toggle("is-on", !!pinned);
    btn.setAttribute("aria-pressed", pinned ? "true" : "false");
    btn.title = pinned ? "Unpin" : "Pin";
    btn.setAttribute("aria-label", pinned ? "Unpin" : "Pin this place");
    const existing = btn.querySelector(".place-pin-label");
    if (pinned && !existing) btn.insertAdjacentHTML("beforeend", `<span class="place-pin-label">Pinned</span>`);
    else if (!pinned && existing) existing.remove();
  };

  const placeRowByName = (name) => {
    const host = overlay;
    const want = String(name || "").trim().toLowerCase();
    if (!host || !want) return null;
    return [...host.querySelectorAll(".cat-place-row")].find(rowEl => {
      const input = rowEl.querySelector("input.deck-place-name");
      const text = input
        ? input.value
        : (rowEl.querySelector(".cat-item-name-input")?.textContent || "");
      return String(text || "").trim().toLowerCase() === want;
    }) || null;
  };

  function renderMainList() {
    const live = overlay?.querySelector("#deck-rows");
    if (!live) return;
    live.innerHTML = "";
    renderDupBanner();
    const items = draftPlaces
      .map(p => ({ p, name: String(p.label || "").trim() }))
      .sort((a, b) => a.name.localeCompare(b.name, undefined, { sensitivity: "base" }));
    if (personal) {
      const yours = document.createElement("div");
      yours.className = "side-label place-section-label";
      yours.textContent = "Your places";
      live.appendChild(yours);
    }
    if (!items.length) {
      const empty = document.createElement("p");
      empty.className = "cat-hint deck-empty-hint";
      empty.textContent = personal
        ? "No places yet. They appear here after you use them."
        : "No places yet. They appear here after they’re used.";
      live.appendChild(empty);
    }
    for (const row of items) live.appendChild(paintPlaceRow(row.p));
    if (!personal || typeof collectShownBoardPlaces !== "function") return;
    const own = new Set(draftPlaces.map(p => String(p.label || "").trim().toLowerCase()).filter(Boolean));
    const imported = collectShownBoardPlaces().filter(p => p.label && !own.has(p.label.toLowerCase()));
    if (!imported.length) return;
    const heading = document.createElement("div");
    heading.className = "side-label place-section-label";
    heading.textContent = "From your boards";
    live.appendChild(heading);
    for (const place of imported) {
      const note = (place.sources || []).map(s => s.name).filter(Boolean).slice(0, 2).join(", ");
      live.appendChild(paintPlaceRow(place, { readOnly: true, sourceNote: note }));
    }
  }

  const checkMaps = async () => {
    let checked = 0;
    let problems = 0;
    for (const row of draftPlaces) {
      const href = row.mapUrl || placeMapHrefs(row)[0] || "";
      if (!href || typeof resolveMapLink !== "function") continue;
      checked += 1;
      try {
        const resolved = await resolveMapLink(href);
        row.mapCheckedName = resolved?.name || "";
        if (row.mapCheckedName && typeof placeMapNameAgrees === "function"
          && !placeMapNameAgrees(row.label, row.mapCheckedName)) problems += 1;
      } catch {
        row.mapCheckedName = "";
      }
    }
    toast(checked
      ? (problems ? `${problems} map ${problems === 1 ? "name differs" : "names differ"}` : "Map links look fine")
      : "No map links to check");
    renderMainList();
  };

  overlay.querySelector("#place-check-maps")?.addEventListener("click", () => { void checkMaps(); });
  _placesRepaint = renderMainList;

  const flushPlaces = () => {
    _placesRepaint = null;
    const renames = inputRenames();
    savePlaceList(renames);
    for (const row of draftPlaces) {
      const label = String(row.label || "").trim();
      if (label) row.orig = label;
    }
    if (!personal && !conn.local) {
      for (const pair of renames) void rewriteVisiblePlace(pair.from, pair.to);
    }
  };
  if (hostEl) {
    renderMainList();
    return flushPlaces;
  }
  sideOverlayBeforeClose = flushPlaces;
  renderMainList();
}

function openDrawingsManagerBody(conn, hostEl) {
  const drawingsMarkup = `<div id="deck-rows" class="deck-editor-list"></div>`;
  let overlay = hostEl || null;
  if (overlay) {
    overlay.classList.add("deck-editor-side-body");
    overlay.innerHTML = drawingsMarkup;
  } else {
    const openedHost = openSideOverlay({
      kind: "drawings",
      title: "Drawings",
      bodyClass: ["side-overlay-categories", "deck-editor-side-body"],
      mount: (body) => { body.innerHTML = drawingsMarkup; },
    });
    if (!openedHost || sideOverlayKind !== "drawings") return;
    overlay = openedHost;
  }
  const rowsEl = overlay.querySelector("#deck-rows");

  function renderDrawings() {
    const cards = typeof harvestDrawings === "function"
      ? harvestDrawings(conn)
      : (typeof normalizeReactionCards === "function"
        ? normalizeReactionCards(conn.reactionCards)
        : (Array.isArray(conn.reactionCards) ? conn.reactionCards.slice() : []));
    rowsEl.innerHTML = `
      <div class="routine-catalog-panel reaction-catalog-panel">
        <p class="cat-hint">Drawings used as event icons, plus leftover chat or event reactions. Delete one to remove it from this server.</p>
        <div class="routine-manage-list reaction-manage-list">
          ${cards.length
            ? cards.map((entry, i) => {
                const card = typeof reactionCardId === "function" ? reactionCardId(entry) : (entry?.card || entry);
                const byline = typeof reactionCardCreatorLabel === "function"
                  ? reactionCardCreatorLabel(entry)
                  : "Created by someone";
                const usage = typeof drawingUsageLabel === "function"
                  ? drawingUsageLabel(entry)
                  : "";
                const meta = [byline, usage].filter(Boolean).join(" · ");
                return `
              <div class="routine-manage-row reaction-manage-row" data-drawing-i="${i}">
                <span class="routine-manage-icon reaction-manage-icon">${
                  typeof rxDisplay === "function" ? rxDisplay(card)
                    : (typeof ic === "function" ? ic(card, "ico-inline rx-drawn") : "")
                }</span>
                <span class="routine-manage-copy">
                  <strong class="routine-manage-title">Drawing</strong>
                  <span class="routine-manage-meta">${esc(meta)}</span>
                </span>
                <span class="routine-manage-actions">
                  <button type="button" class="routine-delete-btn" data-delete>Delete</button>
                </span>
              </div>`;
              }).join("")
            : `<p class="cat-hint deck-empty-hint">No drawings yet. They appear here after someone draws an event icon or a chat reaction.</p>`}
        </div>
      </div>`;
    rowsEl.querySelectorAll("[data-drawing-i]").forEach(row => {
      const idx = Number(row.dataset.drawingI);
      const entry = cards[idx];
      const card = typeof reactionCardId === "function" ? reactionCardId(entry) : (entry?.card || entry);
      row.querySelector("[data-delete]")?.addEventListener("click", async () => {
        if (!card) return;
        if (!(await ashConfirm("Delete this drawing from the server, events, and chat?", { danger: true }))) return;
        send({ type: "deleteReactionCard", card }, conn.id);
        if (typeof stripDrawnPayloadFromConn === "function") stripDrawnPayloadFromConn(conn, card);
        if (typeof cacheConn === "function") cacheConn(conn);
        renderDrawings();
        try { renderAll(); } catch {}
      });
    });
  }

  if (!hostEl) sideOverlayBeforeClose = null;
  renderDrawings();
}
