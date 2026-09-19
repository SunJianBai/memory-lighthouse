package com.sun.minicpmo_android.update

import io.mockk.every
import io.mockk.mockk
import io.mockk.verifyOrder
import kotlinx.coroutines.runBlocking
import okhttp3.ConnectionPool
import okhttp3.Dispatcher
import okhttp3.OkHttpClient
import org.junit.Assert.assertNotNull
import org.junit.Assert.assertNotSame
import org.junit.Test
import java.util.concurrent.ExecutorService
import java.util.concurrent.atomic.AtomicReference

class UpdateHttpClientCloserTest {
    @Test fun socketCleanupNeverRunsOnTheActivityCallerThread() = runBlocking {
        val caller = Thread.currentThread()
        val closeThread = AtomicReference<Thread>()
        val dispatcher = mockk<Dispatcher>(relaxed = true)
        val executor = mockk<ExecutorService>(relaxed = true)
        val pool = mockk<ConnectionPool>(relaxed = true)
        val client = mockk<OkHttpClient>()
        every { client.dispatcher } returns dispatcher
        every { dispatcher.executorService } returns executor
        every { client.connectionPool } returns pool
        every { pool.evictAll() } answers { closeThread.set(Thread.currentThread()) }
        closeUpdateHttpClient(client).join()
        assertNotNull(closeThread.get())
        assertNotSame("TLS shutdown must not run on the Activity's caller thread", caller, closeThread.get())
        verifyOrder { dispatcher.cancelAll(); executor.shutdown(); pool.evictAll() }
    }
}
