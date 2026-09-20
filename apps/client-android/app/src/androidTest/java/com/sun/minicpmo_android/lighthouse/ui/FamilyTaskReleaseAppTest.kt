package com.sun.minicpmo_android.lighthouse.ui

import android.graphics.Bitmap
import androidx.compose.ui.test.*
import androidx.compose.ui.test.junit4.createAndroidComposeRule
import androidx.test.platform.app.InstrumentationRegistry
import com.sun.minicpmo_android.BuildConfig
import com.sun.minicpmo_android.MainActivity
import com.sun.minicpmo_android.lighthouse.data.AppSettingsRepository
import com.sun.minicpmo_android.lighthouse.data.CredentialVault
import com.sun.minicpmo_android.lighthouse.data.SecureStore
import org.junit.Assume.assumeTrue
import org.junit.Rule
import org.junit.Test
import org.junit.rules.ExternalResource
import org.junit.rules.RuleChain
import org.junit.rules.TestRule
import java.io.File

/** Actual Activity, two synthetic users and the local MySQL-backed API. */
class FamilyTaskReleaseAppTest {
    private val compose = createAndroidComposeRule<MainActivity>()
    private val setup = object : ExternalResource() {
        override fun before() {
            val api = InstrumentationRegistry.getArguments().getString("careApiBase")
            assumeTrue("Local API fixture not supplied", api != null)
            require(BuildConfig.APPLICATION_ID.endsWith(".iterationtest"))
            require(api!!.startsWith("http://127.0.0.1:13100/"))
            val context = InstrumentationRegistry.getInstrumentation().targetContext
            val vault = CredentialVault(SecureStore(context))
            require(vault.deviceCredential() == null && vault.userSession() == null) { "Do not overwrite an existing isolated-app session" }
            AppSettingsRepository(context).saveApiBaseUrl(api)
        }
    }
    @get:Rule val rules: TestRule = RuleChain.outerRule(setup).around(compose)

    private fun login(username: String) {
        compose.waitUntil(15_000) { compose.onAllNodesWithText("邮箱或用户名").fetchSemanticsNodes().isNotEmpty() }
        compose.onNodeWithText("邮箱或用户名").performTextInput(username)
        compose.onNodeWithText("密码", substring = false).performTextInput("Local-Care-Fixture-2026!")
        compose.onNode(hasText("安全登录") and hasClickAction()).performScrollTo().performClick()
        compose.waitUntil(15_000) { compose.onAllNodesWithText("今日照护").fetchSemanticsNodes().isNotEmpty() }
        if (compose.onAllNodes(hasText("测试长者乙") and hasClickAction()).fetchSemanticsNodes().isNotEmpty()) {
            compose.onNode(hasText("测试长者乙") and hasClickAction()).performClick()
            compose.onNodeWithText("测试长者甲").performClick()
        }
        compose.onNodeWithText("查看日程与待办").performScrollTo().performClick()
        compose.onNodeWithTag("care-list").performScrollToNode(hasTestTag("family-task-filters"))
    }

    private fun logout() {
        compose.onNodeWithContentDescription("更多操作").performClick()
        compose.onNodeWithText("退出登录").performClick()
        compose.waitUntil(15_000) { compose.onAllNodesWithText("邮箱或用户名").fetchSemanticsNodes().isNotEmpty() }
    }

    private fun screenshot(name: String) {
        val directory = InstrumentationRegistry.getArguments().getString("additionalTestOutputDir")?.let(::File)
            ?: InstrumentationRegistry.getInstrumentation().targetContext.getExternalFilesDir("qa")!!
        directory.mkdirs()
        File(directory, name).outputStream().use {
            InstrumentationRegistry.getInstrumentation().uiAutomation.takeScreenshot().compress(Bitmap.CompressFormat.PNG, 100, it)
        }
    }

    @Test fun ownerReleasesAndCaregiverReclaimsTheSameUnfinishedTask() {
        val args = InstrumentationRegistry.getArguments()
        login(requireNotNull(args.getString("careUsername")))
        compose.onNodeWithText("我负责 1").performClick()
        compose.onNodeWithTag("care-list").performScrollToNode(hasText("测试待办-CLAIMED"))
        compose.onNodeWithText("交回待认领").performScrollTo().performClick()
        compose.onNodeWithText("取消", substring = false).performScrollTo().performClick()
        compose.onNodeWithText("确认交回").assertDoesNotExist()
        compose.onNodeWithText("交回待认领").performScrollTo().performClick()
        compose.onNodeWithText("确认交回").performScrollTo().assertIsDisplayed()
        screenshot("task-release-confirm.png")
        compose.onNodeWithText("确认交回").performClick()
        compose.onNodeWithTag("care-list").performScrollToNode(hasTestTag("family-task-filters"))
        compose.waitUntil(15_000) { compose.onAllNodesWithText("我负责 0").fetchSemanticsNodes().isNotEmpty() }
        compose.onNodeWithText("待认领 2").assertExists()
        compose.onNodeWithText("已结束 1").assertExists()
        logout()
        login(requireNotNull(args.getString("caregiverUsername")))
        compose.onNodeWithText("待认领 2").performClick()
        compose.onNodeWithTag("care-list").performScrollToNode(hasText("测试待办-CLAIMED"))
        val releasedCard = hasTestTag("family-task-card") and hasAnyDescendant(hasText("测试待办-CLAIMED"))
        compose.onNode(hasText("认领", substring = false) and hasAnyAncestor(releasedCard)).performScrollTo().performClick()
        compose.onNodeWithTag("care-list").performScrollToNode(hasTestTag("family-task-filters"))
        compose.waitUntil(15_000) { compose.onAllNodesWithText("我负责 1").fetchSemanticsNodes().isNotEmpty() }
        compose.onNodeWithText("我负责 1").performClick()
        compose.onNodeWithTag("care-list").performScrollToNode(hasText("测试待办-CLAIMED"))
        compose.onNodeWithText("交回待认领").performScrollTo().assertIsDisplayed()
        screenshot("task-reclaimed-app.png")
        logout()
    }
}
