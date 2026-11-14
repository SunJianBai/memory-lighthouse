package com.sun.minicpmo_android.lighthouse.ui

import android.graphics.Bitmap
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.SnackbarHostState
import androidx.compose.material3.Surface
import androidx.compose.runtime.mutableStateOf
import androidx.compose.ui.Modifier
import androidx.compose.ui.graphics.asAndroidBitmap
import androidx.compose.ui.test.*
import androidx.compose.ui.test.junit4.createComposeRule
import androidx.test.platform.app.InstrumentationRegistry
import com.sun.minicpmo_android.lighthouse.model.*
import com.sun.minicpmo_android.model.AppUiState
import com.sun.minicpmo_android.model.RealtimeMode
import com.sun.minicpmo_android.ui.MiniCpmApp
import com.sun.minicpmo_android.ui.theme.LighthouseTheme
import org.junit.Rule
import org.junit.Test
import java.io.File

/** Native visual smoke pass. Synthetic state only: no repository, network or production account. */
class ArchiveVisualTest {
    @get:Rule val compose = createComposeRule()
    private val screen = mutableStateOf("memories")
    private val dark = mutableStateOf(false)
    private val stamp = "2026-11-03T08:00:00Z"
    private val state = LighthouseUiState(
        selectedRecipientId = "elder",
        recipients = listOf(CareRecipientView("elder", "home", "测试长者", "测试长者", null, "Asia/Shanghai", "测试住处", "ACTIVE", 1)),
        memories = listOf(MemoryView("memory", "home", "elder", "PREFERENCE", "日常阅读偏好", "HOUSEHOLD", "FAMILY_REPORTED", "ACTIVE", MemoryRevisionView("revision", 1, "这是一段合成的长记录，用于检查档案条目的文字换行、标签与操作布局，不包含真实家庭数据。", "FAMILY", null, stamp), stamp, 1)),
    )

    @Test fun nativePagesShareTheArchiveTheme() {
        compose.setContent {
            LighthouseTheme(darkTheme = dark.value) {
                Surface(Modifier.fillMaxSize(), color = MaterialTheme.colorScheme.background) {
                    when (screen.value) {
                        "memories" -> MemoriesSection(state, {}, {}, {})
                        "privacy" -> PrivacySection(state) { _, _ -> }
                        else -> MiniCpmApp(
                            state = AppUiState(selectedMode = if (screen.value == "audio") RealtimeMode.AUDIO else RealtimeMode.VIDEO),
                            cameraPermissionGranted = false, snackbarHostState = SnackbarHostState(),
                            onSelectMode = {}, onComposerChange = {}, onSendChat = {},
                            onStartDuplex = {}, onStop = {}, onTogglePause = {}, onToggleMic = {},
                            onToggleForceListen = {}, onFrame = {}, onCameraError = {},
                            onOpenSettings = {}, onDismissSettings = {}, onSaveSettings = { null },
                            onClear = {}, onExit = {}, allowedModes = setOf(RealtimeMode.AUDIO, RealtimeMode.VIDEO),
                        )
                    }
                }
            }
        }
        val directory = InstrumentationRegistry.getInstrumentation().targetContext.getExternalFilesDir("archive-visual")!!
        directory.mkdirs()
        for (isDark in listOf(false, true)) for (name in listOf("memories", "privacy", "audio", "video")) {
            compose.runOnIdle { screen.value = name; dark.value = isDark }
            compose.waitForIdle()
            if (name == "memories") compose.onNodeWithText("日常阅读偏好").assertIsDisplayed()
            File(directory, "android-$name-${if (isDark) "dark" else "light"}.png").outputStream().use {
                compose.onRoot().captureToImage().asAndroidBitmap().compress(Bitmap.CompressFormat.PNG, 100, it)
            }
        }
    }
}
