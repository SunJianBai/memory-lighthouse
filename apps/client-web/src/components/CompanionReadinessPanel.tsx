import { useEffect, useRef, useState } from "react";
import type { DeviceReadinessView } from "../api/types";
import { readableError } from "../api/api-client";
import {
  browserPermissionMessage,
  inspectBrowserPermission,
  type BrowserMediaPermission,
} from "../device/browser-permissions";
import { deviceSession } from "../device/device-session";

type CheckPhase = "idle" | "checking" | "done" | "expired" | "error";
const scopeLabels: Record<string, string> = {
  MICROPHONE_CAPTURE: "陪伴麦克风",
  CAMERA_CAPTURE: "陪伴摄像头",
  MODEL_PROCESSING: "全模态模型处理",
};
const authorizationMessage = (
  check?: DeviceReadinessView["authorization"]["audio"],
) =>
  !check
    ? "未检查"
    : check.allowed
      ? "已授权"
      : `请家属在“隐私与授权”开启${check.missingScopes.map((scope) => (Object.hasOwn(scopeLabels, scope) ? scopeLabels[scope] : "所需功能")).join("、")}`;

// This component never captures media, creates a session or changes startup authorization.
export function CompanionReadinessPanel({
  bindingId,
  deviceId,
}: {
  bindingId: string;
  deviceId: string;
}) {
  const [phase, setPhase] = useState<CheckPhase>("idle");
  const [report, setReport] = useState<DeviceReadinessView | null>(null);
  const [permissions, setPermissions] = useState<{
    microphone?: BrowserMediaPermission;
    camera?: BrowserMediaPermission;
  }>({});
  const [error, setError] = useState("");
  const generation = useRef(0);
  const running = useRef(false);

  useEffect(() => {
    const invalidate = () => {
      ++generation.current;
      running.current = false;
      setReport(null);
      setPermissions({});
      setError("");
      setPhase((current) => (current === "idle" ? "idle" : "expired"));
    };
    invalidate();
    const onVisibility = () => {
      if (document.visibilityState !== "visible") invalidate();
    };
    document.addEventListener("visibilitychange", onVisibility);
    window.addEventListener("pagehide", invalidate);
    window.addEventListener("blur", invalidate);
    return () => {
      ++generation.current;
      running.current = false;
      document.removeEventListener("visibilitychange", onVisibility);
      window.removeEventListener("pagehide", invalidate);
      window.removeEventListener("blur", invalidate);
    };
  }, [bindingId, deviceId]);

  useEffect(() => {
    if (phase !== "done" && phase !== "error") return;
    const timer = setTimeout(() => {
      ++generation.current;
      setReport(null);
      setPermissions({});
      setError("");
      setPhase("expired");
    }, 60_000);
    return () => clearTimeout(timer);
  }, [phase, report]);

  async function check() {
    if (running.current) return;
    running.current = true;
    const ticket = ++generation.current;
    setReport(null);
    setPermissions({});
    setError("");
    setPhase("checking");
    let timer: ReturnType<typeof setTimeout> | undefined;
    try {
      const [microphone, camera, server] = await Promise.all([
        inspectBrowserPermission("microphone"),
        inspectBrowserPermission("camera"),
        Promise.race([
          deviceSession.readiness(),
          new Promise<never>((_, reject) => {
            timer = setTimeout(
              () => reject(new Error("检查超时，请稍后重试")),
              15_000,
            );
          }),
        ]).then(
          (value) => ({ value }),
          (cause: unknown) => ({ cause }),
        ),
      ]);
      if (generation.current !== ticket) return;
      setPermissions({ microphone, camera });
      if ("cause" in server) throw server.cause;
      if (
        server.value.schemaVersion !== 1 ||
        server.value.bindingId !== bindingId ||
        server.value.deviceId !== deviceId ||
        !Number.isFinite(Date.parse(server.value.checkedAt))
      ) {
        throw new Error("设备状态已变化，请刷新陪伴页面后重试");
      }
      setReport(server.value);
      setPhase("done");
    } catch (cause) {
      if (generation.current !== ticket) return;
      setError(readableError(cause));
      setPhase("error");
    } finally {
      if (timer !== undefined) clearTimeout(timer);
      if (generation.current === ticket) running.current = false;
    }
  }

  const rows = [
    [
      "设备身份与服务端",
      report
        ? "本次访问成功，设备绑定有效"
        : phase === "error"
          ? "本次检查失败"
          : "未检查",
    ],
    ["语音陪伴授权", authorizationMessage(report?.authorization.audio)],
    ["视频陪伴授权", authorizationMessage(report?.authorization.audioVideo)],
    ["本机麦克风", browserPermissionMessage(permissions.microphone)],
    ["本机摄像头", browserPermissionMessage(permissions.camera)],
    [
      "模型配置",
      !report
        ? "未检查"
        : report.model.configurationStatus === "CONFIGURED"
          ? "配置已提供，连接未检查"
          : "配置不可用，请联系管理员",
    ],
  ];
  return (
    <details className="companion-readiness panel-card">
      <summary>
        启动检查<span>此浏览器</span>
      </summary>
      <p>读取启动条件，不开启摄像头或麦克风。</p>
      <dl>
        {rows.map(([title, detail]) => (
          <div key={title}>
            <dt>{title}</dt>
            <dd>{detail}</dd>
          </div>
        ))}
      </dl>
      <p role="status">
        {phase === "checking"
          ? "正在检查…"
          : phase === "expired"
            ? "结果已失效，请重新检查。"
            : report
              ? `检查时间：${new Date(report.checkedAt).toLocaleString("zh-CN")}`
              : "尚无有效的服务端检查结果。"}
      </p>
      {error && (
        <p className="form-message error" role="alert">
          {error}
        </p>
      )}
      <button
        type="button"
        className="secondary-button"
        disabled={phase === "checking"}
        onClick={() => void check()}
      >
        {phase === "checking" ? "正在检查…" : "检查启动条件"}
      </button>
      <p className="companion-readiness-note">
        检查仅供参考；实际采集和模型连接以开始陪伴后的结果为准。
      </p>
    </details>
  );
}
