import type { LiveMediaStatus } from "./live-media";

export type FamilyCallPresentation = {
  state:
    | "idle"
    | "ringing"
    | "accepted"
    | "connecting"
    | "connected"
    | "media-failed"
    | "ended";
  title: string;
  message: string;
  tone: "neutral" | "success" | "error";
  canJoin: boolean;
};

const acceptedStatuses = new Set(["ACCEPTED", "CONNECTING", "ACTIVE"]);
const terminalStatuses = new Set([
  "DECLINED",
  "CANCELLED",
  "ENDED",
  "EXPIRED",
  "FAILED",
  "REVOKED",
]);

export const shouldDisconnectFamilyMedia = (
  remoteStatus: string | undefined,
): boolean => Boolean(remoteStatus && terminalStatuses.has(remoteStatus));

export const presentFamilyCall = (
  remoteStatus: string | undefined,
  mediaStatus: LiveMediaStatus,
  acceptedMediaFailure = false,
): FamilyCallPresentation => {
  if (!remoteStatus) {
    return {
      state: "idle",
      title: "尚未发起通话",
      message: "陪伴端只有在现场明确接听后才会打开摄像头和麦克风。",
      tone: "neutral",
      canJoin: false,
    };
  }
  if (remoteStatus === "RINGING") {
    return {
      state: "ringing",
      title: "等待陪伴端现场接听",
      message: "未接听前不会打开陪伴端摄像头或麦克风。",
      tone: "neutral",
      canJoin: false,
    };
  }
  if (
    acceptedMediaFailure ||
    (acceptedStatuses.has(remoteStatus) &&
      (mediaStatus === "error" || mediaStatus === "disconnected"))
  ) {
    return {
      state: "media-failed",
      title: "设备已接听，但媒体连接失败",
      message: "陪伴模型已停止。请结束本次通话后重新发起，不能直接重连。",
      tone: "error",
      canJoin: false,
    };
  }
  if (!acceptedStatuses.has(remoteStatus)) {
    return {
      state: "ended",
      title: "本次通话已结束",
      message: "如需再次通话，请重新发起并等待陪伴端现场接听。",
      tone: "neutral",
      canJoin: false,
    };
  }
  if (mediaStatus === "connected") {
    return {
      state: "connected",
      title: "实时媒体已连接",
      message: "等待服务器确认双方已加入并发布所需轨道。",
      tone: "success",
      canJoin: false,
    };
  }
  if (mediaStatus === "connecting") {
    return {
      state: "connecting",
      title: "正在建立加密媒体通道",
      message: "设备已现场接听，陪伴模型已停止。",
      tone: "success",
      canJoin: false,
    };
  }
  return {
    state: "accepted",
    title: "设备已现场接听",
    message: "现在可以加入本次实时通话；陪伴模型已停止。",
    tone: "success",
    canJoin: true,
  };
};
