/* hand-plan-parse.js — deterministic plan extract from chat / pasted text.
 * Globals out: planParse, planLooksPromotable, openCreateDraftFromText,
 *   openCreateDraftFromMessage, applyPlanParseToDraft, applyPlanTextToOpenDraft,
 *   isPlanPasteDump, chatPlanCandidateClass, chatPlanMarkHTML, chatPlanPromoteHTML,
 *   handleChatPlanPromoteClick, wireCreateDraftPaste, chatMessageEventContext,
 *   planUpdateActionsForEvent, applyPlanUpdateToEvent, planParseMessages
 * Load after: hand-create-time.js; before: hand-create-draft.js
 */

const PLAN_PHRASE_RE = /\b(let['’]?s|shall we|who['’]?s in|meet(?:ing)? (?:at|up)|pub quiz|how about|fancy|we should|plan(?:ning)? for)\b/i;
const PLAN_WA_BRACKET_RE = /^\s*\[(\d{1,2}[/.]\d{1,2}(?:[/.]\d{2,4})?),?\s+\d{1,2}:\d{2}(?::\d{2})?(?:\s*[ap]m)?\]\s*/i;
const PLAN_WA_EXPORT_RE = /^\s*(\d{1,2}[/.]\d{1,2}(?:[/.]\d{2,4})?),?\s+\d{1,2}:\d{2}(?::\d{2})?\s+-\s+/;
const PLAN_NAME_COLON_RE = /^(?:~?\s*)?[A-Za-z][\w .'-]{0,40}:\s+/;
const PLAN_MONTH_RE = /(jan(?:uary)?|feb(?:ruary)?|mar(?:ch)?|apr(?:il)?|may|jun(?:e)?|jul(?:y)?|aug(?:ust)?|sep(?:t(?:ember)?)?|oct(?:ober)?|nov(?:ember)?|dec(?:ember)?)/i;
const PLAN_WEEKDAY_RE = /\b(next\s+|this\s+)?(sun(?:day)?|mon(?:day)?|tue(?:s(?:day)?)?|wed(?:nesday)?|thu(?:r(?:s(?:day)?)?)?|fri(?:day)?|sat(?:urday)?)\b/i;
const PLAN_MONTHS = ["jan", "feb", "mar", "apr", "may", "jun", "jul", "aug", "sep", "oct", "nov", "dec"];

function planDayStart(ts) {
  if (typeof dayStart === "function") return dayStart(ts);
  const d = new Date(Number(ts) || Date.now());
  d.setHours(0, 0, 0, 0);
  return d.getTime();
}

function planWeekdayIndex(token) {
  const t = String(token || "").toLowerCase().slice(0, 3);
  return { sun: 0, mon: 1, tue: 2, wed: 3, thu: 4, fri: 5, sat: 6 }[t];
}

function planMonthIndex(token) {
  return PLAN_MONTHS.indexOf(String(token || "").toLowerCase().slice(0, 3));
}

function planFutureDay(dayTs, now) {
  const today = planDayStart(now);
  const d = planDayStart(dayTs);
  if (d >= today) return d;
  const next = new Date(d);
  next.setFullYear(next.getFullYear() + 1);
  return planDayStart(next.getTime());
}

function planSoonestWeekday(now, weekday, nextFlag) {
  const start = new Date(planDayStart(now));
  const cur = start.getDay();
  let delta = (weekday - cur + 7) % 7;
  if (nextFlag && delta === 0) delta = 7;
  start.setDate(start.getDate() + delta);
  return start.getTime();
}

function stripChatPrefix(line) {
  return String(line || "")
    .replace(PLAN_WA_BRACKET_RE, "")
    .replace(PLAN_WA_EXPORT_RE, "")
    .replace(PLAN_NAME_COLON_RE, "")
    .trim();
}

function planExtractDate(text, now) {
  const s = String(text || "");
  const hits = [];

  const rel = s.match(/\b(today|tonight|tomorrow|tomoz|tmrw)\b/i);
  if (rel) {
    const key = rel[1].toLowerCase();
    const base = new Date(planDayStart(now));
    if (key !== "today" && key !== "tonight") base.setDate(base.getDate() + 1);
    hits.push({ raw: rel[0], day: base.getTime(), score: 3, index: rel.index });
  }

  // Prefer a qualified weekday ("next Sunday") over a bare one that is often
  // part of a name ("Sunday roast next Sunday").
  const wdAll = [...s.matchAll(new RegExp(PLAN_WEEKDAY_RE.source, "gi"))];
  const wd = wdAll.find((m) => m[1]) || wdAll[0] || null;
  if (wd) {
    const idx = planWeekdayIndex(wd[2]);
    if (idx != null) {
      const nextFlag = /^\s*next\s+/i.test(wd[1] || "");
      const day = planSoonestWeekday(now, idx, nextFlag);
      // "next Sunday" is ambiguous in UK usage: the coming one or the one after.
      let altDay = null;
      if (nextFlag) {
        const alt = new Date(day);
        alt.setDate(alt.getDate() + 7);
        altDay = planDayStart(alt.getTime());
      }
      hits.push({
        raw: wd[0],
        day,
        altDay,
        score: 2,
        index: wd.index,
      });
    }
  }

  const iso = s.match(/\b(\d{4})-(\d{1,2})-(\d{1,2})\b/);
  if (iso) {
    const year = parseInt(iso[1], 10);
    const month = parseInt(iso[2], 10) - 1;
    const day = parseInt(iso[3], 10);
    if (day >= 1 && day <= 31 && month >= 0 && month <= 11) {
      const d = new Date(year, month, day);
      d.setHours(0, 0, 0, 0);
      hits.push({ raw: iso[0], day: planFutureDay(d.getTime(), now), score: 4, index: iso.index });
    }
  }

  const dmy = s.match(/\b(\d{1,2})[/.](\d{1,2})(?:[/.](\d{2,4}))?\b/);
  if (dmy) {
    const day = parseInt(dmy[1], 10);
    const month = parseInt(dmy[2], 10) - 1;
    let year = dmy[3] ? parseInt(dmy[3], 10) : new Date(now).getFullYear();
    if (year < 100) year += 2000;
    if (day >= 1 && day <= 31 && month >= 0 && month <= 11) {
      const d = new Date(year, month, day);
      d.setHours(0, 0, 0, 0);
      hits.push({ raw: dmy[0], day: planFutureDay(d.getTime(), now), score: 4, index: dmy.index });
    }
  }

  const dm = s.match(new RegExp(String.raw`\b(\d{1,2})(?:st|nd|rd|th)?\s+` + PLAN_MONTH_RE.source + String.raw`(?:\s+(\d{2,4}))?\b`, "i"));
  if (dm) {
    const day = parseInt(dm[1], 10);
    const month = planMonthIndex(dm[2]);
    let year = dm[3] ? parseInt(dm[3], 10) : new Date(now).getFullYear();
    if (year < 100) year += 2000;
    if (day >= 1 && day <= 31 && month >= 0) {
      const d = new Date(year, month, day);
      d.setHours(0, 0, 0, 0);
      hits.push({ raw: dm[0], day: planFutureDay(d.getTime(), now), score: 4, index: dm.index });
    }
  }

  const md = s.match(new RegExp(String.raw`\b` + PLAN_MONTH_RE.source + String.raw`\s+(\d{1,2})(?:st|nd|rd|th)?(?:\s*,?\s*(\d{2,4}))?\b`, "i"));
  if (md) {
    const month = planMonthIndex(md[1]);
    const day = parseInt(md[2], 10);
    let year = md[3] ? parseInt(md[3], 10) : new Date(now).getFullYear();
    if (year < 100) year += 2000;
    if (day >= 1 && day <= 31 && month >= 0) {
      const d = new Date(year, month, day);
      d.setHours(0, 0, 0, 0);
      hits.push({ raw: md[0], day: planFutureDay(d.getTime(), now), score: 4, index: md.index });
    }
  }

  const fuzzy = s.match(new RegExp(String.raw`\b(early|mid|late)\s+` + PLAN_MONTH_RE.source + String.raw`\b`, "i"));
  if (fuzzy) {
    const month = planMonthIndex(fuzzy[2]);
    if (month >= 0) {
      const dayNum = fuzzy[1].toLowerCase() === "early" ? 8 : (fuzzy[1].toLowerCase() === "late" ? 20 : 15);
      const year = new Date(now).getFullYear();
      const d = new Date(year, month, dayNum);
      d.setHours(0, 0, 0, 0);
      hits.push({ raw: fuzzy[0], day: planFutureDay(d.getTime(), now), score: 1, index: fuzzy.index });
    }
  }

  hits.sort((a, b) => b.score - a.score || a.index - b.index);
  return hits[0] || null;
}

function planPreferEvening(parsed, raw) {
  if (!parsed || typeof parseCreateTimeNlp !== "function") return parsed;
  if (/am/i.test(raw) || parsed.startMin >= 12 * 60) return parsed;
  const h = Math.floor(parsed.startMin / 60);
  if (h < 7 || h > 11) return parsed;
  return parseCreateTimeNlp(String(raw).replace(/\s*(am|pm)\s*/ig, "") + "pm") || parsed;
}

function planNumberWord(token) {
  const words = {
    a: 1, an: 1, one: 1, two: 2, three: 3, four: 4, five: 5, six: 6,
    seven: 7, eight: 8, nine: 9, ten: 10, eleven: 11, twelve: 12,
  };
  const key = String(token || "").toLowerCase();
  if (words[key]) return words[key];
  const n = parseFloat(key);
  return Number.isFinite(n) ? n : 0;
}

function planDurationMinutes(token, unit) {
  const n = planNumberWord(token);
  if (!n) return 0;
  return /^(hours?|hrs?)$/i.test(unit) ? Math.round(n * 60) : Math.round(n);
}

function planDurationTail(text, from) {
  const rest = String(text || "").slice(from);
  const m = rest.match(/^\s+for\s+(a|an|one|two|three|four|five|six|seven|eight|nine|ten|eleven|twelve|\d+(?:\.\d+)?)\s+(hours?|hrs?|minutes?|mins?)\b/i);
  if (!m) return null;
  const minutes = planDurationMinutes(m[1], m[2]);
  if (minutes <= 0) return null;
  return { raw: m[0], minutes };
}

function planFinishTime(text, hit) {
  if (!hit || hit.startMin == null) return hit;
  const src = String(text || "");
  const raw = String(hit.raw || "");
  const at = src.toLowerCase().indexOf(raw.toLowerCase());
  if (at < 0) return hit;
  const extra = planDurationTail(src, at + raw.length);
  if (!extra) return hit;
  const endMin = Math.min(hit.startMin + extra.minutes, 24 * 60);
  const label = typeof formatCreateTimeRange === "function"
    ? formatCreateTimeRange(hit.startMin, endMin)
    : hit.label;
  return {
    ...hit,
    raw: (raw + extra.raw).replace(/\s+/g, " ").trim(),
    endMin,
    label: label || hit.label,
    period: "",
  };
}

function planInterpretTime(text) {
  const src = String(text || "").trim();
  if (!src) return null;
  const clockRe = /\b(\d{1,2}:\d{2}\s*(?:am|pm)?|\d{1,2}\s*(?:am|pm))\b/gi;
  let last = null;
  let match;
  while ((match = clockRe.exec(src))) last = match;
  // The last time mentioned wins ("7, actually 8pm") — unless it closes a
  // range ("7pm–8pm"): then the range is read from its start.
  let from = last ? last.index : 0;
  if (last) {
    // A dash range ("7pm–8pm", "9-5"), or a worded one whose start has its
    // own am / pm ("7pm to 9pm"); "7 to 9pm" keeps the old reading.
    const range = /(\d{1,2}(?::\d{2})?\s*(?:am|pm)?)\s*(?:–|—|-)\s*$/i.exec(src.slice(0, last.index))
      || /(\d{1,2}(?::\d{2})?\s*(?:am|pm))\s*(?:to|until|till)\s*$/i.exec(src.slice(0, last.index));
    if (range) from = range.index;
  }
  const base = planExtractTime(last ? src.slice(from) : src);
  if (!base || base.startMin == null) return base;
  const span = Number(base.endMin) - Number(base.startMin);
  if (span > 60) return base;
  const dur = src.match(/\bfor\s+(a|an|one|two|three|four|five|six|seven|eight|nine|ten|eleven|twelve|\d+(?:\.\d+)?)\s+(hours?|hrs?|minutes?|mins?)\b/i);
  if (!dur) return base;
  const minutes = planDurationMinutes(dur[1], dur[2]);
  if (minutes <= 0) return base;
  const endMin = Math.min(base.startMin + minutes, 24 * 60);
  const label = typeof formatCreateTimeRange === "function"
    ? formatCreateTimeRange(base.startMin, endMin)
    : base.label;
  return { ...base, endMin, label: label || base.label, period: "", raw: src };
}

function planInterpretDate(text, now = Date.now()) {
  const src = String(text || "").trim();
  if (!src) return null;
  const specific = /\b(?:next|this)\s+(?:sun|mon|tue|wed|thu|fri|sat)\w*/gi;
  let lastSpecific = "";
  let match;
  while ((match = specific.exec(src))) lastSpecific = match[0];
  if (lastSpecific) return planExtractDate(lastSpecific, now);
  const weekdays = /\b(?:sun|mon|tue|wed|thu|fri|sat)\w*/gi;
  let lastDay = "";
  while ((match = weekdays.exec(src))) lastDay = match[0];
  if (lastDay) return planExtractDate(lastDay, now);
  return planExtractDate(src, now);
}

function planExtractTime(text) {
  if (typeof parseCreateTimeNlp !== "function") return null;
  const s = String(text || "")
    .replace(/\b\d{1,2}[/.]\d{1,2}(?:[/.]\d{2,4})?\b/g, " ")
    .replace(/\b(\d{1,2})(?:\s*ish)\b/gi, "$1pm");

  const finish = (hit) => planFinishTime(s, hit);

  const range = s.match(/\b(\d{1,2}(?::\d{2})?\s*(?:am|pm)?)\s*(?:[-–]|to)\s*(\d{1,2}(?::\d{2})?\s*(?:am|pm)?)\b/i);
  if (range) {
    const parsed = planPreferEvening(parseCreateTimeNlp(range[1] + "-" + range[2]), range[0]);
    if (parsed) return finish({ raw: range[0], ...parsed });
  }

  const clock = s.match(/\b(\d{1,2}:\d{2}\s*(?:am|pm)?|\d{1,2}\s*(?:am|pm))\b/i);
  if (clock) {
    const parsed = planPreferEvening(parseCreateTimeNlp(clock[1]), clock[1]);
    if (parsed) return finish({ raw: clock[0], ...parsed });
  }

  const atHour = s.match(/\bat\s+(\d{1,2}(?::\d{2})?\s*(?:am|pm)?)\b/i);
  if (atHour) {
    const rawTok = atHour[1];
    const n = parseInt(rawTok, 10);
    if (n >= 1 && n <= 12) {
      const token = /am|pm|:/i.test(rawTok) ? rawTok : rawTok + "pm";
      const parsed = planPreferEvening(parseCreateTimeNlp(token), token);
      if (parsed) return finish({ raw: atHour[0], ...parsed });
    }
  }

  const eve = s.match(/\b(?:on\s+)?(?:sun|mon|tue|wed|thu|fri|sat)[a-z]*\s+(\d{1,2})(\s*(?:am|pm))?\b/i);
  if (eve) {
    const h = parseInt(eve[1], 10);
    if (h >= 1 && h <= 12) {
      const token = /am|pm/i.test(eve[2] || "") ? h + eve[2] : h + "pm";
      const parsed = planPreferEvening(parseCreateTimeNlp(token), token);
      if (parsed) return finish({ raw: (eve[1] + (eve[2] || "")).trim(), ...parsed });
    }
  }

  const oclock = s.match(/\b(\d{1,2})\s*o['’]?clock\b/i);
  if (oclock) {
    const n = parseInt(oclock[1], 10);
    if (n >= 1 && n <= 12) {
      const token = n + "pm";
      const parsed = planPreferEvening(parseCreateTimeNlp(token), token);
      if (parsed) return finish({ raw: oclock[0], ...parsed });
    }
  }

  const moved = s.match(/\b(?:to|until|till|by|around|about)\s+(\d{1,2}(?::\d{2})?\s*(?:am|pm)?)\b/i);
  if (moved) {
    const rawTok = moved[1];
    const n = parseInt(rawTok, 10);
    if (n >= 1 && n <= 12) {
      const token = /am|pm|:/i.test(rawTok) ? rawTok : rawTok + "pm";
      const parsed = planPreferEvening(parseCreateTimeNlp(token), token);
      if (parsed) return finish({ raw: rawTok, ...parsed });
    }
  }

  const period = s.match(/\b(this\s+)?(morning|afternoon|evening)\b/i);
  if (period) {
    const id = period[2].toLowerCase();
    const hour = (typeof DAY_PERIODS !== "undefined" && DAY_PERIODS.find(p => p.id === id)?.hour)
      || (id === "morning" ? 9 : id === "evening" ? 19 : 14);
    const startMin = hour * 60;
    const clockLabel = typeof formatCreateClockMins === "function"
      ? formatCreateClockMins(startMin)
      : (hour > 12 ? `${hour - 12}pm` : (hour === 12 ? "12pm" : `${hour}am`));
    return finish({
      raw: (period[2] || period[0]).trim(),
      startMin,
      endMin: Math.min(startMin + 60, 24 * 60 - 15),
      label: clockLabel,
      period: id,
    });
  }
  return null;
}

function planExtractPlace(text) {
  const m = String(text || "").match(
    /\b(?:@|at)\s+(?!the\s+(?:weekend|latest|moment|end|start|same)\b)((?:the\s+)?[A-Za-z][\w'’&.\-\s]{1,48}?)(?=\s*[.!?,]|\s+(?:if|for|tomorrow|today|tonight|next|on|at|@|\d)|$)/i
  );
  if (!m) return null;
  const where = m[1].trim().replace(/\s+/g, " ");
  if (!where || /^\d/.test(where) || /^(am|pm|ish)\b/i.test(where)) return null;
  return { raw: m[0], where };
}

function planLineLooksQuestion(line) {
  return /^(what|when|where|who|how|why|which)\b/i.test(String(line || "").trim());
}

function planTitleFrom(text, spans) {
  let t = String(text || "");
  const marks = [...new Set((spans || []).filter(Boolean).map((span) => String(span)))];
  marks.sort((a, b) => b.length - a.length);
  for (const span of marks) {
    const idx = t.toLowerCase().indexOf(span.toLowerCase());
    if (idx < 0) continue;
    t = t.slice(0, idx) + "\u0000" + t.slice(idx + span.length);
  }
  let prev = "";
  while (t !== prev) {
    prev = t;
    t = t.replace(/(?:^|\s)(?:on|at|for|this|next)(?=\s*\u0000)/ig, " ");
    t = t.replace(/\u0000\s*(?:on|at|for|this|next)(?=\s|$|[?!.,])/ig, "\u0000");
  }
  t = t.replace(/\u0000/g, " ");
  t = t.replace(/[?!.,]+/g, " ").replace(/\s+/g, " ").trim();
  t = t.replace(/^(?:ok+|yeah|yes|yep|hey|hi)\s+/i, "").trim();
  if (!t || /^\d/.test(t) || /^ish\b/i.test(t)) return "";
  return t.charAt(0).toUpperCase() + t.slice(1);
}

function planChooseTitle(lines, spans) {
  const dateRaw = String((spans && spans[0]) || "");
  const rows = [];
  for (const line of lines || []) {
    const title = planTitleFrom(line, spans);
    if (!title) continue;
    const question = planLineLooksQuestion(line) || planLineLooksQuestion(title);
    const dated = !!(dateRaw && String(line).toLowerCase().includes(dateRaw.toLowerCase()));
    rows.push({ title, question, dated });
  }
  const datedName = rows.find((row) => row.dated && !row.question);
  if (datedName) return datedName.title;
  const named = rows.find((row) => !row.question);
  return (named || rows[0] || {}).title || "";
}

function planParse(text, now = Date.now()) {
  const original = String(text || "").trim();
  if (!original) {
    return {
      title: "", day: null, timeText: "", timeStartMin: null, where: "", remainder: "",
      dateRaw: "", timeRaw: "", placeRaw: "", timePeriod: "", confident: false,
    };
  }
  const lines = original.split(/\r?\n/).map(stripChatPrefix).filter(Boolean);
  const combined = lines.join(" ");
  let bestLine = lines[0] || combined;
  let bestDate = null;
  for (const line of lines) {
    const d = planExtractDate(line, now);
    if (d && (!bestDate || d.score > bestDate.score)) {
      bestDate = d;
      bestLine = line;
    }
  }
  if (!bestDate) bestDate = planExtractDate(combined, now);

  const time = planExtractTime(bestLine) || planExtractTime(combined);
  const place = planExtractPlace(bestLine) || planExtractPlace(combined);
  const title = planChooseTitle(lines, [bestDate?.raw, time?.raw, place?.raw]);
  const dump = lines.length > 1 || PLAN_WA_BRACKET_RE.test(original) || PLAN_WA_EXPORT_RE.test(original);
  const remainder = dump ? original : "";
  return {
    title: (title || "Plan").slice(0, 160),
    day: bestDate?.day ?? null,
    timeText: time?.label || "",
    timeStartMin: time?.startMin ?? null,
    where: place?.where || "",
    remainder,
    dateRaw: bestDate?.raw || "",
    timeRaw: time?.raw || "",
    placeRaw: place?.raw || "",
    timePeriod: time?.period || "",
    altDay: bestDate?.altDay ?? null,
    confident: !!bestDate,
  };
}

/** Parse a group of chat messages as one plan.
 *  list: [{ id, text, ts }] in any order. Each message's relative dates resolve
 *  from its own send time. A later message's time / place overrides an earlier
 *  one ("evening" then "actually 12pm" -> 12pm). The title comes from
 *  opts.primaryId's message when given. */
function planParseMessages(list, opts = {}) {
  const rows = (list || [])
    .filter((m) => m && String(m.text || "").trim())
    .map((m) => ({ id: m.id || "", ts: Number(m.ts) || Date.now(), text: String(m.text || "").trim() }))
    .sort((a, b) => a.ts - b.ts);
  if (!rows.length) return planParse("", Date.now());
  if (rows.length === 1 && !opts.primaryId) {
    const one = planParse(rows[0].text, rows[0].ts);
    one.sources = { date: one.dateRaw ? rows[0].id : "", time: one.timeRaw || one.timeText ? rows[0].id : "", place: one.where ? rows[0].id : "" };
    return one;
  }
  let bestDate = null;
  let dateRow = null;
  let time = null;
  let timeRow = null;
  let place = null;
  let placeRow = null;
  const allLines = [];
  const spanRaws = [];
  for (const row of rows) {
    const lines = row.text.split(/\r?\n/).map(stripChatPrefix).filter(Boolean);
    for (const line of lines) {
      allLines.push({ line, id: row.id });
      const d = planExtractDate(line, row.ts);
      if (d && (!bestDate || d.score >= bestDate.score)) { bestDate = d; dateRow = row; }
      if (d?.raw) spanRaws.push(d.raw);
      const t = planExtractTime(line);
      if (t) { time = t; timeRow = row; if (t.raw) spanRaws.push(t.raw); }
      const pl = planExtractPlace(line);
      if (pl) { place = pl; placeRow = row; spanRaws.push(pl.raw); }
    }
  }
  // Strip every when/where phrase from the title, including ones a later
  // message overrode ("evening" when "12pm" won).
  const spans = [bestDate?.raw, ...spanRaws];
  const primaryLines = opts.primaryId
    ? allLines.filter((l) => l.id === opts.primaryId).map((l) => l.line)
    : [];
  const title = (primaryLines.length ? planChooseTitle(primaryLines, spans) : "")
    || planChooseTitle(allLines.map((l) => l.line), spans);
  return {
    title: (title || "Plan").slice(0, 160),
    day: bestDate?.day ?? null,
    altDay: bestDate?.altDay ?? null,
    timeText: time?.label || "",
    timeStartMin: time?.startMin ?? null,
    where: place?.where || "",
    remainder: rows.map((r) => r.text).join("\n"),
    dateRaw: bestDate?.raw || "",
    timeRaw: time?.raw || "",
    placeRaw: place?.raw || "",
    timePeriod: time?.period || "",
    confident: !!bestDate,
    sources: { date: dateRow?.id || "", time: timeRow?.id || "", place: placeRow?.id || "" },
  };
}

function planLooksPromotable(text, now = Date.now()) {
  const raw = String(text || "").trim();
  if (!raw) return false;
  const parsed = planParse(raw, now);
  if (parsed.confident) return true;
  if (PLAN_PHRASE_RE.test(raw) && (parsed.timeStartMin != null || parsed.where)) return true;
  return false;
}

function applyPlanParseToDraft(pending, parsed) {
  if (!pending || !parsed) return;
  if (parsed.title) {
    pending.title = String(parsed.title).slice(0, 160);
    pending.subtitle = pending.title;
    if (typeof markCreateDirty === "function") markCreateDirty("title");
  }
  if (parsed.day != null) {
    pending.day = parsed.day;
    if (typeof rebasePendingOntoDay === "function") rebasePendingOntoDay(pending, parsed.day);
  }
  if (parsed.timeText && typeof applyCreateTimeParse === "function") {
    applyCreateTimeParse(pending, parsed.timeText);
    if (typeof markCreateDirty === "function") markCreateDirty("time");
  }
  if (parsed.where) {
    pending.where = parsed.where;
    pending.locationDismissed = "";
    if (typeof markCreateDirty === "function") markCreateDirty("place");
  }
  if (parsed.remainder) pending.details = parsed.remainder;
  if (typeof inferCreateDraftIconFromTitle === "function") inferCreateDraftIconFromTitle();
}

function applyPlanTextToOpenDraft(text) {
  const pending = typeof createDraftPending === "function" ? createDraftPending() : null;
  if (!pending) return false;
  applyPlanParseToDraft(pending, planParse(text));
  if (typeof paintCreateDraft === "function") paintCreateDraft();
  return true;
}

function openCreateDraftFromText(text, now = Date.now()) {
  const parsed = planParse(text, now);
  if (typeof openCreateDraft !== "function") return;
  openCreateDraft({
    title: parsed.title,
    day: parsed.day || undefined,
    timeText: parsed.timeText,
    where: parsed.where,
    details: parsed.remainder,
  });
}

function openCreateDraftFromMessage(msg, extra = {}) {
  const text = typeof chatMessagePlaintext === "function"
    ? chatMessagePlaintext(msg)
    : String(msg?._text || msg?.text || "");
  if (typeof S !== "undefined" && msg?.id) {
    const conn = typeof activeConn === "function" ? activeConn() : null;
    const channelId = extra.channelId
      || msg.channelId
      || (S.activeView?.kind === "channel" ? S.activeView.id : null);
    const messageIds = Array.isArray(extra.messageIds) && extra.messageIds.length
      ? extra.messageIds
      : [msg.id];
    S.createDraftFromChat = {
      messageId: msg.id,
      messageIds,
      channelId,
      connId: extra.connId || conn?.id || S.activeConnId || null,
    };
  }
  if (typeof closeChatMessageOptions === "function") closeChatMessageOptions();
  openCreateDraftFromText(text, Number(msg?.ts) || Date.now());
}

function isPlanPasteDump(text) {
  const t = String(text || "");
  if (typeof parseMapLink === "function" && parseMapLink(t)) return false;
  if (t.includes("\n") && t.trim().length > 20) return true;
  if (PLAN_WA_BRACKET_RE.test(t) || PLAN_WA_EXPORT_RE.test(t)) return true;
  return false;
}

function chatMessageEventContext(opts = {}) {
  const msgEl = opts.msgEl;
  const ownerConn = opts.ownerConn;
  const inSheet = !!(msgEl && (
    msgEl.closest("#tl-sheet-host")
    || msgEl.closest("#tl-sheet-messages")
  ));
  let eventId = "";
  if (inSheet && typeof timelineSheetEventId !== "undefined" && timelineSheetEventId) {
    eventId = String(timelineSheetEventId);
  } else if (typeof S !== "undefined" && S.conversationsThread?.eventId) {
    eventId = String(S.conversationsThread.eventId);
  }
  if (!eventId) return null;
  let ev = null;
  if (typeof timelineFindEvent === "function") {
    try { ev = timelineFindEvent(eventId) || null; } catch { ev = null; }
  }
  if (!ev && ownerConn?.events) {
    ev = ownerConn.events.find(e => e && e.id === eventId) || null;
  }
  if (!ev && typeof activeConn === "function") {
    const conn = activeConn();
    ev = (conn?.events || []).find(e => e && e.id === eventId) || null;
  }
  return ev || null;
}

const PLAN_UPDATE_MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sept", "Oct", "Nov", "Dec"];

function planUpdateDateLabel(dayTs) {
  if (dayTs == null) return "";
  if (typeof conversationHeaderDateLabel === "function") {
    return conversationHeaderDateLabel({ when: dayTs }) || "";
  }
  const today = planDayStart(Date.now());
  const day = planDayStart(dayTs);
  if (day === today) return "Today";
  if (day === today + 864e5) return "Tomorrow";
  const d = new Date(day);
  const wk = d.toLocaleDateString("en-GB", { weekday: "short" }).replace(/\.$/, "");
  return `${wk} ${d.getDate()} ${PLAN_UPDATE_MONTHS[d.getMonth()] || ""}`.trim();
}

function planEventHasPreciseTime(ev) {
  if (!ev || ev.when == null) return false;
  const p = ev.whenPrecision;
  return p !== "day" && p !== "period" && p !== "unconfirmed";
}

function planEventStartMin(ev) {
  if (!planEventHasPreciseTime(ev)) return null;
  const d = new Date(ev.when);
  return d.getHours() * 60 + d.getMinutes();
}

function planEventPlace(ev) {
  if (typeof timelineEventPlace === "function") return String(timelineEventPlace(ev) || "").trim();
  const raw = ev?._where != null ? ev._where : ev?.where;
  return String(raw || "").trim();
}

function planOwnerConnForEvent(ev, conn) {
  return conn
    || (typeof ownerConnFor === "function" ? ownerConnFor(ev) : null)
    || (typeof ownerConnOf === "function" ? ownerConnOf(ev?.id) : null)
    || (typeof activeConn === "function" ? activeConn() : null);
}

function planEventWhenForDate(ev, day) {
  const dayTs = planDayStart(day);
  if (planEventHasPreciseTime(ev)) {
    const d = new Date(ev.when);
    const when = typeof atTime === "function"
      ? atTime(dayTs, d.getHours(), d.getMinutes())
      : (() => { const next = new Date(dayTs); next.setHours(d.getHours(), d.getMinutes(), 0, 0); return next.getTime(); })();
    return { when, whenPrecision: "" };
  }
  const when = typeof atHour === "function" ? atHour(dayTs, 12) : (Number(dayTs) + 12 * 3600e3);
  return { when, whenPrecision: "unconfirmed" };
}

function planEventWhenForTime(ev, timeStartMin) {
  const dayTs = ev?.when != null ? planDayStart(ev.when) : planDayStart(Date.now());
  const h = Math.floor(Number(timeStartMin) / 60);
  const m = Number(timeStartMin) % 60;
  const when = typeof atTime === "function"
    ? atTime(dayTs, h, m)
    : (() => { const d = new Date(dayTs); d.setHours(h, m, 0, 0); return d.getTime(); })();
  return { when, whenPrecision: "" };
}

function planUpdateTimeLabel(parsed) {
  if (parsed?.timePeriod) {
    return parsed.timePeriod.charAt(0).toUpperCase() + parsed.timePeriod.slice(1);
  }
  if (parsed?.timeStartMin != null && typeof formatCreateClockMins === "function") {
    return formatCreateClockMins(parsed.timeStartMin);
  }
  const text = String(parsed?.timeText || "").trim();
  if (text) return text.split(/[–-]/)[0].trim();
  if (parsed?.timeStartMin == null) return "";
  const h = Math.floor(parsed.timeStartMin / 60);
  const m = parsed.timeStartMin % 60;
  const h12 = h % 12 || 12;
  const ap = h < 12 ? "am" : "pm";
  return m ? `${h12}:${String(m).padStart(2, "0")}${ap}` : `${h12}${ap}`;
}

function planUpdateActionsForEvent(text, ev, now = Date.now()) {
  const actions = [];
  if (!ev) return actions;
  const parsed = planParse(text, now);
  if (parsed.day != null) {
    const sameDay = ev.when != null && planDayStart(ev.when) === planDayStart(parsed.day);
    if (!sameDay) {
      const dateLabel = planUpdateDateLabel(parsed.day);
      if (dateLabel) {
        actions.push({
          field: "date",
          icon: "calendar",
          label: `Update date to ${dateLabel}`,
          parsed,
        });
      }
    }
  }
  if (parsed.timeStartMin != null) {
    const currentMin = planEventStartMin(ev);
    const currentPeriod = typeof eventPeriodId === "function" ? eventPeriodId(ev) : "";
    const sameClock = currentMin != null && currentMin === parsed.timeStartMin;
    const samePeriod = !!(parsed.timePeriod && currentPeriod && currentPeriod === parsed.timePeriod);
    if (!sameClock && !samePeriod) {
      const timeLabel = planUpdateTimeLabel(parsed);
      if (timeLabel) {
        actions.push({
          field: "time",
          icon: "clock",
          label: `Update time to ${timeLabel}`,
          parsed,
        });
      }
    }
  }
  if (parsed.where) {
    const currentPlace = planEventPlace(ev);
    if (currentPlace.toLowerCase() !== parsed.where.toLowerCase()) {
      actions.push({
        field: "location",
        icon: "map-pin",
        label: `Update location to ${parsed.where}`,
        parsed,
      });
    }
  }
  return actions;
}

async function applyPlanUpdateToEvent(ev, field, parsed, conn) {
  if (!ev || !field || !parsed) return false;
  const owner = planOwnerConnForEvent(ev, conn);
  if (!owner || typeof send !== "function") return false;
  const fail = (kind) => {
    try { toast(`Couldn't update the ${kind}`); } catch {}
    return false;
  };
  if (field === "date" && parsed.day != null) {
    const next = planEventWhenForDate(ev, parsed.day);
    const result = send({
      type: "setEventTimePrecision",
      eventId: ev.id,
      when: next.when,
      whenPrecision: next.whenPrecision,
    }, owner.id);
    if (result === "failed") return fail("date");
    try { toast("Date updated"); } catch {}
    return true;
  }
  if (field === "time" && parsed.timeStartMin != null) {
    const next = planEventWhenForTime(ev, parsed.timeStartMin);
    const result = send({
      type: "setEventTimePrecision",
      eventId: ev.id,
      when: next.when,
      whenPrecision: next.whenPrecision,
    }, owner.id);
    if (result === "failed") return fail("time");
    try { toast("Time updated"); } catch {}
    return true;
  }
  if (field === "location" && parsed.where) {
    const whereCipher = typeof encrypt === "function"
      ? await encrypt(parsed.where, owner.key)
      : parsed.where;
    const result = send({ type: "setEventWhere", eventId: ev.id, where: whereCipher }, owner.id);
    if (result === "failed") return fail("location");
    try { toast("Location updated"); } catch {}
    return true;
  }
  return false;
}

function planLocateRaw(hay, raw) {
  const h = String(hay || "");
  const r = String(raw || "").trim();
  if (!r) return null;
  const idx = h.toLowerCase().indexOf(r.toLowerCase());
  if (idx < 0) return null;
  return { start: idx, end: idx + r.length, text: h.slice(idx, idx + r.length) };
}

function chatPlanPromoteSpans(text, opts) {
  if (!chatPlanCandidateClass(text, opts)) return [];
  const now = Number(opts?.now) || Date.now();
  const parsed = planParse(text, now);
  const scoped = !!(opts && typeof opts === "object" && Object.prototype.hasOwnProperty.call(opts, "event"));
  const ev = scoped ? opts.event : null;
  const createMode = !ev;
  const dateOnly = !!(opts && opts.dateOnly);
  const whenOnly = !!(opts && opts.whenOnly);
  const updateFields = createMode ? [] : planUpdateActionsForEvent(text, ev, now).map((action) => action.field);
  const allowed = dateOnly
    ? new Set(["date"])
    : (createMode
      ? new Set(["date", "time", "location"])
      : new Set(whenOnly ? updateFields.filter((field) => field === "date" || field === "time") : updateFields));
  const fieldOf = (name) => (createMode ? "create" : name);
  const spans = [];
  const overlaps = (hit) => spans.some(s => hit.start < s.end && hit.end > s.start);
  const take = (field, loc) => {
    if (!loc) return;
    const hit = { field: fieldOf(field), ...loc };
    if (overlaps(hit)) return;
    spans.push(hit);
  };
  if (allowed.has("date") && parsed.dateRaw) take("date", planLocateRaw(text, parsed.dateRaw));
  if (allowed.has("time") && (parsed.timeRaw || parsed.timeText)) {
    take("time", planLocateRaw(text, parsed.timeRaw) || planLocateRaw(text, String(parsed.timeText).split(/[–-]/)[0]));
  }
  if (allowed.has("location") && (parsed.placeRaw || parsed.where)) {
    take("location", planLocateRaw(text, parsed.placeRaw) || planLocateRaw(text, parsed.where));
  }
  spans.sort((a, b) => a.start - b.start);
  return spans;
}

function chatPlanHitAria(field, raw, parsed) {
  const token = String(raw || "").trim();
  if (field === "create") return token ? `Create event from ${token}` : "Create event";
  if (field === "date") {
    const label = planUpdateDateLabel(parsed?.day);
    return label ? `Update date to ${label}` : "Update date";
  }
  if (field === "time") {
    const label = planUpdateTimeLabel(parsed);
    return label ? `Update time to ${label}` : "Update time";
  }
  if (field === "location") {
    const where = parsed?.where || token;
    return where ? `Update location to ${where}` : "Update location";
  }
  return token;
}

function chatPlanPromoteHTML(text, opts) {
  const src = String(text || "");
  // Plain stretches of text keep their web links clickable.
  const plain = typeof escLinkify === "function" ? escLinkify : (typeof esc === "function" ? esc : (s) => String(s));
  // A highlight never cuts a link in two: drop spans inside a URL.
  const links = [];
  if (typeof CHAT_LINK_RE !== "undefined") {
    CHAT_LINK_RE.lastIndex = 0;
    let lm;
    while ((lm = CHAT_LINK_RE.exec(src))) links.push([lm.index, lm.index + lm[0].length]);
  }
  const spans = chatPlanPromoteSpans(src, opts)
    .filter((sp) => !links.some(([a, b]) => sp.start < b && sp.end > a));
  if (!spans.length) return plain(src);
  const parsed = planParse(src, Number(opts?.now) || Date.now());
  const escape = typeof esc === "function" ? esc : (s) => String(s);
  const marksOnly = !!(opts && opts.marksOnly);
  let html = "";
  let cursor = 0;
  for (const span of spans) {
    html += plain(src.slice(cursor, span.start));
    if (marksOnly) html += `<span class="msg-plan-hit is-mark">${escape(span.text)}</span>`;
    else {
      const label = chatPlanHitAria(span.field, span.text, parsed);
      html += `<button type="button" class="msg-plan-hit" data-plan-promote="${escape(span.field)}" aria-label="${escape(label)}">${escape(span.text)}</button>`;
    }
    cursor = span.end;
  }
  html += plain(src.slice(cursor));
  return html;
}

function chatPlanMarkHTML(text, opts) {
  return "";
}

function handleChatPlanPromoteClick(e, { ch, ownerConn } = {}) {
  const hit = e.target && e.target.closest ? e.target.closest("[data-plan-promote]") : null;
  if (!hit) return false;
  const msgEl = hit.closest(".msg[data-msg-id], .edc-msg[data-msg-id]");
  if (!msgEl || msgEl.dataset.realChat !== "1") return false;
  if (msgEl.classList.contains("is-msg-armed") || msgEl.querySelector(".chat-msg-toolbar")) return true;
  e.preventDefault();
  e.stopPropagation();
  const field = hit.dataset.planPromote;
  const messageId = msgEl.dataset.msgId;
  const conn = ownerConn
    || (typeof activeConn === "function" ? activeConn() : null);
  let channel = ch;
  if (!channel && conn?.messages && messageId) {
    channel = (conn.channels || []).find(c => (conn.messages[c.id] || []).some(m => m.id === messageId)) || null;
  }
  const msg = channel && messageId
    ? (conn?.messages?.[channel.id] || []).find(m => m.id === messageId)
    : null;
  const prompt = hit.getAttribute("aria-label")
    || (field === "create" ? "Create an event from this?" : "Update this event?");
  const okLabel = field === "create" ? "Create" : "Update";
  const run = () => {
    if (field === "create") {
      if (msg && typeof openCreateDraftFromMessage === "function") openCreateDraftFromMessage(msg);
      else if (typeof openCreateDraftFromText === "function") {
        const text = typeof chatMessagePlaintext === "function" && msg
          ? chatMessagePlaintext(msg)
          : (msgEl.querySelector(".msg-body, .edc-text")?.textContent || "");
        openCreateDraftFromText(text);
      }
      return;
    }
    const ev = typeof chatMessageEventContext === "function"
      ? chatMessageEventContext({ msgEl, ownerConn: conn, ch: channel })
      : null;
    if (!ev || !msg) return;
    const text = typeof chatMessagePlaintext === "function"
      ? chatMessagePlaintext(msg)
      : String(msg._text || msg.text || "");
    if (typeof applyPlanUpdateToEvent === "function") {
      void applyPlanUpdateToEvent(ev, field, planParse(text, Number(msg.ts) || Date.now()), conn);
    }
  };
  if (typeof ashConfirm === "function") {
    void ashConfirm(prompt, { ok: okLabel }).then((ok) => { if (ok) run(); });
  } else {
    run();
  }
  return true;
}

function chatPlanCandidateClass(text, opts) {
  const scoped = !!(opts && typeof opts === "object" && Object.prototype.hasOwnProperty.call(opts, "event"));
  const ev = scoped
    ? opts.event
    : (typeof chatMessageEventContext === "function" ? chatMessageEventContext(opts || {}) : null);
  if (ev) {
    if (typeof canEditEvent === "function" && !canEditEvent(ev)) return "";
    if (typeof planUpdateActionsForEvent === "function" && planUpdateActionsForEvent(text, ev, Number(opts?.now) || Date.now()).length) {
      return " is-plan-candidate";
    }
    return "";
  }
  if (!planLooksPromotable(text, Number(opts?.now) || Date.now())) return "";
  if (typeof canCreateEvents === "function" && !canCreateEvents()) return "";
  return " is-plan-candidate";
}

function openCreateDraftPastePopover() {
  const pop = document.getElementById("cd-popover");
  if (!pop) return;
  pop.classList.remove("cd-icon-popover");
  pop.innerHTML = `<div class="cd-popover-kicker"><span>Paste messages</span></div>`
    + `<textarea class="cd-paste-input" id="cd-paste-input" rows="6" placeholder="Paste a WhatsApp chat or any plan text" aria-label="Paste plan text"></textarea>`
    + `<div class="cd-paste-actions"><button type="button" class="cd-create-btn" id="cd-paste-apply">Apply</button></div>`;
  if (typeof pinCreateDraftPopoverTop === "function") pinCreateDraftPopoverTop(pop);
  else pop.classList.add("open");
  const area = pop.querySelector("#cd-paste-input");
  const apply = pop.querySelector("#cd-paste-apply");
  apply?.addEventListener("click", () => {
    const value = area?.value || "";
    if (typeof closeCreateDraftPopovers === "function") closeCreateDraftPopovers();
    if (String(value).trim()) applyPlanTextToOpenDraft(value);
  });
  try { area?.focus(); } catch {}
}

function applyCreateDraftMapPaste(text) {
  const pending = typeof createDraftPending === "function" ? createDraftPending() : null;
  if (!pending || typeof applyCreateDraftLocationValue !== "function") return false;
  if (typeof parseMapLink !== "function" || !parseMapLink(text)) return false;
  applyCreateDraftLocationValue(pending, text);
  const loc = document.getElementById("cd-location-input");
  if (loc) {
    loc.value = (typeof createDraftAllowsMultiLocations === "function" && createDraftAllowsMultiLocations())
      ? (pending.locationQuery || "")
      : (pending.where || "");
  }
  if (typeof markCreateDirty === "function") markCreateDirty("place");
  if (typeof paintCreateDraftFields === "function") paintCreateDraftFields();
  if (pending.mapUrl && !String(pending.where || "").trim()
      && typeof resolveCreateDraftMapName === "function") {
    void resolveCreateDraftMapName(pending);
  }
  return true;
}

async function createDraftPasteFromClipboard() {
  let text = "";
  try {
    if (navigator.clipboard?.readText) text = await navigator.clipboard.readText();
  } catch {}
  if (String(text || "").trim()) {
    if (applyCreateDraftMapPaste(text)) return;
    applyPlanTextToOpenDraft(text);
    return;
  }
  openCreateDraftPastePopover();
}

function wireCreateDraftPaste(layer) {
  if (!layer || layer._planPasteWired) return;
  layer._planPasteWired = true;
  layer.addEventListener("paste", (e) => {
    const text = e.clipboardData?.getData("text/plain") || "";
    if (typeof parseMapLink === "function" && parseMapLink(text)) {
      if (e.target && e.target.id === "cd-location-input") return;
      e.preventDefault();
      applyCreateDraftMapPaste(text);
      return;
    }
    if (!isPlanPasteDump(text)) return;
    e.preventDefault();
    applyPlanTextToOpenDraft(text);
  });
}
