import {
  CheckCircle2,
  Cloud,
  Download,
  HardDrive,
  RadioTower,
  RefreshCw,
  RotateCcw,
  ShieldAlert,
  Upload,
  WifiOff,
  XCircle,
} from "lucide-react";
import { useRef, useState } from "react";
import { useAppState } from "../state/app-state";

type TestState = "idle" | "testing" | "success" | "error";

export const SettingsPage = () => {
  const { state, updateState, exportData, importData, resetData } = useAppState();
  const [testState, setTestState] = useState<TestState>("idle");
  const [testMessage, setTestMessage] = useState("");
  const importRef = useRef<HTMLInputElement | null>(null);

  const setProvider = (provider: "local" | "cloud" | "replay") => {
    if (provider === "cloud" && !state.consent.cloudProcessingApproved) {
      setTestState("error");
      setTestMessage("请先在记忆中心明确授权公网处理敏感音视频。即使授权，也不要上传真实隐私素材进行比赛演示。");
      return;
    }
    updateState((current) => ({
      ...current,
      provider: { ...current.provider, provider },
    }));
    setTestState("idle");
    setTestMessage("");
  };

  const testConnection = async () => {
    if (state.provider.provider === "replay") {
      setTestState("success");
      setTestMessage("演示回放不依赖网络，可以立即运行完整业务流程。所有语音会明确标记为本地演示语音。");
      return;
    }
    setTestState("testing");
    setTestMessage("正在检查模型服务……");
    try {
      const endpoint =
        state.provider.provider === "local"
          ? state.provider.localChatHttp.replace(/\/v1\/chat\/completions\/?$/, "/health")
          : `${state.provider.cloudBaseUrl.replace(/\/$/, "")}/api/config/eta`;
      const startedAt = performance.now();
      const response = await fetch(endpoint, { signal: AbortSignal.timeout(6000) });
      if (!response.ok) throw new Error(`HTTP ${response.status}`);
      setTestState("success");
      setTestMessage(`服务可达，健康请求耗时 ${Math.round(performance.now() - startedAt)}ms。摄像头与麦克风仍需在陪伴端单独验收。`);
    } catch (error) {
      setTestState("error");
      setTestMessage(
        `${error instanceof Error ? error.message : "连接失败"}。请检查 SSH 隧道、服务状态和浏览器代理；也可以切换演示回放。`,
      );
    }
  };

  const handleImport = async (file?: File) => {
    if (!file) return;
    try {
      await importData(file);
      setTestState("success");
      setTestMessage("陪伴档案已从 JSON 数据包恢复。");
    } catch (error) {
      setTestState("error");
      setTestMessage(error instanceof Error ? error.message : "导入失败");
    } finally {
      if (importRef.current) importRef.current.value = "";
    }
  };

  return (
    <div className="settings-layout">
      <section className="panel-card provider-section">
        <div className="panel-heading">
          <div>
            <p className="eyebrow">推理来源</p>
            <h2>选择当前演示 Provider</h2>
          </div>
          <span className="provider-current">
            当前：{
              state.provider.provider === "local"
                ? "本地 Ascend"
                : state.provider.provider === "cloud"
                  ? "ModelBest 公网"
                  : "演示回放"
            }
          </span>
        </div>
        <div className="provider-grid">
          <button
            className={state.provider.provider === "local" ? "is-active" : ""}
            type="button"
            onClick={() => setProvider("local")}
          >
            <span className="provider-icon local">
              <HardDrive aria-hidden="true" size={25} />
            </span>
            <strong>本地 Ascend</strong>
            <p>通过 SSH 隧道连接 vLLM-Omni，全双工音视频不发送到公网。</p>
            <span className="provider-tag">可选本地部署</span>
          </button>
          <button
            className={state.provider.provider === "cloud" ? "is-active" : ""}
            type="button"
            onClick={() => setProvider("cloud")}
          >
            <span className="provider-icon cloud">
              <Cloud aria-hidden="true" size={25} />
            </span>
            <strong>ModelBest 公网</strong>
            <p>按官方 Realtime API 接入全双工音频 / 视频和 Chat 动作轮次。</p>
            <span className="provider-tag recommended">本方案主模型</span>
          </button>
          <button
            className={state.provider.provider === "replay" ? "is-active" : ""}
            type="button"
            onClick={() => setProvider("replay")}
          >
            <span className="provider-icon replay">
              <WifiOff aria-hidden="true" size={25} />
            </span>
            <strong>演示回放</strong>
            <p>离线跑通业务闭环，明确标记本地语音，不冒充真实模型输出。</p>
            <span className="provider-tag">离线备用</span>
          </button>
        </div>

        <div className="connection-actions">
          <button
            className="primary-button"
            type="button"
            disabled={testState === "testing"}
            onClick={() => void testConnection()}
          >
            <RadioTower aria-hidden="true" size={19} />
            {testState === "testing" ? "正在检查" : "检查服务连接"}
          </button>
          <span>连接检查不会打开摄像头或麦克风。</span>
        </div>
        {testMessage && (
          <div
            className={`inline-alert ${testState === "success" ? "success" : testState === "error" ? "danger" : "info"}`}
            role={testState === "error" ? "alert" : "status"}
          >
            {testState === "success" ? (
              <CheckCircle2 aria-hidden="true" size={20} />
            ) : testState === "error" ? (
              <XCircle aria-hidden="true" size={20} />
            ) : (
              <RefreshCw aria-hidden="true" size={20} className="spin" />
            )}
            <span>{testMessage}</span>
          </div>
        )}
      </section>

      <section className="panel-card endpoint-section">
        <div className="panel-heading">
          <div>
            <p className="eyebrow">接口</p>
            <h2>MiniCPM-o 4.5 服务地址</h2>
          </div>
        </div>
        <div className="form-grid two-columns">
          <label className="full-span">
            本地 Realtime WebSocket
            <input
              value={state.provider.localRealtimeWs}
              onChange={(event) =>
                updateState((current) => ({
                  ...current,
                  provider: {
                    ...current.provider,
                    localRealtimeWs: event.target.value,
                  },
                }))
              }
            />
          </label>
          <label className="full-span">
            本地 Chat HTTP
            <input
              value={state.provider.localChatHttp}
              onChange={(event) =>
                updateState((current) => ({
                  ...current,
                  provider: {
                    ...current.provider,
                    localChatHttp: event.target.value,
                  },
                }))
              }
            />
          </label>
          <label>
            模型名称
            <input
              value={state.provider.model}
              onChange={(event) =>
                updateState((current) => ({
                  ...current,
                  provider: { ...current.provider, model: event.target.value },
                }))
              }
            />
          </label>
          <label>
            公网服务根地址
            <input
              value={state.provider.cloudBaseUrl}
              onChange={(event) =>
                updateState((current) => ({
                  ...current,
                  provider: {
                    ...current.provider,
                    cloudBaseUrl: event.target.value,
                  },
                }))
              }
            />
          </label>
          <label className="full-span">
            ModelBest Realtime WebSocket
            <input
              value={state.provider.cloudRealtimeWs}
              onChange={(event) =>
                updateState((current) => ({
                  ...current,
                  provider: {
                    ...current.provider,
                    cloudRealtimeWs: event.target.value,
                  },
                }))
              }
            />
          </label>
        </div>
        <p className="panel-intro">
          官方协议入口：
          <a
            href="https://minicpmo45.modelbest.cn/docs/zh/realtime-api/overview/"
            target="_blank"
            rel="noreferrer"
          >
            MiniCPM-o 4.5 Realtime API 概览
          </a>
        </p>
      </section>

      <section className="panel-card data-section">
        <div className="panel-heading">
          <div>
            <p className="eyebrow">数据可携带</p>
            <h2>备份、恢复与重置</h2>
          </div>
        </div>
        <p className="panel-intro">
          导出的 JSON 包可能包含敏感资料和压缩图片，请只在受控设备间传递。参考音色不会进入导出包。
        </p>
        <div className="data-actions">
          <button className="secondary-button" type="button" onClick={exportData}>
            <Download aria-hidden="true" size={19} /> 导出陪伴档案
          </button>
          <label className="secondary-button file-button">
            <Upload aria-hidden="true" size={19} /> 导入陪伴档案
            <input
              ref={importRef}
              type="file"
              accept="application/json"
              onChange={(event) => void handleImport(event.target.files?.[0])}
            />
          </label>
          <button
            className="danger-button"
            type="button"
            onClick={() => {
              if (window.confirm("确定清除当前浏览器中的所有资料并恢复演示数据吗？")) {
                resetData();
                setTestState("success");
                setTestMessage("已恢复到内置脱敏演示数据。");
              }
            }}
          >
            <RotateCcw aria-hidden="true" size={19} /> 恢复演示数据
          </button>
        </div>
        <div className="inline-alert warning">
          <ShieldAlert aria-hidden="true" size={20} />
          <span>浏览器本地存储不是生产级多用户数据库。本 Demo 的重点是完整交互与模型闭环，正式产品需加入加密、账户、审计和撤回授权机制。</span>
        </div>
      </section>
    </div>
  );
};
