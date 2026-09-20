package com.sun.minicpmo_android.lighthouse.ui

import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.width
import androidx.compose.material3.MaterialTheme
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.CompositionLocalProvider
import androidx.compose.ui.Modifier
import androidx.compose.ui.platform.LocalDensity
import androidx.compose.ui.unit.Density
import androidx.compose.ui.unit.dp
import androidx.compose.ui.test.*
import androidx.compose.ui.test.junit4.createComposeRule
import com.sun.minicpmo_android.lighthouse.model.CareEventView
import com.sun.minicpmo_android.lighthouse.model.OccurrenceView
import org.junit.Assert.assertEquals
import org.junit.Rule
import org.junit.Test

class CareHistoryUiTest {
    @get:Rule val compose = createComposeRule()
    private val occurrence = OccurrenceView("o", "h", "r", "rule", "散步提醒", "ACTIVITY", "家属原文", "2026-12-31T16:30:00Z", "2027-01-01", "EXPIRED", null, null, null, 1)

    @Test fun closedReminderIsNotCompletedAndTimezoneUpdates() {
        val zone = mutableStateOf("Asia/Shanghai")
        compose.setContent { MaterialTheme { OccurrenceCard(occurrence, zone.value) { _, _ -> error("Read-only record") } } }
        compose.onNodeWithText("已关闭").assertIsDisplayed()
        compose.onNodeWithText("2027-01-01 00:30").assertIsDisplayed()
        compose.onNodeWithText("核验已完成").assertDoesNotExist()
        compose.runOnIdle { zone.value = "America/Los_Angeles" }
        compose.onNodeWithText("2026-12-31 08:30").assertIsDisplayed()
        compose.onNodeWithText("2027-01-01 00:30").assertDoesNotExist()
    }

    @Test fun reviewActionsRemainAvailableOnlyForReviewStatus() {
        var result: Boolean? = null
        compose.setContent { MaterialTheme { OccurrenceCard(occurrence.copy(status = "NEEDS_FAMILY_REVIEW"), "Asia/Shanghai") { _, verified -> result = verified } } }
        compose.onNodeWithText("待家属核验").assertIsDisplayed()
        compose.onNodeWithText("核验未完成").performClick()
        compose.runOnIdle { assertEquals(false, result) }
        compose.onNodeWithText("核验已完成").performClick()
        compose.runOnIdle { assertEquals(true, result) }
    }

    @Test fun unknownMetadataAndLongTitleFitNarrowCardWithLargeText() {
        compose.setContent { MaterialTheme {
            CompositionLocalProvider(LocalDensity provides Density(LocalDensity.current.density, 1.5f)) {
                Column(Modifier.width(300.dp)) {
                    CareEventCard(CareEventView("e", "UNKNOWN_TYPE", "UNKNOWN_LEVEL", "UNKNOWN_SOURCE", "这是一条需要完整阅读的较长照护记录标题", "保留原文", "invalid"), "invalid/zone")
                }
            }
        } }
        compose.onNodeWithText("来源待确认 · 其他动态").assertIsDisplayed()
        compose.onNodeWithText("级别未知").assertIsDisplayed()
        compose.onNodeWithText("时间未知").assertIsDisplayed()
        compose.onNodeWithText("这是一条需要完整阅读的较长照护记录标题").assertIsDisplayed()
        compose.onNodeWithText("UNKNOWN_SOURCE", substring = true).assertDoesNotExist()
    }
}
