package com.sun.minicpmo_android.lighthouse.ui

import android.graphics.Bitmap
import androidx.compose.ui.graphics.asAndroidBitmap
import androidx.compose.ui.test.*
import androidx.compose.ui.test.junit4.createAndroidComposeRule
import androidx.test.platform.app.InstrumentationRegistry
import com.sun.minicpmo_android.BuildConfig
import com.sun.minicpmo_android.MainActivity
import com.sun.minicpmo_android.lighthouse.data.AppSettingsRepository
import org.junit.Assume.assumeTrue
import org.junit.Rule
import org.junit.Test
import org.junit.rules.ExternalResource
import org.junit.rules.RuleChain
import org.junit.rules.TestRule
import java.io.File

class RoutineScheduleAppTest {
    private val compose = createAndroidComposeRule<MainActivity>()
    private val setup = object : ExternalResource() {
        override fun before() {
            val api = InstrumentationRegistry.getArguments().getString("careApiBase")
            assumeTrue("Local API fixture required", api != null)
            require(BuildConfig.APPLICATION_ID.endsWith(".iterationtest"))
            require(api!!.startsWith("http://127.0.0.1:13100/"))
            AppSettingsRepository(InstrumentationRegistry.getInstrumentation().targetContext).saveApiBaseUrl(api)
        }
    }
    @get:Rule val rules: TestRule = RuleChain.outerRule(setup).around(compose)
    @Test fun createsWeekendRangeAndEditsItToOneTimeThroughTheRealApi() {
        val args = InstrumentationRegistry.getArguments()
        compose.waitUntil(15_000) { compose.onAllNodesWithText("邮箱或用户名").fetchSemanticsNodes().isNotEmpty() }
        compose.onNodeWithText("邮箱或用户名").performTextInput(requireNotNull(args.getString("careUsername")))
        compose.onNodeWithText("密码", substring = false).performTextInput("Local-Care-Fixture-2026!")
        compose.onNode(hasText("安全登录") and hasClickAction()).performScrollTo().performClick()
        compose.waitUntil(15_000) { compose.onAllNodesWithText("今日照护").fetchSemanticsNodes().isNotEmpty() }
        val second = hasText("测试长者乙") and hasClickAction()
        if (compose.onAllNodes(second).fetchSemanticsNodes().isNotEmpty()) {
            compose.onNode(second).performClick()
            compose.onNodeWithText("测试长者甲").performClick()
        }
        compose.onNodeWithText("查看日程与待办").performScrollTo().performClick()
        compose.onNodeWithText("新增日程").performScrollTo().performClick()
        compose.onNodeWithText("标题").performScrollTo().performTextInput("周期测试-周末")
        compose.onNodeWithText("家属录入的提醒内容").performScrollTo().performTextInput("在院内散步")
        compose.onNodeWithText("确认问题").performScrollTo().performTextInput("散步完成了吗？")
        compose.onNodeWithText("周末", substring = false).performScrollTo().performClick()
        compose.onNodeWithText("开始日期").performScrollTo().performTextReplacement("2026-09-26")
        compose.onNodeWithText("结束日期（可选）").performScrollTo().performTextReplacement("2026-09-27")
        val weekly = "周末 08:30（Asia/Shanghai） · 2026-09-26起，至2026-09-27"
        compose.onNodeWithText(weekly).performScrollTo().assertIsDisplayed()
        compose.onNodeWithText("保存日程").performClick()
        compose.waitUntil(15_000) { compose.onAllNodesWithText("保存日程").fetchSemanticsNodes().isEmpty() }
        compose.onNodeWithTag("care-list").performScrollToNode(hasText("周期测试-周末"))
        compose.onNodeWithText(weekly).performScrollTo().assertIsDisplayed()
        val card = hasTestTag("routine-card") and hasAnyDescendant(hasText("周期测试-周末"))
        compose.onNode(hasText("编辑", substring = false) and hasAnyAncestor(card)).performScrollTo().performClick()
        compose.onNodeWithText("仅一次", substring = false).performScrollTo().performClick()
        compose.onNodeWithText("提醒日期").performScrollTo().performTextReplacement("2026-09-28")
        compose.onNodeWithText("保存日程").performClick()
        compose.waitUntil(15_000) { compose.onAllNodesWithText("保存日程").fetchSemanticsNodes().isEmpty() }
        val once = "仅一次 · 2026-09-28 08:30（Asia/Shanghai）"
        compose.onNodeWithTag("care-list").performScrollToNode(hasText(once))
        compose.onNodeWithText(once).assertIsDisplayed()
        val directory = args.getString("additionalTestOutputDir")?.let(::File) ?: InstrumentationRegistry.getInstrumentation().targetContext.getExternalFilesDir("qa")!!
        directory.mkdirs()
        File(directory, "routine-schedule-app.png").outputStream().use { compose.onRoot().captureToImage().asAndroidBitmap().compress(Bitmap.CompressFormat.PNG, 100, it) }
        compose.onNodeWithContentDescription("更多操作").performClick()
        compose.onNodeWithText("退出登录").performClick()
        compose.waitUntil(15_000) { compose.onAllNodesWithText("邮箱或用户名").fetchSemanticsNodes().isNotEmpty() }
    }
}
