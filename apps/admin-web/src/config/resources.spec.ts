import { describe, expect, it } from 'vitest'

import { resourceDefinitions, summarizeRemoteMedia } from './resources'

describe('admin resource contracts', () => {
  it('uses the model session states emitted by server-api', () => {
    expect(resourceDefinitions['model-sessions']?.statusOptions).toEqual([
      'ACTIVE',
      'ENDED',
      'FAILED'
    ])
  })

  it('offers every remote session state emitted by server-api', () => {
    expect(resourceDefinitions['remote-sessions']?.statusOptions).toEqual([
      'RINGING',
      'ACCEPTED',
      'CONNECTING',
      'ACTIVE',
      'ENDING',
      'ENDED',
      'DECLINED',
      'CANCELLED',
      'EXPIRED',
      'FAILED',
      'REVOKED'
    ])
  })

  it('decodes the persisted remote media bit mask returned by server-api', () => {
    expect(summarizeRemoteMedia('7')).toBe('接收设备音频、接收设备视频、发送家属音频')
    expect(summarizeRemoteMedia(8)).toBe('发送家属视频')
    expect(summarizeRemoteMedia('0')).toBe('未请求媒体')
    expect(summarizeRemoteMedia('invalid')).toBe('未知媒体权限')
  })
})
