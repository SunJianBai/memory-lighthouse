import {
  Camera,
  CircleStop,
  Clock3,
  Mic,
  PhoneCall,
  PhoneOff,
  RefreshCw,
  ShieldCheck,
  Video,
  WifiOff,
} from "lucide-react";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { apiClient, readableError } from "../../api/api-client";
import { IdempotentCommandRegistry } from "../../api/idempotent-command";
import { useAuth } from "../../auth/auth-context";
import type {
  RemoteAvailabilityView,
  RemoteJoinTicketView,
  RemoteSessionView,
} from "../../api/types";
import {
  BrowserRemoteSignalAdapter,
  LiveMediaConnection,
  type LiveMediaStatus,
} from "../../realtime/live-media";
import {
  presentFamilyCall,
  shouldDisconnectFamilyMedia,
} from "../../realtime/family-call-presentation";
import { useWorkspace } from "../../workspace/workspace-context";

const terminal = new Set([
  "DECLINED",
  "CANCELLED",
  "ENDED",
  "EXPIRED",
  "FAILED",
  "REVOKED",
]);

export const RemoteCallPage = () => {
  const { user } = useAuth();
  const workspace = useWorkspace();
  const activeBindings = workspace.bindings.filter(
    (binding) =>
      binding.status === "ACTIVE" &&
      binding.recipientId === workspace.recipientId,
  );
  const [bindingId, setBindingId] = useState("");
  const [availability, setAvailability] =
    useState<RemoteAvailabilityView | null>(null);
  const [session, setSession] = useState<RemoteSessionView | null>(null);
  const [mediaStatus, setMediaStatus] = useState<LiveMediaStatus>("idle");
  const [mediaDetail, setMediaDetail] = useState("");
  const [acceptedMediaFailure, setAcceptedMediaFailure] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const remoteVideo = useRef<HTMLVideoElement | null>(null);
  const remoteAudio = useRef<HTMLAudioElement | null>(null);
  const media = useRef(new LiveMediaConnection());
  const expectedMediaDisconnect = useRef(false);
  const signals = useRef<BrowserRemoteSignalAdapter | null>(null);
  const commands = useMemo(
    () =>
      new IdempotentCommandRegistry(undefined, {
        persist: true,
        namespace: user?.id ?? "anonymous",
        replacePreviousIntent: true,
        scope: "remote-call",
      }),
    [user?.id],
  );

  useEffect(() => {
    setBindingId((current) =>
      activeBindings.some((binding) => binding.id === current)
        ? current
        : (activeBindings[0]?.id ?? ""),
    );
  }, [workspace.recipientId, workspace.bindings]);

  const loadAvailability = useCallback(async () => {
    if (!workspace.householdId || !bindingId) {
      setAvailability(null);
      return;
    }
    setError("");
    try {
      setAvailability(
        await apiClient.request<RemoteAvailabilityView>(
          `/households/${workspace.householdId}/companion-bindings/${bindingId}/availability`,
        ),
      );
    } catch (loadError) {
      setError(readableError(loadError));
    }
  }, [bindingId, workspace.householdId]);

  useEffect(() => {
    void loadAvailability();
  }, [loadAvailability]);
  useEffect(() => {
    signals.current = new BrowserRemoteSignalAdapter();
    return () => {
      signals.current?.close();
      expectedMediaDisconnect.current = true;
      void media.current.disconnect();
    };
  }, []);

  const pollSession = useCallback(async () => {
    if (!session || !workspace.householdId || terminal.has(session.status))
      return;
    try {
      const next = await apiClient.request<RemoteSessionView>(
        `/households/${workspace.householdId}/remote-sessions/${session.id}`,
      );
      setSession(next);
    } catch (pollError) {
      setError(readableError(pollError));
    }
  }, [session?.id, session?.status, workspace.householdId]);

  useEffect(() => {
    if (!session || terminal.has(session.status)) return;
    const timer = window.setInterval(() => void pollSession(), 2_000);
    return () => window.clearInterval(timer);
  }, [pollSession, session?.id, session?.status]);

  useEffect(() => {
    if (!shouldDisconnectFamilyMedia(session?.status)) return;
    let active = true;
    expectedMediaDisconnect.current = true;
    void media.current
      .disconnect()
      .catch((disconnectError) => {
        if (active) setError(readableError(disconnectError));
      })
      .finally(() => {
        if (!active) return;
        setMediaStatus("idle");
        setMediaDetail("");
        expectedMediaDisconnect.current = false;
      });
    return () => {
      active = false;
    };
  }, [session?.id, session?.status]);

  const call = async () => {
    if (!user || !workspace.householdId || !bindingId) return;
    const requestedMedia = {
      receiveDeviceAudio: true,
      receiveDeviceVideo: true,
      sendFamilyAudio: true,
      sendFamilyVideo: false,
    };
    const fingerprint = JSON.stringify({
      initiatorUserId: user.id,
      householdId: workspace.householdId,
      bindingId,
      media: requestedMedia,
    });
    setBusy(true);
    setError("");
    setMediaStatus("idle");
    setMediaDetail("");
    setAcceptedMediaFailure(false);
    expectedMediaDisconnect.current = false;
    try {
      const created = await commands.execute(
        `remote-call:${fingerprint}`,
        (idempotencyKey) =>
          apiClient.request<RemoteSessionView>(
            `/households/${workspace.householdId}/remote-sessions`,
            {
              method: "POST",
              headers: { "Idempotency-Key": idempotencyKey },
              body: { bindingId, media: requestedMedia },
            },
          ),
      );
      setSession(created);
      signals.current?.publish({
        type: "remote-session.requested",
        session: created,
      });
    } catch (callError) {
      setError(readableError(callError));
    } finally {
      setBusy(false);
    }
  };

  const join = async () => {
    if (!workspace.householdId || !session) return;
    setBusy(true);
    setError("");
    setAcceptedMediaFailure(false);
    try {
      const nextTicket = await apiClient.request<RemoteJoinTicketView>(
        `/households/${workspace.householdId}/remote-sessions/${session.id}/join-ticket`,
        { method: "POST", body: { clientType: "WEB" } },
      );
      await media.current.connect(
        nextTicket,
        "FAMILY",
        { remoteVideo: remoteVideo.current, remoteAudio: remoteAudio.current },
        (status, detail) => {
          setMediaStatus(status);
          setMediaDetail(detail ?? "");
          if (
            !expectedMediaDisconnect.current &&
            (status === "error" || status === "disconnected")
          ) {
            setAcceptedMediaFailure(true);
          }
        },
      );
    } catch (joinError) {
      setError(readableError(joinError));
    } finally {
      setBusy(false);
    }
  };

  const end = async (cancel = false) => {
    if (!workspace.householdId || !session) return;
    setBusy(true);
    expectedMediaDisconnect.current = true;
    try {
      await media.current.disconnect();
      const next = await apiClient.request<RemoteSessionView>(
        `/households/${workspace.householdId}/remote-sessions/${session.id}/${cancel ? "cancel" : "end"}`,
        { method: "POST", body: {} },
      );
      setSession(next);
      setMediaStatus("idle");
      setMediaDetail("");
      setAcceptedMediaFailure(false);
    } catch (endError) {
      setError(readableError(endError));
    } finally {
      expectedMediaDisconnect.current = false;
      setBusy(false);
    }
  };

  if (activeBindings.length === 0) {
    return (
      <section className="empty-resource-state">
        <PhoneCall aria-hidden="true" size={34} />
        <h2>没有可呼叫的陪伴设备</h2>
        <p>先在“陪伴设备”中为当前长者完成激活，并确保设备在线。</p>
      </section>
    );
  }

  const callPresentation = presentFamilyCall(
    session?.status,
    mediaStatus,
    acceptedMediaFailure,
  );
  const canJoin = Boolean(session && callPresentation.canJoin);

  return (
    <div className="remote-call-layout">
      <section className="remote-video-card">
        <video
          ref={remoteVideo}
          autoPlay
          playsInline
          aria-label="陪伴端实时摄像头画面"
        />
        <audio ref={remoteAudio} autoPlay aria-label="陪伴端实时音频" />
        {(mediaStatus !== "connected" || session?.status !== "ACTIVE") && (
          <div className="video-placeholder">
            <Video aria-hidden="true" size={38} />
            <strong>
              {callPresentation.title}
            </strong>
            <p>{callPresentation.message}</p>
          </div>
        )}
        <div className="remote-video-status">
          <span
            className={`status-dot ${mediaStatus === "connected" ? "green" : ""}`}
          />
          <span>{session?.status ?? "IDLE"}</span>
          {mediaDetail && <small>{mediaDetail}</small>}
        </div>
      </section>

      <aside className="remote-control-card panel-card">
        <div className="panel-heading">
          <div>
            <p className="eyebrow">现场接听</p>
            <h2>远程关怀通话</h2>
          </div>
          <PhoneCall aria-hidden="true" size={25} />
        </div>
        <label>
          陪伴设备
          <select
            value={bindingId}
            onChange={(event) => setBindingId(event.target.value)}
          >
            {activeBindings.map((binding) => (
              <option key={binding.id} value={binding.id}>
                {binding.displayName}
              </option>
            ))}
          </select>
        </label>
        <div className="availability-row">
          <span
            className={`status-pill ${availability?.online ? "success" : "neutral"}`}
          >
            {availability?.online ? "设备在线" : "设备离线"}
          </span>
          <span>
            {availability?.busy
              ? "远程媒体正忙"
              : availability?.companionActive
                ? "陪伴中，可呼叫"
                : "当前空闲"}
          </span>
          <button
            className="icon-button"
            type="button"
            onClick={() => void loadAvailability()}
            aria-label="刷新设备在线状态"
          >
            <RefreshCw aria-hidden="true" size={18} />
          </button>
        </div>
        <ul className="media-summary">
          <li>
            <Camera aria-hidden="true" size={18} /> 接听后开启音视频
          </li>
          <li>
            <Mic aria-hidden="true" size={18} /> 与陪伴端实时通话
          </li>
          <li>
            <ShieldCheck aria-hidden="true" size={18} /> recording=false ·
            transcription=false
          </li>
        </ul>
        {error && (
          <div className="form-message error" role="alert">
            {error}
          </div>
        )}
        {callPresentation.state === "media-failed" && (
          <div className="form-message error" role="alert">
            <strong>{callPresentation.title}</strong>
            <span>{callPresentation.message}</span>
          </div>
        )}
        {!session || terminal.has(session.status) ? (
          <button
            className="call-button"
            type="button"
            disabled={busy || !availability?.online || availability.busy}
            onClick={() => void call()}
          >
            <PhoneCall aria-hidden="true" size={22} />{" "}
            {busy
              ? "正在呼叫…"
              : !availability?.online
                ? "设备离线"
                : availability.busy
                  ? "设备忙碌"
                  : "呼叫陪伴端"}
          </button>
        ) : (
          <div className="call-actions">
            {session.status === "RINGING" && (
              <div className="ringing-state">
                <Clock3 aria-hidden="true" size={20} />
                <span>等待陪伴端现场接听…</span>
              </div>
            )}
            {canJoin && (
              <button
                className="call-button"
                type="button"
                disabled={busy}
                onClick={() => void join()}
              >
                <PhoneCall aria-hidden="true" size={21} />{" "}
                {busy ? "正在连接…" : "加入已接听通话"}
              </button>
            )}
            <button
              className="danger-outline-button"
              type="button"
              disabled={busy}
              onClick={() => void end(session.status === "RINGING")}
            >
              {session.status === "RINGING" ? (
                <PhoneOff aria-hidden="true" size={19} />
              ) : (
                <CircleStop aria-hidden="true" size={19} />
              )}
              {session.status === "RINGING" ? "取消呼叫" : "结束通话"}
            </button>
          </div>
        )}
        {!availability?.online && (
          <p className="offline-hint">
            <WifiOff aria-hidden="true" size={17} /> 陪伴设备当前离线。
          </p>
        )}
      </aside>
    </div>
  );
};
