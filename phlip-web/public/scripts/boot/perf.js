/* ----------------------- opt-in responsiveness instrumentation ----------------------- */
/* Disabled by default. Enable locally with `localStorage.ash_perf_debug = "1"`.
 * Measurements contain names and durations only; they never include user content. */
const AshPerf = (() => {
  const enabled = () => {
    try { return localStorage.getItem("ash_perf_debug") === "1"; } catch { return false; }
  };
  const now = () => (typeof performance !== "undefined" ? performance.now() : Date.now());
  const starts = new Map();

  function begin(name) {
    if (!enabled()) return 0;
    const started = now();
    starts.set(name, started);
    try { performance.mark(`ash:${name}:start`); } catch {}
    return started;
  }

  function end(name, started = starts.get(name), budgetMs = null) {
    if (!enabled() || !started) return 0;
    starts.delete(name);
    const duration = now() - started;
    try {
      performance.mark(`ash:${name}:end`);
      performance.measure(`ash:${name}`, `ash:${name}:start`, `ash:${name}:end`);
    } catch {}
    if (budgetMs != null && duration > budgetMs) {
      console.warn(`[perf] ${name} took ${duration.toFixed(1)}ms (budget ${budgetMs}ms)`);
    }
    return duration;
  }

  return { enabled, begin, end };
})();
