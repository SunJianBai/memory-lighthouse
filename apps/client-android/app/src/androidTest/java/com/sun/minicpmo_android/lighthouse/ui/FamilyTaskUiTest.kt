package com.sun.minicpmo_android.lighthouse.ui

import androidx.compose.foundation.layout.Column
import androidx.compose.material3.MaterialTheme
import androidx.compose.runtime.*
import androidx.compose.ui.test.*
import androidx.compose.ui.test.junit4.createComposeRule
import com.sun.minicpmo_android.lighthouse.model.FamilyTaskView
import com.sun.minicpmo_android.lighthouse.model.FamilyTaskFilter
import org.junit.Rule
import org.junit.Test

class FamilyTaskUiTest {
    @get:Rule val compose = createComposeRule()
    private fun task() = FamilyTaskView("task", "elder", "internal-event", "other", "CLAIMED", "NORMAL", null, null, null, null, 1, "需要联系长者", "核对是否需要帮助", "测试家属", false, false, false)
    @Test fun otherAssigneeHasNoFinishOrClaimButton() {
        compose.setContent { MaterialTheme { FamilyTaskCard(task(), false, "Asia/Shanghai", {}, { _, _ -> }) } }
        compose.onNodeWithText("负责人：测试家属").assertIsDisplayed()
        compose.onNodeWithText("由负责人处理").assertIsDisplayed()
        compose.onNodeWithText("完成", substring = false).assertDoesNotExist()
        compose.onNodeWithText("认领", substring = false).assertDoesNotExist()
        compose.onNodeWithText("internal-event", substring = true).assertDoesNotExist()
    }
    @Test fun filtersAreSelectableAndMineDoesNotIncludeOtherMembers() {
        compose.setContent { MaterialTheme {
            var selected by remember { mutableStateOf(FamilyTaskFilter.UNFINISHED) }
            val tasks = listOf(task())
            Column {
                FamilyTaskFilters(tasks, selected, false) { selected = it }
                FamilyTaskFilter.entries.forEach { filter -> if (selected == filter && filter.select(tasks).isEmpty()) androidx.compose.material3.Text(filter.emptyLabel) }
            }
        } }
        compose.onNodeWithText("我负责 0").performClick().assertIsSelected()
        compose.onNodeWithText("暂无由你负责的未完成事项").assertIsDisplayed()
        compose.onNodeWithText("全部未完成 1").performClick().assertIsSelected()
    }
    @Test fun busyStateDisablesMutations() {
        compose.setContent { MaterialTheme { FamilyTaskCard(task().copy(assigneeMemberId = null, status = "OPEN", canClaim = true, canFinish = true), true, "Asia/Shanghai", {}, { _, _ -> }) } }
        compose.onNodeWithText("认领").assertIsNotEnabled()
        compose.onNodeWithText("完成").assertIsNotEnabled()
        compose.onNodeWithText("不再处理").assertIsNotEnabled()
    }
}
