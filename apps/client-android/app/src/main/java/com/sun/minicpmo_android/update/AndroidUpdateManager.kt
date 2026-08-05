package com.sun.minicpmo_android.update

import android.app.Activity
import android.content.Intent
import android.content.pm.PackageManager
import android.net.Uri
import android.os.Build
import android.provider.Settings
import androidx.core.content.FileProvider
import com.sun.minicpmo_android.BuildConfig
import java.io.File
import java.io.FileOutputStream
import java.net.URI
import java.security.MessageDigest
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.SupervisorJob
import kotlinx.coroutines.cancel
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.asStateFlow
import kotlinx.coroutines.launch
import kotlinx.coroutines.withContext
import okhttp3.OkHttpClient
import okhttp3.Request
import org.json.JSONObject

data class AndroidReleaseInfo(
    val versionCode: Int,
    val versionName: String,
    val apkUrl: String,
    val sha256: String,
    val releaseNotes: List<String>,
    val mandatory: Boolean,
)

sealed interface AppUpdateState {
    data object Idle : AppUpdateState
    data class Available(val release: AndroidReleaseInfo) : AppUpdateState
    data class Downloading(val release: AndroidReleaseInfo, val progress: Int?) : AppUpdateState
    data class Ready(val release: AndroidReleaseInfo, val apk: File) : AppUpdateState
    data class Failed(val release: AndroidReleaseInfo?, val message: String) : AppUpdateState
}

object AndroidUpdateManifestParser {
    fun parse(value: String): AndroidReleaseInfo {
        val json = JSONObject(value)
        val versionCode = json.getInt("versionCode")
        val versionName = json.getString("versionName").trim()
        val apkUrl = json.getString("apkUrl").trim()
        val sha256 = json.getString("sha256").lowercase().trim()
        require(versionCode > 0) { "更新版本号无效" }
        require(versionName.isNotEmpty()) { "更新版本名称为空" }
        require(URI(apkUrl).scheme == "https") { "更新地址必须使用 HTTPS" }
        require(sha256.matches(Regex("[0-9a-f]{64}"))) { "更新校验值无效" }
        val notes = json.optJSONArray("releaseNotes")?.let { array ->
            buildList {
                for (index in 0 until array.length()) {
                    array.optString(index).trim().takeIf(String::isNotEmpty)?.let(::add)
                }
            }
        }.orEmpty()
        return AndroidReleaseInfo(
            versionCode = versionCode,
            versionName = versionName,
            apkUrl = apkUrl,
            sha256 = sha256,
            releaseNotes = notes,
            mandatory = json.optBoolean("mandatory", false),
        )
    }
}

class AndroidUpdateManager(private val activity: Activity) {
    private val client = OkHttpClient.Builder().followRedirects(true).build()
    private val scope = CoroutineScope(SupervisorJob() + Dispatchers.Main.immediate)
    private val mutableState = MutableStateFlow<AppUpdateState>(AppUpdateState.Idle)
    val state: StateFlow<AppUpdateState> = mutableState.asStateFlow()

    fun checkForUpdate(manual: Boolean = false) {
        scope.launch {
            runCatching {
                withContext(Dispatchers.IO) {
                    val request = Request.Builder()
                        .url(BuildConfig.ANDROID_UPDATE_MANIFEST_URL)
                        .header("Accept", "application/json")
                        .build()
                    client.newCall(request).execute().use { response ->
                        check(response.isSuccessful) { "版本服务暂时不可用（${response.code}）" }
                        AndroidUpdateManifestParser.parse(
                            response.body?.string() ?: error("版本服务返回为空"),
                        )
                    }
                }
            }.onSuccess { release ->
                mutableState.value = if (release.versionCode > BuildConfig.VERSION_CODE) {
                    AppUpdateState.Available(release)
                } else {
                    AppUpdateState.Idle
                }
            }.onFailure { error ->
                mutableState.value = if (manual) {
                    AppUpdateState.Failed(null, error.message ?: "检查更新失败")
                } else {
                    AppUpdateState.Idle
                }
            }
        }
    }

    fun download() {
        val release = when (val current = mutableState.value) {
            is AppUpdateState.Available -> current.release
            is AppUpdateState.Failed -> current.release
            else -> null
        } ?: return
        scope.launch {
            mutableState.value = AppUpdateState.Downloading(release, null)
            runCatching { withContext(Dispatchers.IO) { downloadAndVerify(release) } }
                .onSuccess { apk -> mutableState.value = AppUpdateState.Ready(release, apk) }
                .onFailure { error ->
                    mutableState.value = AppUpdateState.Failed(
                        release,
                        error.message ?: "更新包下载失败，请稍后重试",
                    )
                }
        }
    }

    fun install() {
        val ready = mutableState.value as? AppUpdateState.Ready ?: return
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O &&
            !activity.packageManager.canRequestPackageInstalls()
        ) {
            activity.startActivity(
                Intent(
                    Settings.ACTION_MANAGE_UNKNOWN_APP_SOURCES,
                    Uri.parse("package:${activity.packageName}"),
                ),
            )
            return
        }
        val uri = FileProvider.getUriForFile(
            activity,
            "${activity.packageName}.updates",
            ready.apk,
        )
        activity.startActivity(
            Intent(Intent.ACTION_VIEW).apply {
                setDataAndType(uri, "application/vnd.android.package-archive")
                addFlags(Intent.FLAG_GRANT_READ_URI_PERMISSION)
                addFlags(Intent.FLAG_ACTIVITY_NEW_TASK)
            },
        )
    }

    fun dismiss() {
        val mandatory = when (val current = mutableState.value) {
            is AppUpdateState.Available -> current.release.mandatory
            is AppUpdateState.Downloading -> current.release.mandatory
            is AppUpdateState.Ready -> current.release.mandatory
            else -> false
        }
        if (mandatory) return
        mutableState.value = AppUpdateState.Idle
    }

    fun close() {
        scope.cancel()
        client.dispatcher.executorService.shutdown()
        client.connectionPool.evictAll()
    }

    private fun downloadAndVerify(release: AndroidReleaseInfo): File {
        val updateRoot = File(activity.externalCacheDir ?: activity.cacheDir, "updates")
        check(updateRoot.exists() || updateRoot.mkdirs()) { "无法创建更新目录" }
        val target = File(updateRoot, "memory-lighthouse-${release.versionCode}.apk")
        val partial = File(updateRoot, "${target.name}.part")
        partial.delete()
        val request = Request.Builder().url(release.apkUrl).build()
        client.newCall(request).execute().use { response ->
            check(response.isSuccessful) { "更新包下载失败（${response.code}）" }
            val body = response.body ?: error("更新包内容为空")
            val total = body.contentLength().takeIf { it > 0 }
            val digest = MessageDigest.getInstance("SHA-256")
            var lastProgress: Int? = null
            body.byteStream().use { input ->
                FileOutputStream(partial).use { output ->
                    val buffer = ByteArray(DEFAULT_BUFFER_SIZE)
                    var downloaded = 0L
                    while (true) {
                        val count = input.read(buffer)
                        if (count < 0) break
                        output.write(buffer, 0, count)
                        digest.update(buffer, 0, count)
                        downloaded += count
                        val progress = total?.let { ((downloaded * 100) / it).toInt().coerceIn(0, 100) }
                        if (progress != null && progress != lastProgress) {
                            lastProgress = progress
                            mutableState.value = AppUpdateState.Downloading(release, progress)
                        }
                    }
                }
            }
            val actualHash = digest.digest().joinToString("") { "%02x".format(it) }
            check(actualHash == release.sha256) { "更新包校验失败，已停止安装" }
        }
        check(hasCurrentSigningCertificate(partial)) { "更新包签名与当前应用不一致" }
        target.delete()
        check(partial.renameTo(target)) { "无法保存已校验的更新包" }
        return target
    }

    @Suppress("DEPRECATION")
    private fun hasCurrentSigningCertificate(apk: File): Boolean {
        val flags = PackageManager.GET_SIGNING_CERTIFICATES
        val archive = activity.packageManager.getPackageArchiveInfo(apk.absolutePath, flags)
            ?: return false
        val installed = activity.packageManager.getPackageInfo(activity.packageName, flags)
        val archiveSigners = archive.signingInfo?.apkContentsSigners.orEmpty()
        val installedSigners = installed.signingInfo?.apkContentsSigners.orEmpty()
        if (archiveSigners.isEmpty() || installedSigners.isEmpty()) return false
        val digest = MessageDigest.getInstance("SHA-256")
        val expected = installedSigners.map { digest.digest(it.toByteArray()).toList() }.toSet()
        val actual = archiveSigners.map { digest.digest(it.toByteArray()).toList() }.toSet()
        return actual == expected
    }
}
