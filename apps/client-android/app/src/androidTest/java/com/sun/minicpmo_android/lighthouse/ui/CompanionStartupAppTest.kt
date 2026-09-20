package com.sun.minicpmo_android.lighthouse.ui

import android.Manifest
import android.graphics.Bitmap
import androidx.compose.ui.graphics.asAndroidBitmap
import androidx.compose.ui.test.*
import androidx.compose.ui.test.junit4.createAndroidComposeRule
import androidx.lifecycle.Lifecycle
import androidx.test.platform.app.InstrumentationRegistry
import com.sun.minicpmo_android.BuildConfig
import com.sun.minicpmo_android.MainActivity
import com.sun.minicpmo_android.lighthouse.data.*
import kotlinx.coroutines.runBlocking
import org.junit.Assert.*
import org.junit.Assume.assumeTrue
import org.junit.Test
import org.junit.Rule
import org.junit.rules.ExternalResource
import org.junit.rules.RuleChain
import org.junit.rules.TestRule
import java.io.File

/** Real Keystore activation + Repository + Activity against the isolated local API. */
class CompanionStartupAppTest {
    private val compose = createAndroidComposeRule<MainActivity>()
    private lateinit var repository: LighthouseRepository
    private lateinit var vault: CredentialVault
    private var ownedBindingId: String? = null
    private var householdId = ""
    private var username = ""
    private val password = "Local-Care-Fixture-2026!"
    private val setup = object : ExternalResource() {
        override fun before() = runBlocking {
            val args = InstrumentationRegistry.getArguments()
            val api = args.getString("careApiBase")
            assumeTrue("Local API fixture not supplied", api != null)
            require(BuildConfig.APPLICATION_ID.endsWith(".iterationtest")) { "Only the isolated test application is allowed" }
            require(api!!.startsWith("http://127.0.0.1:13100/"))
            username = requireNotNull(args.getString("careUsername"))
            require(username.startsWith("owner_"))
            householdId = requireNotNull(args.getString("careHouseholdId"))
            val recipientId = requireNotNull(args.getString("careRecipientId"))
            val context = InstrumentationRegistry.getInstrumentation().targetContext
            if (android.os.Build.VERSION.SDK_INT >= 33) {
                InstrumentationRegistry.getInstrumentation().uiAutomation.grantRuntimePermission(
                    BuildConfig.APPLICATION_ID, Manifest.permission.POST_NOTIFICATIONS,
                )
            }
            val settings = AppSettingsRepository(context)
            settings.saveApiBaseUrl(api)
            val secureStore = SecureStore(context)
            vault = CredentialVault(secureStore)
            repository = LighthouseRepository(settings, vault, DeviceProofSigner(secureStore))
            require(vault.deviceCredential() == null && vault.userSession() == null) { "Do not overwrite an existing isolated-app session" }
            repository.login(username, password)
            val activation = repository.createActivationChallenge(householdId, recipientId)
            val pending = repository.claimActivation(activation.publicId, ActivationProofType.DYNAMIC_CODE, activation.dynamicCode)
            val details = repository.activationApprovalDetails(pending.challengeId)
            repository.approveActivation(pending.challengeId, details.claimSnapshotToken)
            val exchanged = repository.exchangeApprovedActivation(pending)
            assertTrue(exchanged is ActivationExchangeOutcome.Activated)
            ownedBindingId = requireNotNull(vault.deviceCredential()).bindingId
        }

        override fun after() {
            val bindingId = ownedBindingId ?: return
            runBlocking {
                repository.login(username, password)
                repository.revokeBinding(householdId, bindingId, "LOCAL_TEST_COMPLETED", password)
                repository.logout()
            }
            if (vault.deviceCredential()?.bindingId == bindingId) vault.saveDeviceCredential(null)
        }
    }
    @get:Rule val rules: TestRule = RuleChain.outerRule(setup).around(compose)

    @Test fun activatedDeviceChecksAgainstServerAndInvalidatesOnBackground() {
        val directory = InstrumentationRegistry.getArguments().getString("additionalTestOutputDir")?.let(::File)
            ?: InstrumentationRegistry.getInstrumentation().targetContext.getExternalFilesDir("qa")!!
        directory.mkdirs()
        compose.waitUntil(20_000) { compose.onAllNodesWithText("启动检查").fetchSemanticsNodes().isNotEmpty() }
        compose.onNodeWithText("启动检查").performScrollTo().performClick()
        compose.onNodeWithText("检查启动条件").performScrollTo()
        File(directory, "companion-startup-device-before.png").outputStream().use {
            InstrumentationRegistry.getInstrumentation().uiAutomation.takeScreenshot().compress(Bitmap.CompressFormat.PNG, 100, it)
        }
        compose.onNodeWithText("检查启动条件").assertIsDisplayed().performClick()
        try {
            compose.waitUntil(15_000) { compose.onAllNodesWithText("本次访问成功，设备绑定有效").fetchSemanticsNodes().isNotEmpty() }
        } catch (failure: Throwable) {
            File(directory, "companion-startup-device-failure.png").outputStream().use {
                InstrumentationRegistry.getInstrumentation().uiAutomation.takeScreenshot().compress(Bitmap.CompressFormat.PNG, 100, it)
            }
            File(directory, "companion-startup-failure.png").outputStream().use {
                compose.onRoot().captureToImage().asAndroidBitmap().compress(Bitmap.CompressFormat.PNG, 100, it)
            }
            throw AssertionError(compose.onRoot().printToString(), failure)
        }
        compose.onNodeWithText("配置已提供，连接未检查").performScrollTo().assertIsDisplayed()
        File(directory, "companion-startup-app.png").outputStream().use {
            compose.onRoot().captureToImage().asAndroidBitmap().compress(Bitmap.CompressFormat.PNG, 100, it)
        }
        compose.activityRule.scenario.moveToState(Lifecycle.State.CREATED)
        compose.activityRule.scenario.moveToState(Lifecycle.State.RESUMED)
        compose.onNodeWithText("结果已失效，请重新检查。").performScrollTo().assertIsDisplayed()
        compose.onNodeWithText("本次访问成功，设备绑定有效").assertDoesNotExist()
        compose.onNodeWithText("检查启动条件").performScrollTo().performClick()
        compose.waitUntil(15_000) { compose.onAllNodesWithText("本次访问成功，设备绑定有效").fetchSemanticsNodes().isNotEmpty() }
        compose.onNodeWithText("设备已就绪").assertDoesNotExist()
    }
}
