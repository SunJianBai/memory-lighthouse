package com.sun.minicpmo_android.lighthouse.model

import org.json.JSONObject
import org.junit.Assert.*
import org.junit.Test

class DeviceReadinessViewTest {
    private fun json() = JSONObject("""{"schemaVersion":1,"deviceId":"device","bindingId":"binding","checkedAt":"2026-09-20T04:00:00Z","authorization":{"audio":{"allowed":true,"missingScopes":[]},"audioVideo":{"allowed":false,"missingScopes":["CAMERA_CAPTURE"]}},"model":{"configurationStatus":"CONFIGURED","connectionStatus":"NOT_TESTED"}}""")
    @Test fun mapsTheReadOnlyContractAndActionableConsentLabels() {
        val report = DeviceReadinessView.fromJson(json())
        assertTrue(report.audio.allowed)
        assertTrue(report.modelConfigured)
        assertEquals("已授权", report.audio.summary)
        assertEquals("请家属在“隐私与授权”开启陪伴摄像头", report.audioVideo.summary)
    }
    @Test fun rejectsUnsupportedAndIncompleteResponses() {
        assertThrows(Exception::class.java) { DeviceReadinessView.fromJson(json().put("schemaVersion", 2)) }
        assertThrows(Exception::class.java) { DeviceReadinessView.fromJson(json().put("checkedAt", "not a date")) }
        val contradictory = json()
        contradictory.getJSONObject("authorization").getJSONObject("audioVideo").put("allowed", true)
        assertThrows(Exception::class.java) { DeviceReadinessView.fromJson(contradictory) }
    }
}
