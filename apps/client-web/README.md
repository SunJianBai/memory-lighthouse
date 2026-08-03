# 守忆灯塔 Client Web

同一个 React/Vite Web 提供两个真实工作区，并保留原比赛 Demo：

- `/openBMB/app/*`：家属工作区，数据与权限以 Server API 为准；
- `/openBMB/companion`：陪伴设备模式；首次 Claim/批准后改用独立 Device Identity，已激活设备无需家属登录；
- `/openBMB/demo/*`：完整保留原本地 Demo、MiniCPM-o runtime 和测试。

## 本地运行

从仓库根目录执行：

```powershell
npm install
npm run dev:client
```

打开 `http://127.0.0.1:4310/openBMB/`。Vite 会把
`/openBMB/api/*` 代理到 `http://127.0.0.1:13100`。

## 安全边界

- Web access token 只存在于内存；refresh token 由 Server API 写入
  `HttpOnly + SameSite=Strict` Cookie。
- 邮箱验证使用邮件中的 6 位数字验证码；注册页、独立验证页和账号设置页都不会
  将验证码写入 URL 或浏览器存储。
- 密码重置与家庭邀请的一次性 token 从 URL fragment 读取后，在 React 挂载前
  立即通过 `history.replaceState` 清除。
- 家庭邀请使用 `POST /household-invitations/accept` 的 JSON 请求正文。
- 邮箱验证码入口为 `/openBMB/auth/verify-email`；密码重置与家庭邀请入口分别为
  `/openBMB/auth/reset-password`、`/openBMB/invitations/accept`，其 token 仅在 fragment。
- 陪伴 Web 使用 IndexedDB 保存 Ed25519 `CryptoKey` 和轮换设备凭据；长期
  credential 从不作为 Bearer Token，业务请求只使用短时 device access token。
- 设备凭据兑换成功或检测到既有设备凭据时，客户端先撤销并清除当前家属会话，
  再进入锁定的陪伴壳；返回家属工作区必须重新登录，不能用页面角色切换保留家属令牌。
- 待兑换 Challenge 保存在当前浏览器会话中；瞬时失败释放单航班门闩。`CONSUMED`
  状态返回绑定 MySQL Challenge 版本的 60 秒恢复令牌，浏览器用不可导出安装私钥签署
  独立 `exchange-recovery` proof；旧请求不能重放。即使兑换已提交但响应丢失，也不会
  重复创建 Binding，凭据落盘后会直接恢复设备上下文。
- `CANCELLED / EXPIRED / ATTEMPTS_EXCEEDED` 会停止轮询并清理旧 Challenge；网络、5xx、
  408、429 才自动重试，两类 409 恢复冲突最多尝试五次。若服务端已提交但 IndexedDB
  事务在 commit 阶段中止，页面停止自动轮询但保留 Challenge 与恢复标记，刷新后继续
  使用新恢复令牌；恢复完成前禁止新 Claim 覆盖该句柄，运行中的兑换门闩也不能被重置。
- 家属远程通话只在陪伴端现场接听后连接 LiveKit，ticket 必须声明
  `recording=false` 和 `transcription=false`。
- 陪伴端轮询受设备凭据保护的 `GET /device/remote-sessions/current` 发现跨设备
  来电；`BroadcastChannel` 仅作为同源多标签页的低延迟联调提示。UI 不会把
  通知或媒体失败伪装成通话成功，后续可用鉴权 WSS 替换轮询以降低延迟。

## 校验

```powershell
npm run test --workspace @memory-lighthouse/client-web
npm run typecheck --workspace @memory-lighthouse/client-web
npm run build --workspace @memory-lighthouse/client-web
```
