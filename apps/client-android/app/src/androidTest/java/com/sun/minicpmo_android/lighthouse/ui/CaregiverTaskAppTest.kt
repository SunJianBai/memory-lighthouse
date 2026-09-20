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

/** Real API: VIEW_EVENTS alone must allow tasks despite denied routine/consent reads. */
@RunWith(AndroidJUnit4::class)
class CaregiverTaskAppTest {
    private val compose = createAndroidComposeRule<MainActivity>()
    private val setup = object : ExternalResource() {
        override fun before() {
            val args = InstrumentationRegistry.getArguments()
            val api = args.getString("careApiBase")
            assumeTrue("Local caregiver fixture required", api != null && args.getString("caregiverUsername") != null)
            require(BuildConfig.APPLICATION_ID.endsWith(".iterationtest"))
            require(api!!.startsWith("http://127.0.0.1:13100/"))
            AppSettingsRepository(InstrumentationRegistry.getInstrumentation().targetContext).saveApiBaseUrl(api)
        }
    }
    @get:Rule val rules: TestRule = RuleChain.outerRule(setup).around(compose)

    @Test fun authorizedTasksRemainUsableWhenOtherModulesAreDenied() {
        val args = InstrumentationRegistry.getArguments()
        compose.waitUntil(15_000) { compose.onAllNodesWithText("邮箱或用户名").fetchSemanticsNodes().isNotEmpty() }
        compose.onNodeWithText("邮箱或用户名").performTextInput(requireNotNull(args.getString("caregiverUsername")))
        compose.onNodeWithText("密码", substring = false).performTextInput("Local-Care-Fixture-2026!")
        compose.onNode(hasText("安全登录") and hasClickAction()).performScrollTo().performClick()
        compose.waitUntil(15_000) { compose.onAllNodesWithText("查看日程与待办").fetchSemanticsNodes().isNotEmpty() }
        compose.onNodeWithText("查看日程与待办").performScrollTo().performClick()
        compose.onNodeWithTag("care-list").performScrollToNode(hasText("日程未能加载"))
        compose.onNodeWithText("日程未能加载").assertIsDisplayed()
        compose.onNodeWithText("暂无日程").assertDoesNotExist()
        compose.onNodeWithTag("care-list").performScrollToNode(hasText("测试待办-CLAIMED"))
        val card = hasTestTag("family-task-card") and hasAnyDescendant(hasText("测试待办-CLAIMED"))
        compose.onNode(hasText("由负责人处理") and hasAnyAncestor(card)).performScrollTo().assertIsDisplayed()
        compose.onNode(hasText("完成", substring = false) and hasAnyAncestor(card)).assertDoesNotExist()
        compose.onNode(hasText("不再处理", substring = false) and hasAnyAncestor(card)).assertDoesNotExist()
        val directory = args.getString("additionalTestOutputDir")?.let(::File)
            ?: InstrumentationRegistry.getInstrumentation().targetContext.getExternalFilesDir("qa")!!
        directory.mkdirs()
        File(directory, "family-task-caregiver.png").outputStream().use {
            compose.onRoot().captureToImage().asAndroidBitmap().compress(Bitmap.CompressFormat.PNG, 100, it)
        }
        compose.onNodeWithContentDescription("更多操作").performClick()
        compose.onNodeWithText("退出登录").performClick()
        compose.waitUntil(15_000) { compose.onAllNodesWithText("邮箱或用户名").fetchSemanticsNodes().isNotEmpty() }
    }
}
