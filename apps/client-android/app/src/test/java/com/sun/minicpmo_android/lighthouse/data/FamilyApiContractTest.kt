package com.sun.minicpmo_android.lighthouse.data

import com.sun.minicpmo_android.lighthouse.model.CareRecipientInput
import com.sun.minicpmo_android.lighthouse.model.ConsentCatalog
import com.sun.minicpmo_android.lighthouse.model.MemoryInput
import com.sun.minicpmo_android.lighthouse.model.RoutineInput
import org.json.JSONArray
import org.json.JSONObject
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertNull
import org.junit.Assert.assertTrue
import org.junit.Test

class FamilyApiContractTest {
    @Test
    fun householdAndRecipientCreationTrimInputAndOmitBlankOptionalFields() {
        val household = FamilyApiContract.createHouseholdBody("  向阳之家  ", " Asia/Shanghai ")
        assertEquals("向阳之家", household.getString("name"))
        assertEquals("Asia/Shanghai", household.getString("timezone"))

        val recipient = FamilyApiContract.createRecipientBody(
            CareRecipientInput(
                name = "  王淑兰 ",
                preferredName = " 兰姨 ",
                birthDate = " ",
                timezone = " Asia/Shanghai ",
                homeLabel = null,
            ),
        )
        assertEquals("王淑兰", recipient.getString("name"))
        assertEquals("兰姨", recipient.getString("preferredName"))
        assertEquals("Asia/Shanghai", recipient.getString("timezone"))
        assertFalse(recipient.has("birthDate"))
        assertFalse(recipient.has("homeLabel"))
        assertEquals("households/h-1/care-recipients", FamilyApiContract.recipientsPath("h-1"))
    }

    @Test
    fun memoryMutationsPreserveSourceVersionAndVerificationContract() {
        val input = MemoryInput(
            kind = "PERSON",
            title = "  女儿小雨  ",
            content = "  每周六回家  ",
            sensitivity = "PRIVATE",
        )

        val create = FamilyApiContract.createMemoryBody(input)
        assertEquals("FAMILY", create.getString("source"))
        assertEquals("FAMILY_REPORTED", create.getString("verificationStatus"))
        assertEquals("女儿小雨", create.getString("title"))

        val update = FamilyApiContract.updateMemoryBody(input, version = 7)
        assertEquals(7, update.getInt("version"))
        assertTrue(update.getString("changeReason").contains("Android"))
        assertFalse(update.has("source"))
        assertEquals(
            "households/h-1/memories/m-1?version=7",
            FamilyApiContract.deleteMemoryPath("h-1", "m-1", 7),
        )
    }

    @Test
    fun routineMutationsCarryCompleteScheduleAndOptimisticVersion() {
        val input = RoutineInput(
            type = "MEDICATION",
            medicationId = null,
            title = " 晚间服药 ",
            instructions = " 饭后服用 ",
            confirmationQuestion = " 已经服下了吗？ ",
            timezone = "Asia/Shanghai",
            localTimeMinutes = 19 * 60 + 30,
            weekdayMask = 127,
            startDate = "2026-08-01",
            endDate = " ",
            graceMinutes = 30,
            familyNoticeMinutes = 60,
        )

        val update = FamilyApiContract.updateRoutineBody(input, version = 4)
        val schedule = update.getJSONObject("schedule")
        assertEquals(4, update.getInt("version"))
        assertEquals(1170, schedule.getInt("localTimeMinutes"))
        assertEquals(127, schedule.getInt("weekdayMask"))
        assertEquals(30, schedule.getInt("graceMinutes"))
        assertEquals(60, schedule.getInt("familyNoticeMinutes"))
        assertTrue(schedule.isNull("endDate"))
        assertTrue(update.isNull("medicationId"))
        assertEquals(
            "households/h-1/routines/r-1?version=4",
            FamilyApiContract.deleteRoutinePath("h-1", "r-1", 4),
        )
    }

    @Test
    fun familyActionsAndConsentDecisionsCarryConcurrencyAndIdempotencyData() {
        val verification = FamilyApiContract.familyVerifyBody(
            version = 3,
            idempotencyKey = "verify-123",
            verified = true,
            note = " 已电话确认 ",
        )
        assertEquals(3, verification.getInt("version"))
        assertEquals("verify-123", verification.getString("idempotencyKey"))
        assertTrue(verification.getBoolean("verified"))
        assertEquals("已电话确认", verification.getString("note"))

        val finish = FamilyApiContract.finishTaskBody(8, "FAMILY_CONFIRMED", null)
        assertEquals(8, finish.getInt("version"))
        assertEquals("FAMILY_CONFIRMED", finish.getString("resolutionCode"))
        assertFalse(finish.has("note"))

        assertEquals(
            "households/h-1/family-tasks/t-1/claim",
            FamilyApiContract.familyTaskActionPath("h-1", "t-1", "claim"),
        )
        assertEquals(
            "households/h-1/care-recipients/r-1/consents/CAMERA_CAPTURE/revoke",
            FamilyApiContract.consentDecisionPath("h-1", "r-1", "CAMERA_CAPTURE", false),
        )
        assertTrue(
            FamilyApiContract.occurrencesPath(
                "h-1",
                "r-1",
                "2026-08-01T00:00:00+08:00",
                "2026-08-02T00:00:00+08:00",
            ).contains("%2B08%3A00"),
        )
    }

    @Test
    fun responseMapperKeepsRevisionScheduleAndConsentDocumentVersions() {
        val memory = FamilyJsonMapper.parseMemory(
            JSONObject()
                .put("id", "m-1")
                .put("householdId", "h-1")
                .put("recipientId", "r-1")
                .put("kind", "PERSON")
                .put("title", "女儿小雨")
                .put("sensitivity", "PRIVATE")
                .put("verificationStatus", "FAMILY_REPORTED")
                .put("status", "ACTIVE")
                .put(
                    "currentRevision",
                    JSONObject()
                        .put("id", "mr-2")
                        .put("revisionNo", 2)
                        .put("content", "每周六回家")
                        .put("source", "FAMILY")
                        .put("changeReason", JSONObject.NULL)
                        .put("createdAt", "2026-08-01T00:00:00Z"),
                )
                .put("updatedAt", "2026-08-01T00:00:00Z")
                .put("version", 5),
        )
        assertEquals(2, memory.currentRevision.revisionNo)
        assertNull(memory.currentRevision.changeReason)
        assertEquals(5, memory.version)

        val routine = FamilyJsonMapper.parseRoutine(
            JSONObject()
                .put("id", "routine-1")
                .put("householdId", "h-1")
                .put("recipientId", "r-1")
                .put("type", "HYDRATION")
                .put("medicationId", JSONObject.NULL)
                .put("title", "喝水")
                .put("instructions", "喝一杯温水")
                .put("confirmationQuestion", "已经喝水了吗？")
                .put("contentProvenance", "FAMILY")
                .put("status", "ACTIVE")
                .put(
                    "schedules",
                    JSONArray().put(
                        JSONObject()
                            .put("id", "schedule-1")
                            .put("timezone", "Asia/Shanghai")
                            .put("localTimeMinutes", 540)
                            .put("weekdayMask", 127)
                            .put("startDate", "2026-08-01")
                            .put("endDate", JSONObject.NULL)
                            .put("graceMinutes", 20)
                            .put("familyNoticeMinutes", 30)
                            .put("scheduleVersion", 1),
                    ),
                )
                .put("updatedAt", "2026-08-01T00:00:00Z")
                .put("version", 2),
        )
        assertEquals(1, routine.schedules.size)
        assertEquals(540, routine.schedules.single().localTimeMinutes)
        assertNull(routine.schedules.single().endDate)

        val consent = FamilyJsonMapper.parseConsentState(
            JSONObject()
                .put("scope", "CAMERA_CAPTURE")
                .put("granted", true)
                .put("decision", "GRANTED")
                .put(
                    "lastEvent",
                    JSONObject()
                        .put("id", "consent-1")
                        .put("scope", "CAMERA_CAPTURE")
                        .put("decision", "GRANTED")
                        .put(
                            "documentVersion",
                            JSONObject()
                                .put("id", ConsentCatalog.definition("CAMERA_CAPTURE").documentVersionId)
                                .put("code", "privacy-camera")
                                .put("version", 1)
                                .put("publishedAt", "2026-08-01T00:00:00Z"),
                        )
                        .put("reason", "家属授权")
                        .put("occurredAt", "2026-08-01T00:00:00Z"),
                )
                .put("version", 9),
        )
        assertTrue(consent.granted)
        assertEquals(
            "01KYYD3S55C7TCKGXJ32HBEV8E",
            consent.lastEvent?.documentVersion?.id,
        )
        assertEquals(8, ConsentCatalog.entries.map { it.scope }.distinct().size)
    }
}
