import type { AppState } from "./types";

const now = new Date();
const iso = now.toISOString();
const hoursAgo = (hours: number) =>
  new Date(now.getTime() - hours * 60 * 60 * 1000).toISOString();

export const createDemoState = (): AppState => ({
  schemaVersion: 1,
  initialized: true,
  recipient: {
    id: "recipient-lin",
    name: "林淑芬",
    preferredName: "林阿姨",
    birthday: "1954-03-18",
    homeLabel: "杭州 · 家中客厅",
    communicationNotes:
      "说话速度稍慢，一次只给一个步骤；避免责备语气，用“我们一起确认一下”。",
  },
  trustedPeople: [
    {
      id: "person-lin-xiaoyu",
      name: "林晓雨",
      relationship: "女儿",
      phone: "138 0000 2026",
      priority: 1,
      canViewEvidence: true,
    },
  ],
  medications: [
    {
      id: "med-morning-demo",
      name: "晨间降压药（演示记录）",
      alias: "早上的白盒",
      purpose: "由家属录入，仅用于提醒既定安排",
      scheduledTimes: ["08:30"],
      requirements: "早餐后，按照医生和药盒标签所示执行",
      containerLabel: "早 · 08:30",
      containerLocation: "餐桌右侧的白色收纳盘",
      active: true,
      notes: "系统不识别药片、不判断剂量，也不替代医生或家属确认。",
    },
  ],
  routines: [
    {
      id: "routine-morning-med",
      title: "晨间用药确认",
      category: "medication",
      scheduledTime: "08:30",
      weekdays: [0, 1, 2, 3, 4, 5, 6],
      linkedMedicationId: "med-morning-demo",
      instructions: "提醒林阿姨查看标有“早 · 08:30”的白色药盒。",
      confirmationQuestion: "您已经按药盒标签和家属安排完成了吗？",
      graceMinutes: 5,
      familyNoticeMinutes: 15,
      enabled: true,
    },
    {
      id: "routine-departure",
      title: "出门物品确认",
      category: "departure",
      scheduledTime: "09:20",
      weekdays: [1, 2, 3, 4, 5],
      instructions: "出门前确认眼镜、钥匙和手机。",
      confirmationQuestion: "眼镜、钥匙和手机都带好了吗？",
      graceMinutes: 5,
      familyNoticeMinutes: 20,
      enabled: true,
    },
  ],
  memories: [
    {
      id: "memory-preference-tone",
      kind: "preference",
      title: "沟通偏好",
      content: "喜欢被称作林阿姨；语速慢一些；一次只说一个步骤。",
      tags: ["称呼", "语速", "沟通"],
      sensitivity: "normal",
      createdAt: iso,
      updatedAt: iso,
    },
    {
      id: "memory-place-glasses",
      kind: "place",
      title: "眼镜常放位置",
      content: "阅读眼镜通常放在客厅边柜的木质托盘里。",
      tags: ["眼镜", "客厅", "寻物"],
      sensitivity: "normal",
      createdAt: iso,
      updatedAt: iso,
    },
    {
      id: "memory-person-daughter",
      kind: "person",
      title: "女儿林晓雨",
      content: "第一联系人，每周三上午会来家里；本人授权后可查看事件摘要。",
      tags: ["家属", "联系人"],
      sensitivity: "sensitive",
      createdAt: iso,
      updatedAt: iso,
    },
  ],
  assets: [],
  events: [
    {
      id: "event-seed-1",
      type: "user_confirmed",
      severity: "info",
      status: "resolved",
      title: "晨间任务已确认",
      summary: "林阿姨通过语音确认完成，未保存图像。",
      occurredAt: hoursAgo(24),
      routineId: "routine-morning-med",
      source: "user",
    },
    {
      id: "event-seed-2",
      type: "memory_used",
      severity: "info",
      status: "resolved",
      title: "协助找到眼镜",
      summary: "根据家属录入的位置记忆，提示查看客厅边柜托盘。",
      occurredAt: hoursAgo(2),
      source: "agent",
    },
  ],
  consent: {
    localStorageApproved: true,
    cameraApproved: true,
    microphoneApproved: true,
    sensitiveMemoryApproved: true,
    cloudProcessingApproved: false,
    acceptedAt: iso,
  },
  provider: {
    provider: "replay",
    localRealtimeWs:
      import.meta.env.VITE_LOCAL_REALTIME_WS ??
      "ws://localhost:17862/v1/realtime",
    localChatHttp:
      import.meta.env.VITE_LOCAL_CHAT_HTTP ??
      "http://127.0.0.1:18099/v1/chat/completions",
    cloudRealtimeWs:
      import.meta.env.VITE_CLOUD_REALTIME_WS ??
      "wss://minicpmo45.modelbest.cn/v1/realtime",
    cloudBaseUrl:
      import.meta.env.VITE_CLOUD_BASE_URL ??
      "https://minicpmo45.modelbest.cn",
    model:
      import.meta.env.VITE_MODEL_NAME ?? "openbmb/MiniCPM-o-4_5",
  },
});
