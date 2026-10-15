package app.phlip.server

import org.json.JSONArray
import org.json.JSONObject
import java.util.Calendar

/** Event time precision and stacked suggestion commands. */
internal class EventSchedulingHandler(
    private val s: EventCommandSupport,
) {
    fun cmdSetEventTimePrecision(user: User, m: JSONObject) {
        if (!s.authorization.canMutateContent(user)) return
        val precision = m.optString("whenPrecision").ifEmpty { null }
            ?.takeIf { it in listOf("day", "period", "unconfirmed") }
        val period = m.optString("whenPeriod").ifEmpty { null }
            ?.takeIf { precision == "period" && it in listOf("morning", "afternoon", "evening") }
        val newWhen = m.optLong("when").takeIf { it != 0L }
        val ev = s.state.events.find { it.id == m.optString("eventId") } ?: return
        val ch = s.state.channels.find { it.id == ev.channelId } ?: return
        if (!s.authorization.channelVisible(ch, user) || !s.authorization.canEditEvent(user, ev)) return
        val oldWhen = ev.`when`
        val oldPrecision = ev.whenPrecision
        val oldPeriod = ev.whenPeriod
        if (newWhen != null) ev.`when` = newWhen
        if (precision != null) {
            ev.whenPrecision = precision
            ev.whenPeriod = period
        } else if (newWhen != null) {
            ev.whenPrecision = null
            ev.whenPeriod = null
        }
        s.operations.broadcastToChannel(ch, JSONObject().put("type", "eventTimeUpdated")
            .put("eventId", ev.id).put("when", ev.`when` ?: JSONObject.NULL)
            .put("whenPrecision", ev.whenPrecision ?: JSONObject.NULL)
            .put("whenPeriod", ev.whenPeriod ?: JSONObject.NULL))
        if (oldWhen != ev.`when` || oldPrecision != ev.whenPrecision || oldPeriod != ev.whenPeriod) {
            s.appendEventActivity(ch, ev, EventNote(
                user.id, user.name, "", System.currentTimeMillis(), activity = "time",
                oldWhen = oldWhen, newWhen = ev.`when`, oldWhenPrecision = oldPrecision,
                newWhenPrecision = ev.whenPrecision, oldWhenPeriod = oldPeriod,
                newWhenPeriod = ev.whenPeriod,
            ))
            if (ev.chainOf == null && oldWhen != ev.`when`) s.flagChainDependencyWarns(ch, ev)
            if (ev.chainOf != null && ev.chainDepWarnWhen != null) {
                ev.chainDepWarnWhen = null
                s.broadcastChainUpdated(ch, ev)
            }
        }
        s.operations.save()
        s.syncPinnedViewersIfNeeded(ev)
        s.operations.clearOverlappingAvailabilities(ev)
    }

    fun startOfTodayMs(): Long {
        val cal = Calendar.getInstance()
        cal.set(Calendar.HOUR_OF_DAY, 0)
        cal.set(Calendar.MINUTE, 0)
        cal.set(Calendar.SECOND, 0)
        cal.set(Calendar.MILLISECOND, 0)
        return cal.timeInMillis
    }

    fun pruneEventSuggestions(ev: Event): Boolean {
        val list = ev.suggestions ?: return false
        val before = list.size
        list.removeAll { it.`when` < startOfTodayMs() }
        if (list.isEmpty()) {
            ev.suggestions = null
            return before > 0
        }
        return list.size != before
    }

    fun suggestionsPayload(ev: Event): JSONArray {
        pruneEventSuggestions(ev)
        val arr = JSONArray()
        for (s in ev.suggestions ?: emptyList()) {
            arr.put(JSONObject().put("id", s.id).put("when", s.`when`)
                .put("whenPrecision", s.whenPrecision ?: JSONObject.NULL)
                .put("whenPeriod", s.whenPeriod ?: JSONObject.NULL)
                .put("proposedBy", s.proposedBy).put("proposedByName", s.proposedByName)
                .put("supporterIds", JSONArray(s.supporterIds))
                .put("declinerIds", JSONArray(s.declinerIds))
                .put("createdAt", s.createdAt))
        }
        return arr
    }

    fun broadcastSuggestions(ch: Channel, ev: Event) {
        s.operations.broadcastToChannel(ch, JSONObject().put("type", "eventSuggestionsUpdated")
            .put("eventId", ev.id).put("suggestions", suggestionsPayload(ev)))
    }

    fun sameSuggestionWhen(
        aWhen: Long, aPrec: String?, aPeriod: String?,
        bWhen: Long, bPrec: String?, bPeriod: String?,
    ): Boolean {
        if (aWhen != bWhen) return false
        val ap = aPrec ?: ""
        if (ap != (bPrec ?: "")) return false
        if (ap == "period") return (aPeriod ?: "") == (bPeriod ?: "")
        return true
    }

    fun cmdSuggestEventWhen(user: User, m: JSONObject) {
        val ev = s.state.events.find { it.id == m.optString("eventId") } ?: return
        val ch = s.state.channels.find { it.id == ev.channelId } ?: return
        if (!s.authorization.canChannel(user, ch, PERM_FLAG_RSVP)) return
        val newWhen = m.optLong("when").takeIf { it != 0L } ?: return
        if (newWhen < startOfTodayMs()) return
        val precision = m.optString("whenPrecision").ifEmpty { null }
            ?.takeIf { it in listOf("day", "period", "unconfirmed") }
        val period = m.optString("whenPeriod").ifEmpty { null }
            ?.takeIf { precision == "period" && it in listOf("morning", "afternoon", "evening") }
        if (ev.`when` != null && sameSuggestionWhen(newWhen, precision, period,
                ev.`when`!!, ev.whenPrecision, ev.whenPeriod)) return
        pruneEventSuggestions(ev)
        val list = ev.suggestions ?: mutableListOf<EventSuggestion>().also { ev.suggestions = it }
        val existing = list.find {
            sameSuggestionWhen(newWhen, precision, period, it.`when`, it.whenPrecision, it.whenPeriod)
        }
        if (existing != null) {
            if (!existing.supporterIds.contains(user.id)) existing.supporterIds.add(user.id)
            existing.declinerIds.remove(user.id)
            s.operations.save()
            broadcastSuggestions(ch, ev)
            return
        }
        if (list.size >= 12) return
        list.add(EventSuggestion(s.idGenerator(), newWhen, precision, period, user.id, user.name,
            mutableListOf(user.id)))
        s.operations.save()
        broadcastSuggestions(ch, ev)
    }

    fun cmdSupportEventSuggestion(user: User, m: JSONObject) {
        val ev = s.state.events.find { it.id == m.optString("eventId") } ?: return
        val ch = s.state.channels.find { it.id == ev.channelId } ?: return
        if (!s.authorization.canChannel(user, ch, PERM_FLAG_RSVP)) return
        pruneEventSuggestions(ev)
        val sug = ev.suggestions?.find { it.id == m.optString("suggestionId") } ?: return
        val vote = m.optString("vote").ifEmpty { "yes" }
        if (vote != "yes" && vote != "no") return
        val onYes = sug.supporterIds.contains(user.id)
        val onNo = sug.declinerIds.contains(user.id)
        when {
            vote == "yes" && onYes -> {
                sug.supporterIds.remove(user.id)
                sug.declinerIds.remove(user.id)
            }
            vote == "no" && onNo -> {
                sug.supporterIds.remove(user.id)
                sug.declinerIds.remove(user.id)
            }
            vote == "yes" -> {
                if (!sug.supporterIds.contains(user.id)) sug.supporterIds.add(user.id)
                sug.declinerIds.remove(user.id)
            }
            else -> {
                if (!sug.declinerIds.contains(user.id)) sug.declinerIds.add(user.id)
                sug.supporterIds.remove(user.id)
            }
        }
        s.operations.save()
        broadcastSuggestions(ch, ev)
    }

    fun cmdPromoteEventSuggestion(user: User, m: JSONObject) {
        val ev = s.state.events.find { it.id == m.optString("eventId") } ?: return
        val ch = s.state.channels.find { it.id == ev.channelId } ?: return
        if (!s.authorization.canEditEvent(user, ev)) return
        pruneEventSuggestions(ev)
        val list = ev.suggestions ?: return
        val idx = list.indexOfFirst { it.id == m.optString("suggestionId") }
        if (idx < 0) return
        val sug = list.removeAt(idx)
        val oldWhen = ev.`when`
        val oldPrecision = ev.whenPrecision
        val oldPeriod = ev.whenPeriod
        if (oldWhen != null && oldWhen >= startOfTodayMs()) {
            val demoted = EventSuggestion(s.idGenerator(), oldWhen, oldPrecision, oldPeriod,
                ev.createdBy, ev.createdByName, mutableListOf(ev.createdBy))
            val clash = list.find { sameSuggestionWhen(demoted.`when`, demoted.whenPrecision,
                demoted.whenPeriod, it.`when`, it.whenPrecision, it.whenPeriod) }
            if (clash == null) list.add(0, demoted)
        }
        ev.`when` = sug.`when`
        ev.whenPrecision = sug.whenPrecision
        ev.whenPeriod = sug.whenPeriod
        if (list.isEmpty()) ev.suggestions = null
        s.operations.broadcastToChannel(ch, JSONObject().put("type", "eventTimeUpdated")
            .put("eventId", ev.id).put("when", ev.`when` ?: JSONObject.NULL)
            .put("whenPrecision", ev.whenPrecision ?: JSONObject.NULL)
            .put("whenPeriod", ev.whenPeriod ?: JSONObject.NULL))
        broadcastSuggestions(ch, ev)
        if (oldWhen != ev.`when` || oldPrecision != ev.whenPrecision || oldPeriod != ev.whenPeriod) {
            s.appendEventActivity(ch, ev, EventNote(user.id, user.name, "", System.currentTimeMillis(),
                activity = "time", oldWhen = oldWhen, newWhen = ev.`when`,
                oldWhenPrecision = oldPrecision, newWhenPrecision = ev.whenPrecision,
                oldWhenPeriod = oldPeriod, newWhenPeriod = ev.whenPeriod))
            if (ev.chainOf == null && oldWhen != ev.`when`) s.flagChainDependencyWarns(ch, ev)
        }
        s.operations.save()
    }

    fun cmdLockEventSuggestions(user: User, m: JSONObject) {
        val ev = s.state.events.find { it.id == m.optString("eventId") } ?: return
        if (!s.authorization.canEditEvent(user, ev)) return
        if (ev.suggestions.isNullOrEmpty()) return
        ev.suggestions = null
        s.operations.save()
        val ch = s.state.channels.find { it.id == ev.channelId } ?: return
        broadcastSuggestions(ch, ev)
    }
}
