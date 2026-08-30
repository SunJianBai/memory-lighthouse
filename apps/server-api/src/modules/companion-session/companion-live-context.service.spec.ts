import {
  afterEach,
  beforeEach,
  describe,
  expect,
  it,
  jest,
} from '@jest/globals';
import type { ConfigService } from '@nestjs/config';

import {
  buildServerClock,
  CompanionLiveContextService,
} from './companion-live-context.service';

const NOW = new Date('2026-08-26T02:34:56.000Z');

function service(values: Record<string, string> = {}) {
  return new CompanionLiveContextService({
    get: jest.fn((key: string) => values[key]),
  } as unknown as ConfigService);
}

describe('CompanionLiveContextService', () => {
  beforeEach(() => {
    jest.useFakeTimers();
    jest.setSystemTime(NOW);
  });

  afterEach(() => {
    jest.restoreAllMocks();
    jest.useRealTimers();
  });

  it('formats the authoritative server instant in the recipient timezone', () => {
    expect(buildServerClock(NOW, 'Asia/Shanghai')).toEqual({
      source: 'SERVER',
      generatedAtUtc: '2026-08-26T02:34:56.000Z',
      timezone: 'Asia/Shanghai',
      localDate: '2026-08-26',
      localTime: '10:34:56',
      localDateTime: '2026-08-26T10:34:56',
      weekday: '星期三',
      freshForSeconds: 300,
    });
  });

  it('fails closed instead of inventing weather when no location is configured', async () => {
    await expect(
      service().capture({ timezone: 'Asia/Shanghai' }),
    ).resolves.toMatchObject({
      serverClock: {
        localDate: '2026-08-26',
        localTime: '10:34:56',
      },
      weather: { status: 'UNAVAILABLE', reason: 'NOT_CONFIGURED' },
    });
  });

  it('maps configured Open-Meteo current conditions and forecast into bounded facts', async () => {
    const fetchMock = jest.spyOn(globalThis, 'fetch').mockResolvedValue(
      new Response(
        JSON.stringify({
          current: {
            time: '2026-08-26T10:30',
            temperature_2m: 28.4,
            apparent_temperature: 31.2,
            relative_humidity_2m: 71,
            precipitation: 0,
            weather_code: 2,
            wind_speed_10m: 8.1,
          },
          daily: {
            time: ['2026-08-26', '2026-08-27', '2026-08-28'],
            weather_code: [2, 61, 95],
            temperature_2m_min: [24, 23, 22],
            temperature_2m_max: [32, 29, 28],
            precipitation_probability_max: [20, 70, 80],
          },
        }),
        { status: 200, headers: { 'content-type': 'application/json' } },
      ),
    );
    const live = await service({
      WEATHER_LOCATION_LATITUDE: '31.2304',
      WEATHER_LOCATION_LONGITUDE: '121.4737',
      WEATHER_LOCATION_NAME: '上海市',
    }).capture({ timezone: 'Asia/Shanghai' });

    expect(fetchMock).toHaveBeenCalledTimes(1);
    const requested = fetchMock.mock.calls[0]?.[0];
    expect(requested).toBeInstanceOf(URL);
    if (!(requested instanceof URL)) throw new Error('Expected a URL request');
    expect(requested.hostname).toBe('api.open-meteo.com');
    expect(requested.searchParams.get('timezone')).toBe('Asia/Shanghai');
    expect(live.weather).toMatchObject({
      status: 'AVAILABLE',
      source: 'Open-Meteo',
      location: '上海市',
      observedAtLocal: '2026-08-26T10:30',
      condition: '局部多云',
      temperatureC: 28.4,
      apparentTemperatureC: 31.2,
      dailyForecast: [
        { date: '2026-08-26', condition: '局部多云' },
        { date: '2026-08-27', condition: '雨' },
        { date: '2026-08-28', condition: '雷暴' },
      ],
    });
  });

  it('returns an explicit upstream error when the provider response is unusable', async () => {
    jest
      .spyOn(globalThis, 'fetch')
      .mockResolvedValue(new Response('{}', { status: 200 }));
    await expect(
      service({
        WEATHER_LOCATION_LATITUDE: '31.2304',
        WEATHER_LOCATION_LONGITUDE: '121.4737',
      }).capture({ timezone: 'Asia/Shanghai' }),
    ).resolves.toMatchObject({
      weather: { status: 'UNAVAILABLE', reason: 'UPSTREAM_ERROR' },
    });
  });
});
