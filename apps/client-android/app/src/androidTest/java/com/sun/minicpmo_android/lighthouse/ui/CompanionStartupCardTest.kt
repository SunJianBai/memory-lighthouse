package com.sun.minicpmo_android.lighthouse.ui

import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.verticalScroll
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.darkColorScheme
import androidx.compose.runtime.CompositionLocalProvider
import androidx.compose.ui.Modifier
import androidx.compose.ui.platform.LocalDensity
import androidx.compose.ui.unit.Density
import androidx.compose.ui.graphics.asAndroidBitmap
import android.graphics.Bitmap
import androidx.test.platform.app.InstrumentationRegistry
import java.io.File
import androidx.compose.ui.test.*
import androidx.compose.ui.test.junit4.createComposeRule
import com.sun.minicpmo_android.lighthouse.model.CompanionAuthorizationCheck
import com.sun.minicpmo_android.lighthouse.model.DeviceReadinessView
import org.junit.Assert.*
import org.junit.Rule
import org.junit.Test

class CompanionStartupCardTest {
    @get:Rule val compose = createComposeRule()
    private val report = DeviceReadinessView("device", "binding", "2026-09-20T04:00:00Z",
        CompanionAuthorizationCheck(true, emptyList()), CompanionAuthorizationCheck(false, listOf("CAMERA_CAPTURE")), true)

    @Test fun explicitCheckShowsSeparateEvidenceWithoutPromptingForPermissions() {
        var requests = 0; var permissionPrompts = 0; var permissionReads = 0
        compose.setContent { MaterialTheme { Column(Modifier.verticalScroll(rememberScrollState())) {
            CompanionStartupCard("device", "binding", CompanionPermissionReadiness(false, true, false),
                load = { requests++; report }, onRecheckPermissions = { permissionReads++ },
                onRequestPermissions = { permissionPrompts++ }, onOpenSettings = {}, onRefresh = {})
        } } }
        compose.onNodeWithText("启动检查").performClick()
        compose.onNodeWithText("检查启动条件").performScrollTo().performClick()
        compose.onNodeWithText("配置已提供，连接未检查").performScrollTo().assertIsDisplayed()
        compose.onNodeWithText("请家属在“隐私与授权”开启陪伴摄像头").performScrollTo().assertIsDisplayed()
        compose.runOnIdle { assertEquals(1, requests); assertEquals(1, permissionReads); assertEquals(0, permissionPrompts) }
        compose.onNodeWithText("设置本机权限").performScrollTo().performClick()
        compose.runOnIdle { assertEquals(1, permissionPrompts) }
        compose.onNodeWithText("设备已就绪").assertDoesNotExist()
    }

    @Test fun failedCheckKeepsRetryAvailable() {
        var attempts = 0
        compose.setContent { MaterialTheme { Column(Modifier.verticalScroll(rememberScrollState())) {
            CompanionStartupCard("device", "binding", CompanionPermissionReadiness(true, true, true),
                load = { if (++attempts == 1) error("无法连接，请重试") else report }, onRecheckPermissions = {},
                onRequestPermissions = {}, onOpenSettings = {}, onRefresh = {})
        } } }
        compose.onNodeWithText("启动检查").performClick()
        compose.onNodeWithText("检查启动条件").performScrollTo().performClick()
        compose.onNodeWithText("无法连接，请重试").performScrollTo().assertIsDisplayed()
        compose.onNodeWithText("检查启动条件").performScrollTo().performClick()
        compose.onNodeWithText("本次访问成功，设备绑定有效").performScrollTo().assertIsDisplayed()
    }

    @Test fun darkThemeAndLargeTextKeepStatusAndActionsReachable() {
        compose.setContent {
            val density = LocalDensity.current.density
            CompositionLocalProvider(LocalDensity provides Density(density, 2f)) {
                MaterialTheme(colorScheme = darkColorScheme()) { Column(Modifier.verticalScroll(rememberScrollState())) {
                    CompanionStartupCard("device", "binding", CompanionPermissionReadiness(false, false, false),
                        load = { report }, onRecheckPermissions = {}, onRequestPermissions = {}, onOpenSettings = {}, onRefresh = {})
                } }
            }
        }
        compose.onNodeWithText("启动检查").performClick()
        compose.onNodeWithText("检查启动条件").performScrollTo().performClick()
        compose.onNodeWithText("配置已提供，连接未检查").performScrollTo().assertIsDisplayed()
        compose.onNodeWithText("检查启动条件").performScrollTo().assertIsDisplayed()
        val instrumentation = InstrumentationRegistry.getInstrumentation()
        val directory = InstrumentationRegistry.getArguments().getString("additionalTestOutputDir")?.let(::File)
            ?: instrumentation.targetContext.getExternalFilesDir(null)!!
        directory.mkdirs()
        File(directory, "companion-startup-dark-large.png").outputStream().use {
            compose.onRoot().captureToImage().asAndroidBitmap().compress(Bitmap.CompressFormat.PNG, 100, it)
        }
    }
}
