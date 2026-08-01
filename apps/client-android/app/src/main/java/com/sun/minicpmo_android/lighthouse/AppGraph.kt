package com.sun.minicpmo_android.lighthouse

import android.content.Context
import com.sun.minicpmo_android.lighthouse.data.AppSettingsRepository
import com.sun.minicpmo_android.lighthouse.data.CompanionSessionBridge
import com.sun.minicpmo_android.lighthouse.data.CredentialVault
import com.sun.minicpmo_android.lighthouse.data.DeviceProofSigner
import com.sun.minicpmo_android.lighthouse.data.LighthouseRepository
import com.sun.minicpmo_android.lighthouse.data.SecureStore

class AppGraph(context: Context) {
    private val applicationContext = context.applicationContext
    private val secureStore = SecureStore(applicationContext)
    private val settings = AppSettingsRepository(applicationContext)
    private val vault = CredentialVault(secureStore)
    private val signer = DeviceProofSigner(secureStore)

    val repository = LighthouseRepository(settings, vault, signer)
    val companionBridge = CompanionSessionBridge(repository)
}
