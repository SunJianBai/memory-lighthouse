package com.sun.minicpmo_android.camera

import org.junit.Assert.assertEquals
import org.junit.Test

class CameraBindingLeaseTest {
    @Test
    fun lateProviderCallbackDoesNotBindAfterDispose() {
        val lease = CameraBindingLease()
        var bindingCount = 0

        lease.dispose()
        lease.runIfActive { bindingCount += 1 }

        assertEquals(0, bindingCount)
    }
}
