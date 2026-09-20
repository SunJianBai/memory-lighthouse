import type { ClientRoute } from "../app/navigation";

export const guideSections = [
  { id: "guide-start", title: "快速开始" },
  { id: "guide-roles", title: "使用端说明" },
  { id: "guide-capabilities", title: "功能与操作" },
  { id: "guide-faq", title: "常见问题" },
] as const;

export const quickStartSteps = [
  {
    title: "注册与验证",
    description: "注册家属账号，输入邮件中的 6 位验证码。",
    route: "register",
    action: "注册账号",
  },
  {
    title: "创建家庭",
    description: "在家庭概览中创建家庭，再添加陪伴对象。",
    route: "workspace-overview",
    action: "打开家庭概览",
  },
  {
    title: "绑定设备",
    description: "在陪伴设备页生成激活码，按下方图示完成绑定。",
    route: "workspace-devices",
    action: "添加陪伴设备",
  },
  {
    title: "授权与开始",
    description: "在“隐私与授权”设置必要授权，再到陪伴端开始陪伴。",
    route: "workspace-privacy",
    action: "查看隐私授权",
  },
] satisfies Array<{
  title: string;
  description: string;
  route: ClientRoute;
  action: string;
}>;

export const guideCapabilities = [
  {
    id: "companion",
    title: "AI 陪伴",
    description: "实时语音交流，可在授权后使用摄像头。",
    route: "companion",
    action: "打开陪伴端",
    steps: [
      "确认设备已激活，在“隐私与授权”开启“陪伴麦克风”和“全模态模型处理”。",
      "点击“开始陪伴”，允许浏览器使用麦克风；视频模式还需摄像头权限。",
      "直接说话即可交流；使用完毕点击“结束陪伴”。",
    ],
    note: "需要设备联网、模型服务可用。关闭页面后不能继续陪伴。",
  },
  {
    id: "memories",
    title: "记忆档案",
    description: "录入人物关系、偏好和生活信息。",
    route: "workspace-memories",
    action: "打开记忆档案",
    steps: [
      "选择家庭和陪伴对象，点击“新增记忆”。",
      "选择类型与敏感等级，填写标题和内容后保存。",
      "信息变化时编辑或删除；只录入已经核实的信息。",
    ],
    note: "模型使用记忆需要“长期记忆存储”授权。当前记忆由家属维护，并非自动记住所有对话。",
  },
  {
    id: "routines",
    title: "日程与待办",
    description: "设置每日提醒，查看确认记录和家庭待办。",
    route: "workspace-routines",
    action: "打开日程与待办",
    steps: [
      "新建日程，填写提醒内容，选择仅一次、每天或指定星期。",
      "开始陪伴并保持会话运行；长者可明确回复，或点击“我完成了”。",
      "在“提醒记录”中核验状态；家庭待办可按“待认领”“我负责”“已结束”筛选，认领后由负责人处理。",
    ],
      note: "可设置起止日期；结束日期留空表示持续重复。编辑会修改整条规则。提醒按页面所示时区执行；不保证关闭页面后仍能提醒。",
  },
  {
    id: "family",
    title: "家庭协同",
    description: "邀请家属，设置角色和陪伴对象访问权限。",
    route: "workspace-overview",
    action: "打开家庭概览",
    steps: [
      "家庭所有者在“家庭成员”中填写对方邮箱并选择角色。",
      "受邀人打开邀请邮件，登录对应账号后接受邀请。",
      "所有者按需要设置陪伴对象权限及照护授权。",
    ],
    note: "看不到数据或无法操作时，先核对当前家庭、陪伴对象和成员权限。",
  },
  {
    id: "remote",
    title: "远程通话",
    description: "与陪伴端对话，并在授权后查看设备画面。",
    route: "workspace-remote",
    action: "打开远程通话",
    steps: [
      "选择在线陪伴设备，确认远程音频及需要的视频授权。",
      "点击“呼叫陪伴端”，等待陪伴端现场接听。",
      "接通后进行对话，完成后点击“结束通话”。",
    ],
    note: "不是静默监控。家属端不向陪伴端发送摄像头画面；远程通话不录音、不转写。",
  },
  {
    id: "privacy",
    title: "隐私与授权",
    description: "按功能查看、授予或撤回授权。",
    route: "workspace-privacy",
    action: "打开隐私与授权",
    steps: [
      "确认顶部选中的是要管理的陪伴对象。",
      "在对应项目点击“查看并授权”，阅读说明后决定。",
      "不再需要时点击“撤回”；家庭所有者还可查看管理员访问记录。",
    ],
    note: "功能授权与浏览器权限不同：已在家属端授权，设备上仍需允许使用麦克风或摄像头。",
  },
] satisfies Array<{
  id: "companion" | "memories" | "routines" | "family" | "remote" | "privacy";
  title: string;
  description: string;
  route: ClientRoute;
  action: string;
  steps: string[];
  note: string;
}>;

export const guideFaqs = [
  {
    question: "家属端和陪伴端需要两个账号吗？",
    answer:
      "不需要。家属使用账号管理家庭；陪伴设备通过家属生成的二维码或动态码激活。一台陪伴设备绑定一位长者。设备模式不保留家属管理权限，返回家属端需要重新登录。",
  },
  {
    question: "收不到邮箱验证码怎么办？",
    answer:
      "核对邮箱拼写，检查垃圾邮件。等待页面上的重发倒计时结束后重试，并填写最新邮件中的 6 位数字验证码。",
  },
  {
    question: "扫码失败或激活码过期怎么办？",
    answer:
      "可改用“输入动态激活码”，同时填写公开编号和 8 位动态码。提交后还需家属批准。过期时在家属端重新生成，不要继续使用旧码。",
  },
  {
    question: "为什么不能开始陪伴，或没有声音、画面？",
    answer:
      "在已激活的陪伴页面展开“启动检查”，点击“检查启动条件”。家庭授权缺失时，请家属在“隐私与授权”中处理；本机权限问题需在这台陪伴设备上处理。检查不录音录像，“配置已提供”不代表模型已连接。处理后重新检查并开始陪伴；仍无声音或画面时，检查系统音量、设备占用及模型服务状态。",
  },
  {
    question: "为什么无法远程呼叫？",
    answer:
      "陪伴设备需联网并保持陪伴页面或应用运行。刷新设备状态，检查远程通话授权和家属权限；设备忙碌时稍后再试。呼叫发出后，需要陪伴端现场接听。",
  },
  {
    question: "可以把提醒结果当作健康监测结论吗？",
    answer:
      "不能。“已确认”只记录本人或家属的明确确认，不代表医学判断；未回复也不代表发生危险。系统不识别药片与剂量，不替代紧急求助或专业医疗服务。",
  },
];
