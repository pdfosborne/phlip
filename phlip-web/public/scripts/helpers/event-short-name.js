/* Shared compact labels; persisted names use the same encryption as event titles. */
function eventNameCharacters(value) {
  const text = String(value || "");
  if (typeof Intl.Segmenter === "function") return [...new Intl.Segmenter(undefined, { granularity: "grapheme" }).segment(text)].map(x => x.segment);
  // Older WebViews: retain combining marks, emoji modifiers and ZWJ sequences.
  return text.match(/\p{Regional_Indicator}{2}|\P{Mark}(?:\p{Mark}|[\uFE0E\uFE0F\u{1F3FB}-\u{1F3FF}])*(?:\u200D\P{Mark}(?:\p{Mark}|[\uFE0E\uFE0F\u{1F3FB}-\u{1F3FF}])*)*|./gu) || [];
}

function eventShortNameInput(value) {
  return eventNameCharacters(String(value || "").replace(/\s+/g, " ").trim()).slice(0, 14).join("");
}

function compactDestinationName(value, fits = text => eventNameCharacters(text).length <= 14) {
  let text = String(value || "").replace(/\s+/g, " ").trim();
  while (text.includes(" ") && !fits(text)) text = text.slice(0, text.lastIndexOf(" "));
  const characters = eventNameCharacters(text);
  while (characters.length && !fits(characters.join(""))) characters.pop();
  return characters.join("");
}

function eventShortName(ev) {
  const custom = typeof ev?._shortName === "string" ? ev._shortName : "";
  if (custom.trim()) return eventShortNameInput(custom);
  const title = typeof eventDisplayTitle === "function" ? eventDisplayTitle(ev) : (ev?._title || "Event");
  return compactDestinationName(String(title || "Event").trim().split(/\s+/).slice(0, 2).join(" "));
}
