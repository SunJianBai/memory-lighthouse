package com.sun.minicpmo_android.lighthouse.ui

import android.graphics.Bitmap
import android.widget.DatePicker
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.safeDrawingPadding
import androidx.compose.foundation.layout.width
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.verticalScroll
import androidx.compose.runtime.CompositionLocalProvider
import androidx.compose.runtime.Composable
import androidx.compose.material3.Surface
import androidx.compose.runtime.mutableStateOf
import androidx.compose.ui.Modifier
import androidx.compose.ui.platform.LocalDensity
import androidx.compose.ui.test.*
import androidx.compose.ui.test.junit4.createComposeRule
import androidx.compose.ui.unit.Density
import androidx.compose.ui.unit.dp
import androidx.test.espresso.Espresso.onView
import androidx.test.espresso.action.ViewActions.click
import androidx.test.espresso.assertion.ViewAssertions.matches
import androidx.test.espresso.matcher.ViewMatchers.*
import androidx.test.platform.app.InstrumentationRegistry
import com.sun.minicpmo_android.lighthouse.data.CareHistoryKind
import com.sun.minicpmo_android.lighthouse.model.*
import com.sun.minicpmo_android.ui.theme.LighthouseTheme
import java.io.File
import org.junit.Assert.*
import org.junit.Rule
import org.junit.Test

class CareHistoryControlsTest {
    @get:Rule val compose = createComposeRule()
    private val filter = CareHistoryFilter("2026-08-01", "2026-08-31")
    private fun page(cursor: String? = null) = CareHistoryPage(listOf("one", "two"), cursor, "Asia/Shanghai", null, null)

    @Composable private fun TestSurface(darkTheme: Boolean = false, content: @Composable () -> Unit) {
        LighthouseTheme(darkTheme = darkTheme) {
            Surface(Modifier.fillMaxSize()) {
                Box(Modifier.safeDrawingPadding().padding(16.dp)) { content() }
            }
        }
    }

    private fun screenshot(name: String) {
        val directory = InstrumentationRegistry.getArguments().getString("additionalTestOutputDir")?.let(::File)
            ?: InstrumentationRegistry.getInstrumentation().targetContext.getExternalFilesDir("qa")!!
        directory.mkdirs()
        File(directory, name).outputStream().use {
            InstrumentationRegistry.getInstrumentation().uiAutomation.takeScreenshot().compress(Bitmap.CompressFormat.PNG, 100, it)
        }
    }

    @Test fun dateDraftIsSeparateNativePickerOpensAndQueryResetWork() {
        val history = mutableStateOf(CareHistoryState<String>(filter = filter, page = page()))
        val submitted = mutableListOf<CareHistoryFilter?>()
        compose.setContent { TestSurface {
            Column(Modifier.verticalScroll(rememberScrollState())) {
                CareHistoryControls(CareHistoryKind.OCCURRENCES, history.value, "Asia/Shanghai", "a", false) {
                    submitted += it
                    history.value = CareHistoryState(filter = requireNotNull(it), page = page())
                }
            }
        } }
        compose.onNodeWithText("查询历史").performClick()
        compose.onNodeWithContentDescription("选择开始日期").performScrollTo().performClick()
        onView(isAssignableFrom(DatePicker::class.java)).check(matches(isDisplayed()))
        onView(withId(android.R.id.button2)).perform(click())
        compose.onNodeWithText("开始日期").performTextReplacement("2026-07-01")
        compose.onNodeWithText("结束日期").performTextReplacement("2026-07-31")
        compose.runOnIdle { assertTrue(submitted.isEmpty()) }
        compose.onNodeWithTag("history-status").performScrollTo().performClick()
        compose.onNodeWithText("已关闭").performClick()
        compose.onNodeWithText("查询", substring = false).performScrollTo().performClick()
        compose.runOnIdle { assertEquals(CareHistoryFilter("2026-07-01", "2026-07-31", "EXPIRED"), submitted.single()) }
        compose.onNodeWithText("恢复近期").performScrollTo().performClick()
        compose.runOnIdle { assertEquals(CareHistoryFilter(), submitted.last()) }
        compose.onNodeWithText("恢复近期").assertDoesNotExist()
    }

    @Test fun invalidAndOverlongDatesStayInFormWithoutApplying() {
        var submitted = false
        compose.setContent { TestSurface {
            Column(Modifier.verticalScroll(rememberScrollState())) {
                CareHistoryControls(CareHistoryKind.EVENTS, CareHistoryState<String>(filter = filter), "Asia/Shanghai", "a", false) { submitted = true }
            }
        } }
        compose.onNodeWithText("查询历史").performClick()
        compose.onNodeWithText("开始日期").performTextReplacement("2026-02-30")
        compose.onNodeWithText("查询", substring = false).performScrollTo().performClick()
        compose.onNodeWithText("请填写有效的开始和结束日期").assertIsDisplayed()
        compose.onNodeWithText("开始日期").performScrollTo().performTextReplacement("2026-07-01")
        compose.onNodeWithText("查询", substring = false).performScrollTo().performClick()
        compose.onNodeWithText("每次最多查询 31 天，请缩小日期范围").assertIsDisplayed()
        compose.onNodeWithTag("history-status").assertDoesNotExist()
        compose.runOnIdle { assertFalse(submitted) }
    }

    @Test fun footerDistinguishesRetryFromEndAndKeepsLoadedCount() {
        val history = mutableStateOf(CareHistoryState(filter = filter, page = page("next")))
        var more = 0
        var retry = 0
        compose.setContent { TestSurface { Column {
            CareHistoryControls(CareHistoryKind.EVENTS, history.value, "Asia/Shanghai", "a", false) {}
            CareHistoryFooter(history.value, false, { retry++ }, { more++ })
        } } }
        compose.onNodeWithText("已加载 2 条").assertIsDisplayed()
        compose.onNodeWithText("加载更多").performClick()
        compose.runOnIdle { history.value = history.value.copy(error = "网络中断", retry = CareHistoryRetry.MORE) }
        compose.onNodeWithText("重试加载更多").performClick()
        compose.runOnIdle {
            assertEquals(2, more)
            history.value = history.value.copy(page = null, error = "权限已撤回", accessDenied = true, retry = CareHistoryRetry.REFRESH)
        }
        compose.onNodeWithText("已加载 2 条").assertDoesNotExist()
        compose.onNodeWithText("重新查询").performClick()
        compose.runOnIdle { assertEquals(1, retry); history.value = CareHistoryState(page = page()) }
        compose.onNodeWithText("本次查询已加载完").assertIsDisplayed()
        compose.onNodeWithText("加载更多").assertDoesNotExist()
    }

    @Test fun narrowLargeTextLightDarkFormsAndScopeResetRemainUsable() {
        val dark = mutableStateOf(false)
        val scope = mutableStateOf("a-1")
        val history = mutableStateOf(CareHistoryState<String>(filter = filter))
        compose.setContent { TestSurface(darkTheme = dark.value) {
            CompositionLocalProvider(LocalDensity provides Density(LocalDensity.current.density, 2f)) {
                Column(Modifier.width(300.dp).verticalScroll(rememberScrollState())) {
                    CareHistoryControls(CareHistoryKind.OCCURRENCES, history.value, "Asia/Shanghai", scope.value, false) {}
                }
            }
        } }
        compose.onNodeWithText("查询历史").performScrollTo().performClick()
        compose.onNodeWithText("开始日期").performScrollTo().assertIsDisplayed()
        screenshot("history-query-light-large.png")
        compose.runOnIdle { dark.value = true }
        compose.onNodeWithText("结束日期").performScrollTo().assertIsDisplayed()
        screenshot("history-query-dark-large.png")
        compose.onNodeWithText("查询", substring = false).performScrollTo().assertIsDisplayed()
        compose.runOnIdle { scope.value = "a-2"; history.value = CareHistoryState() }
        compose.onNodeWithText("查询历史").performScrollTo().assertIsDisplayed()
        compose.onNodeWithText("开始日期").assertDoesNotExist()
        compose.onNodeWithText("查询历史").performClick()
        compose.onNodeWithText("2026-08-01", substring = false).assertDoesNotExist()
    }

    @Test fun loadingMoreRemindersDoesNotResetTheEventsDraftInTheRealCareList() {
        val recipient = CareRecipientView("r", "h", "测试长者", "测试长者", null, "Asia/Shanghai", null, "ACTIVE", 1)
        val occurrence = OccurrenceView("o", "h", "r", "rule", "饮水提醒", "HYDRATION", "原文", "2026-08-01T00:00:00Z", "2026-08-01", "CONFIRMED", null, null, null, 1)
        val state = mutableStateOf(LighthouseUiState(restoring = false, signedIn = true, selectedHouseholdId = "h", selectedRecipientId = "r", recipients = listOf(recipient),
            occurrenceHistory = CareHistoryState(page = CareHistoryPage(listOf(occurrence), "next", "Asia/Shanghai", null, null)),
            eventHistory = CareHistoryState(filter = filter, page = CareHistoryPage(emptyList(), null, "Asia/Shanghai", null, null))))
        val queries = mutableListOf<Pair<CareHistoryKind, CareHistoryFilter?>>()
        compose.setContent { TestSurface { CareSection(state.value,
            onQueryHistory = { kind, value -> queries += kind to value }, onMoreHistory = {},
            onAddRoutine = {}, onEditRoutine = {}, onDeleteRoutine = {}, onVerifyOccurrence = { _, _ -> },
            onClaimTask = {}, onReleaseTask = {}, onFinishTask = { _, _ -> }) } }
        compose.onNodeWithTag("care-list").performScrollToKey("event-history-controls")
        compose.onNode(hasText("查询历史") and hasAnyAncestor(hasTestTag("care-history-events-controls"))).performClick()
        compose.onNodeWithText("开始日期").performTextReplacement("2026-08-03")
        compose.runOnIdle {
            state.value = state.value.copy(occurrenceHistory = CareHistoryState(page = CareHistoryPage(listOf(occurrence, occurrence.copy(id = "o-2")), null, "Asia/Shanghai", null, null)))
        }
        compose.onNodeWithTag("care-list").performScrollToKey("event-history-controls")
        compose.onNodeWithText("2026-08-03").assertExists()
        compose.onNodeWithText("查询", substring = false).performClick()
        compose.runOnIdle { assertEquals(CareHistoryKind.EVENTS to filter.copy(startDate = "2026-08-03"), queries.single()) }
        compose.onNodeWithText("开始日期").assertIsNotFocused()
        screenshot("history-query-care-list.png")
    }
}
