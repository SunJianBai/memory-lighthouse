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

/** Real Activity checks; all reads and verification commands target the isolated local API. */
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

    private fun openCarePage() {
        val username = requireNotNull(InstrumentationRegistry.getArguments().getString("careUsername"))
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
    }

    private fun signOut() {
        compose.onNodeWithContentDescription("更多操作").performClick()
        compose.onNodeWithText("退出登录").performClick()
        compose.waitUntil(15_000) { compose.onAllNodesWithText("邮箱或用户名").fetchSemanticsNodes().isNotEmpty() }
    }

    private fun historyNode(kind: String, text: String) = compose.onNode(
        hasText(text, substring = false) and hasAnyAncestor(hasTestTag("care-history-$kind-controls")),
    )

    private fun queryDate(kind: String, date: String, status: String? = null) {
        val key = if (kind == "events") "event" else "occurrence"
        compose.onNodeWithTag("care-list").performScrollToKey("$key-history-controls")
        historyNode(kind, "查询历史").performClick()
        historyNode(kind, "开始日期").performScrollTo().performTextReplacement(date)
        historyNode(kind, "结束日期").performScrollTo().performTextReplacement(date)
        if (status != null) {
            compose.onNodeWithTag("history-status").performScrollTo().performClick()
            compose.onNodeWithText(status, substring = false).performClick()
        }
        historyNode(kind, "查询").performScrollTo().performClick()
    }

    private fun expectLoaded(kind: String, count: Int) {
        val key = if (kind == "events") "event" else "occurrence"
        compose.onNodeWithTag("care-list").performScrollToKey("$key-history-controls")
        compose.waitUntil(15_000) {
            compose.onAllNodes(hasText("已加载 $count 条") and hasAnyAncestor(hasTestTag("care-history-$kind-controls")))
                .fetchSemanticsNodes().isNotEmpty()
        }
        historyNode(kind, "已加载 $count 条").assertIsDisplayed()
    }

    @Test fun realAppQueriesAllPagesAndKeepsBothFiltersAfterVerification() {
        assumeTrue("Seeded history preview required", InstrumentationRegistry.getArguments().getString("careHistoryPreview") == "true")
        openCarePage()
        try {
            queryDate("events", "2026-09-01")
            expectLoaded("events", 30)
            for (count in listOf(60, 65)) {
                compose.onNodeWithTag("care-list").performScrollToKey("event-history-footer")
                compose.onNodeWithText("加载更多").performClick()
                expectLoaded("events", count)
            }
            screenshot("history-app-65-records.png")
            compose.onNodeWithTag("care-list").performScrollToKey("event-history-footer")
            compose.onNodeWithText("本次查询已加载完").assertIsDisplayed()
            compose.onNodeWithText("加载更多").assertDoesNotExist()
            compose.onNodeWithTag("care-list").performScrollToNode(hasTestTag("care-event-card") and hasAnyDescendant(hasText("历史记录 1", substring = false)))
            compose.onNodeWithText("历史记录 1", substring = false).assertIsDisplayed()

            queryDate("occurrences", "2026-09-20", "待家属核验")
            expectLoaded("occurrences", 2)
            val reminder = hasTestTag("care-occurrence-card") and hasAnyDescendant(hasText("早餐后饮水"))
            compose.onNodeWithTag("care-list").performScrollToNode(reminder)
            compose.onNode(hasText("核验已完成") and hasAnyAncestor(reminder)).performScrollTo().performClick()
            compose.onNodeWithText("确认核验", substring = false).assertIsDisplayed().performClick()
            expectLoaded("occurrences", 1)
            historyNode("occurrences", "2026-09-20 至 2026-09-20").assertIsDisplayed()
            compose.onNode(hasText("状态：待家属核验") and !hasClickAction() and
                hasAnyAncestor(hasTestTag("care-history-occurrences-controls"))).assertExists()
            screenshot("history-app-verification-filter.png")
            expectLoaded("events", 30)
            historyNode("events", "2026-09-01 至 2026-09-01").assertIsDisplayed()
            historyNode("events", "恢复最新").performScrollTo().performClick()
            expectLoaded("events", 30)
            historyNode("events", "最新动态").assertIsDisplayed()
            historyNode("events", "恢复最新").assertDoesNotExist()
        } finally {
            signOut()
        }
    }

    @Test fun realAppShowsClosedRemindersAndSafeEventMetadata() {
        openCarePage()
        try {
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
            signOut()
        }
    }
}
