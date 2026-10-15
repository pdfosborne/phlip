package app.phlip.server

import org.json.JSONArray
import org.json.JSONObject
import java.util.Calendar

/** Event create/delete, approval, attendance, and clone registration. */
internal class EventLifecycleHandler(
    private val s: EventCommandSupport,
) {
    fun cmdCreateEvent(user: User, m: JSONObject) {
        val ch = s.state.channels.find { it.id == m.optString("channelId") } ?: return
        if (ch.kind != "event" || !s.authorization.canCreateEventsInChannel(user, ch)) return
        // § pinned location / people channels are read-only aggregation views —
        // events must be created in a normal event channel and get aggregated in.
        if (ch.pinnedLocationLabel != null || ch.pinnedUserId != null) return
        val locationLabelId = sanitizeLocationLabelId(m.optString("locationLabelId"), s.state.locations)
        val typeId = m.optString("typeId").trim().take(40).ifEmpty { null }
        val type = typeId?.let { id -> s.state.eventTypes.find { it.id == id } }
        if (type != null && !s.authorization.canCreateType(user, type)) return
        val isChain = m.optString("chainOf").isNotEmpty()
        if (isChain && !s.authorization.canChannel(user, ch, PERM_FLAG_CHAINS) &&
            !s.authorization.canManageServer(user)
        ) return
        val cat = (type?.categoryId ?: m.optString("cat").trim().take(24))
            .takeIf { !it.isNullOrEmpty() && s.state.categories.any { c -> c.id == it } }
        val title = opaqueCiphertext(m.optString("title")).ifEmpty { return }
        val whenMs = m.optLong("when").takeIf { it != 0L } ?: return
        val precision = m.optString("whenPrecision").ifEmpty { null }
            ?.takeIf { it in listOf("day", "period", "unconfirmed") }
        val period = m.optString("whenPeriod").ifEmpty { null }
            ?.takeIf { precision == "period" && it in listOf("morning", "afternoon", "evening") }
        val chainOf = m.optString("chainOf").ifEmpty { null }
            ?.takeIf { id -> s.state.events.any { it.id == id && it.channelId == ch.id } }
        val clientId = m.optString("id").trim().take(24).ifEmpty { null }
        if (clientId != null) {
            val existing = s.state.events.find { it.id == clientId }
            if (existing != null) {
                if (existing.channelId == ch.id && existing.createdBy == user.id) {
                    s.operations.broadcastToChannel(ch, JSONObject().put("type", "eventCreated")
                        .put("event", JSONObject(s.gson.toJson(existing))))
                }
                return
            }
        }
        val stickerRaw = opaqueCiphertext(m.optString("sticker")).ifEmpty { null }
        if (stickerRaw != null &&
            !s.authorization.canChannel(user, ch, PERM_FLAG_STICKERS) &&
            !s.authorization.canManageServer(user)
        ) return
        val subtitleRaw = opaqueCiphertext(m.optString("subtitle")).ifEmpty { null }
        var icon = clampIcon(m.optString("icon"))
        if (icon?.startsWith("d:") == true && !s.authorization.canUserDraw()) icon = null
        val ev = Event(
            id = clientId ?: s.idGenerator(), title = title, `when` = whenMs,
            icon = icon,
            where = opaqueCiphertext(m.optString("where")),
            details = opaqueCiphertext(m.optString("details")),
            createdBy = user.id, createdByName = user.name, createdAt = System.currentTimeMillis(),
            rsvps = mutableMapOf(user.id to "going"),
            channelId = ch.id,
            whenPrecision = precision, whenPeriod = period,
            chainOf = chainOf,
            chainStatus = if (chainOf != null) "proposal" else null,
            sticker = stickerRaw,
            subtitle = subtitleRaw,
            shortName = opaqueCiphertext(m.optString("shortName")).ifEmpty { null },
            duration = m.optString("duration").trim().take(16).takeIf { it in EVENT_DURATION_CODES },
            typeId = type?.id,
            cat = cat,
            locationLabelId = locationLabelId,
            eventCardStyle = user.eventCardStyle ?: defaultEventCardStyle(),
            confirmAttendance = m.optBoolean("confirmAttendance", false),
        )
        if (ev.sticker != null) {
            ev.stickerBy = user.id
            ev.stickerByName = user.name
        }
        if ((s.state.eventsRequireApprovalDefault || s.authorization.roleRequiresApproval(user, ch)) &&
            !s.authorization.canApproveEvents(user, ch)
        ) {
            ev.approvalStatus = "pending"
        }
        s.state.events.add(ev); s.operations.save()
        val created = JSONObject().put("type", "eventCreated")
            .put("event", JSONObject(s.gson.toJson(ev)))
        if (upsertDrawnCard(s.state, user, ev.icon)) {
            s.operations.save()
            created.put(
                "reactionCards",
                JSONArray(s.gson.toJson(s.state.reactionCards ?: emptyList<ReactionCardEntry>())),
            )
        }
        s.operations.broadcastToChannel(ch, created)
        if (ev.approvalStatus == "pending") s.notifyApprovers(ch, ev, user)
        else s.operations.onEventCreated(ev, ch)
        s.syncPinnedViewersIfNeeded(ev)
        if (ev.approvalStatus != "blocked" && ev.approvalStatus != "pending") {
            s.operations.clearOverlappingAvailabilities(ev)
        }
    }

    fun cmdApproveEvent(user: User, m: JSONObject): Boolean {
        val ev = s.state.events.find { it.id == m.optString("eventId") } ?: return false
        val ch = s.state.channels.find { it.id == ev.channelId } ?: return false
        if (ev.approvalStatus != "pending") return false
        if (!s.authorization.canApproveEvents(user, ch)) return false
        ev.approvalStatus = null
        s.operations.save()
        s.operations.broadcastToChannel(ch, JSONObject().put("type", "eventApprovalUpdated")
            .put("eventId", ev.id).put("approvalStatus", JSONObject.NULL))
        s.operations.pushSyncToAll()
        s.autoResolveOverlaps(ch, ev, user)
        s.operations.clearOverlappingAvailabilities(ev)
        return true
    }

    fun cmdBlockEvent(user: User, m: JSONObject): Boolean {
        val ev = s.state.events.find { it.id == m.optString("eventId") } ?: return false
        val ch = s.state.channels.find { it.id == ev.channelId } ?: return false
        if (ev.approvalStatus != "pending") return false
        if (!s.authorization.canApproveEvents(user, ch)) return false
        val note = m.optString("note").trim().take(MAX_REPORT_NOTE).ifEmpty { null }
        val altSuggestion = m.optString("altSuggestion").trim().take(MAX_REPORT_NOTE).ifEmpty { null }
        s.blockPendingEvent(ch, ev, note, altSuggestion, user)
        return true
    }

    fun cmdRsvp(user: User, m: JSONObject) {
        val ev = s.state.events.find { it.id == m.optString("eventId") } ?: return
        val allowed = if (ev.confirmAttendance) listOf("signedUp", "out") else listOf("going", "out")
        val status = m.optString("status").takeIf { it in allowed } ?: return
        val ch = s.state.channels.find { it.id == ev.channelId } ?: return
        if (!s.authorization.canChannel(user, ch, PERM_FLAG_RSVP)) return
        applyMemberRsvp(user, ev, ch, user.id, status, activityFrom = user)
    }

    fun cmdSetMemberRsvp(user: User, m: JSONObject) {
        val ev = s.state.events.find { it.id == m.optString("eventId") } ?: return
        if (!s.authorization.canEditEvent(user, ev)) return
        val targetId = m.optString("userId").trim().ifEmpty { return }
        if (targetId == user.id) return
        val status = m.optString("status").takeIf { it in listOf("going", "signedUp", "out") } ?: return
        val ch = s.state.channels.find { it.id == ev.channelId } ?: return
        if (s.state.users.values.none { it.id == targetId } && !ev.rsvps.containsKey(targetId)) return
        applyMemberRsvp(user, ev, ch, targetId, status, activityFrom = user)
    }

    private fun applyMemberRsvp(
        actor: User,
        ev: Event,
        ch: Channel,
        targetId: String,
        status: String,
        activityFrom: User,
    ) {
        val previous = ev.rsvps[targetId]
        ev.rsvps[targetId] = status
        ev.addedBy?.remove(targetId)
        if (status == "out") dropFromSignupGroups(ev, targetId)
        s.operations.broadcastToChannel(ch, JSONObject().put("type", "rsvpUpdated")
            .put("eventId", ev.id).put("userId", targetId).put("status", status))
        if (previous != status && targetId == activityFrom.id) {
            s.appendEventActivity(ch, ev, EventNote(
                activityFrom.id, activityFrom.name, "", System.currentTimeMillis(),
                activity = "rsvp", status = status,
            ))
        }
        s.operations.save()
        s.syncPinnedViewersIfNeeded(ev)
    }

    fun cmdSetEventConfirmAttendance(user: User, m: JSONObject) {
        val ev = s.state.events.find { it.id == m.optString("eventId") } ?: return
        val ch = s.state.channels.find { it.id == ev.channelId } ?: return
        if (!s.authorization.canEditEvent(user, ev)) return
        val next = m.optBoolean("confirmAttendance", false)
        if (ev.confirmAttendance == next) return
        ev.confirmAttendance = next
        convertConfirmAttendanceRsvps(ev, next)
        s.operations.save()
        val rsvpsJson = JSONObject()
        for ((id, status) in ev.rsvps) rsvpsJson.put(id, status)
        s.operations.broadcastToChannel(ch, JSONObject().put("type", "eventConfirmAttendanceUpdated")
            .put("eventId", ev.id)
            .put("confirmAttendance", next)
            .put("rsvps", rsvpsJson))
    }

    private fun convertConfirmAttendanceRsvps(ev: Event, next: Boolean) {
        val organiser = ev.createdBy
        for (id in ev.rsvps.keys.toList()) {
            val status = ev.rsvps[id] ?: continue
            if (!next && status == "signedUp") ev.rsvps[id] = "going"
            else if (next && status == "going" && id != organiser) ev.rsvps[id] = "signedUp"
        }
    }

    fun cmdSetEventSignupGroups(user: User, m: JSONObject) {
        val ev = s.state.events.find { it.id == m.optString("eventId") } ?: return
        val ch = s.state.channels.find { it.id == ev.channelId } ?: return
        if (!s.authorization.canEditEvent(user, ev)) return
        val arr = m.optJSONArray("signupGroups") ?: JSONArray()
        val groups = mutableListOf<EventSignupGroup>()
        for (i in 0 until arr.length()) {
            val o = arr.optJSONObject(i) ?: continue
            val id = o.optString("id").trim().take(24).ifEmpty { s.idGenerator() }
            if (groups.any { it.id == id }) continue
            val name = o.optString("name").trim().take(40).ifEmpty {
                var n = 1
                val used = groups.map { it.name.trim().lowercase() }.toSet()
                while (used.contains("group $n")) n += 1
                "Group $n"
            }
            val memberIds = mutableListOf<String>()
            val ids = o.optJSONArray("memberIds")
            if (ids != null) for (j in 0 until ids.length()) {
                val uid = ids.optString(j).trim()
                if (uid.isNotEmpty()) memberIds.add(uid)
            }
            groups.add(EventSignupGroup(id, name, memberIds))
        }
        ev.signupGroups = groups.takeIf { it.isNotEmpty() }
        sanitizeSignupGroups(ev)
        broadcastSignupGroups(ch, ev)
    }

    fun cmdAssignEventGroup(user: User, m: JSONObject) {
        val ev = s.state.events.find { it.id == m.optString("eventId") } ?: return
        val ch = s.state.channels.find { it.id == ev.channelId } ?: return
        if (!s.authorization.canEditEvent(user, ev)) return
        val targetId = m.optString("userId").trim().ifEmpty { return }
        val groupId = m.optString("groupId").trim().takeIf { it.isNotEmpty() }
        val groups = ev.signupGroups ?: return
        dropFromSignupGroups(ev, targetId)
        if (groupId != null) {
            val group = groups.find { it.id == groupId }
            val status = ev.rsvps[targetId]
            if (group != null && (status == "going" || status == "signedUp")) {
                group.memberIds.add(targetId)
            }
        }
        sanitizeSignupGroups(ev)
        broadcastSignupGroups(ch, ev)
    }

    private fun dropFromSignupGroups(ev: Event, userId: String) {
        ev.signupGroups?.forEach { it.memberIds.removeAll { id -> id == userId } }
    }

    private fun sanitizeSignupGroups(ev: Event) {
        val groups = ev.signupGroups ?: return
        val eligible = ev.rsvps.filterValues { it == "going" || it == "signedUp" }.keys
        val seen = mutableSetOf<String>()
        for (group in groups) {
            group.name = group.name.trim().take(40).ifEmpty { "Group" }
            group.memberIds.removeAll { id -> id !in eligible || !seen.add(id) }
        }
    }

    private fun broadcastSignupGroups(ch: Channel, ev: Event) {
        s.operations.save()
        s.operations.broadcastToChannel(ch, JSONObject().put("type", "eventSignupGroupsUpdated")
            .put("eventId", ev.id)
            .put("signupGroups", JSONArray(s.gson.toJson(ev.signupGroups ?: emptyList<EventSignupGroup>()))))
    }

    fun cmdAddPerson(user: User, m: JSONObject) {
        val targetId = m.optString("userId").ifEmpty { return }
        val target = s.state.users.values.find { it.id == targetId } ?: return
        val ev = s.state.events.find { it.id == m.optString("eventId") } ?: return
        val ch = s.state.channels.find { it.id == ev.channelId } ?: return
        if (!s.authorization.canCreateEventsInChannel(user, ch)) return
        if (!s.authorization.channelVisible(ch, target)) return
        ev.rsvps[targetId] = "going"
        val added = ev.addedBy ?: mutableMapOf<String, String>().also { ev.addedBy = it }
        added[targetId] = user.id
        s.operations.broadcastToChannel(ch, JSONObject().put("type", "rsvpUpdated")
            .put("eventId", ev.id).put("userId", targetId).put("status", "going").put("addedBy", user.id))
        if (targetId != user.id) {
            s.appendEventActivity(ch, ev, EventNote(
                user.id, user.name, "", System.currentTimeMillis(),
                activity = "addPerson", targetUserId = targetId, targetName = target.name,
            ))
        }
        s.operations.save()
        if (targetId != user.id) {
            s.operations.pushNotification(Notification(s.idGenerator(), targetId, "addedToEvent",
                eventId = ev.id, fromUserId = user.id, fromUserName = user.name,
                ts = System.currentTimeMillis()))
        }
        s.syncPinnedViewersIfNeeded(ev)
    }

    fun cmdRemovePerson(user: User, m: JSONObject) {
        val targetId = m.optString("userId").ifEmpty { return }
        val ev = s.state.events.find { it.id == m.optString("eventId") } ?: return
        if (!s.authorization.canEditEvent(user, ev)) return
        val ch = s.state.channels.find { it.id == ev.channelId } ?: return
        if (targetId.startsWith("guest:")) {
            val label = targetId.removePrefix("guest:")
            if (label.isEmpty()) return
            val guests = ev.bridgeGuests ?: return
            val key = guests.keys.firstOrNull { it.equals(label, ignoreCase = true) } ?: return
            guests.remove(key)
            if (guests.isEmpty()) ev.bridgeGuests = null
            s.operations.broadcastToChannel(ch, JSONObject().put("type", "bridgeRsvpUpdated")
                .put("eventId", ev.id).put("guest", key).put("removed", true)
                .put("hostPlusN", ev.bridgeHostPlusN))
            s.appendEventActivity(ch, ev, EventNote(
                user.id, user.name, "", System.currentTimeMillis(),
                activity = "removePerson", targetName = key,
            ))
            s.operations.save()
            return
        }
        if (!ev.rsvps.containsKey(targetId)) return
        val targetName = s.state.users.values.find { it.id == targetId }?.name
            ?: ev.notes?.lastOrNull { it.userId == targetId }?.name ?: "someone"
        ev.rsvps.remove(targetId)
        ev.addedBy?.remove(targetId)
        dropFromSignupGroups(ev, targetId)
        s.operations.broadcastToChannel(ch, JSONObject().put("type", "rsvpUpdated")
            .put("eventId", ev.id).put("userId", targetId).put("removed", true))
        if (targetId != user.id) {
            s.appendEventActivity(ch, ev, EventNote(
                user.id, user.name, "", System.currentTimeMillis(),
                activity = "removePerson", targetUserId = targetId, targetName = targetName,
            ))
        }
        s.operations.save()
        s.syncPinnedViewersIfNeeded(ev)
    }

    fun cmdDeleteEvent(user: User, m: JSONObject) {
        val ev = s.state.events.find { it.id == m.optString("eventId") } ?: return
        val ch = s.state.channels.find { it.id == ev.channelId } ?: return
        if (!s.authorization.channelVisible(ch, user) || !s.authorization.canEditEvent(user, ev)) return
        s.operations.purgeEventFromHost(ev.id, true, true)
    }
}
