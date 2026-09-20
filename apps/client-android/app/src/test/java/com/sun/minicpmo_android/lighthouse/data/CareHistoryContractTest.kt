package com.sun.minicpmo_android.lighthouse.data

import com.sun.minicpmo_android.lighthouse.model.CareHistoryFilter
import org.json.JSONArray
import org.json.JSONObject
import org.junit.Assert.*
import org.junit.Test

class CareHistoryContractTest {
    private fun page() = JSONObject()
        .put("items", JSONArray().put(JSONObject().put("id", "event").put("householdId", "home").put("recipientId", "elder")
            .put("type", "ROUTINE_CONFIRMED").put("sourceType", "FAMILY").put("severity", "INFO")
            .put("title", "照护记录").put("summary", "家属原文").put("occurredAt", "2026-09-01T00:00:00Z")))
        .put("nextCursor", "opaque_cursor").put("timezone", "Asia/Shanghai")
        .put("from", JSONObject.NULL).put("to", JSONObject.NULL)

    @Test fun encodesTheNewPageContractWithoutChangingLegacyArrayRoutes() {
        assertEquals("households/home/care-recipients/elder/events/history?limit=30", CareHistoryContract.path("home", "elder", CareHistoryKind.EVENTS, CareHistoryFilter()))
        assertEquals("households/home/care-recipients/elder/occurrences/history?limit=30&startDate=2026-08-01&endDate=2026-08-31&status=EXPIRED&cursor=opaque_cursor",
            CareHistoryContract.path("home", "elder", CareHistoryKind.OCCURRENCES, CareHistoryFilter("2026-08-01", "2026-08-31", "EXPIRED"), "opaque_cursor"))
        assertEquals("households/home/care-recipients/elder/events", FamilyApiContract.careEventsPath("home", "elder"))
    }

    @Test fun validatesActualCalendarDatesAndInclusiveRange() {
        assertNull(CareHistoryFilter("2024-02-29", "2024-03-30").validationError())
        assertNull(CareHistoryFilter().validationError())
        for (filter in listOf(CareHistoryFilter("2026-02-30", "2026-03-01"), CareHistoryFilter("2026-09-02", "2026-09-01"),
            CareHistoryFilter("2026-01-01", "2026-02-01"), CareHistoryFilter("2026-01-01"), CareHistoryFilter("", ""),
            CareHistoryFilter("1899-12-31", "1900-01-01"))) {
            assertNotNull(filter.validationError())
            assertThrows(IllegalArgumentException::class.java) { CareHistoryContract.path("home", "elder", CareHistoryKind.EVENTS, filter) }
        }
    }

    @Test fun rejectsEventStatusUnknownOccurrenceStatusAndEmptyCursor() {
        assertThrows(IllegalArgumentException::class.java) { CareHistoryContract.path("home", "elder", CareHistoryKind.EVENTS, CareHistoryFilter(status = "CONFIRMED")) }
        assertThrows(IllegalArgumentException::class.java) { CareHistoryContract.path("home", "elder", CareHistoryKind.OCCURRENCES, CareHistoryFilter(status = "UNKNOWN")) }
        assertThrows(IllegalArgumentException::class.java) { CareHistoryContract.path("home", "elder", CareHistoryKind.EVENTS, CareHistoryFilter(), "") }
    }

    @Test fun parsesEventsOnlyAfterCheckingTheirScope() {
        val parsed = CareHistoryContract.parse(page(), "home", "elder", FamilyJsonMapper::parseCareEvent)
        assertEquals("照护记录", parsed.items.single().title)
        assertEquals("opaque_cursor", parsed.nextCursor)
        assertEquals("Asia/Shanghai", parsed.timezone)
        assertNull(parsed.from)
        assertThrows(IllegalArgumentException::class.java) { CareHistoryContract.parse(page(), "home", "other", FamilyJsonMapper::parseCareEvent) }
        assertThrows(IllegalArgumentException::class.java) { CareHistoryContract.parse(page(), "other", "elder", FamilyJsonMapper::parseCareEvent) }
    }

    @Test fun distinguishesEmptyLastPageFromMalformedMetadata() {
        val empty = page().put("items", JSONArray()).put("nextCursor", JSONObject.NULL)
        assertTrue(CareHistoryContract.parse(empty, "home", "elder", FamilyJsonMapper::parseCareEvent).items.isEmpty())
        val missing = page().also { it.remove("nextCursor") }
        assertThrows(IllegalArgumentException::class.java) { CareHistoryContract.parse(missing, "home", "elder", FamilyJsonMapper::parseCareEvent) }
        assertThrows(IllegalArgumentException::class.java) { CareHistoryContract.parse(page().put("from", "2026-09-01T00:00:00Z"), "home", "elder", FamilyJsonMapper::parseCareEvent) }
    }
}
