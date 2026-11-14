---
name: "守忆灯塔"
description: "家庭档案跨端设计系统；以家庭 Web 的实际实现为规范基线。"
colors:
  primary: "#284b3c"
  primary-strong: "#1c382b"
  primary-soft: "#e7ebdc"
  accent: "#5f784f"
  background: "#f5f3e9"
  surface: "#fcfbf5"
  surface-soft: "#eeeee3"
  foreground: "#283b30"
  muted-foreground: "#5b6558"
  border: "#d4d9c9"
  border-strong: "#8a9783"
  success: "#365c3e"
  success-soft: "#e4eddf"
  warm: "#a74d0a"
  warm-soft: "#fff0db"
  danger: "#b4232d"
  danger-strong: "#8f1822"
  danger-soft: "#ffe5e7"
typography:
  display:
    fontFamily: '"Songti SC", "SimSun", serif'
    fontSize: "clamp(2rem, 3.8vw, 3.2rem)"
    fontWeight: 700
    lineHeight: 1.3
    letterSpacing: "0"
  headline:
    fontFamily: '"Source Sans 3 Variable", "PingFang SC", "Microsoft YaHei", system-ui, sans-serif'
    fontSize: "clamp(1.5rem, 2.4vw, 1.8rem)"
    fontWeight: 700
    lineHeight: 1.55
    letterSpacing: "0"
  title:
    fontFamily: '"Source Sans 3 Variable", "PingFang SC", "Microsoft YaHei", system-ui, sans-serif'
    fontSize: "1.25rem"
    fontWeight: 700
    lineHeight: 1.55
    letterSpacing: "0"
  body:
    fontFamily: '"Source Sans 3 Variable", "PingFang SC", "Microsoft YaHei", system-ui, sans-serif'
    fontSize: "16px"
    fontWeight: 400
    lineHeight: 1.55
  label:
    fontFamily: '"Source Sans 3 Variable", "PingFang SC", "Microsoft YaHei", system-ui, sans-serif'
    fontSize: "16px"
    fontWeight: 750
    lineHeight: 1.55
rounded:
  flat: "0"
  sm: "6px"
  md: "8px"
  lg: "12px"
  pill: "999px"
spacing:
  xs: "8px"
  sm: "12px"
  md: "16px"
  lg: "24px"
  xl: "32px"
components:
  button-primary:
    backgroundColor: "{colors.primary}"
    textColor: "{colors.surface}"
    rounded: "{rounded.sm}"
    padding: "10px 18px"
  button-primary-hover:
    backgroundColor: "{colors.primary-strong}"
  button-secondary:
    backgroundColor: "{colors.surface}"
    textColor: "{colors.primary}"
    rounded: "{rounded.sm}"
    padding: "10px 18px"
  button-danger:
    backgroundColor: "{colors.danger}"
    textColor: "{colors.surface}"
    rounded: "{rounded.sm}"
    padding: "10px 18px"
  input:
    backgroundColor: "{colors.surface}"
    textColor: "{colors.foreground}"
    rounded: "{rounded.sm}"
    padding: "10px 12px"
  navigation-item:
    textColor: "{colors.muted-foreground}"
    rounded: "{rounded.flat}"
    padding: "10px 2px"
  status-success:
    backgroundColor: "{colors.success-soft}"
    textColor: "{colors.success}"
    rounded: "{rounded.pill}"
    padding: "4px 9px"
  archive-record:
    backgroundColor: "transparent"
    textColor: "{colors.foreground}"
    rounded: "{rounded.flat}"
    padding: "24px 0"
---

# Design System: 守忆灯塔

## Overview

**Creative North Star: "家庭档案"**

以米白纸面、松绿文字与细分隔线组织家庭信息，让记录、上下文和下一步操作优先于装饰。保留“守忆灯塔”名称及现有灯泡／灯塔品牌标识；页面标题使用正式产品或任务名称。

本规范从当前实现提取，以家庭 Web 为主。管理端共享纸面与松绿的语义，但保留后台密度、独立字体及深色模式；Android 将同源色彩映射到 Material 3，保留原生控件、系统字体缩放和导航。统一的是视觉关系，不是三个端的每个值或轮廓。

本次依据是用户于 2026-11-03 在聊天中明确选择 B，以及当前本地实现；选定参考为 [.impeccable/mocks/decision/warm.html](.impeccable/mocks/decision/warm.html)。这是 code-led 提取，不是像素级静态稿复刻。产品约束见 [PRODUCT.md](PRODUCT.md)，实施与验证边界见 [跨端实施记录](../../docs/design/family-archive-implementation.md)。旧探索 seed 无法核验，不作为本规范的来源证明。本轮尚未提交或部署。

**Key Characteristics:**

- 米白底、松绿主操作、低饱和状态底色。
- 开放式记录以细线与留白分隔，不给每条记录加浮起卡片。
- 品牌衬线字与任务无衬线字分工；正文清晰、长内容可换行。
- 平台原生交互、权限含义和真实数据边界保持不变。

## Colors

低饱和纸面承载内容，深绿墨色保证阅读，松绿与苔绿承担操作和焦点。前置 tokens 仅记录家庭 Web 的复用值，不将管理端或 Android 的独立语义值混入同一套色表。

### Primary

- **松绿 / 深松绿：** 主按钮、当前位置、品牌标题与悬停加深。
- **浅苔绿：** 选中、悬停及轻提示底色，避免大面积高饱和填充。

### Secondary

- **苔绿：** 品牌图标底色、键盘焦点与辅助强调，不代替危险或成功状态。

### Neutral

- **米白纸面 / 浅纸面 / 灰绿纸面：** 页面、输入与分组状态的轻层次。
- **深绿墨色 / 灰绿说明：** 正文与次要信息；不把重要说明藏进极淡文字。
- **浅分隔线 / 控件边线：** 分别承担内容分隔与可交互边界。

成功绿、警告赭色、危险红及各自浅底是功能状态，不是额外装饰色。媒体画面使用独立深色背景与遮罩；不要为“暖色统一”覆盖视频内容。

**The Semantic Accent Rule.** 松绿指向主操作与当前位置；成功、警告和危险使用各自语义色，并保留文字或图标说明。

管理端通过 CSS 语义角色切换深色模式，其危险／警告值与家庭 Web 不完全相同。Android 的 primary、surface、outline、error 及 container 家族来自原生主题；深色主题使用浅绿前景与深绿纸面。家庭 Web 当前明确为浅色，不凭本文件推定它已有深色模式。

## Typography

**Display Font:** Songti SC，回退 SimSun、serif；用于品牌名称及入口品牌标题。
**Body Font:** Source Sans 3 Variable，中文回退 PingFang SC、Microsoft YaHei，再回退系统 sans-serif。

**Character:** 品牌有纸质档案的识别感，操作内容保持直接、易读。字体是否可用以平台实际回退为准，不把系统中文字体的具体轮廓当作跨端一致性要求。

### Hierarchy

- **Display：** 首页正式产品标题，使用前置 display 的响应式尺度。
- **Headline：** 家属工作区页面标题，使用 headline；不套用首页的大字号。
- **Title：** 工作区分区与档案标题，使用 title。
- **Body：** 正文使用 body；记忆内容限制在约 72ch 并允许长词换行。
- **Label：** 表单标签使用 label；导航、记录元数据与状态标记保留组件自己的紧凑尺度。

**The Brand and Task Rule.** 品牌衬线字只承担产品识别；任务标题、表单和记录使用正文无衬线体系，不把宣传句改造成页面标题。

管理端正文使用 Fira Sans / Noto Sans SC 等回退，技术字段使用 Fira Code / monospace。Android 使用系统 SansSerif，主要正文为 16sp/24sp、常规辅助文字为 14sp，标题按 20–32sp 分级；技术标签才用 Monospace。sp 随系统字号缩放，不换算为固定 CSS 像素。

## Layout

- **家庭 Web：** 主框架最大宽度（1440px），桌面家庭上下文列（220px）、列间距（36px）、外边距（32px）；顶部承担全局导航，上下文列承担家庭和陪伴对象选择。首页内容单独使用最大宽度（1360px），不强行套工作区网格。
- **中等宽度：** 不超过（1024px）隐藏顶部任务导航、显示底部导航；上下文列变为（190px），间距及边距（24px）。
- **窄屏：** 不超过（620px）工作区单列，页面横向留白（16px），家庭与陪伴对象选择并列；底部导航含“更多”，保留安全区，正文底部留出导航空间。记录操作移到下一行，不缩小正文以挤进桌面列。
- **间距：** 前置 spacing 记录反复出现的步长，而不是限制现有表单／媒体页面所有尺寸。开放分区常用上下（24px）留白，窄屏部分分区降为（20px）。
- **管理端：** 桌面侧栏（232px），内容最大宽度（1600px）；不超过（1024px）使用可展开侧栏。数据表保留横向滚动，不伪装成家庭记录列表。
- **Android：** 家属页面在可用宽度至少（720dp）时使用 NavigationRail，较窄屏保留原生导航；原生页面的系统栏、键盘与触摸目标由 Compose 处理，不复制 Web 的固定底栏。

## Elevation & Depth

常规记录与工作区分区在静态时无阴影，以底色、细线和留白传达层次。Web 的中等阴影仅用于“更多”浮层、媒体容器等独立层；底部主导航最终样式无阴影。管理端深色模式有独立阴影值；Android 保留 Material 控件的 tonal elevation 与原生浮层语义。

### Shadow Vocabulary

- **平面：** `none`，用于常规记录、分区与按钮。
- **独立层：** `0 12px 32px rgb(40 59 48 / 12%)`，用于已有的浮层或媒体容器，不扩散为所有卡片的默认。

**The Open Record Rule.** 记录与常规分区在纸面上展开，用细线和间距建立层级；阴影仅保留给确有遮挡关系的浮层及媒体容器。

## Shapes

Web 常规交互控件使用 sm，容器按 md／lg 分工；开放式记录与内容分区使用 flat。分隔线通常为（1px）；选中的顶部导航使用（2px）下划线。pill 仅用于状态、计数等已有紧凑标记，不是全界面的轮廓。

Android 主题的形状步长为（4／6／8／12／16dp），但 Material 按钮、标签和导航可能使用其原生胶囊轮廓；这是平台边界，不应为模仿 Web 方角而替换控件。

## Components

### Buttons

清晰、克制，以动作结果命名。常规按钮最小高度（46px），使用前置按钮 tokens；主按钮深松绿悬停，次按钮细描边并在悬停时出现浅苔绿底。危险按钮独立使用危险红。轻量动作可使用透明底；不要借颜色弱化危险含义。禁用按钮保留语义且降低透明度（0.48）。

### Inputs / Fields

浅纸面、明确描边与 sm 圆角，常规最小高度（46px）；上下文选择控件使用（44px）。标签在字段外，帮助与错误文字保留。按钮、输入、链接与 summary 的键盘焦点使用苔绿轮廓（3px）及外偏移（3px），不能只靠悬停表示可操作性。

### Navigation

桌面顶部文字导航以松绿和底线标示当前位置，并保留 aria-current。上下文选择与模式切换位于左侧；窄屏底导航使用图标加文字，不把全部路由压成一行小字。管理端的侧栏和 Android 原生导航沿各自布局边界实现。

### Chips

状态标签以文字、浅底和语义前景色共同表达，不仅依赖颜色。家庭 Web 成功／中性 pill 最小高度（28px），文本可换行；筛选按钮是可操作控件，需保留 pressed 状态和焦点，不与静态状态标签混用。

### Cards / Containers

通用分区与记录平铺于纸面；编辑、确认对话框及明确的权限提示仍可使用浅纸面、细边框和适量圆角。空／加载／失败状态是实际操作反馈，不用虚构记录填充空白。

### Archive Records

开放记录是主要复用特征：元信息、标题、正文和操作分层，条目间细线分隔，正文约（72ch）以内；窄屏让操作区落到记录下方。Android 的 ArchiveSection 用 HorizontalDivider 和内容列表达同一关系，编辑和决策继续使用原生 Material 对话框。

状态转换沿用 Web fast（160ms）与 normal（240ms）节奏，尊重 prefers-reduced-motion；管理端 normal 为（220ms），不强行抹平差异。现有语音波形、来电与媒体状态可以表达运行状态，但不推广为页面装饰。

## Do's and Don'ts

### Do:

- **Do** 沿用语义颜色和清晰的文字状态；危险操作保留明确名称与确认流程。
- **Do** 用细线、标题和间距组织记录；长内容换行，桌面操作在窄屏自然移到下一行。
- **Do** 保留键盘焦点、减少动态效果设置、原生系统文字缩放及安全区。
- **Do** 保留守忆灯塔名称和现有灯泡／灯塔标识；示例人物与记录明确标注为合成数据。

### Don't:

- **Don't** 将每条记录包装为带阴影的大圆角卡片，或用装饰遮盖任务层级。
- **Don't** 以宣传语、实现细节或虚构使用量替代正式产品标题与真实状态。
- **Don't** 将 Web 字体、像素尺寸或方角要求强套到 Android 的 Material 控件；不把原生应用改成网页包装。
- **Don't** 为视觉统一改动业务字段、权限含义、真实家庭记录或媒体生命周期。

提取来源：家庭 Web 的 `src/styles.css`、`ProductShell.tsx`、`WelcomePage.tsx`，管理端的 `styles/tokens.css` 与 `global.css`，Android 的 `ui/theme` 与 `ArchiveSection.kt`。当前实现与核对截图优先于早期探索稿；侧车色阶仅供预览，不是新增产品颜色 tokens。
