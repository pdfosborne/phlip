/* render-backup.js — personal backup passphrase/unlock/preview/export/restore.
 * Globals out: openPersonalBackup*Flow / Modal helpers
 * Load after: render-cosmetics.js; before: render-user-settings.js
 */

/* ---- Tier 1 personal backup UI (User settings) -------------------------- */

function openPersonalBackupPassphraseModal({ title, confirmLabel, onConfirm }) {
  const opened = AshModal.open({
    className: "backup-pass",
    html: `
    <div class="modal-card backup-pass-modal">
      <div class="user-settings-top"><h4>${esc(title || "Passphrase")}</h4></div>
      <div class="user-settings-body">
        <p class="feel-strength-hint">Choose a passphrase you will remember. If you forget it, this backup cannot be opened — there is no recovery.</p>
        <div class="field">
          <label for="backup-pass-a">Passphrase</label>
          <input id="backup-pass-a" type="password" autocomplete="new-password" minlength="8" placeholder="At least 8 characters">
        </div>
        <div class="field">
          <label for="backup-pass-b">Confirm</label>
          <input id="backup-pass-b" type="password" autocomplete="new-password" minlength="8" placeholder="Type it again">
        </div>
        <div class="actions">
          <button type="button" class="cancel" id="backup-pass-cancel">Cancel</button>
          <button type="button" class="save" id="backup-pass-ok">${esc(confirmLabel || "Continue")}</button>
        </div>
      </div>
    </div>`,
    singleton: "return",
  });
  if (!opened) return;
  const { overlay, close } = opened;
  const a = overlay.querySelector("#backup-pass-a");
  const b = overlay.querySelector("#backup-pass-b");
  overlay.querySelector("#backup-pass-cancel").onclick = close;
  overlay.querySelector("#backup-pass-ok").onclick = async () => {
    const p1 = String(a?.value || "");
    const p2 = String(b?.value || "");
    if (p1.length < 8) { toast("Passphrase must be at least 8 characters"); return; }
    if (p1 !== p2) { toast("Passphrases don’t match"); return; }
    close();
    try { await onConfirm?.(p1); } catch (err) { toast(err?.message || "Backup failed"); }
  };
  requestAnimationFrame(() => a?.focus());
}

function openPersonalBackupUnlockModal({ onConfirm }) {
  const opened = AshModal.open({
    className: "backup-pass",
    html: `
    <div class="modal-card backup-pass-modal">
      <div class="user-settings-top"><h4>Restore backup</h4></div>
      <div class="user-settings-body">
        <p class="feel-strength-hint">Enter the passphrase used when this file was exported.</p>
        <div class="field">
          <label for="backup-unlock-a">Passphrase</label>
          <input id="backup-unlock-a" type="password" autocomplete="current-password" placeholder="Passphrase">
        </div>
        <div class="actions">
          <button type="button" class="cancel" id="backup-unlock-cancel">Cancel</button>
          <button type="button" class="save" id="backup-unlock-ok">Unlock</button>
        </div>
      </div>
    </div>`,
    singleton: "return",
  });
  if (!opened) return;
  const { overlay, close } = opened;
  const a = overlay.querySelector("#backup-unlock-a");
  overlay.querySelector("#backup-unlock-cancel").onclick = close;
  overlay.querySelector("#backup-unlock-ok").onclick = async () => {
    const p = String(a?.value || "");
    if (!p) { toast("Enter the passphrase"); return; }
    close();
    try { await onConfirm?.(p); } catch (err) { toast(err?.message || "Couldn’t open backup"); }
  };
  requestAnimationFrame(() => a?.focus());
}

function openPersonalBackupPreviewModal(payload, { onMerge, onReplace }) {
  const prev = typeof personalBackupPreview === "function"
    ? personalBackupPreview(payload)
    : { eventCount: 0, channelCount: 0, hasIdentity: false, meName: "" };
  const when = prev.exportedAt
    ? new Date(prev.exportedAt).toLocaleString([], { dateStyle: "medium", timeStyle: "short" })
    : "unknown date";
  const opened = AshModal.open({
    className: "backup-preview",
    html: `
    <div class="modal-card backup-preview-modal">
      <div class="user-settings-top"><h4>Restore preview</h4></div>
      <div class="user-settings-body">
        <p class="feel-strength-hint">Exported ${esc(when)}${prev.meName ? ` · ${esc(prev.meName)}` : ""}</p>
        <ul class="backup-preview-stats">
          <li><strong>${prev.eventCount}</strong> events</li>
          <li><strong>${prev.channelCount}</strong> channels</li>
          <li>${prev.hasIdentity ? "Includes device key" : "No device key in file"}</li>
        </ul>
        <p class="feel-strength-hint"><strong>Merge</strong> adds missing plans and keeps what you already have (keeps this phone’s key). <strong>Replace</strong> wipes personal space and restores the file, including the device key.</p>
        <div class="actions backup-preview-actions">
          <button type="button" class="cancel" id="backup-preview-cancel">Cancel</button>
          <button type="button" class="people-btn" id="backup-preview-merge">Merge</button>
          <button type="button" class="save" id="backup-preview-replace">Replace</button>
        </div>
      </div>
    </div>`,
    singleton: "return",
  });
  if (!opened) return;
  const { overlay, close } = opened;
  overlay.querySelector("#backup-preview-cancel").onclick = close;
  overlay.querySelector("#backup-preview-merge").onclick = async () => {
    close();
    try { await onMerge?.(); } catch (err) { toast(err?.message || "Merge failed"); }
  };
  overlay.querySelector("#backup-preview-replace").onclick = async () => {
    close();
    try { await onReplace?.(); } catch (err) { toast(err?.message || "Replace failed"); }
  };
}

function openPersonalBackupExportFlow({ onDone } = {}) {
  if (typeof runPersonalBackupExport !== "function") {
    toast("Backup isn’t available yet");
    return;
  }
  openPersonalBackupPassphraseModal({
    title: "Export backup",
    confirmLabel: "Export",
    onConfirm: async (pass) => {
      toast("Preparing backup…");
      const ok = await runPersonalBackupExport(pass);
      if (ok) {
        toast("Backup saved");
        try { onDone?.(); } catch {}
      } else {
        toast("Export cancelled or failed");
      }
    },
  });
}

function openPersonalBackupRestoreFlow({ onDone } = {}) {
  if (typeof readPersonalBackupFile !== "function") {
    toast("Restore isn’t available yet");
    return;
  }
  (async () => {
    const text = await readPersonalBackupFile();
    if (text == null) {
      toast("No file selected");
      return;
    }
    openPersonalBackupUnlockModal({
      onConfirm: async (pass) => {
        let payload;
        try {
          payload = await decryptPersonalBackupFileText(text, pass);
        } catch (err) {
          toast(err?.message || "Wrong passphrase or damaged file");
          return;
        }
        openPersonalBackupPreviewModal(payload, {
          onMerge: async () => {
            await applyPersonalBackup(payload, "merge");
            toast("Backup merged");
            try { onDone?.(); } catch {}
          },
          onReplace: async () => {
            await applyPersonalBackup(payload, "replace");
            toast("Backup restored");
            try { onDone?.(); } catch {}
          },
        });
      },
    });
  })().catch((err) => toast(err?.message || "Restore failed"));
}

