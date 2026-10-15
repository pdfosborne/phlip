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

function openPlacesManagerBody(conn) {
  const source = typeof harvestUsedPlaces === "function"
    ? harvestUsedPlaces(conn)
    : locationsFor(conn);
  const draftPlaces = source.map(l => ({
    label: l.label || "",
    orig: l.label || "",
    address: l.address || "",
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

  const placeUseTotal = (loc) => {
    if (!loc?.uses) return 0;
    return Object.values(loc.uses).reduce((n, v) => n + (Number(v) || 0), 0);
  };

  const placeStem = (label) => (typeof typedLabelStem === "function"
    ? typedLabelStem(label)
    : String(label || "").toLowerCase()
      .replace(/[^a-z0-9\s]/g, " ")
      .split(/\s+/)
      .filter(w => w && w !== "the" && w !== "a" && w !== "an" && w !== "pub" && w !== "bar" && w !== "cafe")
      .sort((a, b) => b.length - a.length)[0] || "");

  const placeDuplicateClusters = () => {
    const byStem = new Map();
    draftPlaces.forEach((p, i) => {
      const stem = placeStem(p.label);
      if (stem.length < 4) return;
      if (!byStem.has(stem)) byStem.set(stem, []);
      byStem.get(stem).push({ i, label: (p.label || "").trim(), uses: placeUseTotal(p) });
    });
    return [...byStem.entries()]
      .filter(([stem, g]) => g.length >= 2 && !ignoredDupStems.has(stem))
      .map(([stem, g]) => ({ stem, items: g.sort((a, b) => b.uses - a.uses) }));
  };

  const openedHost = openSideOverlay({
    kind: "places",
    title: "Places",
    bodyClass: ["side-overlay-categories", "deck-editor-side-body"],
    mount: (body) => {
      body.innerHTML = `
      <p class="cat-hint">Places used on this server. Delete ones that don’t belong.</p>
      <div id="deck-dup-banner"></div>
      <div id="deck-rows" class="deck-editor-list"></div>`;
    },
  });
  if (!openedHost || sideOverlayKind !== "places") return;
  const overlay = openedHost;
  const headActions = document.getElementById("side-overlay-actions");
  if (headActions) {
    headActions.innerHTML = "";
    headActions.hidden = true;
  }
  const rowsEl = overlay.querySelector("#deck-rows");
  const dupBannerEl = overlay.querySelector("#deck-dup-banner");

  const renderDupBanner = () => {
    if (!dupBannerEl) return;
    const clusters = placeDuplicateClusters();
    if (clusters.length) {
      const c = clusters[0];
      const preview = c.items.slice(0, 3).map(i => i.label).join(", ");
      dupBannerEl.innerHTML = `
        <div class="deck-dup-card">
          <div class="deck-dup-copy">
            <span class="deck-dup-ico" aria-hidden="true">${ic("share")}</span>
            <div>
              <div class="deck-dup-title">${c.items.length} places look like duplicates</div>
              <div class="deck-dup-preview">${esc(preview)}</div>
              <div class="deck-dup-ask">Merge them, or ignore if the similar names are intentional.</div>
            </div>
          </div>
          <div class="deck-dup-actions">
            <button type="button" class="save" data-dup-review="${esc(c.stem)}">Review</button>
            <button type="button" class="cancel" data-dup-ignore="${esc(c.stem)}">Ignore</button>
          </div>
        </div>`;
      dupBannerEl.querySelector("[data-dup-ignore]").onclick = () => {
        ignoredDupStems.add(c.stem);
        persistIgnoredDupStems();
        toast("Similar names kept — won't ask again");
        renderMainList();
      };
      dupBannerEl.querySelector("[data-dup-review]").onclick = async () => {
        const keep = c.items[0];
        const others = c.items.slice(1);
        if (!(await ashConfirm(
          `Merge into “${keep.label}”? Removes: ${others.map(o => o.label).join(", ")}.`,
          { danger: false },
        ))) return;
        const keepRow = draftPlaces[keep.i];
        for (const o of others) {
          const row = draftPlaces[o.i];
          if (!row || row === keepRow) continue;
          for (const [k, v] of Object.entries(row.uses || {})) {
            keepRow.uses[k] = (Number(keepRow.uses[k]) || 0) + (Number(v) || 0);
          }
        }
        const drop = new Set(others.map(o => o.i));
        for (let i = draftPlaces.length - 1; i >= 0; i--) {
          if (drop.has(i)) draftPlaces.splice(i, 1);
        }
        renderMainList();
      };
    } else {
      dupBannerEl.innerHTML = "";
    }
  };

  function renderMainList() {
    if (!rowsEl) return;
    rowsEl.innerHTML = "";
    renderDupBanner();

    const items = draftPlaces
      .map((p, i) => ({ p, i, name: String(p.label || "").trim(), address: String(p.address || "").trim() }))
      .sort((a, b) => String(a.name || "").localeCompare(String(b.name || ""), undefined, { sensitivity: "base" }));
    if (!items.length) {
      rowsEl.innerHTML = `<p class="cat-hint deck-empty-hint">No places yet. They appear here after they’re used.</p>`;
      return;
    }
    items.forEach((row) => {
      const el = document.createElement("div");
      el.className = "cat-item-row cat-place-row";
      el.innerHTML = `
        <div class="cat-item-main">
          <input class="deck-place-name cat-item-name-input" maxlength="48" value="${esc(row.p.label || "")}" placeholder="Place name">
          ${row.address ? `<div class="muted cat-item-address">${esc(row.address)}</div>` : ""}
        </div>
        <button type="button" class="cat-item-action cat-item-del" title="Delete" aria-label="Delete">${ic("cancel")}</button>
      `;
      el.querySelector(".cat-item-name-input").oninput = (e) => {
        row.p.label = e.target.value;
      };
      el.querySelector(".cat-item-del").onclick = async () => {
        const name = (row.p.label || "").trim() || "this place";
        if (!(await ashConfirm(`Delete place "${name}"?`, { danger: true }))) return;
        const pi = draftPlaces.indexOf(row.p);
        if (pi >= 0) draftPlaces.splice(pi, 1);
        if (typeof clearTypedBacklogFor === "function" && row.p.label) {
          clearTypedBacklogFor("place", row.p.label, conn.id);
        }
        renderMainList();
      };
      rowsEl.appendChild(el);
    });
  }

  const persistDraft = () => {
    const placeRows = [];
    const placeSeen = new Set();
    for (const row of draftPlaces) {
      const label = (row.label || "").trim().slice(0, 60);
      if (!label) continue;
      const key = label.toLowerCase();
      if (placeSeen.has(key)) continue;
      placeSeen.add(key);
      placeRows.push({
        label,
        orig: row.orig,
        address: (row.address || "").trim().slice(0, 80),
        categoryId: preservedPlaceCategoryId(label, row.categoryId),
        uses: row.uses || {},
      });
    }

    if (PersonalSpace.isPersonal(conn)) {
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
        next.push(prev
          ? { ...prev, label: row.label, address: row.address || prev.address || "", categoryId: row.categoryId }
          : { label: row.label, address: row.address || "", categoryId: row.categoryId, uses: row.uses || {} });
      }
      LOCATIONS = next;
      storageSetJson("ash_locations_v1", LOCATIONS);
      try { renderAll(); } catch {}
      return true;
    }

    send({
      type: "updateLocations",
      locations: placeRows.map(r => ({ label: r.label, categoryId: r.categoryId })),
    });
    return true;
  };

  sideOverlayBeforeClose = () => persistDraft();
  renderMainList();
}

function openDrawingsManagerBody(conn) {
  const openedHost = openSideOverlay({
    kind: "drawings",
    title: "Drawings",
    bodyClass: ["side-overlay-categories", "deck-editor-side-body"],
    mount: (body) => {
      body.innerHTML = `<div id="deck-rows" class="deck-editor-list"></div>`;
    },
  });
  if (!openedHost || sideOverlayKind !== "drawings") return;
  const overlay = openedHost;
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

  sideOverlayBeforeClose = null;
  renderDrawings();
}
