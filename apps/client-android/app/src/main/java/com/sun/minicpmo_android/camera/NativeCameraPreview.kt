package com.sun.minicpmo_android.camera

import android.graphics.Bitmap
import android.graphics.Matrix
import android.os.SystemClock
import android.util.Base64
import androidx.camera.core.CameraSelector
import androidx.camera.core.ImageAnalysis
import androidx.camera.core.ImageProxy
import androidx.camera.core.Preview
import androidx.camera.core.UseCase
import androidx.camera.lifecycle.ProcessCameraProvider
import androidx.camera.view.PreviewView
import androidx.compose.runtime.Composable
import androidx.compose.runtime.DisposableEffect
import androidx.compose.runtime.getValue
import androidx.compose.runtime.remember
import androidx.compose.runtime.rememberUpdatedState
import androidx.compose.ui.Modifier
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.viewinterop.AndroidView
import androidx.core.content.ContextCompat
import androidx.core.graphics.createBitmap
import androidx.core.graphics.scale
import androidx.lifecycle.compose.LocalLifecycleOwner
import java.io.ByteArrayOutputStream
import java.util.concurrent.Executors
import kotlin.math.roundToInt

@Composable
fun NativeCameraPreview(
    lensFacing: Int,
    onFrame: (String) -> Unit,
    onError: (String) -> Unit,
    modifier: Modifier = Modifier,
) {
    val context = LocalContext.current
    val lifecycleOwner = LocalLifecycleOwner.current
    val latestOnFrame by rememberUpdatedState(onFrame)
    val latestOnError by rememberUpdatedState(onError)
    val previewView = remember {
        PreviewView(context).apply {
            implementationMode = PreviewView.ImplementationMode.COMPATIBLE
            scaleType = PreviewView.ScaleType.FILL_CENTER
        }
    }
    AndroidView(
        factory = { previewView },
        modifier = modifier,
    )

    DisposableEffect(lifecycleOwner, lensFacing) {
        val bindingLease = CameraBindingLease()
        val analysisExecutor = Executors.newSingleThreadExecutor()
        val providerFuture = ProcessCameraProvider.getInstance(context)
        var provider: ProcessCameraProvider? = null
        var preview: Preview? = null
        var analysis: ImageAnalysis? = null
        val bind = Runnable {
            runCatching {
                bindingLease.runIfActive {
                    val cameraProvider = providerFuture.get()
                    val cameraPreview = Preview.Builder().build().also {
                        it.surfaceProvider = previewView.surfaceProvider
                    }
                    val cameraAnalysis = ImageAnalysis.Builder()
                        .setBackpressureStrategy(ImageAnalysis.STRATEGY_KEEP_ONLY_LATEST)
                        .setOutputImageFormat(ImageAnalysis.OUTPUT_IMAGE_FORMAT_RGBA_8888)
                        .build()
                        .also { imageAnalysis ->
                            imageAnalysis.setAnalyzer(
                                analysisExecutor,
                                JpegFrameAnalyzer { frame ->
                                    bindingLease.runIfActive { latestOnFrame(frame) }
                                },
                            )
                        }
                    val selector = CameraSelector.Builder()
                        .requireLensFacing(lensFacing)
                        .build()
                    provider = cameraProvider
                    preview = cameraPreview
                    analysis = cameraAnalysis
                    cameraProvider.bindToLifecycle(
                        lifecycleOwner,
                        selector,
                        cameraPreview,
                        cameraAnalysis,
                    )
                }
            }.onFailure {
                releaseCameraUseCases(provider, preview, analysis)
                bindingLease.runIfActive {
                    latestOnError(it.message ?: "摄像头启动失败")
                }
            }
        }
        providerFuture.addListener(bind, ContextCompat.getMainExecutor(context))

        onDispose {
            bindingLease.dispose {
                releaseCameraUseCases(provider, preview, analysis)
            }
            analysisExecutor.shutdownNow()
        }
    }
}

internal class CameraBindingLease {
    private val lock = Any()
    private var active = true

    fun runIfActive(block: () -> Unit): Boolean = synchronized(lock) {
        if (!active) {
            false
        } else {
            block()
            true
        }
    }

    fun dispose(cleanup: () -> Unit = {}) {
        val shouldCleanup = synchronized(lock) {
            if (active) {
                active = false
                true
            } else {
                false
            }
        }
        if (shouldCleanup) cleanup()
    }
}

internal fun releaseCameraUseCases(
    provider: ProcessCameraProvider?,
    preview: Preview?,
    analysis: ImageAnalysis?,
) {
    analysis?.clearAnalyzer()
    if (provider == null) return
    val useCases = listOfNotNull<UseCase>(preview, analysis)
    if (useCases.isNotEmpty()) {
        runCatching { provider.unbind(*useCases.toTypedArray()) }
    }
}

private class JpegFrameAnalyzer(
    private val onFrame: (String) -> Unit,
) : ImageAnalysis.Analyzer {
    private var lastCaptureAt = 0L

    override fun analyze(image: ImageProxy) {
        val now = SystemClock.elapsedRealtime()
        if (now - lastCaptureAt < FRAME_INTERVAL_MS) {
            image.close()
            return
        }
        lastCaptureAt = now

        try {
            val plane = image.planes.first()
            val buffer = plane.buffer.apply { rewind() }
            val paddedWidth = plane.rowStride / plane.pixelStride
            val padded = createBitmap(
                paddedWidth,
                image.height,
                Bitmap.Config.ARGB_8888,
            )
            padded.copyPixelsFromBuffer(buffer)
            val cropped = Bitmap.createBitmap(padded, 0, 0, image.width, image.height)
            if (cropped !== padded) padded.recycle()

            val rotated = rotate(cropped, image.imageInfo.rotationDegrees)
            if (rotated !== cropped) cropped.recycle()
            val scaled = scaleDown(rotated, MAX_FRAME_DIMENSION)
            if (scaled !== rotated) rotated.recycle()

            val output = ByteArrayOutputStream()
            scaled.compress(Bitmap.CompressFormat.JPEG, JPEG_QUALITY, output)
            scaled.recycle()
            onFrame(Base64.encodeToString(output.toByteArray(), Base64.NO_WRAP))
        } finally {
            image.close()
        }
    }

    private fun rotate(bitmap: Bitmap, degrees: Int): Bitmap {
        if (degrees == 0) return bitmap
        return Bitmap.createBitmap(
            bitmap,
            0,
            0,
            bitmap.width,
            bitmap.height,
            Matrix().apply { postRotate(degrees.toFloat()) },
            true,
        )
    }

    private fun scaleDown(bitmap: Bitmap, maxDimension: Int): Bitmap {
        val longest = maxOf(bitmap.width, bitmap.height)
        if (longest <= maxDimension) return bitmap
        val ratio = maxDimension.toFloat() / longest
        return bitmap.scale(
            (bitmap.width * ratio).roundToInt(),
            (bitmap.height * ratio).roundToInt(),
        )
    }

    companion object {
        private const val FRAME_INTERVAL_MS = 850L
        private const val MAX_FRAME_DIMENSION = 640
        private const val JPEG_QUALITY = 70
    }
}
