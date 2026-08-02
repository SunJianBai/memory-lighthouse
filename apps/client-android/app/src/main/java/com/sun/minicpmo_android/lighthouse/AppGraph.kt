package com.sun.minicpmo_android.lighthouse

import android.content.Context
import com.sun.minicpmo_android.lighthouse.call.RemoteCallCoordinator
import com.sun.minicpmo_android.lighthouse.call.CompanionMediaHandoffOrchestrator
import com.sun.minicpmo_android.lighthouse.data.AppSettingsRepository
import com.sun.minicpmo_android.lighthouse.data.CompanionSessionBridge
import com.sun.minicpmo_android.lighthouse.data.CredentialVault
import com.sun.minicpmo_android.lighthouse.data.DeviceProofSigner
import com.sun.minicpmo_android.lighthouse.data.LighthouseRepository
import com.sun.minicpmo_android.lighthouse.data.RemoteCallCommandRegistry
import com.sun.minicpmo_android.lighthouse.data.SecureStore
import com.sun.minicpmo_android.lighthouse.data.SecureRemoteCallCommandPersistence
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.SupervisorJob

class AppGraph(context: Context) {
    private val applicationContext = context.applicationContext
    private val secureStore = SecureStore(applicationContext)
    private val settings = AppSettingsRepository(applicationContext)
    private val vault = CredentialVault(secureStore)
    private val signer = DeviceProofSigner(secureStore)
    private val applicationScope = CoroutineScope(SupervisorJob() + Dispatchers.Main.immediate)

    init {
        if (signer.legacyKeyMaterialPurged) {
            // The old exported key must never be reused. Its server-side public
            // key cannot match a newly generated non-exportable Keystore key,
            // so device-only state is cleared and the user reactivates safely.
            vault.saveDeviceInstallation(null)
            vault.saveDeviceCredential(null)
            vault.savePendingDeviceActivation(null)
        }
    }

    val repository = LighthouseRepository(settings, vault, signer)
    internal val remoteCallCommands = RemoteCallCommandRegistry(
        SecureRemoteCallCommandPersistence(secureStore),
    )
    private val companionMediaHandoff = CompanionMediaHandoffOrchestrator()
    val callCoordinator = RemoteCallCoordinator(
        applicationContext,
        repository,
        applicationScope,
        companionMediaHandoff,
    )
    val companionBridge = CompanionSessionBridge(repository)
}
