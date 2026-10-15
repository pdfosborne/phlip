/* render-core.js — cross-shell renderAll orchestration.
 * Globals out: renderAll
 * Load after: served.js; before: other render-* modules
 */

function renderAll() {
  try { renderRail(); } catch (e) { console.error("renderRail", e); }
  try { renderSidebar(); } catch (e) { console.error("renderSidebar", e); }
  try { renderView(); } catch (e) { console.error("renderView", e); }
  try { renderFoot(); } catch (e) { console.error("renderFoot", e); }
}

