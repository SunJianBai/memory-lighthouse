package com.sun.minicpmo_android.ui.theme

import androidx.compose.ui.graphics.Color
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.darkColorScheme
import androidx.compose.material3.lightColorScheme
import androidx.compose.runtime.Composable
import androidx.compose.foundation.isSystemInDarkTheme

private val MonitorColorScheme = darkColorScheme(
    primary = MonitorSignal,
    onPrimary = MonitorInk,
    primaryContainer = MonitorSignalDark,
    onPrimaryContainer = MonitorInk,
    secondary = MonitorPaper,
    onSecondary = MonitorInk,
    background = MonitorInk,
    onBackground = MonitorPaper,
    surface = MonitorSurface,
    onSurface = MonitorPaper,
    surfaceVariant = MonitorSurfaceRaised,
    onSurfaceVariant = MonitorMuted,
    outline = MonitorOutline,
    error = MonitorDanger,
    onError = MonitorInk,
)

private val LighthouseLightColorScheme = lightColorScheme(
    primary = LighthouseBlue,
    onPrimary = LighthouseSurface,
    primaryContainer = Color(0xFFD5EFFF),
    onPrimaryContainer = LighthouseInk,
    secondary = LighthouseGreen,
    onSecondary = LighthouseSurface,
    background = LighthouseBackground,
    onBackground = LighthouseInk,
    surface = LighthouseSurface,
    onSurface = LighthouseInk,
    surfaceVariant = Color(0xFFE4F2F8),
    onSurfaceVariant = LighthouseMuted,
    outline = LighthouseOutline,
    error = LighthouseDanger,
    onError = LighthouseSurface,
)

private val LighthouseDarkColorScheme = darkColorScheme(
    primary = LighthouseBlueDark,
    onPrimary = Color(0xFF082F49),
    primaryContainer = Color(0xFF075985),
    onPrimaryContainer = LighthouseDarkInk,
    secondary = Color(0xFF86EFAC),
    onSecondary = Color(0xFF052E16),
    background = LighthouseDarkBackground,
    onBackground = LighthouseDarkInk,
    surface = LighthouseDarkSurface,
    onSurface = LighthouseDarkInk,
    surfaceVariant = Color(0xFF173D4D),
    onSurfaceVariant = Color(0xFFB7D3DF),
    outline = Color(0xFF83A7B7),
    error = Color(0xFFFFB4AB),
    onError = Color(0xFF690005),
)

@Composable
fun LighthouseTheme(
    darkTheme: Boolean = isSystemInDarkTheme(),
    content: @Composable () -> Unit,
) {
    MaterialTheme(
        colorScheme = if (darkTheme) LighthouseDarkColorScheme else LighthouseLightColorScheme,
        typography = Typography,
        content = content,
    )
}

@Composable
fun MinicpmoAndroidTheme(content: @Composable () -> Unit) {
    MaterialTheme(
        colorScheme = MonitorColorScheme,
        typography = Typography,
        content = content,
    )
}
