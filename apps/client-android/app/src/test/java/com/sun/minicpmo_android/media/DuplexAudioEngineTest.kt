package com.sun.minicpmo_android.media

import org.junit.Assert.assertEquals
import org.junit.Test

class DuplexAudioEngineTest {
    @Test
    fun captureChunkMatchesRealtimeProtocolOneSecondCadence() {
        assertEquals(16_000, DuplexAudioEngine.CHUNK_SAMPLES)
    }

    @Test
    fun fullPlaybackBufferDropsOldestAndKeepsLatest() {
        val buffer = LatestBoundedBuffer<Int>(capacity = 2)

        buffer.offer(1)
        buffer.offer(2)
        buffer.offer(3)

        assertEquals(listOf(2, 3), listOf(buffer.poll(), buffer.poll()))
    }
}
