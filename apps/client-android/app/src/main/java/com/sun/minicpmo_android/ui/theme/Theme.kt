package com.sun.minicpmo_android.ui.theme

import androidx.compose.foundation.isSystemInDarkTheme
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.darkColorScheme
import androidx.compose.material3.lightColorScheme
import androidx.compose.runtime.Composable
import androidx.compose.ui.graphics.Color

private val LighthouseLightColorScheme = lightColorScheme(
    primary = LighthouseBlue,
    onPrimary = LighthouseSurface,
    primaryContainer = LighthousePrimaryContainer,
    onPrimaryContainer = LighthouseInk,
    inversePrimary = LighthouseBlueDark,
    secondary = LighthouseGreen,
    onSecondary = LighthouseSurface,
    secondaryContainer = LighthouseSecondaryContainer,
    onSecondaryContainer = LighthouseOnSecondaryContainer,
    tertiary = LighthouseTeal,
    onTertiary = LighthouseSurface,
    tertiaryContainer = LighthouseTertiaryContainer,
    onTertiaryContainer = LighthouseOnTertiaryContainer,
    background = LighthouseBackground,
    onBackground = LighthouseInk,
    surface = LighthouseSurface,
    onSurface = LighthouseInk,
    surfaceVariant = LighthouseSurfaceVariant,
    onSurfaceVariant = LighthouseMuted,
    surfaceTint = LighthouseBlue,
    inverseSurface = LighthouseInverseSurface,
    inverseOnSurface = LighthouseInverseOnSurface,
    error = LighthouseDanger,
    onError = LighthouseSurface,
    errorContainer = LighthouseErrorContainer,
    onErrorContainer = LighthouseOnErrorContainer,
    outline = LighthouseOutline,
    outlineVariant = LighthouseOutlineVariant,
    scrim = Color.Black,
    surfaceBright = LighthouseSurface,
    surfaceDim = LighthouseSurfaceDim,
    surfaceContainerLowest = LighthouseSurfaceContainerLowest,
    surfaceContainerLow = LighthouseSurfaceContainerLow,
    surfaceContainer = LighthouseSurfaceContainer,
    surfaceContainerHigh = LighthouseSurfaceContainerHigh,
    surfaceContainerHighest = LighthouseSurfaceContainerHighest,
)

private val LighthouseDarkColorScheme = darkColorScheme(
    primary = LighthouseBlueDark,
    onPrimary = Color(0xFF003548),
    primaryContainer = LighthouseDarkPrimaryContainer,
    onPrimaryContainer = LighthousePrimaryContainer,
    inversePrimary = LighthouseBlue,
    secondary = LighthouseDarkSecondary,
    onSecondary = Color(0xFF08371D),
    secondaryContainer = LighthouseDarkSecondaryContainer,
    onSecondaryContainer = LighthouseDarkOnSecondaryContainer,
    tertiary = LighthouseDarkTertiary,
    onTertiary = Color(0xFF003735),
    tertiaryContainer = LighthouseDarkTertiaryContainer,
    onTertiaryContainer = LighthouseDarkOnTertiaryContainer,
    background = LighthouseDarkBackground,
    onBackground = LighthouseDarkInk,
    surface = LighthouseDarkSurface,
    onSurface = LighthouseDarkInk,
    surfaceVariant = LighthouseDarkSurfaceVariant,
    onSurfaceVariant = LighthouseDarkMuted,
    surfaceTint = LighthouseBlueDark,
    inverseSurface = LighthouseDarkInverseSurface,
    inverseOnSurface = LighthouseDarkInverseOnSurface,
    error = LighthouseDarkError,
    onError = LighthouseDarkOnError,
    errorContainer = LighthouseDarkErrorContainer,
    onErrorContainer = LighthouseDarkOnErrorContainer,
    outline = LighthouseDarkOutline,
    outlineVariant = LighthouseDarkOutlineVariant,
    scrim = Color.Black,
    surfaceBright = LighthouseDarkSurfaceBright,
    surfaceDim = LighthouseDarkSurfaceDim,
    surfaceContainerLowest = LighthouseDarkSurfaceContainerLowest,
    surfaceContainerLow = LighthouseDarkSurfaceContainerLow,
    surfaceContainer = LighthouseDarkSurfaceContainer,
    surfaceContainerHigh = LighthouseDarkSurfaceContainerHigh,
    surfaceContainerHighest = LighthouseDarkSurfaceContainerHighest,
)

@Composable
fun LighthouseTheme(
    darkTheme: Boolean = isSystemInDarkTheme(),
    content: @Composable () -> Unit,
) {
    MaterialTheme(
        colorScheme = if (darkTheme) LighthouseDarkColorScheme else LighthouseLightColorScheme,
        typography = Typography,
        shapes = LighthouseShapes,
        content = content,
    )
}
