package com.sun.minicpmo_android.model

import com.sun.minicpmo_android.network.RealtimeApiClient
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertTrue
import org.junit.Test

class ChatDeliveryPresentationTest {
    @Test
    fun `realtime client rejects chat when there is no active socket`() {
        assertFalse(
            RealtimeApiClient().sendChat(
                text = "这条消息不会被发送",
                ttsEnabled = false,
                lengthPenalty = 1f,
            ),
        )
    }

    @Test
    fun `rejected delivery restores a cleared pending draft without a fake user message`() {
        val next = AppUiState(composerText = "").withChatDeliveryResult(
            text = "提醒我下午吃药",
            accepted = false,
            messageId = 41,
        )

        assertEquals("提醒我下午吃药", next.composerText)
        assertTrue(next.messages.isEmpty())
    }

    @Test
    fun `accepted delivery appends the user message exactly once and clears matching draft`() {
        val next = AppUiState(composerText = "今天天气怎么样").withChatDeliveryResult(
            text = "今天天气怎么样",
            accepted = true,
            messageId = 42,
        )

        assertEquals("", next.composerText)
        assertEquals(
            listOf(
                ConversationMessage(
                    id = 42,
                    role = MessageRole.USER,
                    text = "今天天气怎么样",
                ),
            ),
            next.messages,
        )
    }

    @Test
    fun `accepted pending delivery does not erase a newer draft`() {
        val next = AppUiState(composerText = "我还想问另一件事").withChatDeliveryResult(
            text = "先讲一个故事",
            accepted = true,
            messageId = 43,
        )

        assertEquals("我还想问另一件事", next.composerText)
        assertEquals("先讲一个故事", next.messages.single().text)
    }

    @Test
    fun `rejected pending delivery preserves both attempted text and a newer draft`() {
        val next = AppUiState(composerText = "我还想问另一件事").withChatDeliveryResult(
            text = "先讲一个故事",
            accepted = false,
            messageId = 0,
        )

        assertEquals("先讲一个故事\n\n我还想问另一件事", next.composerText)
        assertTrue(next.messages.isEmpty())
    }

    @Test
    fun `retry after a rejected pending delivery creates only one user message`() {
        val rejected = AppUiState(composerText = "").withChatDeliveryResult(
            text = "播放我喜欢的歌",
            accepted = false,
            messageId = 0,
        )
        val accepted = rejected.withChatDeliveryResult(
            text = "播放我喜欢的歌",
            accepted = true,
            messageId = 44,
        )

        assertEquals(1, accepted.messages.size)
        assertEquals(MessageRole.USER, accepted.messages.single().role)
        assertEquals("播放我喜欢的歌", accepted.messages.single().text)
    }

    @Test
    fun `failure copy tells the user the draft is retained and how to retry`() {
        assertEquals(
            "消息未发送，内容已保留。请检查网络后点击发送重试（连接已关闭）",
            chatDeliveryFailureMessage("连接已关闭"),
        )
    }
}
