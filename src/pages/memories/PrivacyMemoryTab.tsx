import { FileImage, Trash2 } from "lucide-react";
import type { AppState, ConsentState } from "../../domain/types";

type Props = {
  state: AppState;
  deleteAsset: (assetId: string) => void;
  setConsent: (
    key: Exclude<keyof ConsentState, "acceptedAt">,
    approved: boolean,
  ) => void;
};

const consentOptions: Array<{
  key: Exclude<keyof ConsentState, "acceptedAt">;
  label: string;
}> = [
  { key: "localStorageApproved", label: "在此浏览器保存陪伴档案" },
  { key: "cameraApproved", label: "会话期间使用摄像头" },
  { key: "microphoneApproved", label: "会话期间使用麦克风" },
  { key: "sensitiveMemoryApproved", label: "保存人脸、药物等敏感记忆" },
  {
    key: "cloudProcessingApproved",
    label: "把音视频发送到 ModelBest 公网服务",
  },
];

export const PrivacyMemoryTab = ({
  state,
  deleteAsset,
  setConsent,
}: Props) => (
  <div className="memory-content-grid" role="tabpanel">
    <section className="panel-card">
      <div className="panel-heading">
        <div>
          <p className="eyebrow">已上传资料</p>
          <h2>本地资产清单</h2>
        </div>
        <span className="local-only-chip">{state.assets.length} 个文件</span>
      </div>
      <p className="panel-intro">
        人脸照片仅作为家属录入的资料展示和上下文，不进行自动身份认证。删除后会同步解除所有关联。
      </p>
      <div className="asset-grid">
        {state.assets.length === 0 && (
          <div className="empty-state">
            <FileImage aria-hidden="true" size={30} />
            <strong>没有上传文件</strong>
            <p>可在“人物与称呼”或“药物与日程”中添加照片。</p>
          </div>
        )}
        {state.assets.map((asset) => (
          <article key={asset.id} className="asset-card">
            {asset.mimeType.startsWith("image/") ? (
              <img src={asset.dataUrl} alt={asset.name} />
            ) : (
              <FileImage aria-hidden="true" size={28} />
            )}
            <div>
              <strong>{asset.name}</strong>
              <span>{asset.kind} · 仅本地</span>
            </div>
            <button
              className="icon-button danger-ghost"
              type="button"
              aria-label={`删除文件：${asset.name}`}
              onClick={() => deleteAsset(asset.id)}
            >
              <Trash2 aria-hidden="true" size={18} />
            </button>
          </article>
        ))}
      </div>
    </section>

    <section className="panel-card consent-card">
      <div className="panel-heading">
        <div>
          <p className="eyebrow">授权状态</p>
          <h2>谁可以处理哪些数据</h2>
        </div>
      </div>
      {consentOptions.map(({ key, label }) => (
        <label className="consent-row" key={key}>
          <span>
            <strong>{label}</strong>
            {key === "cloudProcessingApproved" && (
              <small>关闭时只能使用本地 Ascend 或演示回放。</small>
            )}
          </span>
          <input
            type="checkbox"
            checked={state.consent[key]}
            onChange={(event) => setConsent(key, event.target.checked)}
          />
        </label>
      ))}
    </section>
  </div>
);
