/* channel-events-board.js — events board entry: scope the channel, then render the Timeline.
 * Globals out: renderEvents
 * The Month / Week / Day board is archived (archive/web/A-month-week-day).
 * Load after: channel-open-pitch.js; before: channel-ticket-cards.js
 */

function renderEvents(view, g, channel) {
  view.style.cssText = "display:flex;flex-direction:column;flex:1;min-height:0";

  const eventChannels = g.channels.filter(c =>
    c.kind === "event"
    && !(typeof PersonalSpace !== "undefined" && PersonalSpace.isHiddenChannel(c, activeConn())));
  const multi = !channel && eventChannels.length > 1;
  if (multi) {
    if (!S.activeEventChannelId || !eventChannels.some(c => c.id === S.activeEventChannelId))
      S.activeEventChannelId = eventChannels[0].id;
  } else {
    S.activeEventChannelId = channel ? channel.id : (eventChannels[0]?.id || null);
  }
  const targetChannel = channel || eventChannels.find(c => c.id === S.activeEventChannelId) || null;
  // Meta board (Events sidebar) keeps its own title — don't show the create-target agenda name.
  const isMetaBoard = !channel;
  $("#view-title").textContent = headerTitle(
    isMetaBoard ? "All events" : (targetChannel
      ? (typeof channelHeadTitle === "function" ? channelHeadTitle(targetChannel) : `# ${targetChannel.name}`)
      : "All events")
  );
  if (typeof syncViewTitleLinkedMarks === "function") {
    syncViewTitleLinkedMarks(isMetaBoard ? null : targetChannel);
  }

  // Personal Events board: opt-in linked calendars (Plans, Me, remotes).
  // Otherwise scope to the selected calendar (+ its own linked feeds).
  const metaLinks = PersonalSpace.isPersonal(activeConn()) && !channel
    ? directLinkedEventSourcesFor("personal", PERSONAL_META_EVENTS_ID)
    : [];
  const events = metaLinks.length
    ? collectPersonalMetaEvents()
    : channel
      ? collectChannelViewEvents(channel)
      : (PersonalSpace.isPersonal(activeConn()) && targetChannel)
        ? collectChannelViewEvents(targetChannel)
        : g.events;
  renderTimelineView(view, g, channel, {
    targetChannel, eventChannels, events, isMetaBoard,
  });
}
