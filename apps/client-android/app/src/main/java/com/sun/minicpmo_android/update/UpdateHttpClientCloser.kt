package com.sun.minicpmo_android.update

import kotlinx.coroutines.Job
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.launch
import okhttp3.OkHttpClient

// Independent from the cancelled Activity scope; captures no Activity reference.
// Evicting an idle TLS socket may write close_notify, so it is network I/O.
internal fun closeUpdateHttpClient(client: OkHttpClient): Job = CoroutineScope(Dispatchers.IO).launch {
    client.dispatcher.cancelAll()
    client.dispatcher.executorService.shutdown()
    client.connectionPool.evictAll()
}
