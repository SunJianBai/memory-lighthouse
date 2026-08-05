package com.sun.minicpmo_android.update

import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertThrows
import org.junit.Test

class AndroidUpdateManifestParserTest {
    @Test
    fun parsesTrustedReleaseMetadata() {
        val release = AndroidUpdateManifestParser.parse(
            """
            {
              "versionCode": 2,
              "versionName": "1.0.1",
              "apkUrl": "https://github.com/example/app.apk",
              "sha256": "${"ab".repeat(32)}",
              "mandatory": false,
              "releaseNotes": ["优化界面", "新增应用内更新"]
            }
            """.trimIndent(),
        )

        assertEquals(2, release.versionCode)
        assertEquals("1.0.1", release.versionName)
        assertEquals(listOf("优化界面", "新增应用内更新"), release.releaseNotes)
        assertFalse(release.mandatory)
    }

    @Test
    fun rejectsNonHttpsDownload() {
        assertThrows(IllegalArgumentException::class.java) {
            AndroidUpdateManifestParser.parse(
                """
                {
                  "versionCode": 2,
                  "versionName": "1.0.1",
                  "apkUrl": "http://example.com/app.apk",
                  "sha256": "${"ab".repeat(32)}"
                }
                """.trimIndent(),
            )
        }
    }

    @Test
    fun rejectsMalformedDigest() {
        assertThrows(IllegalArgumentException::class.java) {
            AndroidUpdateManifestParser.parse(
                """
                {
                  "versionCode": 2,
                  "versionName": "1.0.1",
                  "apkUrl": "https://example.com/app.apk",
                  "sha256": "not-a-digest"
                }
                """.trimIndent(),
            )
        }
    }
}
