package com.sun.minicpmo_android.lighthouse.data

import com.sun.minicpmo_android.lighthouse.model.UserSession
import com.sun.minicpmo_android.lighthouse.network.LighthouseHttpClient
import io.mockk.coEvery
import io.mockk.every
import io.mockk.mockk
import java.io.IOException
import kotlinx.coroutines.test.runTest
import org.json.JSONArray
import org.json.JSONObject
import org.junit.Assert.*
import org.junit.Test

class RoutineLifecycleRepositoryTest {
    @Test fun lostPauseResponseAndLaterManualRetryReuseDurableKeyAndResumeUsesDifferentKey() = runTest {
        val vault = mockk<CredentialVault>(relaxed = true)
        every { vault.userSession() } returns UserSession("token", "2099-01-01T00:00:00Z", "refresh", "2099-01-01T00:00:00Z", "session")
        every { vault.userCareNamespace() } returns "family-1"
        var pending: String? = null
        every { vault.careCommandState() } answers { pending }
        every { vault.saveCareCommandState(any()) } answers { pending = firstArg() }
        val http = mockk<LighthouseHttpClient>()
        val keys = mutableListOf<String>()
        var offline = true
        coEvery { http.request("POST", any(), any(), "token", any()) } answers {
            assertEquals(1, thirdArg<JSONObject>().length())
            assertNotNull(pending)
            keys += arg<Map<String, String>>(4).getValue("Idempotency-Key")
            if (offline) throw IOException("response lost")
            routineJson(if (secondArg<String>().endsWith("pause")) "PAUSED" else "ACTIVE")
        }
        val repo = LighthouseRepository(mockk(relaxed = true), vault, mockk(relaxed = true), http)
        val routine = FamilyJsonMapper.parseRoutine(routineJson("ACTIVE"))
        assertTrue(runCatching { repo.setRoutinePaused("h", routine, true) }.isFailure)
        offline = false
        val paused = repo.setRoutinePaused("h", routine, true)
        assertEquals("PAUSED", paused.status)
        assertEquals(1, keys.distinct().size)
        assertNull(pending)
        repo.setRoutinePaused("h", paused, false)
        assertEquals(2, keys.distinct().size)
    }

    @Test fun readsIncludePausedAndMapperKeepsLatestSavedInactiveSchedule() = runTest {
        val vault = mockk<CredentialVault>(relaxed = true)
        every { vault.userSession() } returns UserSession("token", "2099-01-01T00:00:00Z", "refresh", "2099-01-01T00:00:00Z", "session")
        val http = mockk<LighthouseHttpClient>()
        coEvery { http.request("GET", "households/h/care-recipients/r/routines?includePaused=true", null, "token", emptyMap()) } returns JSONObject().put("value", JSONArray().put(routineJson("PAUSED")))
        val repo = LighthouseRepository(mockk(relaxed = true), vault, mockk(relaxed = true), http)
        val result = repo.listRoutines("h", "r").single()
        assertEquals("PAUSED", result.status)
        assertEquals(570, result.schedules.single().localTimeMinutes)
    }

    @Test fun closureReasonIsOptionalAndPreservesUnknownValuesWithoutCompleting() {
        val json = JSONObject("""{"id":"o","householdId":"h","recipientId":"r","routineId":"rule","routineTitle":"散步","routineType":"ACTIVITY","instructions":"慢走","scheduledAtUtc":"2026-11-03T00:00:00Z","scheduledLocalDate":"2026-11-03","status":"EXPIRED","version":2}""")
        assertNull(FamilyJsonMapper.parseOccurrence(json).closureReason)
        json.put("closureReason", "ROUTINE_PAUSED")
        assertEquals("ROUTINE_PAUSED", FamilyJsonMapper.parseOccurrence(json).closureReason)
        assertNull(FamilyJsonMapper.parseOccurrence(json).completedAt)
        json.put("closureReason", "NEW_REASON")
        assertEquals("NEW_REASON", FamilyJsonMapper.parseOccurrence(json).closureReason)
    }

    private fun routineJson(status: String) = JSONObject("""{"id":"rule","householdId":"h","recipientId":"r","type":"ACTIVITY","medicationId":null,"title":"散步","instructions":"慢走","confirmationQuestion":"完成了吗","contentProvenance":"FAMILY_ENTERED_VERBATIM","status":"$status","updatedAt":"2026-11-03T00:00:00Z","version":2,"schedules":[{"id":"s","timezone":"Asia/Shanghai","localTimeMinutes":570,"weekdayMask":127,"startDate":"2026-11-03","endDate":null,"graceMinutes":5,"familyNoticeMinutes":15,"scheduleVersion":2,"active":false}]}""")
}
