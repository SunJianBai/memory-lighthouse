# 守忆灯塔 Client Web

同一个 React/Vite Web 提供两个真实工作区，并保留原比赛 Demo：

- `/openBMB/app/*`：家属工作区，数据与权限以 Server API 为准；
- `/openBMB/companion`：陪伴设备模式，登录家属账号后还必须完成设备激活；
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
- 邮箱验证、密码重置与家庭邀请的一次性 token 从 URL fragment 读取后，
  在 React 挂载前立即通过 `history.replaceState` 清除。
- 家庭邀请使用 `POST /household-invitations/accept` 的 JSON 请求正文。
- 邮件入口与服务端契约一致：`/openBMB/auth/verify-email`、
  `/openBMB/auth/reset-password`、`/openBMB/invitations/accept`；token 仅在 fragment。
- 陪伴 Web 使用 IndexedDB 保存 Ed25519 `CryptoKey` 和轮换设备凭据；长期
  credential 从不作为 Bearer Token，业务请求只使用短时 device access token。
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
