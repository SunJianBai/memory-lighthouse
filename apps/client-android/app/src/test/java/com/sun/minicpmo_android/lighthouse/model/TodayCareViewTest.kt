package com.sun.minicpmo_android.lighthouse.model

import org.json.JSONObject
import org.junit.Assert.assertEquals
import org.junit.Assert.assertThrows
import org.junit.Test

class TodayCareViewTest {
    private fun payload() = JSONObject("""{"householdId":"home-a","recipientId":"elder-a","localDate":"2026-09-20","timezone":"Asia/Shanghai","generatedAt":"2026-09-20T04:00:00Z","counts":{"total":10,"confirmed":2,"needsReview":2,"pending":5,"expired":1},"openTaskCount":3,"items":[{"id":"1","title":"饮水","scheduledAt":"2026-09-20T00:00:00Z","status":"NEEDS_FAMILY_REVIEW"}]}""")
    @Test fun parsesServerSnapshotWithoutUsingListLengthAsTotal() {
        val parsed = TodayCareView.fromJson(payload())
        assertEquals(10, parsed.total)
        assertEquals(1, parsed.items.size)
        assertEquals(3, parsed.openTaskCount)
        assertEquals("NEEDS_FAMILY_REVIEW", parsed.items.single().status)
    }
    @Test fun rejectsMissingCountsInsteadOfDisplayingZeros() {
        assertThrows(Exception::class.java) { TodayCareView.fromJson(payload().apply { remove("counts") }) }
    }
    @Test fun validatesTimezoneBeforeTheComposableFormatsIt() {
        assertThrows(Exception::class.java) { TodayCareView.fromJson(payload().put("timezone", "not-a-timezone")) }
    }
    @Test fun rejectsInvalidTimesAndNegativeTotals() {
        assertThrows(Exception::class.java) { TodayCareView.fromJson(payload().put("generatedAt", "invalid")) }
        assertThrows(Exception::class.java) { TodayCareView.fromJson(payload().apply { getJSONObject("counts").put("total", -1) }) }
    }
}
