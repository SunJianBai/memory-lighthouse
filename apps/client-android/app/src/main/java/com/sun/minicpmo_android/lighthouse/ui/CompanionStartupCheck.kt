package com.sun.minicpmo_android.lighthouse.ui

import com.sun.minicpmo_android.lighthouse.model.DeviceReadinessView
import kotlinx.coroutines.CancellationException
import kotlinx.coroutines.CoroutineStart
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.Job
import kotlinx.coroutines.TimeoutCancellationException
import kotlinx.coroutines.delay
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.asStateFlow
import kotlinx.coroutines.launch
import kotlinx.coroutines.withTimeout

internal enum class StartupCheckPhase { IDLE, CHECKING, DONE, ERROR, EXPIRED }
internal data class StartupCheckState(
    val phase: StartupCheckPhase = StartupCheckPhase.IDLE,
    val report: DeviceReadinessView? = null,
    val error: String? = null,
)

/** UI-scoped snapshot; never starts media or substitutes for runtime authorization. */
internal class CompanionStartupCheck(
    private val deviceId: String,
    private val bindingId: String,
    private val scope: CoroutineScope,
    private val load: suspend () -> DeviceReadinessView,
) {
    private val mutableState = MutableStateFlow(StartupCheckState())
    val state = mutableState.asStateFlow()
    private var generation = 0L
    private var job: Job? = null

    fun check() {
        if (mutableState.value.phase == StartupCheckPhase.CHECKING) return
        val ticket = ++generation
        job?.cancel()
        mutableState.value = StartupCheckState(StartupCheckPhase.CHECKING)
        job = scope.launch {
            // Start expiry before transport; response latency cannot extend freshness.
            launch(start = CoroutineStart.UNDISPATCHED) {
                delay(60_000)
                if (generation == ticket) invalidate()
            }
            try {
                val report = withTimeout(15_000) { load() }
                if (generation != ticket) return@launch
                require(report.deviceId == deviceId && report.bindingId == bindingId) { "设备状态已变化，请刷新设备信息后重试" }
                mutableState.value = StartupCheckState(StartupCheckPhase.DONE, report)
            } catch (timeout: TimeoutCancellationException) {
                if (generation != ticket) return@launch
                mutableState.value = StartupCheckState(StartupCheckPhase.ERROR, error = "检查超时，请稍后重试")
            } catch (cancelled: CancellationException) {
                throw cancelled
            } catch (error: Exception) {
                if (generation != ticket) return@launch
                mutableState.value = StartupCheckState(StartupCheckPhase.ERROR, error = error.message ?: "检查失败，请重试")
            }
        }
    }

    fun invalidate() {
        ++generation
        job?.cancel()
        job = null
        mutableState.value = StartupCheckState(
            if (mutableState.value.phase == StartupCheckPhase.IDLE) StartupCheckPhase.IDLE else StartupCheckPhase.EXPIRED,
        )
    }
}
