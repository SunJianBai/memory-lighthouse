package com.sun.minicpmo_android

import android.app.Application
import com.sun.minicpmo_android.lighthouse.AppGraph

class LighthouseApplication : Application() {
    val appGraph: AppGraph by lazy(LazyThreadSafetyMode.SYNCHRONIZED) {
        AppGraph(applicationContext)
    }
}
