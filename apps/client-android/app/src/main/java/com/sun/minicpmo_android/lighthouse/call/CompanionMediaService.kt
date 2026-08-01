package com.sun.minicpmo_android.lighthouse.call

import android.Manifest
import android.app.Notification
import android.app.NotificationChannel
import android.app.NotificationManager
import android.app.PendingIntent
import android.app.Service
import android.content.Context
import android.content.Intent
import android.content.pm.PackageManager
import android.content.pm.ServiceInfo
import android.os.IBinder
import androidx.core.app.NotificationCompat
import androidx.core.app.ServiceCompat
import androidx.core.content.ContextCompat
import com.sun.minicpmo_android.LighthouseApplication
import com.sun.minicpmo_android.MainActivity
import com.sun.minicpmo_android.R
import com.sun.minicpmo_android.lighthouse.model.RemoteSessionView

/**
 * Media foreground service. It is created only after an explicit local answer
 * and is never sticky, so process reconstruction cannot silently reopen media.
 */
class CompanionMediaService : Service() {
    private val coordinator by lazy {
        (application as LighthouseApplication).appGraph.callCoordinator
    }
    private var sessionId: String? = null

    override fun onStartCommand(intent: Intent?, flags: Int, startId: Int): Int {
        val id = intent?.getStringExtra(EXTRA_SESSION_ID)
        if (id.isNullOrBlank()) {
            stopSelf()
            return START_NOT_STICKY
        }
        sessionId = id
        val needsMicrophone = intent.getBooleanExtra(EXTRA_MICROPHONE, true)
        val needsCamera = intent.getBooleanExtra(EXTRA_CAMERA, true)
        if (!hasRequiredPermissions(needsMicrophone, needsCamera)) {
            coordinator.mediaForegroundFailed(id)
            stopSelf()
            return START_NOT_STICKY
        }

        return try {
            createChannel()
            ServiceCompat.startForeground(
                this,
                MEDIA_NOTIFICATION_ID,
                mediaNotification(id, needsMicrophone, needsCamera),
                foregroundTypes(needsMicrophone, needsCamera),
            )
            coordinator.mediaForegroundStarted(id)
            START_NOT_STICKY
        } catch (_: Throwable) {
            coordinator.mediaForegroundFailed(id)
            stopSelf()
            START_NOT_STICKY
        }
    }

    override fun onDestroy() {
        sessionId?.let(coordinator::mediaForegroundLost)
        super.onDestroy()
    }

    override fun onBind(intent: Intent?): IBinder? = null

    private fun hasRequiredPermissions(microphone: Boolean, camera: Boolean): Boolean =
        (!microphone || hasPermission(Manifest.permission.RECORD_AUDIO)) &&
            (!camera || hasPermission(Manifest.permission.CAMERA))

    private fun foregroundTypes(microphone: Boolean, camera: Boolean): Int {
        var types = 0
        if (microphone) types = types or ServiceInfo.FOREGROUND_SERVICE_TYPE_MICROPHONE
        if (camera) types = types or ServiceInfo.FOREGROUND_SERVICE_TYPE_CAMERA
        return types
    }

    private fun mediaNotification(
        id: String,
        microphone: Boolean,
        camera: Boolean,
    ): Notification {
        val media = buildList {
            if (microphone) add("麦克风")
            if (camera) add("摄像头")
        }.joinToString("和")
        val hangup = PendingIntent.getService(
            this,
            id.hashCode() xor 0x52,
            Intent(this, CompanionCallService::class.java)
                .setAction("online.sun227454.memorylighthouse.call.HANG_UP")
                .putExtra(CompanionCallService.EXTRA_SESSION_ID, id),
            PendingIntent.FLAG_UPDATE_CURRENT or PendingIntent.FLAG_IMMUTABLE,
        )
        val content = PendingIntent.getActivity(
            this,
            id.hashCode() xor 0x53,
            Intent(this, MainActivity::class.java)
                .setAction(CompanionCallService.ACTION_OPEN_INCOMING)
                .putExtra(CompanionCallService.EXTRA_SESSION_ID, id)
                .addFlags(Intent.FLAG_ACTIVITY_NEW_TASK or Intent.FLAG_ACTIVITY_SINGLE_TOP),
            PendingIntent.FLAG_UPDATE_CURRENT or PendingIntent.FLAG_IMMUTABLE,
        )
        return NotificationCompat.Builder(this, MEDIA_CHANNEL_ID)
            .setSmallIcon(R.drawable.ic_launcher_foreground)
            .setContentTitle("家属通话正在使用$media")
            .setContentText("挂断、拒绝、撤权或异常时会立即释放")
            .setContentIntent(content)
            .addAction(0, "挂断", hangup)
            .setCategory(NotificationCompat.CATEGORY_CALL)
            .setPriority(NotificationCompat.PRIORITY_HIGH)
            .setVisibility(NotificationCompat.VISIBILITY_PUBLIC)
            .setOngoing(true)
            .setOnlyAlertOnce(true)
            .build()
    }

    private fun createChannel() {
        getSystemService(NotificationManager::class.java).createNotificationChannel(
            NotificationChannel(
                MEDIA_CHANNEL_ID,
                "通话摄像头与麦克风",
                NotificationManager.IMPORTANCE_HIGH,
            ).apply {
                description = "现场接听后才会运行的实时通话媒体服务"
                lockscreenVisibility = Notification.VISIBILITY_PUBLIC
            },
        )
    }

    private fun hasPermission(permission: String): Boolean =
        ContextCompat.checkSelfPermission(this, permission) == PackageManager.PERMISSION_GRANTED

    companion object {
        private const val EXTRA_SESSION_ID = "remote-session-id"
        private const val EXTRA_MICROPHONE = "use-microphone"
        private const val EXTRA_CAMERA = "use-camera"
        private const val MEDIA_CHANNEL_ID = "remote-assistance-media-v1"
        private const val MEDIA_NOTIFICATION_ID = 7_202

        fun start(context: Context, remote: RemoteSessionView) {
            ContextCompat.startForegroundService(
                context,
                Intent(context, CompanionMediaService::class.java)
                    .putExtra(EXTRA_SESSION_ID, remote.id)
                    .putExtra(EXTRA_MICROPHONE, remote.media.receiveDeviceAudio)
                    .putExtra(EXTRA_CAMERA, remote.media.receiveDeviceVideo),
            )
        }

        fun stop(context: Context) {
            context.stopService(Intent(context, CompanionMediaService::class.java))
        }
    }
}
