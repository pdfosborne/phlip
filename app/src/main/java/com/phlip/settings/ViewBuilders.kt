package com.phlip.settings

import android.graphics.Typeface
import android.graphics.drawable.GradientDrawable
import android.view.View
import android.widget.Button
import android.widget.LinearLayout
import android.widget.TextView
import android.widget.Toast
import androidx.appcompat.app.AppCompatActivity
import androidx.core.graphics.ColorUtils
import com.phlip.settings.SettingsTheme.ACCENT
import com.phlip.settings.SettingsTheme.BORDER
import com.phlip.settings.SettingsTheme.CHIP
import com.phlip.settings.SettingsTheme.DANGER
import com.phlip.settings.SettingsTheme.PUBLIC_LIVE
import com.phlip.settings.SettingsTheme.SURFACE

/** Shared view DSL for Settings screens. */
class ViewBuilders(private val activity: AppCompatActivity) {
    fun dp(v: Int) = (v * activity.resources.displayMetrics.density).toInt()

    fun toast(msg: String) = Toast.makeText(activity, msg, Toast.LENGTH_SHORT).show()

    fun tv(text: String, size: Float, color: Int, bold: Boolean = false) = TextView(activity).apply {
        this.text = text
        textSize = size
        setTextColor(color)
        if (bold) setTypeface(typeface, Typeface.BOLD)
    }

    fun btn(text: String, bg: Int, fg: Int, onClick: () -> Unit) = Button(activity).apply {
        this.text = text
        textSize = 14f
        isAllCaps = false
        setTypeface(typeface, Typeface.BOLD)
        setTextColor(fg)
        val isPrimary = bg == ACCENT || bg == PUBLIC_LIVE || (bg == DANGER && fg != DANGER)
        val fill = when {
            isPrimary -> bg
            bg == CHIP -> SURFACE
            else -> bg
        }
        val stroke = when {
            isPrimary -> null
            fg == DANGER -> ColorUtils.setAlphaComponent(DANGER, 0x55)
            else -> BORDER
        }
        background = GradientDrawable().apply {
            shape = GradientDrawable.RECTANGLE
            cornerRadius = dp(12).toFloat()
            setColor(fill)
            if (stroke != null) setStroke(dp(1), stroke)
        }
        val padH = dp(16)
        val padV = dp(12)
        setPadding(padH, padV, padH, padV)
        minHeight = dp(44)
        stateListAnimator = null
        elevation = 0f
        setOnClickListener { onClick() }
    }

    fun <T : View> T.margins(top: Int = 0, bottom: Int = 0): T {
        val lp = (layoutParams as? LinearLayout.LayoutParams)
            ?: LinearLayout.LayoutParams(
                LinearLayout.LayoutParams.MATCH_PARENT,
                LinearLayout.LayoutParams.WRAP_CONTENT,
            )
        lp.topMargin = dp(top)
        lp.bottomMargin = dp(bottom)
        layoutParams = lp
        return this
    }

    fun spaced(view: View, left: Int): View {
        view.layoutParams = LinearLayout.LayoutParams(
            LinearLayout.LayoutParams.WRAP_CONTENT,
            LinearLayout.LayoutParams.WRAP_CONTENT,
        ).apply { leftMargin = dp(left) }
        return view
    }
}
