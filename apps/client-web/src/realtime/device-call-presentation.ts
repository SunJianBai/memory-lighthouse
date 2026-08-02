import type { LiveMediaStatus } from "./live-media";

export type DeviceCallPresentation = {
  state: "ringing" | "connecting" | "connected" | "media-failed" | "accepted";
  message: string;
  callDetailTone: "success" | "error";
  canJoin: boolean;
};

export const presentDeviceCall = (
  remoteStatus: string,
  mediaStatus: LiveMediaStatus,
): DeviceCallPresentation => {
  if (remoteStatus === "RINGING") {
    return {
      state: "ringing",
      message: "远程通话尚未接听，陪伴模型继续按原授权运行",
      callDetailTone: "success",
      canJoin: true,
    };
  }
  if (mediaStatus === "error" || mediaStatus === "disconnected") {
    return {
      state: "media-failed",
      message: "已现场接听，但媒体连接失败；陪伴模型已安全停止，请结束本次通话后重新发起",
      callDetailTone: "error",
      canJoin: false,
    };
  }
  if (mediaStatus === "connected") {
    return {
      state: "connected",
      message: "实时媒体已连接",
      callDetailTone: "success",
      canJoin: false,
    };
  }
  if (mediaStatus === "connecting") {
    return {
      state: "connecting",
      message: "已现场接听，正在建立加密媒体通道；陪伴模型已停止",
      callDetailTone: "success",
      canJoin: false,
    };
  }
  return {
    state: "accepted",
    message: "已现场接听，等待加入实时媒体；陪伴模型已停止",
    callDetailTone: "success",
    canJoin: true,
  };
};
