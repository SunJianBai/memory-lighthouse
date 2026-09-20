package com.sun.minicpmo_android.lighthouse.model

import org.json.JSONObject
import java.time.Instant

data class CompanionAuthorizationCheck(val allowed: Boolean, val missingScopes: List<String>) {
    val summary: String
        get() = if (allowed) "已授权" else "请家属在“隐私与授权”开启" + missingScopes.joinToString("、") {
            when (it) {
                "MICROPHONE_CAPTURE" -> "陪伴麦克风"
                "CAMERA_CAPTURE" -> "陪伴摄像头"
                "MODEL_PROCESSING" -> "全模态模型处理"
                else -> "所需功能"
            }
        }
}

data class DeviceReadinessView(
    val deviceId: String,
    val bindingId: String,
    val checkedAt: String,
    val audio: CompanionAuthorizationCheck,
    val audioVideo: CompanionAuthorizationCheck,
    val modelConfigured: Boolean,
) {
    companion object {
        fun fromJson(json: JSONObject): DeviceReadinessView {
            require(json.getInt("schemaVersion") == 1) { "检查结果版本不支持，请更新应用" }
            val checkedAt = json.getString("checkedAt")
            Instant.parse(checkedAt)
            val model = json.getJSONObject("model")
            require(model.getString("connectionStatus") == "NOT_TESTED") { "检查结果格式不支持，请更新应用" }
            val configuration = model.getString("configurationStatus")
            require(configuration in setOf("CONFIGURED", "INVALID")) { "检查结果格式不支持，请更新应用" }
            fun authorization(name: String): CompanionAuthorizationCheck {
                val check = json.getJSONObject("authorization").getJSONObject(name)
                val scopes = check.getJSONArray("missingScopes")
                val missing = (0 until scopes.length()).map { scopes.getString(it) }
                val allowed = check.getBoolean("allowed")
                require(allowed == missing.isEmpty()) { "检查结果不完整，请重试" }
                return CompanionAuthorizationCheck(allowed, missing)
            }
            return DeviceReadinessView(json.getString("deviceId"), json.getString("bindingId"), checkedAt,
                authorization("audio"), authorization("audioVideo"), configuration == "CONFIGURED")
        }
    }
}
