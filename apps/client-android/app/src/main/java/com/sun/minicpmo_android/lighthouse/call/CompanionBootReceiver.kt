package com.sun.minicpmo_android.lighthouse.call

import android.content.BroadcastReceiver
import android.content.Context
import android.content.Intent
import com.sun.minicpmo_android.LighthouseApplication

class CompanionBootReceiver : BroadcastReceiver() {
    override fun onReceive(context: Context, intent: Intent) {
        if (
            intent.action !in setOf(
                Intent.ACTION_BOOT_COMPLETED,
                Intent.ACTION_MY_PACKAGE_REPLACED,
            )
        ) {
            return
        }
        val graph = (context.applicationContext as LighthouseApplication).appGraph
        if (graph.repository.hasDeviceCredential()) {
            CompanionCallService.start(context)
        }
    }
}
