package com.phlip.bridge

import android.Manifest
import android.content.ContentUris
import android.content.pm.PackageManager
import android.provider.CalendarContract
import androidx.core.content.ContextCompat
import com.phlip.MainActivity
import org.json.JSONArray
import org.json.JSONObject

/** Device-calendar permission, selection and snapshot import. */
class CalendarJsApi(
    private val main: MainActivity,
) {
    fun listDeviceCalendars(requestId: String) {
        Thread({
            val result = try {
                main.AndroidCryptoContextEnsure()
                if (!hasCalendarPermission()) throw SecurityException()
                val fields = arrayOf(
                    CalendarContract.Calendars._ID,
                    CalendarContract.Calendars.CALENDAR_DISPLAY_NAME,
                    CalendarContract.Calendars.ACCOUNT_NAME,
                    CalendarContract.Calendars.ACCOUNT_TYPE,
                    CalendarContract.Calendars.CALENDAR_COLOR,
                    CalendarContract.Calendars.VISIBLE,
                    CalendarContract.Calendars.IS_PRIMARY,
                )
                val calendars = JSONArray()
                val cursor = main.contentResolver.query(
                    CalendarContract.Calendars.CONTENT_URI,
                    fields,
                    null,
                    null,
                    "${CalendarContract.Calendars.ACCOUNT_NAME} COLLATE NOCASE, ${CalendarContract.Calendars.CALENDAR_DISPLAY_NAME} COLLATE NOCASE",
                ) ?: throw IllegalStateException("Calendar provider unavailable")
                cursor.use {
                    while (it.moveToNext()) {
                        val id = it.getString(0) ?: continue
                        calendars.put(
                            JSONObject()
                                .put("id", id)
                                .put("name", it.getString(1).orEmpty().ifBlank { "Calendar" }.take(120))
                                .put("accountName", it.getString(2).orEmpty().take(120))
                                .put("accountType", it.getString(3).orEmpty().take(80))
                                .put("color", it.getInt(4))
                                .put("visible", it.getInt(5) == 1)
                                .put("primary", it.getInt(6) == 1),
                        )
                    }
                }
                JSONObject().put("ok", true).put("calendars", calendars)
            } catch (_: SecurityException) {
                JSONObject().put("ok", false).put("error", "Calendar access is off. Allow calendar access to import.")
            } catch (_: Exception) {
                JSONObject().put("ok", false).put("error", "Could not list calendars on this phone.")
            }
            main.webView.post {
                main.webView.evaluateJavascript(
                    "window.DeviceCalendarImport?.receiveCalendars(" +
                        JSONObject.quote(requestId.take(80)) + "," + result.toString() + ")",
                    null,
                )
            }
        }, "phlip-calendar-list").start()
    }

    /** Explicit snapshot import, separate from the legacy ephemeral busy overlay. */
    fun importDeviceCalendar(requestId: String) {
        importDeviceCalendarFiltered(requestId, "{}")
    }

    fun importDeviceCalendarFiltered(requestId: String, optionsJson: String) {
        Thread({
            val result = try {
                main.AndroidCryptoContextEnsure()
                if (!hasCalendarPermission()) throw SecurityException()
                val opts = parseImportOptions(optionsJson)
                val now = System.currentTimeMillis()
                val day = 86_400_000L
                val from = now - opts.fromDays * day
                val to = now + opts.toDays * day
                val builder = CalendarContract.Instances.CONTENT_URI.buildUpon()
                ContentUris.appendId(builder, from)
                ContentUris.appendId(builder, to)
                val fields = arrayOf(
                    CalendarContract.Instances.EVENT_ID,
                    CalendarContract.Instances.CALENDAR_ID,
                    CalendarContract.Instances.BEGIN,
                    CalendarContract.Instances.END,
                    CalendarContract.Instances.TITLE,
                    CalendarContract.Instances.EVENT_LOCATION,
                    CalendarContract.Instances.ALL_DAY,
                )
                val events = JSONArray()
                val idClause = if (opts.calendarIds.isEmpty()) {
                    ""
                } else {
                    val placeholders = opts.calendarIds.joinToString(",") { "?" }
                    " AND ${CalendarContract.Instances.CALENDAR_ID} IN ($placeholders)"
                }
                val selection = "${CalendarContract.Instances.VISIBLE}=1 AND (${CalendarContract.Instances.STATUS} IS NULL OR ${CalendarContract.Instances.STATUS}!=?)$idClause"
                val args = ArrayList<String>(1 + opts.calendarIds.size)
                args.add(CalendarContract.Events.STATUS_CANCELED.toString())
                args.addAll(opts.calendarIds)
                val cursor = main.contentResolver.query(
                    builder.build(),
                    fields,
                    selection,
                    args.toTypedArray(),
                    CalendarContract.Instances.BEGIN,
                ) ?: throw IllegalStateException("Calendar provider unavailable")
                val needle = opts.titleContains.lowercase()
                cursor.use {
                    while (it.moveToNext()) {
                        if (events.length() >= 10000) throw IllegalStateException("Too many calendar events to import")
                        val allDay = it.getInt(6) == 1
                        if (!opts.includeAllDay && allDay) continue
                        val title = it.getString(4).orEmpty().take(500)
                        if (needle.isNotEmpty() && !title.lowercase().contains(needle)) continue
                        events.put(
                            JSONObject()
                                .put("eventId", it.getString(0))
                                .put("calendarId", it.getString(1))
                                .put("startMs", it.getLong(2))
                                .put("endMs", it.getLong(3))
                                .put("title", title)
                                .put("location", it.getString(5).orEmpty().take(1000))
                                .put("allDay", allDay),
                        )
                    }
                }
                JSONObject().put("ok", true).put("events", events).put("fromMs", from).put("toMs", to)
            } catch (_: SecurityException) {
                JSONObject().put("ok", false).put("error", "Calendar access is off. Allow calendar access to import.")
            } catch (_: Exception) {
                JSONObject().put("ok", false).put("error", "Could not read the device calendar. Your previous import is unchanged.")
            }
            main.webView.post {
                main.webView.evaluateJavascript(
                    "window.DeviceCalendarImport?.receive(" +
                        JSONObject.quote(requestId.take(80)) + "," + result.toString() + ")",
                    null,
                )
            }
        }, "phlip-calendar-import").start()
    }

    fun hasCalendarPermission(): Boolean =
        try {
            ContextCompat.checkSelfPermission(main, Manifest.permission.READ_CALENDAR) ==
                PackageManager.PERMISSION_GRANTED
        } catch (_: Exception) {
            false
        }

    /**
     * Request READ_CALENDAR. Result delivered to `window.__ashOnCalendarPermission(boolean)`.
     * Must run on the UI thread for the system dialog.
     */
    fun requestCalendarPermission() {
        main.runOnUiThread {
            if (hasCalendarPermission()) {
                main.deliverCalendarPermission(true)
                return@runOnUiThread
            }
            main.calendarPermissionLauncher.launch(Manifest.permission.READ_CALENDAR)
        }
    }

    private data class ImportOptions(
        val calendarIds: List<String>,
        val fromDays: Long,
        val toDays: Long,
        val includeAllDay: Boolean,
        val titleContains: String,
    )

    private fun parseImportOptions(raw: String): ImportOptions {
        val obj = try {
            if (raw.isBlank()) JSONObject() else JSONObject(raw)
        } catch (_: Exception) {
            JSONObject()
        }
        val ids = ArrayList<String>()
        val arr = obj.optJSONArray("calendarIds")
        if (arr != null) {
            for (i in 0 until arr.length()) {
                val id = arr.optString(i).trim()
                if (id.matches(Regex("\\d+"))) ids.add(id)
            }
        }
        fun days(key: String, fallback: Long): Long {
            val n = obj.optLong(key, fallback)
            return n.coerceIn(1L, 730L)
        }
        return ImportOptions(
            calendarIds = ids,
            fromDays = days("fromDays", 30),
            toDays = days("toDays", 365),
            includeAllDay = obj.optBoolean("includeAllDay", true),
            titleContains = obj.optString("titleContains").trim().take(120),
        )
    }
}
