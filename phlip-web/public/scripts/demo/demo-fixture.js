/* demo-fixture.js — relative-date seed for Personal space, Home, and Friends.
 *
 * Globals in:  defaultOfflineAvatar, defaultPersonalMyPlansChannel (at build time)
 * Globals out: DemoFixture
 * Load after:  demo-store.js
 * Load before: demo-boot.js
 *
 * Must not: fetch, use absolute calendar years, or write live membership keys
 */
const DemoFixture = (() => {
  "use strict";

  const YOU_ID = "demo-you";
  const VERSION = 10;

  function avatar(id, name) {
    if (typeof defaultOfflineAvatar === "function") return defaultOfflineAvatar(id, name);
    const letters = String(name || "?").replace(/[^\p{L}\p{N}]/gu, "").slice(0, 2).toUpperCase() || "?";
    return { mode: "letters", text: letters, color: "#a9c8ef" };
  }

  function person(id, name, role) {
    const r = role || "user";
    return {
      id,
      name,
      role: r,
      isHost: r === "host",
      offlineAvatar: avatar(id, name),
    };
  }

  function you(role) {
    return person(YOU_ID, "You", role || "user");
  }

  function atDay(offset, hour, minute) {
    const d = new Date();
    d.setSeconds(0, 0);
    d.setHours(hour, minute || 0, 0, 0);
    d.setDate(d.getDate() + offset);
    return d.getTime();
  }

  function hydrateEvent(ev) {
    if (typeof hydratePlainEvent === "function") hydratePlainEvent(ev);
    else {
      ev._title = ev.title;
      ev._where = ev.where || "";
      ev._details = ev.details || "";
      ev._sticker = ev.sticker || "";
      ev._subtitle = ev.subtitle || "";
    }
    return ev;
  }

  function ev({
    id, title, when, where, details, channelId, createdBy, createdByName,
    rsvps, cat, icon, duration, subtitle, notes,
    confirmAttendance, signupGroups,
  }) {
    const event = {
      id,
      title,
      when,
      where: where || "",
      details: details || "",
      sticker: "",
      stickerBy: null,
      stickerByName: null,
      subtitle: subtitle || "",
      createdBy,
      createdByName,
      createdAt: when - 36e5 * 20,
      rsvps: rsvps || { [createdBy]: "going" },
      channelId,
      whenPrecision: null,
      whenPeriod: null,
      chainOf: null,
      chainStatus: null,
      duration: duration || "2h",
      typeId: null,
      cat: cat || "social",
      icon: icon || null,
      notes: notes || [],
      confirmAttendance: !!confirmAttendance,
      signupGroups: Array.isArray(signupGroups) ? signupGroups : [],
    };
    return hydrateEvent(event);
  }

  function note(userId, name, text, ts, extra) {
    return { userId, name, text, ts, ...extra };
  }

  function msg({ id, channelId, userId, name, text, ts, eventId, eventTitle }) {
    return {
      id, channelId, userId, name, text, ts,
      mentionedUserIds: null,
      mentionedEventIds: eventId ? [eventId] : null,
      eventId: eventId || null,
      eventTitle: eventTitle || null,
      replyToId: null,
    };
  }

  function chatChannel(id, name, extra) {
    return {
      id, name, kind: "chat",
      allowedUserIds: extra?.allowedUserIds ?? null,
      autoIncludeNewMembers: extra?.autoIncludeNewMembers ?? true,
      minRole: "viewer",
      boardId: extra?.boardId || null,
      welcomeChannel: !!extra?.welcomeChannel,
    };
  }

  function eventChannel(id, name, extra) {
    return {
      id, name, kind: "event",
      allowedUserIds: extra?.allowedUserIds ?? null,
      autoIncludeNewMembers: extra?.autoIncludeNewMembers ?? true,
      minRole: "viewer",
      enabledCardIds: null,
      enabledCategoryIds: null,
      enabledLocations: extra?.enabledLocations ?? null,
      pinnedLocationLabel: extra?.pinnedLocationLabel ?? null,
      pinnedUserId: extra?.pinnedUserId ?? null,
      allowAvailability: extra?.allowAvailability ?? true,
      linkedChatChannelId: extra?.linkedChatChannelId || null,
      mirrorActivity: !!extra?.mirrorActivity,
      boardId: extra?.boardId || null,
    };
  }

  function boardRecord(id, name, extra) {
    return {
      id, name,
      icon: extra?.icon || null,
      allowedUserIds: extra?.allowedUserIds ?? null,
      autoIncludeNewMembers: extra?.autoIncludeNewMembers ?? true,
    };
  }

  /** Event + chat pair sharing a board. Returns { board, event, chat }. */
  function boardPair(prefix, name, extra) {
    const rest = extra || {};
    const boardId = rest.id || `${prefix}-board`;
    const eventId = rest.eventId || `${prefix}-ev`;
    const chatId = rest.chatId || `${prefix}-chat`;
    const vis = {
      allowedUserIds: rest.allowedUserIds,
      autoIncludeNewMembers: rest.autoIncludeNewMembers,
      icon: rest.icon,
    };
    const board = boardRecord(boardId, name, vis);
    const chat = chatChannel(chatId, name, { ...vis, boardId: board.id });
    const event = eventChannel(eventId, name, {
      ...rest,
      ...vis,
      boardId: board.id,
      linkedChatChannelId: chat.id,
      mirrorActivity: rest.mirrorActivity !== false,
    });
    return { board, event, chat };
  }

  function welcomeChat(id) {
    return chatChannel(id, "Welcome", { welcomeChannel: true, autoIncludeNewMembers: true });
  }

  function privateAllow(ids) {
    return { allowedUserIds: ids, autoIncludeNewMembers: false };
  }

  function pinLocation(id, label) {
    return eventChannel(id, label, {
      pinnedLocationLabel: label,
      enabledLocations: [label],
      autoIncludeNewMembers: false,
      allowAvailability: false,
    });
  }

  function pinPerson(id, member) {
    return eventChannel(id, member.name, {
      pinnedUserId: member.id,
      autoIncludeNewMembers: false,
      allowAvailability: false,
    });
  }

  function src(connId, channelId) {
    return { connId, channelId };
  }

  function serverSettings(overrides) {
    return {
      allowUserCreateEvents: true,
      createEvents: "everyone",
      createEventTypes: "moderator",
      addLocations: "moderator",
      inviteToGroup: "admin",
      liveProfilePhotos: "off",
      allowProfilePics: false,
      allowUserDraw: true,
      cardTheme: "classic",
      forceJoinCode: false,
      purgeEndedEvents: false,
      chatRetentionDays: 0,
      allowMultiLocations: false,
      allowPinnedPeople: false,
      ...overrides,
    };
  }

  function localConn(partial) {
    const me = partial.me;
    const members = partial.members || [me];
    return {
      id: partial.id,
      url: null,
      name: partial.name,
      token: null,
      pass: null,
      key: null,
      ws: null,
      me,
      hostName: partial.hostName || partial.name,
      boards: partial.boards || [],
      channels: partial.channels || [],
      events: partial.events || [],
      tasks: partial.tasks || [],
      routines: [],
      availabilities: [],
      timeBlocks: [],
      categories: [],
      cardCats: {},
      cardDurations: {},
      removedCards: [],
      eventTypes: [],
      locations: partial.locations || [],
      messages: partial.messages || {},
      members,
      online: members.map(m => m.id),
      pendingReqs: [],
      invite: null,
      notifications: partial.notifications || [],
      reports: [],
      blocked: [],
      serverSettings: partial.serverSettings || serverSettings(),
      iconText: partial.iconText || "",
      serverPic: "",
      joinTag: "",
      status: "online",
      local: true,
      demo: true,
      retryDelay: 0,
    };
  }

  function personalSpace(me) {
    const plansBoard = typeof defaultPersonalMyPlansBoard === "function"
      ? defaultPersonalMyPlansBoard()
      : boardRecord("pch-board", "My plans");
    const plans = typeof defaultPersonalMyPlansChannel === "function"
      ? defaultPersonalMyPlansChannel()
      : eventChannel("pch", "My plans", { boardId: plansBoard.id });
    const plansChat = typeof defaultPersonalMyPlansChat === "function"
      ? defaultPersonalMyPlansChat()
      : chatChannel("pch-chat", "My plans", { boardId: plansBoard.id });
    plans.boardId = plansBoard.id;
    plansChat.boardId = plansBoard.id;
    plans.linkedChatChannelId = plansChat.id;
    const accepted = {
      id: (typeof personalAcceptedId === "function" ? personalAcceptedId() : "pacc"),
      kind: "event",
      name: "Accepted",
      hidden: true,
    };
    const home = boardPair("p-home", "Home", { eventId: "p-home" });
    const friends = boardPair("p-friends", "Friends", { eventId: "p-friends" });
    const dentist = ev({
      id: "pev-dentist",
      title: "Dentist",
      when: atDay(2, 9, 30),
      where: "Town",
      details: "Check-up — block the morning.",
      channelId: plans.id,
      createdBy: me.id,
      createdByName: me.name,
      rsvps: { [me.id]: "going" },
      cat: "other",
      icon: "custom",
      duration: "1h",
    });
    const read = ev({
      id: "pev-read",
      title: "Quiet reading hour",
      when: atDay(5, 20, 0),
      where: "Home",
      details: "Phone in another room.",
      channelId: plans.id,
      createdBy: me.id,
      createdByName: me.name,
      rsvps: { [me.id]: "going" },
      cat: "entertainment",
      icon: "film",
      duration: "1h",
    });
    const study = ev({
      id: "pev-study",
      title: "Study block",
      when: atDay(1, 14, 0),
      where: "Study",
      details: "Chapter notes before book club.",
      channelId: plans.id,
      createdBy: me.id,
      createdByName: me.name,
      rsvps: { [me.id]: "going" },
      cat: "other",
      icon: "custom",
      duration: "2h",
    });
    return localConn({
      id: "personal",
      name: "Personal",
      hostName: "this device",
      iconText: "",
      me,
      members: [me],
      boards: [plansBoard, home.board, friends.board],
      channels: [
        plans, plansChat, home.event, home.chat,
        friends.event, friends.chat, accepted,
        pinLocation("p-pin-home", "Home"),
        pinLocation("p-pin-study", "Study"),
      ],
      events: [dentist, read, study],
      locations: [
        { label: "Home", categoryId: "other" },
        { label: "Study", categoryId: "other" },
        { label: "Town", categoryId: "other" },
      ],
      messages: {
        [plansChat.id]: [
          msg({
            id: "p-m1", channelId: plansChat.id, userId: me.id, name: me.name,
            text: "Keep Tuesday afternoon for the study block", ts: atDay(0, 8, 40),
            eventId: study.id, eventTitle: study.title,
          }),
          msg({
            id: "p-m2", channelId: plansChat.id, userId: me.id, name: me.name,
            text: "Dentist Tuesday morning — keep it clear", ts: atDay(0, 8, 48),
            eventId: dentist.id, eventTitle: dentist.title,
          }),
          msg({
            id: "p-m3", channelId: plansChat.id, userId: me.id, name: me.name,
            text: "Reading hour stays in the evening, phone in another room", ts: atDay(0, 8, 55),
            eventId: read.id, eventTitle: read.title,
          }),
        ],
        [plans.id]: [
          msg({
            id: "p-em1", channelId: plans.id, userId: me.id, name: me.name,
            text: "Chapter notes before book club — don't move this", ts: atDay(0, 8, 42),
            eventId: study.id, eventTitle: study.title,
          }),
        ],
      },
    });
  }

  /** Family — a single shared board, plus per-person "follow" boards for Mum & Dad. */
  function familyGroup(me) {
    const mum = person("demo-mum", "Mum", "host");
    const dad = person("demo-dad", "Dad", "user");
    const welcome = welcomeChat("fa-welcome");
    const family = boardPair("fa", "Family", { eventId: "fa-events", chatId: "fa-chat" });
    const roast = ev({
      id: "fa-roast",
      title: "Sunday roast",
      when: atDay(((7 - new Date().getDay()) % 7) || 7, 13, 0),
      where: "Home",
      details: "Yorkshire puddings if someone remembers the tin.",
      channelId: family.event.id,
      createdBy: mum.id,
      createdByName: mum.name,
      rsvps: { [mum.id]: "going", [dad.id]: "going", [me.id]: "going" },
      cat: "food",
      icon: "dinner",
      duration: "3h",
    });
    const walk = ev({
      id: "fa-walk",
      title: "Park walk",
      when: atDay(3, 11, 0),
      where: "Park",
      details: "Loop and coffee after.",
      channelId: family.event.id,
      createdBy: dad.id,
      createdByName: dad.name,
      rsvps: { [dad.id]: "going", [mum.id]: "going" },
      cat: "social",
      icon: "party",
      duration: "1h",
    });
    const bins = ev({
      id: "fa-bins",
      title: "Bins out",
      when: atDay(1, 21, 0),
      where: "Home",
      details: "Recycling and garden waste. Don't leave it for Mum.",
      channelId: family.event.id,
      createdBy: mum.id,
      createdByName: mum.name,
      rsvps: { [mum.id]: "going", [me.id]: "going" },
      cat: "other",
      icon: "custom",
      duration: "15m",
    });
    return localConn({
      id: "demo-family",
      name: "Home",
      iconText: "Ho",
      me,
      members: [mum, dad, me],
      // §pinned-people — Mum & Dad each get a followable board of their own plans.
      serverSettings: serverSettings({ allowPinnedPeople: true }),
      boards: [family.board],
      channels: [
        welcome,
        family.event, family.chat,
        pinPerson("fa-pin-mum", mum),
        pinPerson("fa-pin-dad", dad),
      ],
      events: [roast, walk, bins],
      locations: [
        { label: "Home", categoryId: "other" },
        { label: "Park", categoryId: "entertainment" },
        { label: "Coffee Shop", categoryId: "food" },
      ],
      messages: {
        [welcome.id]: [
          msg({
            id: "fa-m1", channelId: welcome.id, userId: mum.id, name: mum.name,
            text: "Roast is on — tell me if you're bringing anyone", ts: atDay(0, 9, 15),
            eventId: roast.id, eventTitle: roast.title,
          }),
          msg({
            id: "fa-m2", channelId: welcome.id, userId: dad.id, name: dad.name,
            text: "I'll do the walk mid-week if the rain holds off", ts: atDay(0, 9, 40),
          }),
          msg({
            id: "fa-m3", channelId: welcome.id, userId: mum.id, name: mum.name,
            text: "Bins tomorrow night — whoever is home first", ts: atDay(0, 10, 2),
            eventId: bins.id, eventTitle: bins.title,
          }),
        ],
        [family.chat.id]: [
          msg({
            id: "fa-c1", channelId: family.chat.id, userId: mum.id, name: mum.name,
            text: "Who's around for the roast?", ts: atDay(0, 9, 18),
            eventId: roast.id, eventTitle: roast.title,
          }),
          msg({
            id: "fa-c2", channelId: family.chat.id, userId: dad.id, name: dad.name,
            text: "I'll pick up the meat on the way home", ts: atDay(0, 9, 32),
            eventId: roast.id, eventTitle: roast.title,
          }),
          msg({
            id: "fa-c3", channelId: family.chat.id, userId: dad.id, name: dad.name,
            text: "Park walk mid-week if the rain holds off", ts: atDay(0, 9, 44),
            eventId: walk.id, eventTitle: walk.title,
          }),
          msg({
            id: "fa-c4", channelId: family.chat.id, userId: mum.id, name: mum.name,
            text: "I'll come if we're back from the shops", ts: atDay(0, 9, 50),
            eventId: walk.id, eventTitle: walk.title,
          }),
          msg({
            id: "fa-c5", channelId: family.chat.id, userId: mum.id, name: mum.name,
            text: "Bins tomorrow night — whoever is home first", ts: atDay(0, 10, 4),
            eventId: bins.id, eventTitle: bins.title,
          }),
          msg({
            id: "fa-c6", channelId: family.chat.id, userId: me.id, name: me.name,
            text: "I'll do the bins on the way out", ts: atDay(0, 10, 12),
            eventId: bins.id, eventTitle: bins.title,
          }),
        ],
        [family.event.id]: [
          msg({
            id: "fa-e1", channelId: family.event.id, userId: mum.id, name: mum.name,
            text: "Yorkshire puddings if someone remembers the tin", ts: atDay(0, 9, 20),
            eventId: roast.id, eventTitle: roast.title,
          }),
        ],
      },
    });
  }

  /** Friends — a central London hangout everyone shares, plus a uni sub-group and a home sub-group. */
  function friendsGroup(me) {
    const sam = person("demo-sam", "Sam", "host");
    const jo = person("demo-jo", "Jo", "user");
    const ada = person("demo-ada", "Ada", "user");
    const leo = person("demo-leo", "Leo", "user");
    const zara = person("demo-zara", "Zara", "user");
    const uniIds = [me.id, sam.id, jo.id, leo.id];
    const homeIds = [me.id, sam.id, ada.id, zara.id];
    const welcome = welcomeChat("fr-welcome");
    const CENTRAL_PLACE = "The Anchor, Borough";
    const london = boardPair("fr-london", "London meetup", { eventId: "fr-london", chatId: "fr-london-chat" });
    const uni = boardPair("fr-uni", "Uni friends", {
      ...privateAllow(uniIds),
      eventId: "fr-uni",
      chatId: "fr-uni-chat",
    });
    const home = boardPair("fr-home", "Home friends", {
      ...privateAllow(homeIds),
      eventId: "fr-home",
      chatId: "fr-home-chat",
    });
    const quiz = ev({
      id: "fr-quiz",
      title: "Pub quiz night",
      when: atDay(1, 19, 30),
      where: CENTRAL_PLACE,
      details: "Usual corner table. First round on Sam.",
      channelId: london.event.id,
      createdBy: sam.id,
      createdByName: sam.name,
      rsvps: { [sam.id]: "going", [jo.id]: "going", [ada.id]: "going", [me.id]: "going", [leo.id]: "going", [zara.id]: "going" },
      cat: "social",
      icon: "party",
      duration: "3h",
      notes: [
        note(jo.id, jo.name, "I can do 19:30 if we eat first", atDay(0, 12, 10)),
        note(sam.id, sam.name, "The Anchor it is, as always", atDay(0, 12, 22), { activity: "rsvp", status: "going" }),
      ],
    });
    const birthday = ev({
      id: "fr-birthday",
      title: "Zara's birthday drinks",
      when: atDay(4, 20, 0),
      where: CENTRAL_PLACE,
      details: "Same spot as always. Chip in for a cake before Thursday.",
      channelId: london.event.id,
      createdBy: zara.id,
      createdByName: zara.name,
      rsvps: { [zara.id]: "going", [sam.id]: "going", [jo.id]: "going", [ada.id]: "going", [leo.id]: "out" },
      cat: "social",
      icon: "party",
      duration: "3h",
    });
    const uniDinner = ev({
      id: "fr-uni-dinner",
      title: "Uni mates curry night",
      when: atDay(((7 - new Date().getDay()) % 7) || 7, 19, 0),
      where: "Brick Lane",
      details: "Same table Leo booked last time. Byo appetite.",
      channelId: uni.event.id,
      createdBy: leo.id,
      createdByName: leo.name,
      rsvps: { [leo.id]: "going", [sam.id]: "going", [jo.id]: "going", [me.id]: "going" },
      cat: "food",
      icon: "dinner",
      duration: "2h",
    });
    const homeBbq = ev({
      id: "fr-home-bbq",
      title: "Back home BBQ",
      when: atDay(6, 15, 0),
      where: "The Fox, hometown",
      details: "Whoever's back this weekend — garden if it's dry.",
      channelId: home.event.id,
      createdBy: ada.id,
      createdByName: ada.name,
      rsvps: { [ada.id]: "going", [sam.id]: "going", [zara.id]: "going", [me.id]: "going" },
      cat: "food",
      icon: "dinner",
      duration: "3h",
    });
    return localConn({
      id: "demo-friends",
      name: "Friends",
      iconText: "Fr",
      me,
      members: [sam, me, jo, ada, leo, zara],
      boards: [london.board, uni.board, home.board],
      channels: [
        welcome,
        london.event, uni.event, home.event,
        london.chat, uni.chat, home.chat,
        pinLocation("fr-pin-anchor", CENTRAL_PLACE),
      ],
      events: [quiz, birthday, uniDinner, homeBbq],
      locations: [
        { label: CENTRAL_PLACE, categoryId: "food" },
        { label: "Brick Lane", categoryId: "food" },
        { label: "The Fox, hometown", categoryId: "food" },
      ],
      messages: {
        [london.chat.id]: [
          msg({
            id: "fr-m1", channelId: london.chat.id, userId: sam.id, name: sam.name,
            text: "Pub quiz tomorrow 7:30 at The Anchor?", ts: atDay(0, 11, 40),
            eventId: quiz.id, eventTitle: quiz.title,
          }),
          msg({
            id: "fr-m2", channelId: london.chat.id, userId: zara.id, name: zara.name,
            text: "Yeah I'm around, just say when", ts: atDay(0, 11, 55),
            eventId: quiz.id, eventTitle: quiz.title,
          }),
          msg({
            id: "fr-m3", channelId: london.chat.id, userId: zara.id, name: zara.name,
            text: "Birthday drinks Thursday at the same spot — chip in for a cake", ts: atDay(0, 12, 5),
            eventId: birthday.id, eventTitle: birthday.title,
          }),
          msg({
            id: "fr-m4", channelId: london.chat.id, userId: sam.id, name: sam.name,
            text: "I'm in. I'll sort the cake if someone books the corner", ts: atDay(0, 12, 18),
            eventId: birthday.id, eventTitle: birthday.title,
          }),
        ],
        [london.event.id]: [
          msg({
            id: "fr-e1", channelId: london.event.id, userId: jo.id, name: jo.name,
            text: "I can do 19:30 if we eat first", ts: atDay(0, 12, 10),
            eventId: quiz.id, eventTitle: quiz.title,
          }),
          msg({
            id: "fr-e2", channelId: london.event.id, userId: sam.id, name: sam.name,
            text: "The Anchor it is, as always", ts: atDay(0, 12, 22),
            eventId: quiz.id, eventTitle: quiz.title,
          }),
          msg({
            id: "fr-e3", channelId: london.event.id, userId: jo.id, name: jo.name,
            text: "Shall we meet at 7 at the usual corner?", ts: atDay(0, 12, 35),
            eventId: quiz.id, eventTitle: quiz.title,
          }),
        ],
        [uni.chat.id]: [
          msg({
            id: "fr-um1", channelId: uni.chat.id, userId: leo.id, name: leo.name,
            text: "Curry night is locked in, Brick Lane as usual", ts: atDay(0, 10, 5),
            eventId: uniDinner.id, eventTitle: uniDinner.title,
          }),
          msg({
            id: "fr-um2", channelId: uni.chat.id, userId: jo.id, name: jo.name,
            text: "I'll come from work, might be a bit late", ts: atDay(0, 10, 18),
            eventId: uniDinner.id, eventTitle: uniDinner.title,
          }),
        ],
        [home.chat.id]: [
          msg({
            id: "fr-hm1", channelId: home.chat.id, userId: ada.id, name: ada.name,
            text: "BBQ Saturday if the weather holds — garden's free", ts: atDay(0, 9, 40),
            eventId: homeBbq.id, eventTitle: homeBbq.title,
          }),
          msg({
            id: "fr-hm2", channelId: home.chat.id, userId: sam.id, name: sam.name,
            text: "I'll bring burgers, someone else do drinks", ts: atDay(0, 9, 52),
            eventId: homeBbq.id, eventTitle: homeBbq.title,
          }),
        ],
      },
    });
  }


  function build() {
    const me = you("user");
    const conns = {
      personal: personalSpace(me),
      "demo-friends": friendsGroup(me),
      "demo-family": familyGroup(me),
    };
    return {
      fixtureVersion: VERSION,
      me,
      conns,
      nav: { connId: "demo-friends", view: { kind: "events" }, eventChannelId: null },
      links: {
        events: [
          { connId: "personal", channelId: "p-home", sources: [src("demo-family", "fa-events")] },
          { connId: "personal", channelId: "p-friends", sources: [src("demo-friends", "fr-london")] },
        ],
        chats: [],
      },
    };
  }

  return { build, YOU_ID, VERSION };
})();
window.DemoFixture = DemoFixture;
