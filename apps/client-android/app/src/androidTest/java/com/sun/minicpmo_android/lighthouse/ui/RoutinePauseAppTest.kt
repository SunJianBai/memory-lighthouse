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
import java.time.LocalDate
import java.time.ZoneId

/** Opt-in isolated MainActivity acceptance; never targets production or the user's installed app. */
class RoutinePauseAppTest {
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

    @Test fun pauseEditWhilePausedAndResumeThroughTheRealApi() {
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
        val title = "暂停恢复验收-${System.currentTimeMillis()}"
        compose.onNodeWithText("标题").performScrollTo().performTextInput(title)
        compose.onNodeWithText("家属录入的提醒内容").performScrollTo().performTextInput("在院内散步")
        compose.onNodeWithText("确认问题").performScrollTo().performTextInput("散步完成了吗？")
        compose.onNodeWithText("开始日期").performScrollTo().performTextReplacement(LocalDate.now(ZoneId.of("Asia/Shanghai")).plusDays(1).toString())
        compose.onNodeWithText("保存日程").performClick()
        compose.waitUntil(15_000) { compose.onAllNodesWithText("保存日程").fetchSemanticsNodes().isEmpty() }
        var card = hasTestTag("routine-card") and hasAnyDescendant(hasText(title))
        compose.onNodeWithTag("care-list").performScrollToNode(hasText(title))
        compose.onNode(hasText("暂停", substring = false) and hasAnyAncestor(card)).performScrollTo().performClick()
        compose.onNodeWithText("暂停这个日程？").assertIsDisplayed()
        compose.onNodeWithText("暂停日程").performClick()
        compose.waitUntil(15_000) { compose.onAllNodes(hasText("已暂停") and hasAnyAncestor(card)).fetchSemanticsNodes().isNotEmpty() }
        compose.onNode(hasText("编辑", substring = false) and hasAnyAncestor(card)).performScrollTo().performClick()
        compose.onNodeWithText("保存后仍保持暂停；需要另行恢复才会安排提醒。").assertIsDisplayed()
        compose.onNodeWithText("标题").performScrollTo().performTextReplacement("$title-已编辑")
        compose.onNodeWithText("保存日程").performClick()
        compose.waitUntil(15_000) { compose.onAllNodesWithText("保存日程").fetchSemanticsNodes().isEmpty() }
        card = hasTestTag("routine-card") and hasAnyDescendant(hasText("$title-已编辑"))
        compose.onNodeWithTag("care-list").performScrollToNode(hasText("$title-已编辑"))
        compose.onNode(hasText("已暂停") and hasAnyAncestor(card)).assertIsDisplayed()
        compose.onNode(hasText("恢复", substring = false) and hasAnyAncestor(card)).performScrollTo().performClick()
        compose.onNodeWithText("只安排恢复后的提醒，不补发暂停期间的提醒。").performScrollTo().assertIsDisplayed()
        compose.onNodeWithText("恢复日程").performClick()
        compose.waitUntil(15_000) { compose.onAllNodes(hasText("已启用") and hasAnyAncestor(card)).fetchSemanticsNodes().isNotEmpty() }
        val directory = args.getString("additionalTestOutputDir")?.let(::File) ?: InstrumentationRegistry.getInstrumentation().targetContext.getExternalFilesDir("qa")!!
        directory.mkdirs()
        File(directory, "routine-pause-app.png").outputStream().use { compose.onRoot().captureToImage().asAndroidBitmap().compress(Bitmap.CompressFormat.PNG, 100, it) }
        compose.onNodeWithContentDescription("更多操作").performClick()
        compose.onNodeWithText("退出登录").performClick()
        compose.waitUntil(15_000) { compose.onAllNodesWithText("邮箱或用户名").fetchSemanticsNodes().isNotEmpty() }
    }
}
