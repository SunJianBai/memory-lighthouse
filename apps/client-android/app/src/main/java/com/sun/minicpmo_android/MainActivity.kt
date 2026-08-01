package com.sun.minicpmo_android

import android.os.Bundle
import android.content.Intent
import androidx.activity.ComponentActivity
import androidx.activity.compose.setContent
import androidx.activity.enableEdgeToEdge
import androidx.activity.viewModels
import com.sun.minicpmo_android.lighthouse.LighthouseViewModel
import com.sun.minicpmo_android.lighthouse.call.CompanionCallService
import com.sun.minicpmo_android.lighthouse.ui.LighthouseRoute
import com.sun.minicpmo_android.ui.theme.LighthouseTheme

class MainActivity : ComponentActivity() {
    private val graph by lazy { (application as LighthouseApplication).appGraph }

    private val lighthouseViewModel: LighthouseViewModel by viewModels {
        LighthouseViewModel.factory(graph)
    }

    private val miniCpmViewModel: MainViewModel by viewModels {
        MainViewModel.factory(applicationContext, graph.companionBridge)
    }

    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        enableEdgeToEdge()
        setContent {
            LighthouseTheme {
                LighthouseRoute(lighthouseViewModel, miniCpmViewModel)
            }
        }
        handleIntent(intent)
    }

    override fun onNewIntent(intent: Intent) {
        super.onNewIntent(intent)
        setIntent(intent)
        handleIntent(intent)
    }

    private fun handleIntent(value: Intent?) {
        value?.dataString?.let(lighthouseViewModel::handleActivationQr)
        lighthouseViewModel.handleCallIntent(
            value?.action,
            value?.getStringExtra(CompanionCallService.EXTRA_SESSION_ID),
        )
    }
}
