package com.sun.minicpmo_android

import androidx.lifecycle.viewModelScope
import com.sun.minicpmo_android.data.SettingsRepository
import com.sun.minicpmo_android.lighthouse.data.CompanionSessionBridge
import com.sun.minicpmo_android.lighthouse.model.CompanionModelConnection
import com.sun.minicpmo_android.media.DuplexAudioEngine
import com.sun.minicpmo_android.model.RealtimeMode
import com.sun.minicpmo_android.model.SessionPhase
import com.sun.minicpmo_android.model.SessionSettings
import com.sun.minicpmo_android.network.RealtimeApiClient
import io.mockk.clearMocks
import io.mockk.coEvery
import io.mockk.every
import io.mockk.mockk
import io.mockk.verify
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.ExperimentalCoroutinesApi
import kotlinx.coroutines.cancel
import kotlinx.coroutines.test.StandardTestDispatcher
import kotlinx.coroutines.test.advanceUntilIdle
import kotlinx.coroutines.test.resetMain
import kotlinx.coroutines.test.runCurrent
import kotlinx.coroutines.test.runTest
import kotlinx.coroutines.test.setMain
import org.junit.After
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Before
import org.junit.Test

@OptIn(ExperimentalCoroutinesApi::class)
class MainViewModelCompanionDirectiveOwnershipTest {
    private val mainDispatcher = StandardTestDispatcher()

    @Before
    fun setUp() {
        Dispatchers.setMain(mainDispatcher)
    }

    @After
    fun tearDown() {
        Dispatchers.resetMain()
    }

    @Test
    fun aLateServerDirectiveFromSessionACannotStopCurrentSessionB() =
        runTest(mainDispatcher) {
            val settings = mockk<SettingsRepository>()
            every { settings.load() } returns SessionSettings()
            val realtime = mockk<RealtimeApiClient>(relaxed = true)
            coEvery { realtime.isServiceAvailable(any()) } returns true
            val audio = mockk<DuplexAudioEngine>(relaxed = true)
            val bridge = mockk<CompanionSessionBridge>(relaxed = true)
            coEvery { bridge.prepare(RealtimeMode.AUDIO) } returnsMany listOf(
                connection("session-a"),
                connection("session-b"),
            )
            val viewModel = MainViewModel(settings, realtime, audio, bridge)
            try {
                viewModel.selectMode(RealtimeMode.AUDIO)
                viewModel.startDuplex()
                runCurrent()
                val deliverLateStopFromA = {
                    viewModel.stopForServerDirective("session-a")
                }

                viewModel.stopSession(quiet = true)
                advanceUntilIdle()
                viewModel.startDuplex()
                runCurrent()
                clearMocks(audio, realtime, bridge, answers = false)

                val stopped = deliverLateStopFromA()

                assertEquals(SessionPhase.CONNECTING, viewModel.uiState.value.phase)
                assertFalse(viewModel.uiState.value.mediaError != null)
                verify(exactly = 0) { audio.stop() }
                verify(exactly = 0) { realtime.close(any()) }
                verify(exactly = 0) { bridge.acknowledgeServerStop(any()) }
                assertFalse(stopped)
            } finally {
                viewModel.viewModelScope.cancel()
            }
        }

    @Test
    fun aServerDirectiveStopsOnlyItsCurrentSession() = runTest(mainDispatcher) {
        val settings = mockk<SettingsRepository>()
        every { settings.load() } returns SessionSettings()
        val realtime = mockk<RealtimeApiClient>(relaxed = true)
        coEvery { realtime.isServiceAvailable(any()) } returns true
        val audio = mockk<DuplexAudioEngine>(relaxed = true)
        val bridge = mockk<CompanionSessionBridge>(relaxed = true)
        coEvery { bridge.prepare(RealtimeMode.AUDIO) } returns connection("session-a")
        val viewModel = MainViewModel(settings, realtime, audio, bridge)
        try {
            viewModel.selectMode(RealtimeMode.AUDIO)
            viewModel.startDuplex()
            runCurrent()
            clearMocks(audio, realtime, bridge, answers = false)

            val stopped = viewModel.stopForServerDirective("session-a")

            assertEquals(SessionPhase.STOPPED, viewModel.uiState.value.phase)
            verify(exactly = 1) { audio.stop() }
            verify(exactly = 1) { realtime.close("remote_call") }
            verify(exactly = 1) {
                bridge.acknowledgeServerStop(
                    match { it.companionSessionId == "session-a" },
                )
            }
            assertEquals(true, stopped)
        } finally {
            viewModel.viewModelScope.cancel()
        }
    }

    private fun connection(companionSessionId: String) = CompanionModelConnection(
        companionSessionId = companionSessionId,
        modelSessionId = "model-$companionSessionId",
        realtimeUrl = "wss://example.invalid/realtime",
        model = "MiniCPM-o 4.5",
        systemPrompt = "陪伴提示词",
        userTranscriptionAllowed = false,
        promptVersion = 1,
        memoryCount = 0,
        routineCount = 0,
    )
}
