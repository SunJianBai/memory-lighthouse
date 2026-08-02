package com.sun.minicpmo_android.lighthouse.call

import android.app.Notification
import android.app.NotificationChannel
import android.app.NotificationManager
import android.app.PendingIntent
import android.app.Service
import android.content.Context
import android.content.Intent
import android.content.pm.ServiceInfo
import android.os.Build
import android.os.IBinder
import androidx.core.app.NotificationCompat
import androidx.core.app.Person
import androidx.core.content.ContextCompat
import androidx.core.app.ServiceCompat
import com.sun.minicpmo_android.LighthouseApplication
import com.sun.minicpmo_android.MainActivity
import com.sun.minicpmo_android.R
import com.sun.minicpmo_android.lighthouse.model.RemoteSessionView
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.SupervisorJob
import kotlinx.coroutines.cancel
import kotlinx.coroutines.launch

/**
 * User-visible, authenticated incoming-call discovery for a dedicated companion
 * device. It never requests camera or microphone access.
 */
class CompanionCallService : Service(), CompanionCallRuntime {
    private val serviceScope = CoroutineScope(SupervisorJob() + Dispatchers.Main.immediate)
    private val coordinator by lazy {
        (application as LighthouseApplication).appGraph.callCoordinator
    }

    override fun onCreate() {
        super.onCreate()
        createChannels()
        showDiscovery()
        coordinator.attachRuntime(this)
    }

    override fun onStartCommand(intent: Intent?, flags: Int, startId: Int): Int {
        val sessionId = intent?.getStringExtra(EXTRA_SESSION_ID)
        when (intent?.action) {
            ACTION_DECLINE -> sessionId?.let { id ->
                serviceScope.launch { coordinator.declineIncoming(id) }
            }
            ACTION_HANG_UP -> sessionId?.let { id ->
                serviceScope.launch { coordinator.endCompanionCall(id) }
            }
        }
        return START_STICKY
    }

    override fun onDestroy() {
        coordinator.detachRuntime(this)
        serviceScope.cancel()
        super.onDestroy()
    }

    override fun onBind(intent: Intent?): IBinder? = null

    override fun showDiscovery() {
        promote(discoveryNotification())
    }

    override fun showIncoming(session: RemoteSessionView) {
        promote(incomingNotification(session))
    }

    override fun showOngoing(session: RemoteSessionView) {
        promote(ongoingNotification(session))
    }

    override fun stopAfterRevocation() {
        ServiceCompat.stopForeground(this, ServiceCompat.STOP_FOREGROUND_REMOVE)
        stopSelf()
    }

    private fun promote(notification: Notification) {
        ServiceCompat.startForeground(
            this,
            CALL_NOTIFICATION_ID,
            notification,
            if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.UPSIDE_DOWN_CAKE) {
                ServiceInfo.FOREGROUND_SERVICE_TYPE_SPECIAL_USE
            } else {
                0
            },
        )
    }

    private fun discoveryNotification(): Notification =
        NotificationCompat.Builder(this, DISCOVERY_CHANNEL_ID)
            .setSmallIcon(R.drawable.ic_launcher_foreground)
            .setContentTitle("守忆灯塔陪伴端正在守候")
            .setContentText("仅使用加密设备凭据检查家属来电，不会开启摄像头或麦克风")
            .setContentIntent(openAppIntent())
            .setCategory(NotificationCompat.CATEGORY_SERVICE)
            .setPriority(NotificationCompat.PRIORITY_LOW)
            .setOngoing(true)
            .setOnlyAlertOnce(true)
            .build()

    private fun incomingNotification(session: RemoteSessionView): Notification {
        val caller = caller()
        return NotificationCompat.Builder(this, CALL_CHANNEL_ID)
            .setSmallIcon(R.drawable.ic_launcher_foreground)
            .setContentTitle("家属正在呼叫")
            .setContentText("需要现场明确接听；接听前不会开启摄像头或麦克风")
            .setContentIntent(openIncomingIntent(session.id))
            .setStyle(
                NotificationCompat.CallStyle.forIncomingCall(
                    caller,
                    serviceAction(ACTION_DECLINE, session.id, 10),
                    answerActivityIntent(session.id),
                ),
            )
            .addPerson(caller)
            .setCategory(NotificationCompat.CATEGORY_CALL)
            .setPriority(NotificationCompat.PRIORITY_MAX)
            .setVisibility(NotificationCompat.VISIBILITY_PUBLIC)
            .setOngoing(true)
            .setAutoCancel(false)
            .build()
    }

    private fun ongoingNotification(session: RemoteSessionView): Notification {
        val caller = caller()
        return NotificationCompat.Builder(this, CALL_CHANNEL_ID)
            .setSmallIcon(R.drawable.ic_launcher_foreground)
            .setContentTitle("正在与家属通话")
            .setContentText("通话不录音、不录像、不转写")
            .setContentIntent(openIncomingIntent(session.id))
            .setStyle(
                NotificationCompat.CallStyle.forOngoingCall(
                    caller,
                    serviceAction(ACTION_HANG_UP, session.id, 20),
                ),
            )
            .addPerson(caller)
            .setCategory(NotificationCompat.CATEGORY_CALL)
            .setPriority(NotificationCompat.PRIORITY_MAX)
            .setVisibility(NotificationCompat.VISIBILITY_PUBLIC)
            .setOngoing(true)
            .setAutoCancel(false)
            .setOnlyAlertOnce(true)
            .build()
    }

    private fun caller() = Person.Builder()
        .setName("家属")
        .setImportant(true)
        .build()

    private fun openAppIntent(): PendingIntent = PendingIntent.getActivity(
        this,
        1,
        Intent(this, MainActivity::class.java).addFlags(
            Intent.FLAG_ACTIVITY_NEW_TASK or Intent.FLAG_ACTIVITY_SINGLE_TOP,
        ),
        PendingIntent.FLAG_UPDATE_CURRENT or PendingIntent.FLAG_IMMUTABLE,
    )

    private fun openIncomingIntent(sessionId: String): PendingIntent = PendingIntent.getActivity(
        this,
        sessionId.hashCode(),
        Intent(this, MainActivity::class.java)
            .setAction(ACTION_OPEN_INCOMING)
            .putExtra(EXTRA_SESSION_ID, sessionId)
            .addFlags(Intent.FLAG_ACTIVITY_NEW_TASK or Intent.FLAG_ACTIVITY_SINGLE_TOP),
        PendingIntent.FLAG_UPDATE_CURRENT or PendingIntent.FLAG_IMMUTABLE,
    )

    private fun answerActivityIntent(sessionId: String): PendingIntent = PendingIntent.getActivity(
        this,
        sessionId.hashCode() xor 0x41,
        Intent(this, MainActivity::class.java)
            .setAction(ACTION_ANSWER)
            .putExtra(EXTRA_SESSION_ID, sessionId)
            .addFlags(Intent.FLAG_ACTIVITY_NEW_TASK or Intent.FLAG_ACTIVITY_SINGLE_TOP),
        PendingIntent.FLAG_UPDATE_CURRENT or PendingIntent.FLAG_IMMUTABLE,
    )

    private fun serviceAction(action: String, sessionId: String, salt: Int): PendingIntent =
        PendingIntent.getService(
            this,
            sessionId.hashCode() xor salt,
            Intent(this, CompanionCallService::class.java)
                .setAction(action)
                .putExtra(EXTRA_SESSION_ID, sessionId),
            PendingIntent.FLAG_UPDATE_CURRENT or PendingIntent.FLAG_IMMUTABLE,
        )

    private fun createChannels() {
        val manager = getSystemService(NotificationManager::class.java)
        manager.createNotificationChannel(
            NotificationChannel(
                DISCOVERY_CHANNEL_ID,
                "陪伴端来电守候",
                NotificationManager.IMPORTANCE_LOW,
            ).apply {
                description = "在专用陪伴模式下使用加密设备凭据发现来电"
                setShowBadge(false)
            },
        )
        manager.createNotificationChannel(
            NotificationChannel(
                CALL_CHANNEL_ID,
                "家属通话",
                NotificationManager.IMPORTANCE_HIGH,
            ).apply {
                description = "不可忽略的家属来电和通话控制"
                lockscreenVisibility = Notification.VISIBILITY_PUBLIC
            },
        )
    }

    companion object {
        const val ACTION_ANSWER = "online.sun227454.memorylighthouse.call.ANSWER"
        const val ACTION_OPEN_INCOMING = "online.sun227454.memorylighthouse.call.OPEN"
        private const val ACTION_START = "online.sun227454.memorylighthouse.call.START"
        private const val ACTION_DECLINE = "online.sun227454.memorylighthouse.call.DECLINE"
        private const val ACTION_HANG_UP = "online.sun227454.memorylighthouse.call.HANG_UP"
        const val EXTRA_SESSION_ID = "remote-session-id"
        const val CALL_CHANNEL_ID = "remote-assistance-calls-v1"
        const val CALL_NOTIFICATION_ID = 7_201
        private const val DISCOVERY_CHANNEL_ID = "companion-call-discovery-v1"

        fun start(context: Context) {
            ContextCompat.startForegroundService(
                context,
                Intent(context, CompanionCallService::class.java).setAction(ACTION_START),
            )
        }

        fun openIncomingUi(context: Context, sessionId: String) {
            context.startActivity(
                Intent(context, MainActivity::class.java)
                    .setAction(ACTION_OPEN_INCOMING)
                    .putExtra(EXTRA_SESSION_ID, sessionId)
                    .addFlags(Intent.FLAG_ACTIVITY_NEW_TASK or Intent.FLAG_ACTIVITY_SINGLE_TOP),
            )
        }
    }
}
