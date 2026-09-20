package com.sun.minicpmo_android.lighthouse.ui

import androidx.compose.material3.MaterialTheme
import androidx.compose.ui.test.*
import androidx.compose.ui.test.junit4.createComposeRule
import com.sun.minicpmo_android.lighthouse.model.CareRecipientView
import com.sun.minicpmo_android.lighthouse.model.LighthouseUiState
import org.junit.Rule
import org.junit.Test

class FamilyResourceErrorUiTest {
    @get:Rule val compose = createComposeRule()
    private val state = LighthouseUiState(
        selectedRecipientId = "elder",
        recipients = listOf(CareRecipientView("elder", "home", "长者", "长者", null, "Asia/Shanghai", null, "ACTIVE", 1)),
        consentLoadError = "请使用顶部刷新重试。",
        memoryLoadError = "请使用顶部刷新重试。",
    )

    @Test fun consentFailureDoesNotOfferAnUninformedDecision() {
        compose.setContent { MaterialTheme { PrivacySection(state) { _, _ -> error("no decision allowed") } } }
        compose.onNodeWithText("暂时无法读取授权状态").assertIsDisplayed()
        compose.onNodeWithText("未授权").assertDoesNotExist()
        compose.onNodeWithText("查看并授权").assertDoesNotExist()
        compose.onNodeWithText("撤回").assertDoesNotExist()
    }

    @Test fun failedMemoriesAreNotReportedAsEmpty() {
        compose.setContent { MaterialTheme { MemoriesSection(state, {}, {}, {}) } }
        compose.onNodeWithText("记忆未能加载").assertIsDisplayed()
        compose.onNodeWithText("还没有记忆").assertDoesNotExist()
    }
}
