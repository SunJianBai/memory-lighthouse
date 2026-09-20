package com.sun.minicpmo_android.lighthouse.model

import com.sun.minicpmo_android.lighthouse.data.FamilyJsonMapper
import org.json.JSONArray
import org.json.JSONObject
import org.junit.Assert.*
import org.junit.Test

class FamilyTaskBoardTest {
    private fun item() = JSONObject("""{"id":"task","householdId":"home","recipientId":"elder","sourceEventId":"event","assigneeMemberId":null,"status":"OPEN","priority":"NORMAL","dueAt":null,"resolvedAt":null,"resolutionCode":null,"resolutionNote":null,"version":0,"sourceTitle":"请联系长者","sourceSummary":"核对是否需要帮助","assigneeDisplayName":null,"assignedToMe":false,"canClaim":true,"canFinish":true}""")
    private fun board(item: JSONObject? = item()) = JSONObject().put("householdId", "home").put("recipientId", "elder").put("tasks", JSONArray().apply { item?.let(::put) })
    @Test fun parsesNamesContextAndActions() {
        val task = FamilyJsonMapper.parseFamilyTaskBoard(board(), "home", "elder").single()
        assertEquals("请联系长者", task.sourceTitle)
        assertTrue(task.canClaim)
        assertFalse(task.assignedToMe)
        assertTrue(FamilyJsonMapper.parseFamilyTaskBoard(board(null), "home", "elder").isEmpty())
    }
    @Test fun rejectsForeignSnapshotAndIndividualTask() {
        assertThrows(Exception::class.java) { FamilyJsonMapper.parseFamilyTaskBoard(board(), "other", "elder") }
        assertThrows(Exception::class.java) { FamilyJsonMapper.parseFamilyTaskBoard(board(item().put("recipientId", "other")), "home", "elder") }
    }
    @Test fun rejectsUnknownStatusAndNonBooleanActions() {
        assertThrows(Exception::class.java) { FamilyJsonMapper.parseFamilyTaskBoard(board(item().put("status", "UNKNOWN")), "home", "elder") }
        assertThrows(Exception::class.java) { FamilyJsonMapper.parseFamilyTaskBoard(board(item().put("canFinish", "true")), "home", "elder") }
    }
    @Test fun rejectsInvalidDeadlineAndDuplicates() {
        assertThrows(Exception::class.java) { FamilyJsonMapper.parseFamilyTaskBoard(board(item().put("dueAt", "tomorrow")), "home", "elder") }
        assertThrows(Exception::class.java) { FamilyJsonMapper.parseFamilyTaskBoard(board().apply { getJSONArray("tasks").put(item()) }, "home", "elder") }
    }
    @Test fun oldMutationResponsesRemainReadableWithoutInventingBoardActions() {
        val old = item().apply { listOf("sourceTitle", "sourceSummary", "assigneeDisplayName", "assignedToMe", "canClaim", "canFinish").forEach(::remove) }
        val task = FamilyJsonMapper.parseFamilyTask(old)
        assertEquals("task", task.id)
        assertFalse(task.canClaim)
        assertFalse(task.canFinish)
    }
    @Test fun mineExcludesFinishedAndClaimedIsNotFinished() {
        val open = FamilyJsonMapper.parseFamilyTask(item())
        val tasks = listOf(open, open.copy(id = "mine", status = "CLAIMED", assigneeMemberId = "me", assignedToMe = true), open.copy(id = "other", status = "CLAIMED", assigneeMemberId = "other"), open.copy(id = "done", status = "RESOLVED", assignedToMe = true), open.copy(id = "dismissed", status = "DISMISSED"))
        assertEquals(listOf("task", "mine", "other"), FamilyTaskFilter.UNFINISHED.select(tasks).map { it.id })
        assertEquals(listOf("task"), FamilyTaskFilter.UNCLAIMED.select(tasks).map { it.id })
        assertEquals(listOf("mine"), FamilyTaskFilter.MINE.select(tasks).map { it.id })
        assertEquals(listOf("done", "dismissed"), FamilyTaskFilter.ENDED.select(tasks).map { it.id })
    }
}
