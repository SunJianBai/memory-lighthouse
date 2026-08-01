package com.sun.minicpmo_android.media

import android.Manifest
import android.content.Context
import android.content.pm.PackageManager
import android.media.AudioAttributes
import android.media.AudioFormat
import android.media.AudioManager
import android.media.AudioRecord
import android.media.AudioTrack
import android.media.MediaRecorder
import android.media.audiofx.AcousticEchoCanceler
import android.media.audiofx.NoiseSuppressor
import androidx.core.content.ContextCompat
import java.util.concurrent.LinkedBlockingQueue
import kotlin.concurrent.thread
import kotlin.math.max
import kotlin.math.sqrt

class DuplexAudioEngine(context: Context) {
    private val appContext = context.applicationContext
    private val audioManager = appContext.getSystemService(AudioManager::class.java)
    private val playbackQueue = LinkedBlockingQueue<FloatArray>()

    @Volatile
    private var recording = false

    @Volatile
    private var playing = false

    private var audioRecord: AudioRecord? = null
    private var audioTrack: AudioTrack? = null
    private var recordThread: Thread? = null
    private var playbackThread: Thread? = null
    private var echoCanceler: AcousticEchoCanceler? = null
    private var noiseSuppressor: NoiseSuppressor? = null
    private var previousAudioMode: Int = AudioManager.MODE_NORMAL

    fun startRecording(onChunk: (samples: FloatArray, level: Float) -> Unit) {
        if (recording) return
        check(
            ContextCompat.checkSelfPermission(appContext, Manifest.permission.RECORD_AUDIO) ==
                PackageManager.PERMISSION_GRANTED,
        ) { "缺少麦克风权限" }

        previousAudioMode = audioManager.mode
        audioManager.mode = AudioManager.MODE_IN_COMMUNICATION

        val floatMin = AudioRecord.getMinBufferSize(
            INPUT_SAMPLE_RATE,
            AudioFormat.CHANNEL_IN_MONO,
            AudioFormat.ENCODING_PCM_FLOAT,
        )
        val useFloat = floatMin > 0
        val encoding = if (useFloat) AudioFormat.ENCODING_PCM_FLOAT else AudioFormat.ENCODING_PCM_16BIT
        val bytesPerSample = if (useFloat) Float.SIZE_BYTES else Short.SIZE_BYTES
        val minBytes = if (useFloat) floatMin else AudioRecord.getMinBufferSize(
            INPUT_SAMPLE_RATE,
            AudioFormat.CHANNEL_IN_MONO,
            encoding,
        )
        check(minBytes > 0) { "当前设备不支持 16 kHz 单声道录音" }

        val recorder = AudioRecord.Builder()
            .setAudioSource(MediaRecorder.AudioSource.VOICE_COMMUNICATION)
            .setAudioFormat(
                AudioFormat.Builder()
                    .setEncoding(encoding)
                    .setSampleRate(INPUT_SAMPLE_RATE)
                    .setChannelMask(AudioFormat.CHANNEL_IN_MONO)
                    .build(),
            )
            .setBufferSizeInBytes(max(minBytes * 2, CHUNK_SAMPLES * bytesPerSample))
            .build()
        check(recorder.state == AudioRecord.STATE_INITIALIZED) { "麦克风初始化失败" }

        audioRecord = recorder
        echoCanceler = if (AcousticEchoCanceler.isAvailable()) {
            AcousticEchoCanceler.create(recorder.audioSessionId)?.apply { enabled = true }
        } else {
            null
        }
        noiseSuppressor = if (NoiseSuppressor.isAvailable()) {
            NoiseSuppressor.create(recorder.audioSessionId)?.apply { enabled = true }
        } else {
            null
        }

        recorder.startRecording()
        recording = true
        recordThread = thread(name = "minicpmo-audio-capture", isDaemon = true) {
            if (useFloat) {
                captureFloat(recorder, onChunk)
            } else {
                capturePcm16(recorder, onChunk)
            }
        }
    }

    fun startPlayback() {
        if (playing) return
        val minBytes = AudioTrack.getMinBufferSize(
            OUTPUT_SAMPLE_RATE,
            AudioFormat.CHANNEL_OUT_MONO,
            AudioFormat.ENCODING_PCM_FLOAT,
        )
        check(minBytes > 0) { "当前设备不支持 24 kHz 音频播放" }

        val track = AudioTrack.Builder()
            .setAudioAttributes(
                AudioAttributes.Builder()
                    .setUsage(AudioAttributes.USAGE_VOICE_COMMUNICATION)
                    .setContentType(AudioAttributes.CONTENT_TYPE_SPEECH)
                    .build(),
            )
            .setAudioFormat(
                AudioFormat.Builder()
                    .setEncoding(AudioFormat.ENCODING_PCM_FLOAT)
                    .setSampleRate(OUTPUT_SAMPLE_RATE)
                    .setChannelMask(AudioFormat.CHANNEL_OUT_MONO)
                    .build(),
            )
            .setTransferMode(AudioTrack.MODE_STREAM)
            .setBufferSizeInBytes(max(minBytes * 2, OUTPUT_SAMPLE_RATE * Float.SIZE_BYTES / 2))
            .build()
        check(track.state == AudioTrack.STATE_INITIALIZED) { "扬声器初始化失败" }

        audioTrack = track
        track.play()
        playing = true
        playbackThread = thread(name = "minicpmo-audio-playback", isDaemon = true) {
            while (playing && !Thread.currentThread().isInterrupted) {
                val samples = try {
                    playbackQueue.take()
                } catch (_: InterruptedException) {
                    break
                }
                if (!playing) break
                var offset = 0
                while (playing && offset < samples.size) {
                    val written = track.write(
                        samples,
                        offset,
                        samples.size - offset,
                        AudioTrack.WRITE_BLOCKING,
                    )
                    if (written <= 0) break
                    offset += written
                }
            }
        }
    }

    fun enqueuePlayback(base64FloatPcm: String) {
        val samples = com.sun.minicpmo_android.network.RealtimeProtocol.decodeFloat32(base64FloatPcm)
        if (samples.isNotEmpty()) playbackQueue.offer(samples)
    }

    fun clearPlayback() {
        playbackQueue.clear()
        audioTrack?.flush()
    }

    fun stop() {
        recording = false
        runCatching { audioRecord?.stop() }
        recordThread?.interrupt()
        runCatching { recordThread?.join(300) }
        recordThread = null

        echoCanceler?.release()
        echoCanceler = null
        noiseSuppressor?.release()
        noiseSuppressor = null
        audioRecord?.release()
        audioRecord = null

        playing = false
        playbackThread?.interrupt()
        runCatching { playbackThread?.join(300) }
        playbackThread = null
        playbackQueue.clear()
        runCatching { audioTrack?.pause() }
        runCatching { audioTrack?.flush() }
        runCatching { audioTrack?.release() }
        audioTrack = null

        audioManager.mode = previousAudioMode
    }

    private fun captureFloat(
        recorder: AudioRecord,
        onChunk: (samples: FloatArray, level: Float) -> Unit,
    ) {
        while (recording && !Thread.currentThread().isInterrupted) {
            val chunk = FloatArray(CHUNK_SAMPLES)
            var offset = 0
            while (recording && offset < chunk.size) {
                val count = recorder.read(
                    chunk,
                    offset,
                    chunk.size - offset,
                    AudioRecord.READ_BLOCKING,
                )
                if (count <= 0) break
                offset += count
            }
            if (recording && offset == chunk.size) onChunk(chunk, rms(chunk))
        }
    }

    private fun capturePcm16(
        recorder: AudioRecord,
        onChunk: (samples: FloatArray, level: Float) -> Unit,
    ) {
        while (recording && !Thread.currentThread().isInterrupted) {
            val raw = ShortArray(CHUNK_SAMPLES)
            var offset = 0
            while (recording && offset < raw.size) {
                val count = recorder.read(
                    raw,
                    offset,
                    raw.size - offset,
                    AudioRecord.READ_BLOCKING,
                )
                if (count <= 0) break
                offset += count
            }
            if (recording && offset == raw.size) {
                val floats = FloatArray(raw.size) { raw[it] / 32768f }
                onChunk(floats, rms(floats))
            }
        }
    }

    private fun rms(samples: FloatArray): Float {
        var sum = 0.0
        for (sample in samples) sum += sample * sample
        return (sqrt(sum / samples.size).toFloat() * 5f).coerceIn(0f, 1f)
    }

    companion object {
        const val INPUT_SAMPLE_RATE = 16_000
        const val OUTPUT_SAMPLE_RATE = 24_000
        const val CHUNK_SAMPLES = INPUT_SAMPLE_RATE
    }
}
