package com.sun.minicpmo_android.ui

import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertTrue
import org.junit.Test

class CompanionSettingsEntryPolicyTest {
    @Test
    fun embeddedCompanionKeepsReplyPreferencesReachableThroughADeliberateMenu() {
        val policy = companionSettingsEntryPolicy(
            embeddedInLighthouse = true,
            settingsEnabled = true,
        )

        assertTrue(policy.visible)
        assertTrue(policy.useOverflowMenu)
        assertTrue(policy.enabled)
        assertEquals("回答偏好", policy.label)
        assertEquals(null, policy.disabledHint)
    }

    @Test
    fun activeSessionKeepsTheEntryVisibleButExplainsWhyItCannotBeChanged() {
        val policy = companionSettingsEntryPolicy(
            embeddedInLighthouse = true,
            settingsEnabled = false,
        )

        assertTrue(policy.visible)
        assertTrue(policy.useOverflowMenu)
        assertFalse(policy.enabled)
        assertEquals("结束陪伴后可修改", policy.disabledHint)
    }

    @Test
    fun standaloneExperienceRetainsItsDirectSettingsButton() {
        val policy = companionSettingsEntryPolicy(
            embeddedInLighthouse = false,
            settingsEnabled = true,
        )

        assertTrue(policy.visible)
        assertFalse(policy.useOverflowMenu)
        assertEquals("打开设置", policy.label)
    }
}
