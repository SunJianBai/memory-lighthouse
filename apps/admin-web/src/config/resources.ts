import { compactId, formatDate, objectValue, safeText } from '../utils/format'

export interface CellValue {
  primary: string
  secondary?: string
  status?: string
  mono?: boolean
}

export interface ResourceColumn {
  key: string
  label: string
  minWidth: number
  cell: (row: Record<string, unknown>) => CellValue
}

export interface ResourceDefinition {
  endpoint: string
  title: string
  description: string
  searchPlaceholder: string
  statusOptions: string[]
  columns: ResourceColumn[]
}

function idCell(row: Record<string, unknown>): CellValue {
  return { primary: compactId(row.id), secondary: safeText(row.id), mono: true }
}

function statusCell(row: Record<string, unknown>): CellValue {
  return { primary: safeText(row.status, '未知'), status: safeText(row.status, 'UNKNOWN') }
}

function dateCell(value: unknown): CellValue {
  return { primary: formatDate(value), mono: true }
}

function counts(...entries: Array<[string, unknown]>): CellValue {
  return {
    primary: entries.map(([label, value]) => `${label} ${safeText(value, '0')}`).join(' · ')
  }
}
function identitySummary(value: unknown): string {
  if (!Array.isArray(value) || value.length === 0) return '无登录标识'
  const identity = objectValue(value[0])
  return identity ? `${safeText(identity.type)} · ${safeText(identity.maskedValue)}` : '无登录标识'
}

function bindingSummary(value: unknown): CellValue {
  const binding = objectValue(value)
  if (!binding) return { primary: '未绑定', status: 'UNBOUND' }
  return {
    primary: safeText(binding.displayName, compactId(binding.id)),
    secondary: `家庭 ${compactId(binding.householdId)} · 长者 ${compactId(binding.recipientId)}`,
    status: safeText(binding.status)
  }
}

export function summarizeRemoteMedia(value: unknown): string {
  const media = objectValue(value)
  if (media) {
    const labels: Record<string, string> = {
      receiveDeviceAudio: '接收设备音频',
      receiveDeviceVideo: '接收设备视频',
      sendFamilyAudio: '发送家属音频',
      sendFamilyVideo: '发送家属视频'
    }
    const enabled = Object.entries(media)
      .filter(([, item]) => item === true)
      .map(([key]) => labels[key] || key)
    return enabled.length ? enabled.join('、') : '未请求媒体'
  }

  const mask =
    typeof value === 'number'
      ? value
      : typeof value === 'string' && /^\d+$/.test(value)
        ? Number(value)
        : Number.NaN
  if (!Number.isSafeInteger(mask) || mask < 0 || mask > 15) return '未知媒体权限'

  const enabled = [
    [1, '接收设备音频'],
    [2, '接收设备视频'],
    [4, '发送家属音频'],
    [8, '发送家属视频']
  ]
    .filter(([bit]) => (mask & Number(bit)) !== 0)
    .map(([, label]) => String(label))
  return enabled.length ? enabled.join('、') : '未请求媒体'
}

export const resourceDefinitions: Record<string, ResourceDefinition> = {
  users: {
    endpoint: 'users',
    title: '用户',
    description: '仅展示账号元数据与脱敏登录标识，不展示密码或认证凭据。',
    searchPlaceholder: '搜索用户 ID、昵称或登录标识',
    statusOptions: ['ACTIVE', 'DISABLED'],
    columns: [
      { key: 'id', label: '用户 ID', minWidth: 190, cell: idCell },
      {
        key: 'identity',
        label: '账号',
        minWidth: 210,
        cell: (row) => ({ primary: safeText(row.displayName), secondary: identitySummary(row.identities) })
      },
      { key: 'status', label: '状态', minWidth: 130, cell: statusCell },
      {
        key: 'counts',
        label: '关联统计',
        minWidth: 180,
        cell: (row) => counts(['家庭', row.householdMembershipCount], ['会话', row.sessionCount])
      },
      {
        key: 'locale',
        label: '区域设置',
        minWidth: 180,
        cell: (row) => ({ primary: safeText(row.locale), secondary: safeText(row.timezone) })
      },
      { key: 'createdAt', label: '注册时间', minWidth: 180, cell: (row) => dateCell(row.createdAt) }
    ]
  },
  households: {
    endpoint: 'households',
    title: '家庭',
    description: '查看家庭空间、成员、长者与陪伴设备绑定数量。',
    searchPlaceholder: '搜索家庭 ID 或名称',
    statusOptions: ['ACTIVE', 'DISABLED'],
    columns: [
      { key: 'id', label: '家庭 ID', minWidth: 190, cell: idCell },
      {
        key: 'name',
        label: '家庭名称',
        minWidth: 200,
        cell: (row) => ({ primary: safeText(row.name), secondary: safeText(row.timezone) })
      },
      { key: 'status', label: '状态', minWidth: 130, cell: statusCell },
      {
        key: 'counts',
        label: '规模',
        minWidth: 260,
        cell: (row) =>
          counts(
            ['成员', row.memberCount],
            ['长者', row.recipientCount],
            ['陪伴设备', row.companionBindingCount]
          )
      },
      { key: 'createdAt', label: '创建时间', minWidth: 180, cell: (row) => dateCell(row.createdAt) }
    ]
  },
  devices: {
    endpoint: 'devices',
    title: '设备',
    description: '查看陪伴端设备版本、在线心跳与一对一绑定状态。',
    searchPlaceholder: '搜索设备 ID、厂商或型号',
    statusOptions: ['ACTIVE', 'REVOKED', 'DISABLED'],
    columns: [
      { key: 'id', label: '设备 ID', minWidth: 190, cell: idCell },
      {
        key: 'hardware',
        label: '设备信息',
        minWidth: 220,
        cell: (row) => ({
          primary: `${safeText(row.manufacturer)} ${safeText(row.model)}`,
          secondary: `${safeText(row.platform)} ${safeText(row.osVersion)} · App ${safeText(row.appVersion)}`
        })
      },
      { key: 'status', label: '状态', minWidth: 130, cell: statusCell },
      { key: 'binding', label: '陪伴绑定', minWidth: 300, cell: (row) => bindingSummary(row.binding) },
      { key: 'lastSeenAt', label: '最后在线', minWidth: 180, cell: (row) => dateCell(row.lastSeenAt) }
    ]
  },
  'model-sessions': {
    endpoint: 'model-sessions',
    title: '模型会话',
    description: '查看模型运行元数据与错误码；对话原文不在此列表中暴露。',
    searchPlaceholder: '搜索会话 ID、模型、服务商或错误码',
    statusOptions: ['ACTIVE', 'ENDED', 'FAILED'],
    columns: [
      { key: 'id', label: '会话 ID', minWidth: 190, cell: idCell },
      {
        key: 'model',
        label: '模型',
        minWidth: 210,
        cell: (row) => ({ primary: safeText(row.model), secondary: safeText(row.provider) })
      },
      { key: 'status', label: '状态', minWidth: 130, cell: statusCell },
      {
        key: 'counts',
        label: '事件统计',
        minWidth: 190,
        cell: (row) => counts(['话轮', row.utteranceCount], ['事件', row.eventCount])
      },
      {
        key: 'result',
        label: '结束信息',
        minWidth: 220,
        cell: (row) => ({ primary: safeText(row.endReason), secondary: safeText(row.errorCode) })
      },
      { key: 'startedAt', label: '开始时间', minWidth: 180, cell: (row) => dateCell(row.startedAt) }
    ]
  },
  'remote-sessions': {
    endpoint: 'remote-sessions',
    title: '远程会话',
    description: '仅展示现场接听式远程通话的连接元数据；不录音、不转写。',
    searchPlaceholder: '搜索会话、家庭、长者、设备绑定或结束原因',
    statusOptions: [
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
    ],
    columns: [
      { key: 'id', label: '远程会话 ID', minWidth: 190, cell: idCell },
      {
        key: 'scope',
        label: '服务范围',
        minWidth: 240,
        cell: (row) => ({
          primary: `家庭 ${compactId(row.householdId)}`,
          secondary: `长者 ${compactId(row.recipientId)} · 设备 ${compactId(row.bindingId)}`
        })
      },
      { key: 'status', label: '状态', minWidth: 130, cell: statusCell },
      {
        key: 'media',
        label: '媒体权限',
        minWidth: 230,
        cell: (row) => ({
          primary: summarizeRemoteMedia(row.mediaMask ?? row.requestedMedia),
          secondary: safeText(row.answerMode)
        })
      },
      {
        key: 'counts',
        label: '参与情况',
        minWidth: 190,
        cell: (row) => counts(['参与者', row.participantCount], ['事件', row.eventCount])
      },
      { key: 'requestedAt', label: '请求时间', minWidth: 180, cell: (row) => dateCell(row.requestedAt) }
    ]
  },
  'audit-logs': {
    endpoint: 'audit-logs',
    title: '审计日志',
    description: '按时间倒序查看不可变审计链事件，哈希用于检测记录被篡改。',
    searchPlaceholder: '搜索日志 ID、动作、资源、请求号',
    statusOptions: ['ALLOW', 'DENY'],
    columns: [
      { key: 'id', label: '日志 ID', minWidth: 190, cell: idCell },
      {
        key: 'action',
        label: '动作',
        minWidth: 260,
        cell: (row) => ({ primary: safeText(row.action), secondary: `${safeText(row.resourceType)} · ${compactId(row.resourceId)}` })
      },
      {
        key: 'actor',
        label: '操作者',
        minWidth: 210,
        cell: (row) => ({ primary: `${safeText(row.actorType)} · ${compactId(row.actorUserId)}`, secondary: safeText(row.environment) })
      },
      {
        key: 'decision',
        label: '决策',
        minWidth: 130,
        cell: (row) => ({ primary: safeText(row.decision), status: safeText(row.decision) })
      },
      {
        key: 'hash',
        label: '事件哈希',
        minWidth: 230,
        cell: (row) => ({ primary: compactId(row.eventHash), secondary: `前序 ${compactId(row.previousEventHash)}`, mono: true })
      },
      { key: 'occurredAt', label: '发生时间', minWidth: 180, cell: (row) => dateCell(row.occurredAt) }
    ]
  }
}
