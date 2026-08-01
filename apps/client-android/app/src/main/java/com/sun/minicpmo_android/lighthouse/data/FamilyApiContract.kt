package com.sun.minicpmo_android.lighthouse.data

import com.sun.minicpmo_android.lighthouse.model.CareEventView
import com.sun.minicpmo_android.lighthouse.model.CareRecipientInput
import com.sun.minicpmo_android.lighthouse.model.CareRecipientView
import com.sun.minicpmo_android.lighthouse.model.ConsentDocumentVersionView
import com.sun.minicpmo_android.lighthouse.model.ConsentEventView
import com.sun.minicpmo_android.lighthouse.model.ConsentStateView
import com.sun.minicpmo_android.lighthouse.model.FamilyTaskView
import com.sun.minicpmo_android.lighthouse.model.HouseholdView
import com.sun.minicpmo_android.lighthouse.model.MemoryInput
import com.sun.minicpmo_android.lighthouse.model.MemoryRevisionView
import com.sun.minicpmo_android.lighthouse.model.MemoryView
import com.sun.minicpmo_android.lighthouse.model.OccurrenceView
import com.sun.minicpmo_android.lighthouse.model.RoutineInput
import com.sun.minicpmo_android.lighthouse.model.RoutineScheduleView
import com.sun.minicpmo_android.lighthouse.model.RoutineView
import org.json.JSONArray
import org.json.JSONObject
import java.net.URLEncoder
import java.nio.charset.StandardCharsets

internal object FamilyApiContract {
    fun householdsPath() = "households"

    fun createHouseholdBody(name: String, timezone: String) = JSONObject()
        .put("name", name.trim())
        .put("timezone", timezone.trim())

    fun recipientsPath(householdId: String) =
        "households/$householdId/care-recipients"

    fun createRecipientBody(input: CareRecipientInput) = JSONObject()
        .put("name", input.name.trim())
        .putOptionalText("preferredName", input.preferredName)
        .putOptionalText("birthDate", input.birthDate)
        .put("timezone", input.timezone.trim())
        .putOptionalText("homeLabel", input.homeLabel)

    fun memoriesPath(householdId: String, recipientId: String) =
        "households/$householdId/care-recipients/$recipientId/memories?limit=50"

    fun createMemoryPath(householdId: String, recipientId: String) =
        "households/$householdId/care-recipients/$recipientId/memories"

    fun memoryPath(householdId: String, memoryId: String) =
        "households/$householdId/memories/$memoryId"

    fun deleteMemoryPath(householdId: String, memoryId: String, version: Int) =
        "${memoryPath(householdId, memoryId)}?version=$version"

    fun createMemoryBody(input: MemoryInput) = memoryBody(input)
        .put("source", "FAMILY")

    fun updateMemoryBody(input: MemoryInput, version: Int) = memoryBody(input)
        .put("changeReason", "家属在 Android 记忆档案中更新")
        .put("version", version)

    private fun memoryBody(input: MemoryInput) = JSONObject()
        .put("kind", input.kind)
        .put("title", input.title.trim())
        .put("content", input.content.trim())
        .put("sensitivity", input.sensitivity)
        .put("verificationStatus", input.verificationStatus)

    fun routinesPath(householdId: String, recipientId: String) =
        "households/$householdId/care-recipients/$recipientId/routines"

    fun routinePath(householdId: String, routineId: String) =
        "households/$householdId/routines/$routineId"

    fun deleteRoutinePath(householdId: String, routineId: String, version: Int) =
        "${routinePath(householdId, routineId)}?version=$version"

    fun createRoutineBody(input: RoutineInput) = routineBody(input)

    fun updateRoutineBody(input: RoutineInput, version: Int) = routineBody(input)
        .put("version", version)

    private fun routineBody(input: RoutineInput) = JSONObject()
        .put("type", input.type)
        .put("medicationId", input.medicationId ?: JSONObject.NULL)
        .put("title", input.title.trim())
        .put("instructions", input.instructions.trim())
        .put("confirmationQuestion", input.confirmationQuestion.trim())
        .put(
            "schedule",
            JSONObject()
                .put("timezone", input.timezone.trim())
                .put("localTimeMinutes", input.localTimeMinutes)
                .put("weekdayMask", input.weekdayMask)
                .put("startDate", input.startDate.trim())
                .put("endDate", input.endDate?.trim()?.takeIf(String::isNotBlank) ?: JSONObject.NULL)
                .put("graceMinutes", input.graceMinutes)
                .put("familyNoticeMinutes", input.familyNoticeMinutes),
        )

    fun occurrencesPath(
        householdId: String,
        recipientId: String,
        from: String,
        to: String,
    ) = "households/$householdId/care-recipients/$recipientId/occurrences" +
        "?from=${query(from)}&to=${query(to)}"

    fun careEventsPath(householdId: String, recipientId: String) =
        "households/$householdId/care-recipients/$recipientId/events"

    fun familyTasksPath(householdId: String, recipientId: String) =
        "households/$householdId/family-tasks?recipientId=${query(recipientId)}"

    fun familyTaskActionPath(householdId: String, taskId: String, action: String) =
        "households/$householdId/family-tasks/$taskId/$action"

    fun claimTaskBody(version: Int) = JSONObject().put("version", version)

    fun finishTaskBody(version: Int, resolutionCode: String, note: String?) = JSONObject()
        .put("version", version)
        .put("resolutionCode", resolutionCode)
        .putOptionalText("note", note)

    fun familyVerifyPath(householdId: String, occurrenceId: String) =
        "households/$householdId/occurrences/$occurrenceId/family-verify"

    fun familyVerifyBody(
        version: Int,
        idempotencyKey: String,
        verified: Boolean,
        note: String?,
    ) = JSONObject()
        .put("version", version)
        .put("idempotencyKey", idempotencyKey)
        .put("verified", verified)
        .putOptionalText("note", note)

    fun consentsPath(householdId: String, recipientId: String) =
        "households/$householdId/care-recipients/$recipientId/consents"

    fun consentDecisionPath(
        householdId: String,
        recipientId: String,
        scope: String,
        grant: Boolean,
    ) = "${consentsPath(householdId, recipientId)}/$scope/${if (grant) "grant" else "revoke"}"

    fun consentDecisionBody(documentVersionId: String, reason: String) = JSONObject()
        .put("documentVersionId", documentVersionId)
        .put("reason", reason)

    private fun query(value: String): String =
        URLEncoder.encode(value, StandardCharsets.UTF_8.toString()).replace("+", "%20")
}

internal object FamilyJsonMapper {
    fun parseArray(json: JSONObject?): JSONArray = json?.optJSONArray("value") ?: JSONArray()

    fun parseHousehold(json: JSONObject) = HouseholdView(
        id = json.getString("id"),
        name = json.getString("name"),
        timezone = json.getString("timezone"),
        status = json.optString("status", "ACTIVE"),
        roleCodes = json.optJSONArray("roleCodes").strings(),
        version = json.optInt("version", 0),
    )

    fun parseRecipient(json: JSONObject) = CareRecipientView(
        id = json.getString("id"),
        householdId = json.getString("householdId"),
        name = json.getString("name"),
        preferredName = json.getString("preferredName"),
        birthDate = json.nullableString("birthDate"),
        timezone = json.getString("timezone"),
        homeLabel = json.nullableString("homeLabel"),
        status = json.optString("status", "ACTIVE"),
        version = json.optInt("version", 0),
    )

    fun parseMemory(json: JSONObject) = MemoryView(
        id = json.getString("id"),
        householdId = json.getString("householdId"),
        recipientId = json.getString("recipientId"),
        kind = json.getString("kind"),
        title = json.getString("title"),
        sensitivity = json.getString("sensitivity"),
        verificationStatus = json.getString("verificationStatus"),
        status = json.getString("status"),
        currentRevision = json.getJSONObject("currentRevision").let { revision ->
            MemoryRevisionView(
                id = revision.getString("id"),
                revisionNo = revision.getInt("revisionNo"),
                content = revision.getString("content"),
                source = revision.getString("source"),
                changeReason = revision.nullableString("changeReason"),
                createdAt = revision.getString("createdAt"),
            )
        },
        updatedAt = json.getString("updatedAt"),
        version = json.getInt("version"),
    )

    fun parseRoutine(json: JSONObject) = RoutineView(
        id = json.getString("id"),
        householdId = json.getString("householdId"),
        recipientId = json.getString("recipientId"),
        type = json.getString("type"),
        medicationId = json.nullableString("medicationId"),
        title = json.getString("title"),
        instructions = json.getString("instructions"),
        confirmationQuestion = json.getString("confirmationQuestion"),
        contentProvenance = json.getString("contentProvenance"),
        status = json.getString("status"),
        schedules = json.optJSONArray("schedules").objects().map { schedule ->
            RoutineScheduleView(
                id = schedule.getString("id"),
                timezone = schedule.getString("timezone"),
                localTimeMinutes = schedule.getInt("localTimeMinutes"),
                weekdayMask = schedule.getInt("weekdayMask"),
                startDate = schedule.getString("startDate"),
                endDate = schedule.nullableString("endDate"),
                graceMinutes = schedule.getInt("graceMinutes"),
                familyNoticeMinutes = schedule.getInt("familyNoticeMinutes"),
                scheduleVersion = schedule.getInt("scheduleVersion"),
            )
        },
        updatedAt = json.getString("updatedAt"),
        version = json.getInt("version"),
    )

    fun parseOccurrence(json: JSONObject) = OccurrenceView(
        id = json.getString("id"),
        householdId = json.getString("householdId"),
        recipientId = json.getString("recipientId"),
        routineId = json.getString("routineId"),
        routineTitle = json.getString("routineTitle"),
        routineType = json.getString("routineType"),
        instructions = json.getString("instructions"),
        scheduledAtUtc = json.getString("scheduledAtUtc"),
        scheduledLocalDate = json.getString("scheduledLocalDate"),
        status = json.getString("status"),
        confirmationDeadlineAt = json.nullableString("confirmationDeadlineAt"),
        escalationAt = json.nullableString("escalationAt"),
        completedAt = json.nullableString("completedAt"),
        version = json.getInt("version"),
    )

    fun parseCareEvent(json: JSONObject) = CareEventView(
        id = json.getString("id"),
        type = json.getString("type"),
        severity = json.getString("severity"),
        sourceType = json.getString("sourceType"),
        title = json.getString("title"),
        summary = json.getString("summary"),
        occurredAt = json.getString("occurredAt"),
    )

    fun parseFamilyTask(json: JSONObject) = FamilyTaskView(
        id = json.getString("id"),
        recipientId = json.getString("recipientId"),
        sourceEventId = json.getString("sourceEventId"),
        assigneeMemberId = json.nullableString("assigneeMemberId"),
        status = json.getString("status"),
        priority = json.getString("priority"),
        dueAt = json.nullableString("dueAt"),
        resolvedAt = json.nullableString("resolvedAt"),
        resolutionCode = json.nullableString("resolutionCode"),
        resolutionNote = json.nullableString("resolutionNote"),
        version = json.getInt("version"),
    )

    fun parseConsentState(json: JSONObject) = ConsentStateView(
        scope = json.getString("scope"),
        granted = json.getBoolean("granted"),
        decision = json.getString("decision"),
        lastEvent = json.optJSONObject("lastEvent")?.let(::parseConsentEvent),
        version = json.getInt("version"),
    )

    fun parseConsentEvent(json: JSONObject) = ConsentEventView(
        id = json.getString("id"),
        scope = json.getString("scope"),
        decision = json.getString("decision"),
        documentVersion = json.getJSONObject("documentVersion").let { document ->
            ConsentDocumentVersionView(
                id = document.getString("id"),
                code = document.getString("code"),
                version = document.getInt("version"),
                publishedAt = document.getString("publishedAt"),
            )
        },
        reason = json.nullableString("reason"),
        occurredAt = json.getString("occurredAt"),
    )
}

private fun JSONObject.putOptionalText(name: String, value: String?): JSONObject {
    value?.trim()?.takeIf(String::isNotBlank)?.let { put(name, it) }
    return this
}

private fun JSONObject.nullableString(name: String): String? =
    if (!has(name) || isNull(name)) null else optString(name).takeIf(String::isNotBlank)

private fun JSONArray?.objects(): List<JSONObject> = this?.let { value ->
    (0 until value.length()).mapNotNull(value::optJSONObject)
}.orEmpty()

private fun JSONArray?.strings(): List<String> = this?.let { value ->
    (0 until value.length()).mapNotNull { value.optString(it).takeIf(String::isNotBlank) }
}.orEmpty()
