import { MailCheck } from "lucide-react";
import { useState } from "react";
import { apiClient, readableError } from "../../api/api-client";
import { navigate } from "../../app/navigation";
import { useWorkspace } from "../../workspace/workspace-context";

export const InvitationAcceptPage = ({ token }: { token?: string }) => {
  const workspace = useWorkspace();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [accepted, setAccepted] = useState(false);

  const accept = async () => {
    if (!token) {
      setError("邀请链接无效，请让家庭管理员重新发送。");
      return;
    }
    setBusy(true);
    setError("");
    try {
      await apiClient.request("/household-invitations/accept", {
        method: "POST",
        body: { token },
      });
      setAccepted(true);
      await workspace.refresh();
    } catch (acceptError) {
      setError(readableError(acceptError));
    } finally {
      setBusy(false);
    }
  };

  return (
    <section className="center-state-card">
      <span className="state-illustration"><MailCheck aria-hidden="true" size={35} /></span>
      <h2>{accepted ? "已加入家庭" : "接受家庭邀请"}</h2>
      <p>{accepted ? "你已加入该家庭。" : "接受后，你将加入该家庭。"}</p>
      {error && <div className="form-message error" role="alert">{error}</div>}
      {accepted ? (
        <button className="primary-button" type="button" onClick={() => navigate("workspace-overview")}>进入家庭概览</button>
      ) : (
        <button className="primary-button" type="button" disabled={busy || !token} onClick={() => void accept()}>{busy ? "正在确认…" : "确认加入家庭"}</button>
      )}
    </section>
  );
};
