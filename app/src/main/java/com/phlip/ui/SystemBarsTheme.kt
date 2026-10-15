package com.phlip.ui

import android.app.Activity
import android.content.Context
import android.graphics.Color
import androidx.appcompat.widget.Toolbar
import androidx.core.view.WindowCompat
import androidx.core.view.WindowInsetsControllerCompat
import com.phlip.R

/** Keeps the system bars and the overlay Toolbar in step with the web light/dark choice. */
object SystemBarsTheme {
    const val PREFS_UI = "phlip_ui"
    const val KEY_UI_THEME = "ui_theme"

    fun isDark(context: Context): Boolean =
        context.getSharedPreferences(PREFS_UI, Context.MODE_PRIVATE)
            .getString(KEY_UI_THEME, "light") == "dark"

    /** Paint status + navigation bars to match the in-app light/dark theme, and flip
     *  icon contrast (dark icons on light bars, light icons on dark bars). */
    fun applySystemBars(activity: Activity, dark: Boolean) {
        val color = Color.parseColor(if (dark) "#15171b" else "#ffffff")
        val window = activity.window
        @Suppress("DEPRECATION")
        window.statusBarColor = color
        @Suppress("DEPRECATION")
        window.navigationBarColor = color
        WindowCompat.setDecorFitsSystemWindows(window, true)
        val insets = WindowInsetsControllerCompat(window, window.decorView)
        insets.isAppearanceLightStatusBars = !dark
        insets.isAppearanceLightNavigationBars = !dark
        applyToolbarOverflow(activity, dark)
    }

    /** Overflow ⋮ sits in a transparent overlay Toolbar — tint it to match web head icons. */
    private fun applyToolbarOverflow(activity: Activity, dark: Boolean) {
        val toolbar = activity.findViewById<Toolbar>(R.id.toolbar) ?: return
        val iconColor = Color.parseColor(if (dark) "#e9eaed" else "#6b7280")
        toolbar.overflowIcon?.mutate()?.setTint(iconColor)
        toolbar.popupTheme = if (dark) {
            androidx.appcompat.R.style.ThemeOverlay_AppCompat_Dark
        } else {
            androidx.appcompat.R.style.ThemeOverlay_AppCompat_Light
        }
        // Re-tint after menu inflate (overflow icon may be recreated).
        toolbar.post {
            toolbar.overflowIcon?.mutate()?.setTint(iconColor)
        }
    }
}
