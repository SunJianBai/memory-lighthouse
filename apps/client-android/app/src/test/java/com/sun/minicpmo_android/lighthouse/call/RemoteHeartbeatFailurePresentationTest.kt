package com.sun.minicpmo_android.lighthouse.call

import com.sun.minicpmo_android.lighthouse.network.LighthouseApiException
import java.io.IOException
import org.junit.Assert.assertEquals
import org.junit.Assert.assertNull
import org.junit.Assert.assertTrue
import org.junit.Test

class RemoteHeartbeatFailurePresentationTest {
    @Test
    fun revokedAuthorizationIsNotPresentedAsANetworkOutage() {
        val presentation = requireNotNull(
            remoteHeartbeatFailurePresentation(
                LighthouseApiException(403, "REMOTE_CALL_NOT_ALLOWED", "revoked"),
            ),
        )

        assertEquals("通话授权已失效", presentation.title)
        assertTrue(presentation.message.contains("授权"))
    }

    @Test
    fun exhaustedTransientRetriesArePresentedAsDisconnected() {
        val presentation = requireNotNull(
            remoteHeartbeatFailurePresentation(
                RemoteHeartbeatRetryExhaustedException(IOException("offline")),
            ),
        )

        assertEquals("通话已断开", presentation.title)
        assertTrue(presentation.message.contains("网络连接"))
    }

    @Test
    fun unrelatedTerminalFailureUsesTheExistingGenericCallFailurePresentation() {
        assertNull(
            remoteHeartbeatFailurePresentation(
                LighthouseApiException(409, "REMOTE_SESSION_TERMINAL", "ended"),
            ),
        )
    }

    @Test
    fun missingSystemAnswerPermissionsHaveAnActionableFailureCard() {
        val presentation = requireNotNull(
            remotePermissionFailurePresentation(RemoteCallPermissionsMissingException()),
        )

        assertEquals("权限未就绪，通话已断开", presentation.title)
        assertTrue(presentation.message.contains("打开应用补全权限"))
    }
}
