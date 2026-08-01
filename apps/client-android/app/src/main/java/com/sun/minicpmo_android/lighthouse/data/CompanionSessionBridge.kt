package com.sun.minicpmo_android.lighthouse.data

import com.sun.minicpmo_android.lighthouse.model.CompanionModelConnection
import com.sun.minicpmo_android.model.RealtimeMode
import java.util.concurrent.atomic.AtomicInteger

class CompanionSessionBridge(private val repository: LighthouseRepository) {
    private val utteranceSequence = AtomicInteger(0)

    suspend fun prepare(mode: RealtimeMode): CompanionModelConnection {
        require(mode != RealtimeMode.CHAT) { "陪伴端仅开放全双工语音或视频" }
        utteranceSequence.set(0)
        return repository.startCompanionModel(
            if (mode == RealtimeMode.VIDEO) "AUDIO_VIDEO" else "AUDIO",
        )
    }

    suspend fun event(
        connection: CompanionModelConnection,
        type: String,
        metrics: Map<String, Number>? = null,
        errorCode: String? = null,
    ) = repository.appendModelEvent(connection.modelSessionId, type, metrics, errorCode)

    suspend fun assistantUtterance(
        connection: CompanionModelConnection,
        providerEventId: String,
        text: String,
    ) {
        // MODEL output is part of the already-authorized model session. The
        // independent MODEL_INPUT_TRANSCRIPTION scope only gates USER/ASR text.
        if (text.isBlank()) return
        repository.appendAssistantUtterance(
            modelSessionId = connection.modelSessionId,
            sequenceNo = utteranceSequence.incrementAndGet(),
            providerEventId = providerEventId,
            rawText = text,
        )
    }

    suspend fun end(connection: CompanionModelConnection, reason: String) =
        repository.endCompanionSession(connection.companionSessionId, reason)
}
