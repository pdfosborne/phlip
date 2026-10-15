package app.phlip.server

import java.security.SecureRandom
import java.util.Base64

/**
 * Owns the mutable server state and low-level id/nonce helpers for one hosted server.
 *
 * This keeps stateful runtime concerns out of [DrServer] while preserving the same
 * persistence, migration, and serialization behavior the host has used so far.
 */
internal class ServerRuntime(
    private val persistence: ServerPersistence,
    private val migrations: ServerStateMigrations,
    internal val rng: SecureRandom = SecureRandom(),
    private val stateProvider: () -> AppState,
    private val stateUpdater: (AppState) -> Unit,
) {
    var state: AppState
        get() = stateProvider()
        set(value) { stateUpdater(value) }

    fun load(
        defaultState: () -> AppState,
        ensureSaltBlindKey: () -> Boolean,
        newInviteCode: () -> String,
        newSalt: () -> String,
        bootstrapState: (AppState) -> Unit = {},
        onSealedUnreadable: () -> Unit = {},
        onLoaded: (AppState) -> Unit = {},
    ): AppState {
        val persisted = persistence.read()
        if (persisted != null) {
            val raw = persisted.raw
            if (persisted.sealedButUnreadable) {
                onSealedUnreadable()
                state = defaultState()
                return state
            }

            state = persisted.state ?: defaultState()
            if (state.e2eSalt.isEmpty()) state.e2eSalt = newSalt()
            if (state.inviteExpiry == 0L) {
                state.inviteCode = newInviteCode()
                state.inviteExpiry = System.currentTimeMillis() + INVITE_TTL_MS
            } else if (state.inviteCode.replace("-", "").length != INVITE_CODE_LEN) {
                state.inviteCode = newInviteCode()
                state.inviteExpiry = System.currentTimeMillis() + INVITE_TTL_MS
            }

            var changed = migrations.migrate(state, ensureSaltBlindKey)
            if (persistence.needsSeal(raw)) changed = true
            if (changed) save()
            onLoaded(state)
            return state
        }

        state = defaultState()
        bootstrapState(state)
        state.inviteCode = newInviteCode()
        state.inviteExpiry = System.currentTimeMillis() + INVITE_TTL_MS
        state.e2eSalt = newSalt()
        ensureSaltBlindKey()
        save()
        onLoaded(state)
        return state
    }

    fun save(): Boolean = persistence.save(state)

    fun displayName(): String = persistence.displayName()

    fun genId(): String {
        val b = ByteArray(6); rng.nextBytes(b)
        return b.joinToString("") { "%02x".format(it) }
    }

    fun genShareId(): String {
        val b = ByteArray(16); rng.nextBytes(b)
        return b.joinToString("") { "%02x".format(it) }
    }

    fun newMemberToken(): String = genShareId()

    fun newInviteCode(): String {
        val b = ByteArray(INVITE_CODE_LEN); rng.nextBytes(b)
        return b.joinToString("") { BASE32[(it.toInt() and 0xff) % BASE32.length].toString() }
    }

    fun newPersonalInviteSlug(): String {
        val b = ByteArray(PERSONAL_INVITE_SLUG_LEN); rng.nextBytes(b)
        return b.joinToString("") { BASE32[(it.toInt() and 0xff) % BASE32.length].toString() }
    }

    fun newGroupInviteCode(): String {
        val b = ByteArray(GROUP_INVITE_CODE_LEN); rng.nextBytes(b)
        return b.joinToString("") { BASE32[(it.toInt() and 0xff) % BASE32.length].toString() }
    }

    fun newSalt(): String {
        val b = ByteArray(16); rng.nextBytes(b)
        return Base64.getEncoder().encodeToString(b)
    }
}
