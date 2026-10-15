package com.phlip.bridge

import android.app.TimePickerDialog
import com.phlip.MainActivity

/**
 * System time picker for create/edit event clocks.
 * Result delivered to `window.__ashOnTimePicked(requestId, hour, minute)`
 * (hour/minute null on cancel).
 */
class TimePickerJsApi(
    private val main: MainActivity,
) {
    fun pickTime(hour: Int, minute: Int, requestId: String) {
        val h = hour.coerceIn(0, 23)
        val m = minute.coerceIn(0, 59)
        val id = requestId.trim().ifEmpty { "tp" }
        main.runOnUiThread {
            try {
                val dlg = TimePickerDialog(
                    main,
                    { _, pickedH, pickedM ->
                        main.deliverTimePicked(id, pickedH, pickedM)
                    },
                    h,
                    m,
                    false,
                )
                dlg.setOnCancelListener {
                    main.deliverTimePicked(id, null, null)
                }
                dlg.show()
            } catch (_: Exception) {
                main.deliverTimePicked(id, null, null)
            }
        }
    }
}
