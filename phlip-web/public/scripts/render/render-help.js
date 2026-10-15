/* render-help.js — served Legal/Help/docs/powered-by chrome.
 * Globals out: appendServedSideChrome, openPhlipDocsModal, poweredByPhlipHTML, …
 * Load after: render-host-console.js; before: render-sidebar.js
 */

/* -------- browser Legal / Contact / Help (served host pages) -------- */

/** Served sidebar: Help & legal (Leave is a row under Help). */
function appendServedSideChrome(settings) {
  appendServedInfoLinks(settings);
  appendPoweredByPhlip(settings, "side-powered-by");
}

const HELP_FAQS_URL = (typeof PHLIP_HELP_FAQS_URL !== "undefined" && PHLIP_HELP_FAQS_URL)
  || "https://phlipapp.com/FAQs";
const PHLIP_SITE_URL = "https://phlipapp.com/";

/** Linked "Powered by Phlip" credit for browser / Broadcast pages (P-mark + text). */
function poweredByPhlipHTML(extraClass = "") {
  const cls = ["powered-by-phlip", extraClass].filter(Boolean).join(" ");
  const mark = "data:image/png;base64," + "iVBORw0KGgoAAAANSUhEUgAAACAAAAAgCAYAAABzenr0AAAEBElEQVR4nMVXS28cRRD+uqdnZ/ZldjfrBBMu4JCXxAWhIDuWAeWAwNy4IsEfAPGwFQJGClKAC6AELpyCeBxQACninICFUXhIHAhEPCJz8IuErDF4154Zz3QX6t7d4PWu1ztrRymppJma7q6vv6rqqWYACDdRREujEOCW1cVyDKQUwnA1xgysZYAhnemBH0SQUdQFAL0ERzrpwPcrkDKKx0AqcwukYhgZeQT3HboXnPPqmkzjbC9E1X1MT8/gzCefGSDeyr9QSm4+FwA5TpJEIktPPf0sSSlJKdW1nj37OaWzOyjbk6ek45BjNEmcC+NrrbJ6CNxUBradxPffTmLfvr0Iw/A6A/GEQQgLA4PD+PHnyyj03W1YWK3MIFz5CyuejygMmkNABCQSCViWZSg3idgFAB0Kra4rYLm7sOueccgogAqWUPrlXdDV71CREagWGr5+ciuRUiKKoibV9lZz9AaqdgJkAIo8iGQB+b2PQzg9ZnNNDLQTzUo70c42TFTGwLgFFXmwEjmIRB4M1+IBOP3e+5if/9OEqB6WVCqFgwf344H7h6/vuG21mG/13EM8AG+dfAeXLv4AMAegegIJ2E4ShwcH8OEHp7F7921QSnVUsrEB7CgU4KZy6Ovrw6MjD8P3fXw1+TWuXLmKiS/P47nRozjz8Ucb5tCWASgpjdNCPo+3T71pbFNTf+DBIw+ZRLxw4RuUSiUUi8XYLPA4aLWzSqWCIFhFf/+dOHBgvwEWhhGWlspmTFwWRMcjiUw1ZDIZ8zozO4vff7sM204gm81g585eY78hOUBEELaNhYUFvDR+3Oz63PkvcK1Ugre8iCefGDPANENxDy/REYDaL/rvxUW89uorNauFTE8eo2NHceyFMRP7bk5O0ckgTao++XQVjD7/jAlFb7GIoaFBkwcNYG9EDjDGEIWhqYKXx481fOt257EAcM5h1c5vz/Ng27bZqWZiK847BqBLT4bLKJfLJhe0bnr0bieAoaHDyOVy2LOnf1ucxgZw6uQbTbbtAiI6GaQTrS5bjfmmAKhFGcV1GqcUxfqJlsU37HQ6ZWttx9MsjaHj/z+Q+aFMTEya8qr3hHFVz5uensOlny4im7sdBAukolovQiAVNIAQ9Ycg8OCmc3hx/LjpXAcGDoHrdmpdshliWuSfYYwIs3PzOHHidSz7HP13PQZmJcDtNJjIYGnqU4ReCVJR65uRJWy4bhZesIqk67bI9GrH206C1RAWk+i94wjStw5DRSumJ/T/+RXluXPwlsvwvUprAFq0U8dN1qLT6IxbAsJ2wPUdsN7mrRPOqlGVKgJFvrkhESkQSYQRQ+AvN4xncW/HGiCrOdlYanEy46rP+tKqQTStd7Ov5/8BCKf9vRJnqfEAAAAASUVORK5CYII=";
  return `<a class="${cls}" href="${PHLIP_SITE_URL}" target="_blank" rel="noopener noreferrer"><img class="powered-by-phlip-mark" src="${mark}" width="18" height="18" alt=""><span>Powered by Phlip</span></a>`;
}

function appendPoweredByPhlip(container, extraClass = "") {
  if (!container) return;
  const wrap = document.createElement("div");
  wrap.className = "powered-by-phlip-wrap";
  wrap.innerHTML = poweredByPhlipHTML(extraClass);
  container.appendChild(wrap);
}

/** Sidebar + join-modal: one “Help & legal” entry that opens Legal / Contact / Help. */
function appendServedInfoLinks(container, opts = {}) {
  if (!container) return;
  const compact = !!opts.compact;
  const b = document.createElement("button");
  b.type = "button";
  b.className = compact ? "join-info-link" : "side-item served-info-link";
  b.textContent = "Help & legal";
  b.title = "Legal, contact, and FAQs";
  b.onclick = (e) => { e.stopPropagation(); e.preventDefault(); openPhlipHelpLegalMenu(); };
  container.appendChild(b);
}

function openPhlipHelpLegalMenu() {
  const opened = AshModal.open({
    className: "phlip-help-legal",
    html: `
    <div class="modal-card phlip-help-legal-modal">
      <h4>Help &amp; Legal</h4>
      <p class="phlip-docs-sub">FAQs, how to reach the developers, and Phlip’s legal documents.</p>
      <div class="phlip-help-legal-list">
        <button type="button" class="phlip-help-legal-row" data-act="legal">
          <span class="phlip-help-legal-title">Legal</span>
          <span class="phlip-help-legal-sub">Terms, moderation, privacy, and licence</span>
        </button>
        <button type="button" class="phlip-help-legal-row" data-act="contact">
          <span class="phlip-help-legal-title">Contact &amp; Bug Report</span>
          <span class="phlip-help-legal-sub">Reach the developers or report a bug</span>
        </button>
        <button type="button" class="phlip-help-legal-row" data-act="help">
          <span class="phlip-help-legal-title">Help</span>
          <span class="phlip-help-legal-sub">FAQs on phlipapp.com</span>
        </button>
      </div>
      <div class="actions">
        <span></span>
        <button type="button" class="cancel" id="phlip-help-legal-close">Close</button>
      </div>
    </div>`,
    singleton: "replace",
  });
  if (!opened) return;
  const { overlay, close } = opened;
  overlay.querySelector("#phlip-help-legal-close").onclick = close;
  overlay.querySelectorAll("[data-act]").forEach((btn) => {
    btn.onclick = () => {
      const act = btn.getAttribute("data-act");
      close();
      if (act === "help") openPhlipHelpFaqs();
      else if (act === "contact") openPhlipDocsModal("contact");
      else openPhlipDocsModal("legal");
    };
  });
}

function openPhlipHelpFaqs() {
  try {
    window.open(HELP_FAQS_URL, "_blank", "noopener,noreferrer");
  } catch {
    try { location.href = HELP_FAQS_URL; } catch {}
  }
}

function openPhlipDocsModal(kind) {
  const pack = kind === "contact"
    ? (typeof PHLIP_CONTACT !== "undefined" ? PHLIP_CONTACT : null)
    : (typeof PHLIP_LEGAL !== "undefined" ? PHLIP_LEGAL : null);
  if (!pack || !pack.sections) {
    toast("Documents aren’t available yet — try again after a refresh.");
    return;
  }
  const cls = kind === "contact" ? "phlip-contact-docs" : "phlip-legal-docs";
  const sectionsHtml = pack.sections.map((s, i) => `
    <div class="phlip-doc-section" data-i="${i}">
      <button type="button" class="phlip-doc-head" aria-expanded="false">▸ ${esc(s.title)}</button>
      <pre class="phlip-doc-body" hidden>${esc(s.body)}</pre>
      <button type="button" class="phlip-doc-read" data-title="${esc(s.title)}" data-i="${i}">Read full text…</button>
    </div>`).join("");
  const opened = AshModal.open({
    className: cls,
    html: `
    <div class="modal-card phlip-docs-modal">
      <div class="phlip-docs-top">
        <h4>${esc(pack.title)}</h4>
        <p class="phlip-docs-sub">${esc(pack.subtitle || "")}</p>
      </div>
      <div class="phlip-docs-body">${sectionsHtml}</div>
      <div class="actions">
        <span></span>
        <button type="button" class="cancel" id="phlip-docs-close">Close</button>
      </div>
    </div>`,
    singleton: "replace",
  });
  if (!opened) return;
  const { overlay, close } = opened;
  overlay.querySelector("#phlip-docs-close").onclick = close;
  overlay.querySelectorAll(".phlip-doc-section").forEach((box) => {
    const head = box.querySelector(".phlip-doc-head");
    const body = box.querySelector(".phlip-doc-body");
    const title = pack.sections[Number(box.dataset.i)]?.title || "";
    head.onclick = () => {
      const open = body.hidden;
      body.hidden = !open;
      head.setAttribute("aria-expanded", open ? "true" : "false");
      head.textContent = (open ? "▾ " : "▸ ") + title;
    };
    box.querySelector(".phlip-doc-read").onclick = () => {
      const text = pack.sections[Number(box.dataset.i)]?.body || "";
      const nested = AshModal.open({
        className: "phlip-doc-full",
        html: `
        <div class="modal-card phlip-doc-full-card">
          <h4>${esc(title)}</h4>
          <pre class="phlip-doc-full-body">${esc(text)}</pre>
          <div class="actions"><span></span><button type="button" class="cancel" id="phlip-doc-full-ok">OK</button></div>
        </div>`,
        singleton: false,
      });
      if (!nested) return;
      nested.overlay.querySelector("#phlip-doc-full-ok").onclick = nested.close;
    };
  });
}

