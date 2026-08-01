package com.sun.minicpmo_android

import android.os.Bundle
import androidx.activity.ComponentActivity
import androidx.activity.compose.setContent
import androidx.activity.enableEdgeToEdge
import androidx.activity.viewModels
import com.sun.minicpmo_android.lighthouse.AppGraph
import com.sun.minicpmo_android.lighthouse.LighthouseViewModel
import com.sun.minicpmo_android.lighthouse.ui.LighthouseRoute
import com.sun.minicpmo_android.ui.theme.LighthouseTheme

class MainActivity : ComponentActivity() {
    private val graph by lazy { AppGraph(applicationContext) }

    private val lighthouseViewModel: LighthouseViewModel by viewModels {
        LighthouseViewModel.factory(applicationContext, graph)
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
        intent?.dataString?.let(lighthouseViewModel::handleActivationQr)
    }

    override fun onNewIntent(intent: android.content.Intent) {
        super.onNewIntent(intent)
        setIntent(intent)
        intent.dataString?.let(lighthouseViewModel::handleActivationQr)
    }
}
