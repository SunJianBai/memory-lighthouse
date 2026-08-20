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
import {
  isWorkspaceOperationOwnerCurrent,
  LatestScopedRequest,
} from "../../workspace/workspace-scope";
import {
  createRemoteSessionOwner,
  isRemoteSessionTerminal,
  remoteSessionCleanupAction,
  type RemoteSessionOwner,
} from "./remote-call-scope";

const cleanupOwnedRemoteSession = async (
  session: RemoteSessionView,
  owner: RemoteSessionOwner,
  forcedAction?: "cancel" | "end",
): Promise<void> => {
  const action = forcedAction ?? remoteSessionCleanupAction(session.status);
  if (!action) return;
  try {
    await apiClient.request(
      `/households/${owner.householdId}/remote-sessions/${session.id}/${action}`,
      { method: "POST", body: {} },
    );
  } catch {
    // Lifecycle cleanup is best-effort and server-side terminal transitions are
    // idempotent. Never surface an old workspace error in the newly selected one.
  }
};

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
  const [availabilityScopeKey, setAvailabilityScopeKey] = useState("");
  const [availabilityLoading, setAvailabilityLoading] = useState(false);
  const [session, setSession] = useState<RemoteSessionView | null>(null);
  const [sessionOwner, setSessionOwner] =
    useState<RemoteSessionOwner | null>(null);
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
  const mounted = useRef(false);
  const currentScopeKey = useRef(workspace.workspaceScopeKey);
  currentScopeKey.current = workspace.workspaceScopeKey;
  const currentBindingId = useRef(bindingId);
  currentBindingId.current = bindingId;
  const currentSession = useRef(session);
  currentSession.current = session;
  const currentSessionOwner = useRef(sessionOwner);
  currentSessionOwner.current = sessionOwner;
  const currentMediaOwner = useRef<string | null>(null);
  const sessionCommandInFlight = useRef<string | null>(null);
  const availabilityRequests = useRef(new LatestScopedRequest());
  const sessionPollRequests = useRef(new LatestScopedRequest());
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
    mounted.current = true;
    signals.current = new BrowserRemoteSignalAdapter();
    return () => {
      mounted.current = false;
      signals.current?.close();
    };
  }, []);

  useEffect(() => {
    availabilityRequests.current.invalidate();
    sessionPollRequests.current.invalidate();
    currentSession.current = null;
    currentSessionOwner.current = null;
    currentMediaOwner.current = null;
    sessionCommandInFlight.current = null;
    expectedMediaDisconnect.current = false;
    setAvailability(null);
    setAvailabilityScopeKey("");
    setAvailabilityLoading(false);
    setSession(null);
    setSessionOwner(null);
    setMediaStatus("idle");
    setMediaDetail("");
    setAcceptedMediaFailure(false);
    setBusy(false);
    setError("");

    return () => {
      availabilityRequests.current.invalidate();
      sessionPollRequests.current.invalidate();
      const ownedSession = currentSession.current;
      const owner = currentSessionOwner.current;
      currentSession.current = null;
      currentSessionOwner.current = null;
      currentMediaOwner.current = null;
      sessionCommandInFlight.current = null;
      if (ownedSession && owner) {
        void cleanupOwnedRemoteSession(ownedSession, owner);
      }
      expectedMediaDisconnect.current = true;
      void media.current
        .disconnect()
        .catch(() => undefined)
        .finally(() => {
          if (currentMediaOwner.current === null) {
            expectedMediaDisconnect.current = false;
          }
        });
    };
  }, [workspace.workspaceScopeKey]);

  useEffect(() => {
    setBindingId((current) =>
      activeBindings.some((binding) => binding.id === current)
        ? current
        : (activeBindings[0]?.id ?? ""),
    );
  }, [workspace.bindings, workspace.recipientId, workspace.workspaceScopeKey]);

  const loadAvailability = useCallback(async () => {
    if (workspace.loading || !workspace.householdId || !bindingId) {
      availabilityRequests.current.invalidate();
      setAvailability(null);
      setAvailabilityScopeKey("");
      setAvailabilityLoading(false);
      return;
    }
    const requestScopeKey = workspace.workspaceScopeKey;
    const requestHouseholdId = workspace.householdId;
    const requestBindingId = bindingId;
    const request = availabilityRequests.current.begin(
      `${requestScopeKey}:${requestBindingId}`,
    );
    setAvailabilityLoading(true);
    setError("");
    try {
      const next = await apiClient.request<RemoteAvailabilityView>(
        `/households/${requestHouseholdId}/companion-bindings/${requestBindingId}/availability`,
      );
      if (
        !mounted.current ||
        !availabilityRequests.current.isCurrent(request) ||
        currentScopeKey.current !== requestScopeKey ||
        currentBindingId.current !== requestBindingId
      )
        return;
      setAvailability(next);
      setAvailabilityScopeKey(requestScopeKey);
    } catch (loadError) {
      if (
        mounted.current &&
        availabilityRequests.current.isCurrent(request) &&
        currentScopeKey.current === requestScopeKey &&
        currentBindingId.current === requestBindingId
      ) {
        setError(readableError(loadError));
      }
    } finally {
      if (
        mounted.current &&
        availabilityRequests.current.isCurrent(request) &&
        currentScopeKey.current === requestScopeKey &&
        currentBindingId.current === requestBindingId
      ) {
        setAvailabilityLoading(false);
      }
    }
  }, [
    bindingId,
    workspace.householdId,
    workspace.loading,
    workspace.workspaceScopeKey,
  ]);

  useEffect(() => {
    void loadAvailability();
  }, [loadAvailability]);

  const pollSession = useCallback(async () => {
    if (
      !session ||
      isRemoteSessionTerminal(session.status) ||
      sessionCommandInFlight.current === session.id ||
      !isWorkspaceOperationOwnerCurrent(
        sessionOwner,
        currentScopeKey.current,
      )
    )
      return;
    const polledSession = session;
    const owner = sessionOwner;
    const request = sessionPollRequests.current.begin(
      `${owner.scopeKey}:${polledSession.id}`,
    );
    try {
      const next = await apiClient.request<RemoteSessionView>(
        `/households/${owner.householdId}/remote-sessions/${polledSession.id}`,
      );
      if (
        !mounted.current ||
        !sessionPollRequests.current.isCurrent(request) ||
        currentScopeKey.current !== owner.scopeKey ||
        currentSession.current?.id !== polledSession.id ||
        currentSessionOwner.current?.scopeKey !== owner.scopeKey
      )
        return;
      currentSession.current = next;
      setSession(next);
    } catch (pollError) {
      if (
        mounted.current &&
        sessionPollRequests.current.isCurrent(request) &&
        currentScopeKey.current === owner.scopeKey &&
        currentSession.current?.id === polledSession.id &&
        currentSessionOwner.current?.scopeKey === owner.scopeKey
      ) {
        setError(readableError(pollError));
      }
    }
  }, [session?.id, session?.status, sessionOwner]);

  useEffect(() => {
    if (
      !session ||
      isRemoteSessionTerminal(session.status) ||
      !isWorkspaceOperationOwnerCurrent(
        sessionOwner,
        workspace.workspaceScopeKey,
      )
    )
      return;
    const timer = window.setInterval(() => void pollSession(), 2_000);
    return () => window.clearInterval(timer);
  }, [
    pollSession,
    session?.id,
    session?.status,
    sessionOwner,
    workspace.workspaceScopeKey,
  ]);

  useEffect(() => {
    if (
      !shouldDisconnectFamilyMedia(session?.status) ||
      !session ||
      !isWorkspaceOperationOwnerCurrent(
        sessionOwner,
        workspace.workspaceScopeKey,
      )
    )
      return;
    let active = true;
    const owner = sessionOwner;
    const mediaOwnerKey = `${owner.scopeKey}:${session.id}`;
    expectedMediaDisconnect.current = true;
    void media.current
      .disconnect()
      .catch((disconnectError) => {
        if (
          active &&
          mounted.current &&
          currentScopeKey.current === owner.scopeKey
        ) {
          setError(readableError(disconnectError));
        }
      })
      .finally(() => {
        if (
          !active ||
          !mounted.current ||
          currentScopeKey.current !== owner.scopeKey
        )
          return;
        if (currentMediaOwner.current === mediaOwnerKey) {
          currentMediaOwner.current = null;
        }
        setMediaStatus("idle");
        setMediaDetail("");
        expectedMediaDisconnect.current = false;
      });
    return () => {
      active = false;
    };
  }, [
    session,
    sessionOwner,
    workspace.workspaceScopeKey,
  ]);

  const call = async () => {
    if (
      !user ||
      !workspace.householdId ||
      !workspace.recipientId ||
      !bindingId
    )
      return;
    const owner = createRemoteSessionOwner(
      workspace.workspaceScopeKey,
      workspace.householdId,
      workspace.recipientId,
      bindingId,
    );
    const requestedMedia = {
      receiveDeviceAudio: true,
      receiveDeviceVideo: true,
      sendFamilyAudio: true,
      sendFamilyVideo: false,
    };
    const fingerprint = JSON.stringify({
      initiatorUserId: user.id,
      householdId: owner.householdId,
      bindingId: owner.bindingId,
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
            `/households/${owner.householdId}/remote-sessions`,
            {
              method: "POST",
              headers: { "Idempotency-Key": idempotencyKey },
              body: { bindingId: owner.bindingId, media: requestedMedia },
            },
          ),
      );
      if (!mounted.current || currentScopeKey.current !== owner.scopeKey) {
        await cleanupOwnedRemoteSession(created, owner, "cancel");
        return;
      }
      sessionPollRequests.current.invalidate();
      currentSession.current = created;
      currentSessionOwner.current = owner;
      setSession(created);
      setSessionOwner(owner);
      signals.current?.publish({
        type: "remote-session.requested",
        session: created,
      });
    } catch (callError) {
      if (mounted.current && currentScopeKey.current === owner.scopeKey) {
        setError(readableError(callError));
      }
    } finally {
      if (mounted.current && currentScopeKey.current === owner.scopeKey) {
        setBusy(false);
      }
    }
  };

  const join = async () => {
    if (
      !session ||
      !isWorkspaceOperationOwnerCurrent(
        sessionOwner,
        currentScopeKey.current,
      )
    )
      return;
    const joinedSession = session;
    const owner = sessionOwner;
    const mediaOwnerKey = `${owner.scopeKey}:${joinedSession.id}`;
    setBusy(true);
    setError("");
    setAcceptedMediaFailure(false);
    try {
      const nextTicket = await apiClient.request<RemoteJoinTicketView>(
        `/households/${owner.householdId}/remote-sessions/${joinedSession.id}/join-ticket`,
        { method: "POST", body: { clientType: "WEB" } },
      );
      if (
        !mounted.current ||
        currentScopeKey.current !== owner.scopeKey ||
        currentSession.current?.id !== joinedSession.id ||
        currentSessionOwner.current?.scopeKey !== owner.scopeKey
      )
        return;
      currentMediaOwner.current = mediaOwnerKey;
      expectedMediaDisconnect.current = false;
      await media.current.connect(
        nextTicket,
        "FAMILY",
        { remoteVideo: remoteVideo.current, remoteAudio: remoteAudio.current },
        (status, detail) => {
          if (
            !mounted.current ||
            currentScopeKey.current !== owner.scopeKey ||
            currentSession.current?.id !== joinedSession.id ||
            currentMediaOwner.current !== mediaOwnerKey
          )
            return;
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
      if (
        !mounted.current ||
        currentScopeKey.current !== owner.scopeKey ||
        currentSession.current?.id !== joinedSession.id ||
        currentSessionOwner.current?.scopeKey !== owner.scopeKey
      ) {
        if (
          currentMediaOwner.current === mediaOwnerKey ||
          currentMediaOwner.current === null
        ) {
          expectedMediaDisconnect.current = true;
          await media.current.disconnect();
          if (currentMediaOwner.current === mediaOwnerKey) {
            currentMediaOwner.current = null;
          }
        }
      }
    } catch (joinError) {
      if (
        mounted.current &&
        currentScopeKey.current === owner.scopeKey &&
        currentSession.current?.id === joinedSession.id
      ) {
        setError(readableError(joinError));
      }
      if (currentMediaOwner.current === mediaOwnerKey) {
        currentMediaOwner.current = null;
      }
    } finally {
      if (
        mounted.current &&
        currentScopeKey.current === owner.scopeKey &&
        currentSession.current?.id === joinedSession.id
      ) {
        setBusy(false);
      }
    }
  };

  const end = async () => {
    if (
      !session ||
      !isWorkspaceOperationOwnerCurrent(
        sessionOwner,
        currentScopeKey.current,
      )
    )
      return;
    const endedSession = session;
    const owner = sessionOwner;
    const action = remoteSessionCleanupAction(endedSession.status);
    if (!action) return;
    sessionCommandInFlight.current = endedSession.id;
    sessionPollRequests.current.invalidate();
    setBusy(true);
    expectedMediaDisconnect.current = true;
    try {
      currentMediaOwner.current = null;
      try {
        await media.current.disconnect();
      } catch (disconnectError) {
        if (
          mounted.current &&
          currentScopeKey.current === owner.scopeKey
        ) {
          setError(readableError(disconnectError));
        }
      }
      const next = await apiClient.request<RemoteSessionView>(
        `/households/${owner.householdId}/remote-sessions/${endedSession.id}/${action}`,
        { method: "POST", body: {} },
      );
      if (
        !mounted.current ||
        currentScopeKey.current !== owner.scopeKey ||
        currentSession.current?.id !== endedSession.id ||
        currentSessionOwner.current?.scopeKey !== owner.scopeKey
      )
        return;
      currentSession.current = next;
      setSession(next);
      setMediaStatus("idle");
      setMediaDetail("");
      setAcceptedMediaFailure(false);
    } catch (endError) {
      if (
        mounted.current &&
        currentScopeKey.current === owner.scopeKey &&
        currentSession.current?.id === endedSession.id
      ) {
        setError(readableError(endError));
      }
    } finally {
      if (sessionCommandInFlight.current === endedSession.id) {
        sessionCommandInFlight.current = null;
      }
      if (
        mounted.current &&
        currentScopeKey.current === owner.scopeKey &&
        currentSession.current?.id === endedSession.id
      ) {
        expectedMediaDisconnect.current = false;
        setBusy(false);
      }
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

  const visibleSession = isWorkspaceOperationOwnerCurrent(
    sessionOwner,
    workspace.workspaceScopeKey,
  )
    ? session
    : null;
  const visibleAvailability =
    availabilityScopeKey === workspace.workspaceScopeKey &&
    availability?.bindingId === bindingId
      ? availability
      : null;
  const callPresentation = presentFamilyCall(
    visibleSession?.status,
    mediaStatus,
    acceptedMediaFailure,
  );
  const canJoin = Boolean(visibleSession && callPresentation.canJoin);

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
        {(mediaStatus !== "connected" || visibleSession?.status !== "ACTIVE") && (
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
          <span>{visibleSession?.status ?? "IDLE"}</span>
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
            disabled={
              busy ||
              Boolean(
                visibleSession &&
                  !isRemoteSessionTerminal(visibleSession.status),
              )
            }
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
            className={`status-pill ${visibleAvailability?.online ? "success" : "neutral"}`}
          >
            {availabilityLoading
              ? "正在检查"
              : visibleAvailability?.online
                ? "设备在线"
                : "设备离线"}
          </span>
          <span>
            {availabilityLoading
              ? "请稍候"
              : visibleAvailability?.busy
                ? "远程媒体正忙"
                : visibleAvailability?.companionActive
                  ? "陪伴中，可呼叫"
                  : "当前空闲"}
          </span>
          <button
            className="icon-button"
            type="button"
            disabled={availabilityLoading}
            onClick={() => void loadAvailability()}
            aria-label={
              availabilityLoading
                ? "正在刷新设备在线状态"
                : "刷新设备在线状态"
            }
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
        {!visibleSession || isRemoteSessionTerminal(visibleSession.status) ? (
          <button
            className="call-button"
            type="button"
            disabled={
              busy ||
              availabilityLoading ||
              !visibleAvailability?.online ||
              visibleAvailability.busy
            }
            onClick={() => void call()}
          >
            <PhoneCall aria-hidden="true" size={22} />{" "}
            {busy
              ? "正在呼叫…"
              : availabilityLoading
                ? "正在检查设备…"
                : !visibleAvailability?.online
                  ? "设备离线"
                  : visibleAvailability.busy
                    ? "设备忙碌"
                    : "呼叫陪伴端"}
          </button>
        ) : (
          <div className="call-actions">
            {visibleSession.status === "RINGING" && (
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
              onClick={() => void end()}
            >
              {visibleSession.status === "RINGING" ? (
                <PhoneOff aria-hidden="true" size={19} />
              ) : (
                <CircleStop aria-hidden="true" size={19} />
              )}
              {visibleSession.status === "RINGING" ? "取消呼叫" : "结束通话"}
            </button>
          </div>
        )}
        {!availabilityLoading && !visibleAvailability?.online && (
          <p className="offline-hint">
            <WifiOff aria-hidden="true" size={17} /> 陪伴设备当前离线。
          </p>
        )}
      </aside>
    </div>
  );
};
