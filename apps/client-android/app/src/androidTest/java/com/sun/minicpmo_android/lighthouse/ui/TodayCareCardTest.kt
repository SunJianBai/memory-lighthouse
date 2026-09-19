package com.sun.minicpmo_android.lighthouse.ui

import android.content.Context
import android.content.ContextWrapper
import android.content.SharedPreferences
import android.graphics.Bitmap
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.verticalScroll
import androidx.compose.material3.MaterialTheme
import androidx.compose.runtime.mutableStateOf
import androidx.compose.ui.Modifier
import androidx.compose.ui.graphics.asAndroidBitmap
import androidx.compose.ui.test.*
import androidx.compose.ui.test.junit4.createComposeRule
import androidx.test.ext.junit.runners.AndroidJUnit4
import androidx.test.platform.app.InstrumentationRegistry
import com.sun.minicpmo_android.lighthouse.data.*
import com.sun.minicpmo_android.lighthouse.model.TodayCareItem
import com.sun.minicpmo_android.lighthouse.model.TodayCareView
import com.sun.minicpmo_android.lighthouse.network.LighthouseHttpClient
import kotlinx.coroutines.CompletableDeferred
import kotlinx.coroutines.NonCancellable
import kotlinx.coroutines.runBlocking
import kotlinx.coroutines.withContext
import org.junit.Assert.assertTrue
import org.junit.Assume.assumeTrue
import org.junit.Rule
import org.junit.Test
import org.junit.runner.RunWith
import java.io.File
import java.util.concurrent.atomic.AtomicInteger

@RunWith(AndroidJUnit4::class)
class TodayCareCardTest {
    @get:Rule val compose = createComposeRule()

    private fun snapshot(recipient: String = "elder-a", title: String = "早餐后饮水") = TodayCareView(
        "home-a", recipient, "2026-09-20", "Asia/Shanghai", "2026-09-20T04:00:00Z",
        10, 2, 2, 5, 1, 3,
        listOf(TodayCareItem("item-a", title, "2026-09-20T00:00:00Z", "NEEDS_FAMILY_REVIEW")),
    )

    private fun show(load: suspend (String, String) -> TodayCareView, onOpen: () -> Unit = {}) {
        compose.setContent {
            MaterialTheme {
                Column(Modifier.verticalScroll(rememberScrollState())) {
                    TodayCareCard("home-a", "elder-a", "user-a", load, onOpen)
                }
            }
        }
    }

    @Test fun showsLocalTimeCountsAndNavigation() {
        var opened = false
        show({ _, _ -> snapshot() }, { opened = true })
        compose.onNodeWithText("今日照护").assertIsDisplayed()
        compose.onNodeWithText("2026-09-20 · Asia/Shanghai").assertIsDisplayed()
        compose.onNodeWithText("更新于 12:00").assertIsDisplayed()
        compose.onNodeWithText("10").assertIsDisplayed()
        compose.onNodeWithText("08:00 · 待核验").performScrollTo().assertIsDisplayed()
        compose.onNodeWithText("查看日程与待办").performScrollTo().performClick()
        compose.runOnIdle { assertTrue(opened) }
    }

    @Test fun failureIsNotZeroAndCanRetry() {
        val calls = AtomicInteger()
        show({ _, _ -> if (calls.incrementAndGet() == 1) error("网络暂不可用，请重试") else snapshot() })
        compose.onNodeWithText("网络暂不可用，请重试").assertIsDisplayed()
        compose.onNodeWithText("今日提醒").assertDoesNotExist()
        compose.onNodeWithText("刷新").performClick()
        compose.onNodeWithText("早餐后饮水").performScrollTo().assertIsDisplayed()
        compose.onNodeWithText("网络暂不可用，请重试").assertDoesNotExist()
    }

    @Test fun changingRecipientRejectsLateAndABAResponses() {
        val selected = mutableStateOf("elder-a")
        val stale = CompletableDeferred<TodayCareView>()
        val calls = AtomicInteger()
        compose.setContent {
            MaterialTheme {
                Column(Modifier.verticalScroll(rememberScrollState())) {
                    TodayCareCard("home-a", selected.value, "user-a", { _, recipient ->
                        if (recipient == "elder-a" && calls.incrementAndGet() == 1) withContext(NonCancellable) { stale.await() }
                        else snapshot(recipient, if (recipient == "elder-a") "甲的新快照" else "乙的日程")
                    }, {})
                }
            }
        }
        compose.onNodeWithText("正在加载今日照护…").assertIsDisplayed()
        compose.runOnIdle { selected.value = "elder-b" }
        compose.onNodeWithText("乙的日程").performScrollTo().assertIsDisplayed()
        compose.runOnIdle { selected.value = "elder-a" }
        compose.onNodeWithText("甲的新快照").performScrollTo().assertIsDisplayed()
        compose.runOnIdle { stale.complete(snapshot(title = "甲的过期快照")) }
        compose.waitForIdle()
        compose.onNodeWithText("甲的过期快照").assertDoesNotExist()
        compose.onNodeWithText("乙的日程").assertDoesNotExist()
        compose.onNodeWithText("甲的新快照").assertIsDisplayed()
    }

    @Test fun mismatchedScopeDoesNotRenderOtherRecipientsData() {
        show({ _, _ -> snapshot("another-elder", "不应显示") })
        compose.onNodeWithText("照护信息不匹配，请刷新重试").assertIsDisplayed()
        compose.onNodeWithText("不应显示").assertDoesNotExist()
    }

    @Test fun emptySnapshotStillHasCareAction() {
        show({ _, _ -> snapshot().copy(total = 0, confirmed = 0, needsReview = 0, pending = 0, expired = 0, openTaskCount = 0, items = emptyList()) })
        compose.onNodeWithText("今日暂无提醒记录，可在照护页面添加日程。").performScrollTo().assertIsDisplayed()
        compose.onNodeWithText("查看日程与待办").performScrollTo().assertIsDisplayed()
    }

    @Test fun realRepositoryAgainstLocalMysqlApi() {
        val args = InstrumentationRegistry.getArguments()
        val api = args.getString("careApiBase")
        assumeTrue("Local API fixture arguments not supplied", api != null)
        require(api!!.startsWith("http://127.0.0.1:13100/"))
        val context = InstrumentationRegistry.getInstrumentation().targetContext
        // Separate preferences: never replace an existing emulator user's account or device binding.
        val isolated = object : ContextWrapper(context) {
            override fun getApplicationContext(): Context = this
            override fun getSharedPreferences(name: String, mode: Int): SharedPreferences =
                super.getSharedPreferences("today-care-test-$name", mode)
        }
        val secure = SecureStore(isolated)
        val repository = LighthouseRepository(AppSettingsRepository(isolated), CredentialVault(secure), DeviceProofSigner(secure), LighthouseHttpClient({ api }))
        val user = runBlocking { repository.login(requireNotNull(args.getString("careUsername")), "Local-Care-Fixture-2026!") }
        val household = requireNotNull(args.getString("careHouseholdId"))
        val recipient = requireNotNull(args.getString("careRecipientId"))
        compose.setContent {
            MaterialTheme {
                Column(Modifier.verticalScroll(rememberScrollState())) {
                    TodayCareCard(household, recipient, user.id, repository::todayCare, {})
                }
            }
        }
        compose.waitUntil(15_000) { compose.onAllNodesWithText("早餐后饮水").fetchSemanticsNodes().isNotEmpty() }
        compose.onNodeWithText("10").assertIsDisplayed()
        compose.onNodeWithText("早餐后饮水").performScrollTo().assertIsDisplayed()
        compose.onNodeWithText("14:00 · 待提醒").performScrollTo().assertIsDisplayed()
        val capture = compose.onRoot().captureToImage().asAndroidBitmap()
        val directory = args.getString("additionalTestOutputDir")?.let(::File) ?: context.getExternalFilesDir("qa")!!
        directory.mkdirs()
        val output = File(directory, "today-care-mysql.png")
        output.outputStream().use { capture.compress(Bitmap.CompressFormat.PNG, 100, it) }
        runBlocking { repository.logout() }
    }
}
