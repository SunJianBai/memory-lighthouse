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
import { useCallback, useEffect, useRef, useState } from "react";
import { apiClient, readableError } from "../../api/api-client";
import type { RemoteAvailabilityView, RemoteJoinTicketView, RemoteSessionView } from "../../api/types";
import { BrowserRemoteSignalAdapter, LiveMediaConnection, type LiveMediaStatus } from "../../realtime/live-media";
import { useWorkspace } from "../../workspace/workspace-context";

const terminal = new Set(["DECLINED", "CANCELLED", "ENDED", "EXPIRED", "FAILED", "REVOKED"]);

export const RemoteCallPage = () => {
  const workspace = useWorkspace();
  const activeBindings = workspace.bindings.filter((binding) => binding.status === "ACTIVE" && binding.recipientId === workspace.recipientId);
  const [bindingId, setBindingId] = useState("");
  const [availability, setAvailability] = useState<RemoteAvailabilityView | null>(null);
  const [session, setSession] = useState<RemoteSessionView | null>(null);
  const [mediaStatus, setMediaStatus] = useState<LiveMediaStatus>("idle");
  const [mediaDetail, setMediaDetail] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const remoteVideo = useRef<HTMLVideoElement | null>(null);
  const remoteAudio = useRef<HTMLAudioElement | null>(null);
  const media = useRef(new LiveMediaConnection());
  const signals = useRef<BrowserRemoteSignalAdapter | null>(null);

  useEffect(() => {
    setBindingId((current) => activeBindings.some((binding) => binding.id === current) ? current : activeBindings[0]?.id ?? "");
  }, [workspace.recipientId, workspace.bindings]);

  const loadAvailability = useCallback(async () => {
    if (!workspace.householdId || !bindingId) {
      setAvailability(null);
      return;
    }
    setError("");
    try {
      setAvailability(await apiClient.request<RemoteAvailabilityView>(`/households/${workspace.householdId}/companion-bindings/${bindingId}/availability`));
    } catch (loadError) {
      setError(readableError(loadError));
    }
  }, [bindingId, workspace.householdId]);

  useEffect(() => { void loadAvailability(); }, [loadAvailability]);
  useEffect(() => {
    signals.current = new BrowserRemoteSignalAdapter();
    return () => {
      signals.current?.close();
      void media.current.disconnect();
    };
  }, []);

  const pollSession = useCallback(async () => {
    if (!session || !workspace.householdId || terminal.has(session.status)) return;
    try {
      const next = await apiClient.request<RemoteSessionView>(`/households/${workspace.householdId}/remote-sessions/${session.id}`);
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

  const call = async () => {
    if (!workspace.householdId || !bindingId) return;
    setBusy(true);
    setError("");
    try {
      const created = await apiClient.request<RemoteSessionView>(`/households/${workspace.householdId}/remote-sessions`, {
        method: "POST",
        headers: { "Idempotency-Key": crypto.randomUUID() },
        body: { bindingId, media: { receiveDeviceAudio: true, receiveDeviceVideo: true, sendFamilyAudio: true, sendFamilyVideo: false } },
      });
      setSession(created);
      signals.current?.publish({ type: "remote-session.requested", session: created });
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
    try {
      const nextTicket = await apiClient.request<RemoteJoinTicketView>(`/households/${workspace.householdId}/remote-sessions/${session.id}/join-ticket`, { method: "POST", body: { clientType: "WEB" } });
      await media.current.connect(nextTicket, "FAMILY", { remoteVideo: remoteVideo.current, remoteAudio: remoteAudio.current }, (status, detail) => { setMediaStatus(status); setMediaDetail(detail ?? ""); });
    } catch (joinError) {
      setError(readableError(joinError));
    } finally {
      setBusy(false);
    }
  };

  const end = async (cancel = false) => {
    if (!workspace.householdId || !session) return;
    setBusy(true);
    try {
      await media.current.disconnect();
      const next = await apiClient.request<RemoteSessionView>(`/households/${workspace.householdId}/remote-sessions/${session.id}/${cancel ? "cancel" : "end"}`, { method: "POST", body: {} });
      setSession(next);
      setMediaStatus("disconnected");
    } catch (endError) {
      setError(readableError(endError));
    } finally {
      setBusy(false);
    }
  };

  if (activeBindings.length === 0) {
    return <section className="empty-resource-state"><PhoneCall aria-hidden="true" size={34} /><h2>没有可呼叫的陪伴设备</h2><p>先在“陪伴设备”中为当前长者完成激活，并确保设备在线。</p></section>;
  }

  const canJoin = session && ["ACCEPTED", "CONNECTING", "ACTIVE"].includes(session.status) && mediaStatus !== "connected";

  return (
    <div className="remote-call-layout">
      <section className="remote-video-card">
        <video ref={remoteVideo} autoPlay playsInline aria-label="陪伴端实时摄像头画面" />
        <audio ref={remoteAudio} autoPlay aria-label="陪伴端实时音频" />
        {(mediaStatus !== "connected" || session?.status !== "ACTIVE") && <div className="video-placeholder"><Video aria-hidden="true" size={38} /><strong>{mediaStatus === "connected" ? "媒体已连接，等待服务器确认双方轨道" : session ? "等待现场接听并建立媒体连接" : "尚未发起通话"}</strong><p>{mediaStatus === "connected" ? "只有 LiveKit Webhook 确认双方加入并发布所需轨道后，状态才会变为 ACTIVE。" : "不会在未接听时打开陪伴端摄像头或麦克风。"}</p></div>}
        <div className="remote-video-status"><span className={`status-dot ${mediaStatus === "connected" ? "green" : ""}`} /><span>{session?.status ?? "IDLE"}</span>{mediaDetail && <small>{mediaDetail}</small>}</div>
      </section>

      <aside className="remote-control-card panel-card">
        <div className="panel-heading"><div><p className="eyebrow">现场接听</p><h2>远程关怀通话</h2></div><PhoneCall aria-hidden="true" size={25} /></div>
        <label>陪伴设备<select value={bindingId} onChange={(event) => setBindingId(event.target.value)}>{activeBindings.map((binding) => <option key={binding.id} value={binding.id}>{binding.displayName}</option>)}</select></label>
        <div className="availability-row"><span className={`status-pill ${availability?.online ? "success" : "neutral"}`}>{availability?.online ? "设备在线" : "设备离线"}</span><span>{availability?.busy ? "正在使用摄像头或麦克风" : "当前空闲"}</span><button className="icon-button" type="button" onClick={() => void loadAvailability()} aria-label="刷新设备在线状态"><RefreshCw aria-hidden="true" size={18} /></button></div>
        <ul className="media-summary"><li><Camera aria-hidden="true" size={18} /> 接听后查看陪伴端画面</li><li><Mic aria-hidden="true" size={18} /> 家属麦克风与陪伴端双向说话</li><li><ShieldCheck aria-hidden="true" size={18} /> recording=false · transcription=false</li></ul>
        {error && <div className="form-message error" role="alert">{error}</div>}
        {!session || terminal.has(session.status) ? (
          <button className="call-button" type="button" disabled={busy || !availability?.online || availability.busy} onClick={() => void call()}><PhoneCall aria-hidden="true" size={22} /> {busy ? "正在呼叫…" : !availability?.online ? "设备离线" : availability.busy ? "设备忙碌" : "呼叫陪伴端"}</button>
        ) : (
          <div className="call-actions">
            {session.status === "RINGING" && <div className="ringing-state"><Clock3 aria-hidden="true" size={20} /><span>等待陪伴端现场接听…</span></div>}
            {canJoin && <button className="call-button" type="button" disabled={busy} onClick={() => void join()}><PhoneCall aria-hidden="true" size={21} /> {busy ? "正在连接…" : "加入已接听通话"}</button>}
            <button className="danger-outline-button" type="button" disabled={busy} onClick={() => void end(session.status === "RINGING")}>
              {session.status === "RINGING" ? <PhoneOff aria-hidden="true" size={19} /> : <CircleStop aria-hidden="true" size={19} />}
              {session.status === "RINGING" ? "取消呼叫" : "结束通话"}
            </button>
          </div>
        )}
        {!availability?.online && <p className="offline-hint"><WifiOff aria-hidden="true" size={17} /> 陪伴端需保持网页或 Android App 在线并持续发送心跳。</p>}
        <p className="dev-signal-note">陪伴端通过受设备凭据保护的 current 接口发现来电；浏览器联调通道只用于同源标签页加速提示。媒体和会话状态均使用真实 API 与 LiveKit，不会伪造接通。</p>
      </aside>
    </div>
  );
};
