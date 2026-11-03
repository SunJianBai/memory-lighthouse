package com.sun.minicpmo_android.lighthouse.ui

import androidx.compose.material3.MaterialTheme
import androidx.compose.ui.test.*
import androidx.compose.ui.test.junit4.createComposeRule
import com.sun.minicpmo_android.lighthouse.model.RoutineView
import org.junit.Assert.*
import org.junit.Rule
import org.junit.Test

class RoutineLifecycleDialogTest {
    @get:Rule val compose = createComposeRule()
    private val routine = RoutineView("r", "h", "elder", "ACTIVITY", null, "散步", "慢走", "完成了吗", "FAMILY", "ACTIVE", emptyList(), "2026-11-03T00:00:00Z", 1)
    @Test fun pauseRequiresExplicitConfirmationAndExplainsPreservedReview() {
        var calls = 0
        compose.setContent { MaterialTheme { RoutineLifecycleDialog(routine, false, null, {}, { calls++ }, {}) } }
        compose.onNodeWithText("暂停这个日程？").assertIsDisplayed()
        compose.onNodeWithText("暂停后，尚未确认的提醒将关闭。待家属核验记录和已有待办会保留。").assertIsDisplayed()
        compose.runOnIdle { assertEquals(0, calls) }
        compose.onNodeWithText("暂停日程").performClick()
        compose.runOnIdle { assertEquals(1, calls) }
    }
    @Test fun expiredPausedScheduleOffersEditAndResumeDoesNotBackfill() {
        var edited = false
        compose.setContent { MaterialTheme { RoutineLifecycleDialog(routine.copy(status = "PAUSED"), false, "原安排没有后续提醒时间，请先修改日期或重复规则", {}, {}, { edited = true }) } }
        compose.onNodeWithText("只安排恢复后的提醒，不补发暂停期间的提醒。").performScrollTo().assertIsDisplayed()
        compose.onNodeWithText("编辑日程").performScrollTo().performClick()
        compose.runOnIdle { assertTrue(edited) }
    }
    @Test fun submittingDisablesRepeatedSubmitAndDismiss() {
        compose.setContent { MaterialTheme { RoutineLifecycleDialog(routine, true, null, {}, {}, {}) } }
        compose.onNodeWithText("处理中…").assertIsNotEnabled()
        compose.onNodeWithText("取消").assertIsNotEnabled()
    }
}
