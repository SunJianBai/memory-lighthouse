import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';

export interface CompanionWeatherSnapshot {
  status: 'AVAILABLE' | 'STALE';
  source: 'Open-Meteo';
  location: string;
  fetchedAtUtc: string;
  validUntilUtc: string;
  observedAtLocal: string;
  condition: string;
  temperatureC: number;
  apparentTemperatureC: number;
  relativeHumidityPercent: number;
  precipitationMm: number;
  windSpeedKmh: number;
  dailyForecast: Array<{
    date: string;
    condition: string;
    minimumTemperatureC: number;
    maximumTemperatureC: number;
    maximumPrecipitationProbabilityPercent: number;
  }>;
}

export interface CompanionLiveContext {
  schemaVersion: 1;
  serverClock: {
    source: 'SERVER';
    generatedAtUtc: string;
    timezone: string;
    localDate: string;
    localTime: string;
    localDateTime: string;
    weekday: string;
    freshForSeconds: number;
  };
  weather:
    | CompanionWeatherSnapshot
    | {
        status: 'UNAVAILABLE';
        reason: 'NOT_CONFIGURED' | 'INVALID_CONFIGURATION' | 'UPSTREAM_ERROR';
      };
}

interface ResolvedLocation {
  latitude: number;
  longitude: number;
  label: string;
}

interface CachedWeather {
  freshUntil: number;
  staleUntil: number;
  weather: CompanionWeatherSnapshot;
}

interface GeocodingResponse {
  results?: Array<{
    name?: unknown;
    admin1?: unknown;
    country?: unknown;
    latitude?: unknown;
    longitude?: unknown;
  }>;
}

interface ForecastResponse {
  current?: Record<string, unknown>;
  daily?: Record<string, unknown>;
}

const DEFAULT_TIMEZONE = 'Asia/Shanghai';
const CLOCK_FRESH_SECONDS = 300;
const DEFAULT_WEATHER_CACHE_SECONDS = 600;
const DEFAULT_WEATHER_STALE_SECONDS = 1_800;
const DEFAULT_REQUEST_TIMEOUT_MS = 2_500;

@Injectable()
export class CompanionLiveContextService {
  private readonly logger = new Logger(CompanionLiveContextService.name);
  private readonly weatherCache = new Map<string, CachedWeather>();
  private resolvedLocation?: Promise<ResolvedLocation | null>;

  constructor(private readonly config: ConfigService) {}

  async capture(input: {
    timezone: string;
    sessionStartedAt?: Date;
  }): Promise<CompanionLiveContext> {
    const clockInstant = input.sessionStartedAt ?? new Date();
    const clock = buildServerClock(clockInstant, input.timezone);
    return {
      schemaVersion: 1,
      serverClock: clock,
      weather: await this.captureWeather(clock.timezone),
    };
  }

  private async captureWeather(
    timezone: string,
  ): Promise<CompanionLiveContext['weather']> {
    const configured = this.weatherConfigurationStatus();
    if (configured !== 'CONFIGURED') {
      return { status: 'UNAVAILABLE', reason: configured };
    }

    let location: ResolvedLocation | null;
    try {
      location = await this.resolveLocation();
    } catch (error) {
      this.warnUpstream(error);
      return { status: 'UNAVAILABLE', reason: 'UPSTREAM_ERROR' };
    }
    if (!location) {
      return { status: 'UNAVAILABLE', reason: 'INVALID_CONFIGURATION' };
    }

    const key = `${location.latitude},${location.longitude},${timezone}`;
    const now = Date.now();
    const cached = this.weatherCache.get(key);
    if (cached && cached.freshUntil > now) return cached.weather;

    try {
      const weather = await this.fetchWeather(location, timezone);
      const freshSeconds = boundedInteger(
        this.config.get<string>('WEATHER_CACHE_TTL_SECONDS'),
        DEFAULT_WEATHER_CACHE_SECONDS,
        60,
        3_600,
      );
      const staleSeconds = Math.max(
        freshSeconds,
        boundedInteger(
          this.config.get<string>('WEATHER_STALE_TTL_SECONDS'),
          DEFAULT_WEATHER_STALE_SECONDS,
          60,
          7_200,
        ),
      );
      this.weatherCache.set(key, {
        weather,
        freshUntil: now + freshSeconds * 1_000,
        staleUntil: now + staleSeconds * 1_000,
      });
      return weather;
    } catch (error) {
      this.warnUpstream(error);
      if (cached && cached.staleUntil > now) {
        return { ...cached.weather, status: 'STALE' };
      }
      return { status: 'UNAVAILABLE', reason: 'UPSTREAM_ERROR' };
    }
  }

  private weatherConfigurationStatus():
    'CONFIGURED' | 'NOT_CONFIGURED' | 'INVALID_CONFIGURATION' {
    const latitude = this.config
      .get<string>('WEATHER_LOCATION_LATITUDE')
      ?.trim();
    const longitude = this.config
      .get<string>('WEATHER_LOCATION_LONGITUDE')
      ?.trim();
    const query = this.config.get<string>('WEATHER_LOCATION_QUERY')?.trim();
    if (!latitude && !longitude && !query) return 'NOT_CONFIGURED';
    if ((latitude && !longitude) || (!latitude && longitude)) {
      return 'INVALID_CONFIGURATION';
    }
    if (latitude && longitude) {
      const parsedLatitude = Number(latitude);
      const parsedLongitude = Number(longitude);
      if (
        !Number.isFinite(parsedLatitude) ||
        !Number.isFinite(parsedLongitude) ||
        parsedLatitude < -90 ||
        parsedLatitude > 90 ||
        parsedLongitude < -180 ||
        parsedLongitude > 180
      ) {
        return 'INVALID_CONFIGURATION';
      }
      return 'CONFIGURED';
    }
    return query && Array.from(query).length < 2
      ? 'INVALID_CONFIGURATION'
      : 'CONFIGURED';
  }

  private resolveLocation(): Promise<ResolvedLocation | null> {
    if (!this.resolvedLocation) {
      this.resolvedLocation = this.loadLocation().catch((error) => {
        this.resolvedLocation = undefined;
        throw error;
      });
    }
    return this.resolvedLocation;
  }

  private async loadLocation(): Promise<ResolvedLocation | null> {
    const latitude = this.config
      .get<string>('WEATHER_LOCATION_LATITUDE')
      ?.trim();
    const longitude = this.config
      .get<string>('WEATHER_LOCATION_LONGITUDE')
      ?.trim();
    if (latitude && longitude) {
      return {
        latitude: Number(latitude),
        longitude: Number(longitude),
        label:
          this.config.get<string>('WEATHER_LOCATION_NAME')?.trim() ||
          '已配置地区',
      };
    }

    const query = this.config.get<string>('WEATHER_LOCATION_QUERY')?.trim();
    if (!query) return null;
    const url = new URL('https://geocoding-api.open-meteo.com/v1/search');
    url.searchParams.set('name', query);
    url.searchParams.set('count', '1');
    url.searchParams.set('language', 'zh');
    url.searchParams.set('format', 'json');
    const payload = await this.fetchJson<GeocodingResponse>(url);
    const result = payload.results?.[0];
    const resolvedLatitude = finiteNumber(result?.latitude);
    const resolvedLongitude = finiteNumber(result?.longitude);
    if (resolvedLatitude === null || resolvedLongitude === null) return null;
    const label = [
      stringValue(result?.name),
      stringValue(result?.admin1),
      stringValue(result?.country),
    ]
      .filter(
        (value, index, values) => value && values.indexOf(value) === index,
      )
      .join(' · ');
    return {
      latitude: resolvedLatitude,
      longitude: resolvedLongitude,
      label: label || query,
    };
  }

  private async fetchWeather(
    location: ResolvedLocation,
    timezone: string,
  ): Promise<CompanionWeatherSnapshot> {
    const url = new URL('https://api.open-meteo.com/v1/forecast');
    url.searchParams.set('latitude', String(location.latitude));
    url.searchParams.set('longitude', String(location.longitude));
    url.searchParams.set(
      'current',
      [
        'temperature_2m',
        'apparent_temperature',
        'relative_humidity_2m',
        'precipitation',
        'weather_code',
        'wind_speed_10m',
      ].join(','),
    );
    url.searchParams.set(
      'daily',
      [
        'weather_code',
        'temperature_2m_max',
        'temperature_2m_min',
        'precipitation_probability_max',
      ].join(','),
    );
    url.searchParams.set('forecast_days', '3');
    url.searchParams.set('timezone', timezone);

    const payload = await this.fetchJson<ForecastResponse>(url);
    const current = payload.current ?? {};
    const daily = payload.daily ?? {};
    const fetchedAt = new Date();
    const weatherCode = requiredNumber(current.weather_code, 'weather_code');
    const dates = stringArray(daily.time);
    const dailyCodes = numberArray(daily.weather_code);
    const minimums = numberArray(daily.temperature_2m_min);
    const maximums = numberArray(daily.temperature_2m_max);
    const precipitationProbabilities = numberArray(
      daily.precipitation_probability_max,
    );

    return {
      status: 'AVAILABLE',
      source: 'Open-Meteo',
      location: location.label,
      fetchedAtUtc: fetchedAt.toISOString(),
      validUntilUtc: new Date(
        fetchedAt.getTime() +
          boundedInteger(
            this.config.get<string>('WEATHER_CACHE_TTL_SECONDS'),
            DEFAULT_WEATHER_CACHE_SECONDS,
            60,
            3_600,
          ) *
            1_000,
      ).toISOString(),
      observedAtLocal: requiredString(current.time, 'current.time'),
      condition: weatherCodeLabel(weatherCode),
      temperatureC: requiredNumber(current.temperature_2m, 'temperature_2m'),
      apparentTemperatureC: requiredNumber(
        current.apparent_temperature,
        'apparent_temperature',
      ),
      relativeHumidityPercent: requiredNumber(
        current.relative_humidity_2m,
        'relative_humidity_2m',
      ),
      precipitationMm: requiredNumber(current.precipitation, 'precipitation'),
      windSpeedKmh: requiredNumber(current.wind_speed_10m, 'wind_speed_10m'),
      dailyForecast: dates.slice(0, 3).map((date, index) => ({
        date,
        condition: weatherCodeLabel(requiredArrayItem(dailyCodes, index)),
        minimumTemperatureC: requiredArrayItem(minimums, index),
        maximumTemperatureC: requiredArrayItem(maximums, index),
        maximumPrecipitationProbabilityPercent: requiredArrayItem(
          precipitationProbabilities,
          index,
        ),
      })),
    };
  }

  private async fetchJson<T>(url: URL): Promise<T> {
    const controller = new AbortController();
    const timeout = setTimeout(
      () => controller.abort(),
      boundedInteger(
        this.config.get<string>('WEATHER_REQUEST_TIMEOUT_MS'),
        DEFAULT_REQUEST_TIMEOUT_MS,
        250,
        10_000,
      ),
    );
    try {
      const response = await fetch(url, {
        signal: controller.signal,
        headers: { accept: 'application/json' },
      });
      if (!response.ok) throw new Error(`Open-Meteo HTTP ${response.status}`);
      return (await response.json()) as T;
    } finally {
      clearTimeout(timeout);
    }
  }

  private warnUpstream(error: unknown): void {
    this.logger.warn(
      `Live weather unavailable (${error instanceof Error ? error.message : 'unknown error'})`,
    );
  }
}

export function buildServerClock(
  instant: Date,
  requestedTimezone: string,
): CompanionLiveContext['serverClock'] {
  const timezone = validTimezone(requestedTimezone)
    ? requestedTimezone
    : DEFAULT_TIMEZONE;
  const formatter = new Intl.DateTimeFormat('zh-CN-u-ca-gregory-nu-latn', {
    timeZone: timezone,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    weekday: 'long',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
    hourCycle: 'h23',
  });
  const parts = Object.fromEntries(
    formatter
      .formatToParts(instant)
      .filter((part) => part.type !== 'literal')
      .map((part) => [part.type, part.value]),
  );
  const localDate = `${parts.year}-${parts.month}-${parts.day}`;
  const localTime = `${parts.hour}:${parts.minute}:${parts.second}`;
  return {
    source: 'SERVER',
    generatedAtUtc: instant.toISOString(),
    timezone,
    localDate,
    localTime,
    localDateTime: `${localDate}T${localTime}`,
    weekday: parts.weekday,
    freshForSeconds: CLOCK_FRESH_SECONDS,
  };
}

function validTimezone(value: string): boolean {
  try {
    new Intl.DateTimeFormat('en-US', { timeZone: value }).format();
    return true;
  } catch {
    return false;
  }
}

function boundedInteger(
  raw: string | undefined,
  fallback: number,
  minimum: number,
  maximum: number,
): number {
  const parsed = Number(raw);
  return Number.isInteger(parsed) && parsed >= minimum && parsed <= maximum
    ? parsed
    : fallback;
}

function finiteNumber(value: unknown): number | null {
  return typeof value === 'number' && Number.isFinite(value) ? value : null;
}

function requiredNumber(value: unknown, field: string): number {
  const parsed = finiteNumber(value);
  if (parsed === null) throw new Error(`Open-Meteo field ${field} is invalid`);
  return parsed;
}

function requiredString(value: unknown, field: string): string {
  if (typeof value !== 'string' || !value.trim()) {
    throw new Error(`Open-Meteo field ${field} is invalid`);
  }
  return value;
}

function stringValue(value: unknown): string {
  return typeof value === 'string' ? value.trim() : '';
}

function stringArray(value: unknown): string[] {
  return Array.isArray(value) &&
    value.every((entry) => typeof entry === 'string')
    ? value
    : [];
}

function numberArray(value: unknown): number[] {
  return Array.isArray(value) &&
    value.every((entry) => finiteNumber(entry) !== null)
    ? (value as number[])
    : [];
}

function requiredArrayItem(values: number[], index: number): number {
  const value = values[index];
  if (value === undefined) {
    throw new Error(`Open-Meteo daily field is missing index ${index}`);
  }
  return value;
}

function weatherCodeLabel(code: number): string {
  if (code === 0) return '晴';
  if (code === 1) return '大部晴朗';
  if (code === 2) return '局部多云';
  if (code === 3) return '阴';
  if (code === 45 || code === 48) return '雾';
  if ([51, 53, 55, 56, 57].includes(code)) return '毛毛雨';
  if ([61, 63, 65, 66, 67].includes(code)) return '雨';
  if ([71, 73, 75, 77].includes(code)) return '雪';
  if ([80, 81, 82].includes(code)) return '阵雨';
  if ([85, 86].includes(code)) return '阵雪';
  if ([95, 96, 99].includes(code)) return '雷暴';
  return `未知天气代码 ${code}`;
}
