package app.phlip.server

import org.junit.Assert.assertNotNull
import org.junit.Assert.assertTrue
import org.junit.Test
import org.junit.runner.RunWith
import org.robolectric.RobolectricTestRunner
import org.robolectric.annotation.Config
import android.app.Application

/** L1 — DevicePatchStatus bucketing (host-security-posture §8.3). */
@RunWith(RobolectricTestRunner::class)
@Config(sdk = [34], application = Application::class)
class DevicePatchStatusTest {

    @Test
    fun evaluateReturnsValidBucket() {
        val info = DevicePatchStatus.evaluate()
        assertNotNull(info.bucket)
        assertTrue(
            info.bucket == DevicePatchStatus.Bucket.GREEN ||
                info.bucket == DevicePatchStatus.Bucket.AMBER ||
                info.bucket == DevicePatchStatus.Bucket.RED,
        )
        val label = DevicePatchStatus.friendlyPatchLabel(info)
        assertTrue(label.isNotBlank())
    }
}
