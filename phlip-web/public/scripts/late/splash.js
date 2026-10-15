/* First-run welcome splash — a playing-card back that takes the user's name,
   then flips onto the personalised example draft on the timeline.

   Standalone module: it mounts once and unmounts permanently. It owns no create
   state — onboarding.showWelcomeSplash() drives it and applies state on
   resolve. Removing this file + its <script> tag leaves the app working (the
   caller falls back to a nameless first-run resume).

   Soft-keyboard handling: the interactive layer is sized to window.visualViewport
   (the area not covered by the keyboard) and scrolls, so the card stays visible
   and "Continue" is always reachable. The flip is deferred until the keyboard
   has finished dismissing, so the card + timeline rects are measured in the settled,
   full-height layout and the card lands on target. */
(() => {
  "use strict";

  const NAME_MAX = 24;
  const FLIP_MS = 1000;

  function prefersReducedMotion() {
    try { return !!window.matchMedia?.("(prefers-reduced-motion: reduce)")?.matches; }
    catch { return false; }
  }

  /** The example rendered underneath the welcome screen. */
  function findCreateCard() {
    if (window.Onboarding?.hasInvite?.()) return null;
    return document.getElementById("ob-first-event");
  }

  /** Step the embossed name down as it gets longer (trim first so trailing
      spaces don't shrink the type). */
  function stepFont(len) {
    if (len > 12) return "17px";
    if (len > 9) return "21px";
    if (len > 6) return "24px";
    return "28px";
  }

  function mount() {
    return new Promise((resolve) => {
      if (document.getElementById("splash")) {
        resolve({ skipped: true, name: null });
        return;
      }
      const reduce = prefersReducedMotion();
      const root = document.createElement("div");
      root.id = "splash";
      root.className = "splash" + (reduce ? " reduce-motion" : "");
      root.setAttribute("role", "dialog");
      root.setAttribute("aria-modal", "true");
      root.setAttribute("aria-labelledby", "splash-pitch");
      root.innerHTML = `
        <div class="splash-ground" aria-hidden="true"></div>
        <div class="splash-scroll" id="splash-scroll">
          <div class="splash-content">
            <div class="splash-card" id="splash-card">
              <div class="card-face card-back">
                <div class="card-pattern" aria-hidden="true"></div>
                <div class="card-edge" aria-hidden="true"></div>
                <div class="card-name-block">
                  <div class="card-name" id="splash-card-name"></div>
                  <div class="card-rule" aria-hidden="true"></div>
                </div>
                <div class="card-mark" aria-hidden="true">PHLIP</div>
              </div>
              <div class="card-face card-front" aria-hidden="true">
                <div class="cf-glyph">◇</div>
                <div class="cf-label" id="splash-event-title">Your first event</div>
              </div>
            </div>
            <div class="splash-form" id="splash-form">
              <p class="pitch" id="splash-pitch">What should we call you?</p>
              <p class="tagline">A name or nickname. You can change it later.</p>
              <input id="splashName" type="text" maxlength="${NAME_MAX}" autocomplete="nickname"
                enterkeyhint="done" placeholder="Your name" value="" aria-label="Your name">
              <p class="splash-err" id="splash-err" hidden>Enter a name to continue.</p>
              <button type="button" id="splashGo">Continue</button>
            </div>
          </div>
        </div>`;
      document.body.appendChild(root);

      const card = root.querySelector("#splash-card");
      const nameEl = root.querySelector("#splash-card-name");
      const input = root.querySelector("#splashName");
      const err = root.querySelector("#splash-err");
      const scroll = root.querySelector("#splash-scroll");
      const goBtn = root.querySelector("#splashGo");
      let dealing = false;

      // Keep the interactive layer inside the area the keyboard leaves visible,
      // and switch to a compact layout (small card, no marketing chrome) while
      // the keyboard is up so the form + buttons fit above it.
      // Baseline height: adjustResize shrinks window.innerHeight with the IME, so
      // comparing vv.height to innerHeight alone never fires — lock the open height.
      const vv = window.visualViewport;
      const baseH = Math.max(window.innerHeight, vv?.height || 0);
      root.style.setProperty("--splash-base-h", `${baseH}px`);
      const syncViewport = () => {
        const h = vv ? vv.height : window.innerHeight;
        if (vv) {
          scroll.style.top = `${vv.offsetTop}px`;
          scroll.style.height = `${h}px`;
        }
        const short = h < baseH - 100;
        const focused = document.activeElement === input;
        root.classList.toggle("kb", short || focused);
      };
      if (vv) {
        vv.addEventListener("resize", syncViewport);
        vv.addEventListener("scroll", syncViewport);
      }
      window.addEventListener("resize", syncViewport);
      syncViewport();

      // When the field is focused, compact immediately and scroll buttons into view.
      input.addEventListener("focus", () => {
        root.classList.add("kb");
        setTimeout(() => {
          syncViewport();
          try { goBtn.scrollIntoView({ block: "nearest", behavior: "smooth" }); } catch {}
        }, 280);
      });
      input.addEventListener("blur", () => {
        setTimeout(syncViewport, 220);
      });

      const syncName = () => {
        const v = input.value.trim();
        if (v) {
          nameEl.textContent = v;
          nameEl.style.fontSize = stepFont(v.length);
          card.classList.add("has-name");
          err.hidden = true;
        } else {
          nameEl.textContent = "";
          card.classList.remove("has-name");
        }
      };
      input.addEventListener("input", syncName);

      const settle = () => {
        try {
          if (vv) {
            vv.removeEventListener("resize", syncViewport);
            vv.removeEventListener("scroll", syncViewport);
          }
          window.removeEventListener("resize", syncViewport);
        } catch {}
        try { root.remove(); } catch {}
        resolve({ name: input.value.trim() });
      };

      // Run cb once the keyboard has finished dismissing (viewport back to the
      // pre-IME baseline), so the flip measures the settled full-height layout.
      const viewportH = () => (vv ? vv.height : window.innerHeight);
      const keyboardGone = () => viewportH() >= baseH - 60;

      const dismissKeyboard = () => {
        try { input.blur(); } catch {}
        try {
          input.setAttribute("readonly", "readonly");
          input.setAttribute("disabled", "disabled");
        } catch {}
        // Leave compact layout so the card is full-size for the flip measure.
        root.classList.remove("kb");
        try {
          scroll.style.top = "0px";
          scroll.style.height = `${baseH}px`;
        } catch {}
        try { window.AshNative?.hideKeyboard?.(); } catch {}
      };

      const afterKeyboardSettles = (cb) => {
        if (keyboardGone()) {
          requestAnimationFrame(() => setTimeout(cb, 40));
          return;
        }
        let done = false;
        const finish = () => {
          if (done) return;
          done = true;
          try { vv?.removeEventListener("resize", onResize); } catch {}
          try { window.removeEventListener("resize", onWinResize); } catch {}
          clearTimeout(timer);
          // One extra frame after restore so layout finishes expanding.
          requestAnimationFrame(() => setTimeout(cb, 80));
        };
        const onResize = () => { if (keyboardGone()) finish(); };
        const onWinResize = () => { if (keyboardGone()) finish(); };
        vv?.addEventListener("resize", onResize);
        window.addEventListener("resize", onWinResize);
        const timer = setTimeout(finish, 900); // fallback if IME never reports
      };

      const startFlip = () => {
        // Measure the example behind the splash after the keyboard settles.
        card.style.willChange = "transform";
        const cardRect = card.getBoundingClientRect();
        const target = findCreateCard();
        let dx, dy, scale;
        if (target) {
          const t = target.getBoundingClientRect();
          dx = (t.left + t.width / 2) - (cardRect.left + cardRect.width / 2);
          dy = (t.top + t.height / 2) - (cardRect.top + cardRect.height / 2);
          scale = Math.max(0.18, Math.min(1, t.width / cardRect.width));
        } else {
          dx = 0;
          dy = (window.innerHeight - 120) - (cardRect.top + cardRect.height / 2);
          scale = 0.34;
        }

        let finished = false;
        const finish = () => {
          if (finished) return;
          finished = true;
          card.style.willChange = "";
          settle();
        };
        card.addEventListener("transitionend", (e) => {
          if (e.propertyName === "transform") finish();
        }, { once: true });
        // Safety net if transitionend is dropped (WebView occasionally misses it).
        setTimeout(finish, FLIP_MS + 140);

        // Fade the paper + form out; flip the card onto its timeline example.
        root.classList.add("is-dealing");
        requestAnimationFrame(() => requestAnimationFrame(() => {
          card.style.transform =
            `translate3d(${dx}px, ${dy}px, 0) rotateY(180deg) rotate(-3deg) scale(${scale})`;
        }));

        // Tap anywhere during the flight jumps straight to the end state.
        root.addEventListener("pointerdown", () => {
          card.style.transition = "none";
          finish();
        }, { once: true });
      };

      const deal = () => {
        const name = input.value.trim();
        if (!name) {
          err.hidden = false;
          try { input.focus(); } catch {}
          return;
        }
        if (dealing) return;
        dealing = true;
        window.Onboarding?.prepare?.(name);
        root.querySelector("#splash-event-title").textContent = name + "’s first event";
        // Mark first-run seen at the START of the flip — a user who kills the app
        // mid-animation must not see the splash again. (The caller also persists.)
        try { localStorage.setItem("ash_me_named", "1"); } catch {}
        // Force the IME down first; animation waits until the viewport is restored.
        dismissKeyboard();

        if (reduce || window.Onboarding?.hasInvite?.() || !findCreateCard()) {
          // No flip, no travel — cross-fade the splash out; the board is already
          // rendered underneath.
          afterKeyboardSettles(() => {
            root.classList.add("fade-out");
            let done = false;
            const finishFade = () => { if (done) return; done = true; settle(); };
            root.addEventListener("transitionend", finishFade, { once: true });
            setTimeout(finishFade, 260);
          });
          return;
        }

        afterKeyboardSettles(() => startFlip());
      };

      goBtn.addEventListener("click", () => deal());
      input.addEventListener("keydown", (e) => {
        if (e.key === "Enter") { e.preventDefault(); deal(); }
      });

      syncName();
      // No auto-focus: show the whole card first; the keyboard only opens when the
      // user taps the field.
    });
  }

  window.Splash = { mount };
})();
