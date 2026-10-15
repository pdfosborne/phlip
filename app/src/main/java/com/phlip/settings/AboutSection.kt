package com.phlip.settings

import android.view.View
import android.widget.LinearLayout
import androidx.appcompat.app.AlertDialog
import com.phlip.ContactDocs
import com.phlip.LegalDocs
import com.phlip.SettingsActivity
import com.phlip.settings.SettingsTheme.CHIP
import com.phlip.settings.SettingsTheme.INK
import com.phlip.settings.SettingsTheme.MUTED
import com.phlip.settings.SettingsTheme.SURFACE

/** Support / Legal / Contact settings screens. */
class AboutSection(private val host: SettingsActivity) {
    fun renderSupport(content: LinearLayout) = host.renderSupportScreen(content)
    fun renderLegal(content: LinearLayout) = host.renderLegalScreen(content)
    fun renderContact(content: LinearLayout) = host.renderContactScreen(content)
}

internal fun SettingsActivity.renderSupportScreen(content: LinearLayout) {
    content.addView(supportSection())
}

internal fun SettingsActivity.renderLegalScreen(content: LinearLayout) {
    content.addView(tv(LegalDocs.SCREEN_TITLE, 26f, INK, bold = true))
    content.addView(tv(LegalDocs.SCREEN_SUBTITLE, 15f, MUTED).margins(top = 8, bottom = 16))
    content.addView(legalSection(LegalDocs.TERMS_TITLE, LegalDocs.TERMS_BODY).margins(bottom = 10))
    content.addView(legalSection(LegalDocs.MODERATION_TITLE, LegalDocs.MODERATION_BODY).margins(bottom = 10))
    content.addView(legalSection(LegalDocs.PRIVACY_TITLE, LegalDocs.PRIVACY_BODY).margins(bottom = 10))
    content.addView(legalSection(LegalDocs.LICENSE_TITLE, LegalDocs.LICENSE_BODY).margins(bottom = 10))
    content.addView(legalSection(LegalDocs.ATTRIBUTION_TITLE, LegalDocs.ATTRIBUTION_BODY))
}

internal fun SettingsActivity.renderContactScreen(content: LinearLayout) {
    content.addView(tv(ContactDocs.SCREEN_TITLE, 26f, INK, bold = true))
    content.addView(tv(ContactDocs.SCREEN_SUBTITLE, 15f, MUTED).margins(top = 8, bottom = 16))
    content.addView(legalSection(ContactDocs.HOW_TITLE, ContactDocs.HOW_BODY).margins(bottom = 10))
    content.addView(legalSection(ContactDocs.BUG_TITLE, ContactDocs.BUG_BODY).margins(bottom = 10))
    content.addView(legalSection(ContactDocs.SCOPE_TITLE, ContactDocs.SCOPE_BODY))
}

/** Expandable legal block — tap title to show/hide the full text. */
internal fun SettingsActivity.legalSection(title: String, body: String): View {
    val box = LinearLayout(this).apply {
        orientation = LinearLayout.VERTICAL
        setBackgroundColor(CHIP)
        setPadding(dp(14), dp(12), dp(14), dp(12))
    }
    val bodyView = tv(body, 13f, INK).margins(top = 10).apply { visibility = View.GONE }
    val header = tv(title, 16f, INK, bold = true).apply {
        isClickable = true
        isFocusable = true
        setOnClickListener {
            val open = bodyView.visibility != View.VISIBLE
            bodyView.visibility = if (open) View.VISIBLE else View.GONE
            text = if (open) "▾ $title" else "▸ $title"
        }
        text = "▸ $title"
    }
    box.addView(header)
    box.addView(bodyView)
    box.addView(btn("Read full text…", SURFACE, INK) {
        val scroll = android.widget.ScrollView(this).apply {
            addView(tv(body, 14f, INK).apply {
                setPadding(dp(8), dp(4), dp(8), dp(4))
            })
            setPadding(dp(8), dp(8), dp(8), dp(8))
        }
        AlertDialog.Builder(this)
            .setTitle(title)
            .setView(scroll)
            .setPositiveButton("OK", null)
            .show()
    }.margins(top = 10))
    return box
}

/** Support screen — hosting and features are free. */
internal fun SettingsActivity.supportSection(): View {
    val box = LinearLayout(this).apply {
        orientation = LinearLayout.VERTICAL
        setBackgroundColor(CHIP)
        setPadding(dp(14), dp(12), dp(14), dp(12))
    }
    box.addView(tv("Phlip is free", 18f, INK, bold = true))
    box.addView(tv(
        "Personal space stays on this device. Shared servers run on a phone you host. There is no subscription and no in-app purchase.",
        14f, INK,
    ).margins(top = 8))
    box.addView(tv(
        "Questions and bug reports are on the Contact screen.",
        13f, MUTED,
    ).margins(top = 8))
    return box
}


/** Public hosting via Cloudflare domain + API (required for any Public server). */
