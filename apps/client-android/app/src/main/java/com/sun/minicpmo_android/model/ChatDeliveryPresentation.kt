package com.sun.minicpmo_android.model

internal fun AppUiState.withChatDeliveryResult(
    text: String,
    accepted: Boolean,
    messageId: Long,
): AppUiState {
    val normalizedText = text.trim()
    if (normalizedText.isEmpty()) return this

    val nextComposerText = when {
        accepted && composerText.trim() == normalizedText -> ""
        !accepted && composerText.isBlank() -> normalizedText
        !accepted && composerText.trim() != normalizedText ->
            "$normalizedText\n\n$composerText"
        else -> composerText
    }
    val nextMessages = if (accepted) {
        messages + ConversationMessage(
            id = messageId,
            role = MessageRole.USER,
            text = normalizedText,
        )
    } else {
        messages
    }

    return copy(
        composerText = nextComposerText,
        messages = nextMessages,
    )
}

internal fun chatDeliveryFailureMessage(cause: String? = null): String {
    val action = "消息未发送，内容已保留。请检查网络后点击发送重试"
    val normalizedCause = cause?.trim().orEmpty()
    return if (normalizedCause.isEmpty()) {
        action
    } else if (normalizedCause.startsWith(action)) {
        normalizedCause
    } else {
        "$action（$normalizedCause）"
    }
}
