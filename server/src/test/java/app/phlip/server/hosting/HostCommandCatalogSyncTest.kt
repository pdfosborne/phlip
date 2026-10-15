package app.phlip.server.hosting

import android.app.Application
import app.phlip.server.HostCommandCatalog
import app.phlip.server.MemberCommandRouter
import app.phlip.server.User
import org.json.JSONObject
import org.junit.Assert.assertEquals
import org.junit.Assert.assertTrue
import org.junit.Test
import org.junit.runner.RunWith
import org.robolectric.RobolectricTestRunner
import org.robolectric.annotation.Config

/**
 * AUTHZ-G-01 prerequisite: the router protocol surface must match the canonical
 * member catalog used to derive the guest-forbidden sweep.
 */
@RunWith(RobolectricTestRunner::class)
@Config(sdk = [34], application = Application::class)
class HostCommandCatalogSyncTest {

    @Test
    fun memberRpcCatalogMatchesHandleAuthedMessage() {
        val router = MemberCommandRouter { _: User, _: JSONObject -> true }
        assertEquals(HostCommandCatalog.MEMBER_RPC, router.supportedCommands)
    }

    @Test
    fun guestAllowedIsSubsetOfMemberRpc() {
        val stray = HostCommandCatalog.GUEST_ALLOWED - HostCommandCatalog.MEMBER_RPC
        assertTrue("Guest-allowed commands not in MEMBER_RPC: $stray", stray.isEmpty())
    }
}
