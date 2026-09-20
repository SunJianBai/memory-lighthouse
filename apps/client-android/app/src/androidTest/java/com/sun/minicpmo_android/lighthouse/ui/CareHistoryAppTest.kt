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

/** Read-only history checks in the real Activity against the isolated local API. */
class CareHistoryAppTest {
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

    private fun screenshot(name: String) {
        val directory = InstrumentationRegistry.getArguments().getString("additionalTestOutputDir")?.let(::File)
            ?: InstrumentationRegistry.getInstrumentation().targetContext.getExternalFilesDir("qa")!!
        directory.mkdirs()
        File(directory, name).outputStream().use {
            InstrumentationRegistry.getInstrumentation().uiAutomation.takeScreenshot().compress(Bitmap.CompressFormat.PNG, 100, it)
        }
    }

    @Test fun realAppShowsClosedRemindersAndSafeEventMetadata() {
        val username = requireNotNull(InstrumentationRegistry.getArguments().getString("careUsername"))
        compose.waitUntil(15_000) { compose.onAllNodesWithText("邮箱或用户名").fetchSemanticsNodes().isNotEmpty() }
        compose.onNodeWithText("邮箱或用户名").performTextInput(username)
        compose.onNodeWithText("密码", substring = false).performTextInput("Local-Care-Fixture-2026!")
        compose.onNode(hasText("安全登录") and hasClickAction()).performScrollTo().performClick()
        compose.waitUntil(15_000) { compose.onAllNodesWithText("今日照护").fetchSemanticsNodes().isNotEmpty() }
        try {
            if (compose.onAllNodes(hasText("测试长者乙") and hasClickAction()).fetchSemanticsNodes().isNotEmpty()) {
                compose.onNode(hasText("测试长者乙") and hasClickAction()).performClick()
                compose.onNodeWithText("测试长者甲").performClick()
            }
            compose.onNodeWithText("查看日程与待办").performScrollTo().performClick()
            compose.onNodeWithTag("care-list").performScrollToNode(hasText("提醒记录", substring = false))
            compose.onNodeWithText("长者时区：Asia/Shanghai").assertIsDisplayed()
            compose.onNodeWithTag("care-list").performScrollToNode(hasTestTag("care-occurrence-card") and hasAnyDescendant(hasText("已结束的提醒")))
            screenshot("care-history-reminder.png")
            compose.onNodeWithText("已关闭").assertIsDisplayed()
            compose.onNodeWithText("2026-09-20 05:00").assertIsDisplayed()
            compose.onNodeWithText("EXPIRED").assertDoesNotExist()
            compose.onNodeWithTag("care-list").performScrollToNode(hasTestTag("care-event-card") and hasAnyDescendant(hasText("测试待办-RESOLVED")))
            compose.onAllNodesWithText("来源待确认 · 其他动态").onFirst().assertIsDisplayed()
            compose.onNodeWithText("FAMILY_REQUESTED", substring = true).assertDoesNotExist()
            screenshot("care-history-events.png")
        } finally {
            compose.onNodeWithContentDescription("更多操作").performClick()
            compose.onNodeWithText("退出登录").performClick()
            compose.waitUntil(15_000) { compose.onAllNodesWithText("邮箱或用户名").fetchSemanticsNodes().isNotEmpty() }
        }
    }
}
