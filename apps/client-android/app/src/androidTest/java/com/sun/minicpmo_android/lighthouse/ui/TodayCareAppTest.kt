package com.sun.minicpmo_android.lighthouse.ui

import android.graphics.Bitmap
import androidx.compose.ui.graphics.asAndroidBitmap
import androidx.compose.ui.test.*
import androidx.compose.ui.test.junit4.createAndroidComposeRule
import androidx.test.ext.junit.runners.AndroidJUnit4
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
import org.junit.runner.RunWith
import java.io.File

/** Exercises the actual activity, login form, repository and family navigation. */
@RunWith(AndroidJUnit4::class)
class TodayCareAppTest {
    private val compose = createAndroidComposeRule<MainActivity>()
    private val setup = object : ExternalResource() {
        override fun before() {
            val args = InstrumentationRegistry.getArguments()
            val api = args.getString("careApiBase")
            assumeTrue("Local API fixture not supplied", api != null)
            require(BuildConfig.APPLICATION_ID.endsWith(".iterationtest")) { "Use the isolated test application" }
            require(api!!.startsWith("http://127.0.0.1:13100/"))
            AppSettingsRepository(InstrumentationRegistry.getInstrumentation().targetContext).saveApiBaseUrl(api)
        }
    }
    @get:Rule val rules: TestRule = RuleChain.outerRule(setup).around(compose)

    @Test fun loginOverviewSwitchAndExistingCareNavigation() {
        val args = InstrumentationRegistry.getArguments()
        compose.waitUntil(15_000) { compose.onAllNodesWithText("邮箱或用户名").fetchSemanticsNodes().isNotEmpty() }
        compose.onNodeWithText("邮箱或用户名").performTextInput(requireNotNull(args.getString("careUsername")))
        compose.onNodeWithText("密码", substring = false).performTextInput("Local-Care-Fixture-2026!")
        compose.onNode(hasText("安全登录") and hasClickAction()).performScrollTo().performClick()
        compose.waitUntil(15_000) { compose.onAllNodesWithText("今日照护").fetchSemanticsNodes().isNotEmpty() }
        // Recipient ordering is not a fixture contract; explicitly select the populated recipient.
        val emptyRecipientSelected = hasText("测试长者乙") and hasClickAction()
        if (compose.onAllNodes(emptyRecipientSelected).fetchSemanticsNodes().isNotEmpty()) {
            compose.onNode(emptyRecipientSelected).performClick()
            compose.onNodeWithText("测试长者甲").performClick()
        }
        compose.onNode(hasText("测试长者甲") and hasClickAction()).assertExists()
        compose.onNodeWithText("今日照护").performScrollTo().assertIsDisplayed()
        compose.waitUntil(15_000) { compose.onAllNodesWithText("早餐后饮水").fetchSemanticsNodes().isNotEmpty() }
        compose.onNodeWithText("早餐后饮水").performScrollTo().assertIsDisplayed()

        val directory = args.getString("additionalTestOutputDir")?.let(::File)
            ?: InstrumentationRegistry.getInstrumentation().targetContext.getExternalFilesDir("qa")!!
        directory.mkdirs()
        val bitmap = compose.onRoot().captureToImage().asAndroidBitmap()
        File(directory, "today-care-app.png").outputStream().use { bitmap.compress(Bitmap.CompressFormat.PNG, 100, it) }

        compose.onNode(hasText("测试长者甲") and hasClickAction()).performClick()
        compose.onNodeWithText("测试长者乙").performClick()
        compose.waitUntil(15_000) { compose.onAllNodesWithText("今日暂无提醒记录，可在照护页面添加日程。").fetchSemanticsNodes().isNotEmpty() }
        compose.onNodeWithText("早餐后饮水").assertDoesNotExist()
        compose.onNodeWithText("今日暂无提醒记录，可在照护页面添加日程。").performScrollTo().assertIsDisplayed()
        compose.onNode(hasText("测试长者乙") and hasClickAction()).performClick()
        compose.onNodeWithText("测试长者甲").performClick()
        compose.waitUntil(15_000) { compose.onAllNodesWithText("早餐后饮水").fetchSemanticsNodes().isNotEmpty() }
        compose.onNodeWithText("查看日程与待办").performScrollTo().performClick()
        compose.onNodeWithText("日程与家庭待办").assertIsDisplayed()
        compose.onNodeWithText("新增日程").assertIsDisplayed()
        // Exercise the new board through the real Activity and existing command endpoints.
        compose.onNodeWithTag("care-list").performScrollToNode(hasText("待认领 1"))
        compose.onNodeWithText("待认领 1").performClick()
        compose.onNodeWithTag("care-list").performScrollToNode(hasText("测试待办-OPEN"))
        compose.onNodeWithText("认领", substring = false).performScrollTo().performClick()
        compose.waitUntil(15_000) { compose.onAllNodesWithText("待认领 0").fetchSemanticsNodes().isNotEmpty() }
        compose.onNodeWithText("我负责 2").performClick()
        compose.onNodeWithTag("care-list").performScrollToNode(hasText("测试待办-OPEN"))
        val openCard = hasTestTag("family-task-card") and hasAnyDescendant(hasText("测试待办-OPEN"))
        compose.onNode(hasText("完成", substring = false) and hasAnyAncestor(openCard)).performScrollTo().performClick()
        compose.onNodeWithText("处理备注（可选）").performTextInput("模拟器验证：已联系确认")
        compose.onNodeWithText("确认已处理").performClick()
        compose.waitUntil(15_000) { compose.onAllNodesWithText("已结束 2").fetchSemanticsNodes().isNotEmpty() }
        compose.onNodeWithText("已结束 2").performClick()
        compose.onNodeWithTag("care-list").performScrollToNode(hasText("处理备注：模拟器验证：已联系确认"))
        compose.onNodeWithText("处理备注：模拟器验证：已联系确认").assertIsDisplayed()
        File(directory, "family-task-app.png").outputStream().use { compose.onRoot().captureToImage().asAndroidBitmap().compress(Bitmap.CompressFormat.PNG, 100, it) }
        compose.onNodeWithContentDescription("更多操作").performClick()
        compose.onNodeWithText("退出登录").performClick()
        compose.waitUntil(15_000) { compose.onAllNodesWithText("邮箱或用户名").fetchSemanticsNodes().isNotEmpty() }
    }
}
