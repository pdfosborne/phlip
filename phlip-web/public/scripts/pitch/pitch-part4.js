/* pitch-part4.js — event activity labels for chat rows and the Broadcast KV meter.
 * Open Pitch (archive/web/E23-card-hand-open-pitch) and the full-card event detail popup
 * (archive/web/E1-event-detail-popup) are archived.
 * Load before: pitch/event-card-styles.js
 */

function activityWhenLabel(when, precision, period) {
  if (!when) return "an unset time";
  const day = relativeDayLabel(when);
  if (precision === "day") return `${day} · all day`;
  if (precision === "period")
    return `${day} · ${DAY_PERIODS.find(p => p.id === period)?.label || "rough time"}`;
  if (precision === "unconfirmed") return `${day} · time TBD`;
  return `${day} · ${fmtTime(when)}`;
}

function eventActivityIcon(activity) {
  if (activity === "time" || activity === "duration") return "clock";
  if (activity === "addPerson" || activity === "removePerson" || activity === "memberJoined") return "user-round-plus";
  if (activity === "where") return "radar";
  if (activity === "details") return "ticket";
  if (activity === "sticker") return "custom";
  if (activity === "icon") return "ticket";
  return "check";
}

function eventActivityText(n) {
  if (n.activity === "rsvp") {
    const labels = { going: "is going", signedUp: "signed up", out: "can’t make it" };
    return `${n.name} ${labels[n.status] || "updated their response"}`;
  }
  if (n.activity === "addPerson")
    return `${n.name} added ${n.targetName || "someone"} to the event`;
  if (n.activity === "removePerson")
    return `${n.name} removed ${n.targetName || "someone"} from the event`;
  if (n.activity === "time")
    return `${n.name} changed the date/time from ${activityWhenLabel(n.oldWhen, n.oldWhenPrecision, n.oldWhenPeriod)} to ${activityWhenLabel(n.newWhen, n.newWhenPrecision, n.newWhenPeriod)}`;
  if (n.activity === "where")
    return `${n.name} changed the location`;
  if (n.activity === "details")
    return `${n.name} updated the description`;
  if (n.activity === "sticker")
    return `${n.name} updated the sticker`;
  if (n.activity === "duration") {
    const to = n.newValue
      ? (typeof durationLabel === "function" ? durationLabel(n.newValue) : n.newValue)
      : "default";
    if (n.oldValue) {
      const from = typeof durationLabel === "function" ? durationLabel(n.oldValue) : n.oldValue;
      return `${n.name} changed the duration from ${from} to ${to}`;
    }
    return `${n.name} set the duration to ${to}`;
  }
  if (n.activity === "icon")
    return `${n.name} changed the event type`;
  if (n.activity === "memberJoined")
    return `${n.name} joined`;
  return "";
}

/** Worker KV write meter under the Broadcast toolbar (public live shares). */
function edgeKvMeterHTML() {
  const kv = S.edgeKv;
  if (!kv) {
    return `<div class="edge-kv-meter muted" id="edge-kv-meter" title="Cloudflare Workers KV daily write budget">Cloudflare KV · … · Free</div>`;
  }
  const paid = kv.plan === "paid";
  const writes = Math.max(0, Number(kv.writes) || 0);
  const budget = Math.max(1, Number(kv.budget) || 1000);
  const limited = !!kv.limited;
  const hot = limited || (!paid && writes >= budget * 0.8);
  if (paid) {
    return `<div class="edge-kv-meter${hot ? " warn" : ""}" id="edge-kv-meter" title="Cloudflare Workers KV writes today">Cloudflare KV · ${writes} today · Paid</div>`;
  }
  const line = limited
    ? `Cloudflare KV · daily limit hit · upgrade Paid ($5/mo)`
    : `Cloudflare KV · ${writes}/${budget} today · Free · Paid $5/mo for full Broadcasts`;
  return `<div class="edge-kv-meter${hot ? " warn" : ""}" id="edge-kv-meter" title="Cloudflare Workers Free plan: ~1000 KV writes/day. Upgrade: Account → Compute → Workers & Pages">${esc(line)}</div>`;
}
