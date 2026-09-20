package com.sun.minicpmo_android.lighthouse.ui

import androidx.compose.material3.MaterialTheme
import androidx.compose.ui.test.*
import androidx.compose.ui.test.junit4.createComposeRule
import android.view.View
import android.widget.DatePicker
import androidx.test.espresso.Espresso.onView
import androidx.test.espresso.UiController
import androidx.test.espresso.ViewAction
import androidx.test.espresso.action.ViewActions.click
import androidx.test.espresso.matcher.ViewMatchers.isAssignableFrom
import androidx.test.espresso.matcher.ViewMatchers.withId
import com.sun.minicpmo_android.lighthouse.model.RoutineInput
import com.sun.minicpmo_android.lighthouse.model.RoutineScheduleView
import com.sun.minicpmo_android.lighthouse.model.RoutineView
import org.junit.Assert.*
import org.junit.Rule
import org.junit.Test

class RoutineEditorUiTest {
    @get:Rule val compose = createComposeRule()
    private val routine = RoutineView("r", "h", "elder", "ACTIVITY", null, "散步", "院内散步", "完成了吗？", "FAMILY_ENTERED_VERBATIM", "ACTIVE", listOf(RoutineScheduleView("s", "Asia/Shanghai", 540, 62, "2026-09-21", "2026-09-27", 5, 15, 1)), "2026-09-20T00:00:00Z", 1)
    @Test fun changeWeeklyToOnceSavesDateBoundsAndRetainsContent() {
        var saved: RoutineInput? = null
        compose.setContent { MaterialTheme { RoutineEditorDialog(routine, "Asia/Shanghai", false, onDismiss = {}, onSave = { saved = it }) } }
        compose.onNodeWithText("仅一次").performScrollTo().performClick().assertIsSelected()
        compose.onNodeWithText("提醒日期").performScrollTo().performTextReplacement("2026-09-26")
        compose.onNodeWithText("仅一次 · 2026-09-26 09:00（Asia/Shanghai）").performScrollTo().assertIsDisplayed()
        compose.onNodeWithText("保存日程").performClick()
        compose.runOnIdle {
            assertEquals("2026-09-26", saved?.startDate)
            assertEquals(saved?.startDate, saved?.endDate)
            assertEquals(127, saved?.weekdayMask)
            assertEquals("散步", saved?.title)
        }
    }
    @Test fun emptyWeekdaysCannotBeSavedAndFailureRemainsVisible() {
        compose.setContent { MaterialTheme { RoutineEditorDialog(routine, "Asia/Shanghai", false, error = "保存失败，请重试", onDismiss = {}, onSave = { error("must not save") }) } }
        compose.onNodeWithText("自选星期").performScrollTo().performClick()
        for (day in listOf("周一", "周二", "周三", "周四", "周五")) compose.onNodeWithText(day).performScrollTo().performClick()
        compose.onNodeWithText("请至少选择一个星期").performScrollTo().assertIsDisplayed()
        compose.onNodeWithText("保存失败，请重试").performScrollTo().assertIsDisplayed()
        compose.onNodeWithText("保存日程").assertIsNotEnabled()
    }

    @Test fun nativeDatePickerReturnsSelectedDateToTheForm() {
        compose.setContent { MaterialTheme { RoutineEditorDialog(routine, "Asia/Shanghai", false, onDismiss = {}, onSave = {}) } }
        compose.onNodeWithContentDescription("选择开始日期").performScrollTo().performClick()
        onView(isAssignableFrom(DatePicker::class.java)).perform(object : ViewAction {
            override fun getConstraints() = isAssignableFrom(DatePicker::class.java)
            override fun getDescription() = "Select September 25, 2026 in the native date picker"
            override fun perform(uiController: UiController, view: View) {
                (view as DatePicker).updateDate(2026, 8, 25)
                uiController.loopMainThreadUntilIdle()
            }
        })
        onView(withId(android.R.id.button1)).perform(click())
        compose.onNodeWithText("开始日期").assertTextContains("2026-09-25")
    }
    @Test fun titleOnlyEditPreservesSameDayWeekdayMask() {
        var saved: RoutineInput? = null
        val sameDay = routine.copy(schedules = listOf(routine.schedules.single().copy(endDate = "2026-09-21")))
        compose.setContent { MaterialTheme { RoutineEditorDialog(sameDay, "Asia/Shanghai", false, onDismiss = {}, onSave = { saved = it }) } }
        compose.onNodeWithText("标题").performScrollTo().performTextReplacement("仅修改标题")
        compose.onNodeWithText("保存日程").performClick()
        compose.runOnIdle { assertEquals(62, saved?.weekdayMask) }
    }
}
