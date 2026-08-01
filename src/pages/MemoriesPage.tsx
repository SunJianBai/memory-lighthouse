import {
  BookHeart,
  Camera,
  Check,
  CircleUserRound,
  Clock3,
  FileImage,
  MapPin,
  Pill,
  Plus,
  ShieldCheck,
  Trash2,
  Upload,
  UsersRound,
} from "lucide-react";
import { useState, type FormEvent } from "react";
import { prepareAsset } from "../data/storage";
import type { AssetKind, ConsentState, MemoryKind } from "../domain/types";
import { useAppState } from "../state/app-state";

type TabId = "people" | "medications" | "daily" | "privacy";

const tabs = [
  { id: "people" as const, label: "人物与称呼", icon: UsersRound },
  { id: "medications" as const, label: "药物与日程", icon: Pill },
  { id: "daily" as const, label: "生活记忆", icon: BookHeart },
  { id: "privacy" as const, label: "授权与数据", icon: ShieldCheck },
];

export const MemoriesPage = () => {
  const {
    state,
    updateState,
    addAsset,
    deleteAsset,
  } = useAppState();
  const [tab, setTab] = useState<TabId>("people");
  const [feedback, setFeedback] = useState("");
  const [feedbackTone, setFeedbackTone] = useState<"success" | "danger">(
    "success",
  );
  const [personForm, setPersonForm] = useState({
    name: "",
    relationship: "",
    phone: "",
  });
  const [medicationForm, setMedicationForm] = useState({
    name: "",
    alias: "",
    time: "08:30",
    requirements: "",
    containerLabel: "",
    containerLocation: "",
  });
  const [memoryForm, setMemoryForm] = useState({
    kind: "preference" as MemoryKind,
    title: "",
    content: "",
    tags: "",
  });

  const assetById = (id?: string) =>
    id ? state.assets.find((asset) => asset.id === id) : undefined;

  const uploadAndAttach = async (
    file: File | undefined,
    kind: AssetKind,
    attach: (assetId: string) => void,
  ) => {
    if (!file) return;
    if (!state.consent.sensitiveMemoryApproved) {
      setFeedbackTone("danger");
      setFeedback("请先在“授权与数据”中允许保存敏感记忆，再上传图片。");
      return;
    }
    try {
      const asset = await prepareAsset(file, kind);
      addAsset(asset);
      attach(asset.id);
      setFeedbackTone("success");
      setFeedback(`“${file.name}”已压缩并保存到本浏览器。`);
    } catch (error) {
      setFeedbackTone("danger");
      setFeedback(error instanceof Error ? error.message : "上传失败");
    }
  };

  const addPerson = (event: FormEvent) => {
    event.preventDefault();
    if (!personForm.name.trim() || !personForm.relationship.trim()) return;
    updateState((current) => ({
      ...current,
      trustedPeople: [
        ...current.trustedPeople,
        {
          id: crypto.randomUUID(),
          name: personForm.name.trim(),
          relationship: personForm.relationship.trim(),
          phone: personForm.phone.trim(),
          priority: current.trustedPeople.length + 1,
          canViewEvidence: false,
        },
      ],
    }));
    setPersonForm({ name: "", relationship: "", phone: "" });
    setFeedbackTone("success");
    setFeedback("联系人已添加，默认无敏感事件查看权限。");
  };

  const addMedication = (event: FormEvent) => {
    event.preventDefault();
    if (!state.consent.sensitiveMemoryApproved) {
      setFeedbackTone("danger");
      setFeedback("请先授权保存药物等敏感记忆，再建立药物日程。");
      return;
    }
    if (!medicationForm.name.trim() || !medicationForm.time) return;
    const medicationId = crypto.randomUUID();
    const routineId = crypto.randomUUID();
    updateState((current) => ({
      ...current,
      medications: [
        ...current.medications,
        {
          id: medicationId,
          name: medicationForm.name.trim(),
          alias: medicationForm.alias.trim() || medicationForm.name.trim(),
          purpose: "由家属录入，仅用于提醒既定安排",
          scheduledTimes: [medicationForm.time],
          requirements: medicationForm.requirements.trim(),
          containerLabel: medicationForm.containerLabel.trim(),
          containerLocation: medicationForm.containerLocation.trim(),
          active: true,
          notes: "系统不识别药片或剂量。",
        },
      ],
      routines: [
        ...current.routines,
        {
          id: routineId,
          title: `${medicationForm.alias.trim() || medicationForm.name.trim()}提醒`,
          category: "medication",
          scheduledTime: medicationForm.time,
          weekdays: [0, 1, 2, 3, 4, 5, 6],
          linkedMedicationId: medicationId,
          instructions: `查看标签“${medicationForm.containerLabel.trim() || medicationForm.alias.trim()}”并按家属安排确认。`,
          confirmationQuestion: "您已经按药盒标签和家属安排完成了吗？",
          graceMinutes: 5,
          familyNoticeMinutes: 15,
          enabled: true,
        },
      ],
    }));
    setMedicationForm({
      name: "",
      alias: "",
      time: "08:30",
      requirements: "",
      containerLabel: "",
      containerLocation: "",
    });
    setFeedbackTone("success");
    setFeedback("药物记忆与对应日程已同时建立。请仅录入医生或家属已确认的信息。");
  };

  const addMemory = (event: FormEvent) => {
    event.preventDefault();
    if (!memoryForm.title.trim() || !memoryForm.content.trim()) return;
    const timestamp = new Date().toISOString();
    updateState((current) => ({
      ...current,
      memories: [
        {
          id: crypto.randomUUID(),
          kind: memoryForm.kind,
          title: memoryForm.title.trim(),
          content: memoryForm.content.trim(),
          tags: memoryForm.tags
            .split(/[，,]/)
            .map((tag) => tag.trim())
            .filter(Boolean),
          sensitivity:
            memoryForm.kind === "person" ? "sensitive" : "normal",
          createdAt: timestamp,
          updatedAt: timestamp,
        },
        ...current.memories,
      ],
    }));
    setMemoryForm({ kind: "preference", title: "", content: "", tags: "" });
    setFeedbackTone("success");
    setFeedback("生活记忆已保存，并会在相关对话中加入模型上下文。");
  };

  const setConsent = (
    key: Exclude<keyof ConsentState, "acceptedAt">,
    approved: boolean,
  ) => {
    updateState((current) => ({
      ...current,
      consent: { ...current.consent, [key]: approved },
      provider:
        key === "cloudProcessingApproved" &&
        !approved &&
        current.provider.provider === "cloud"
          ? { ...current.provider, provider: "replay" }
          : current.provider,
    }));
    setFeedbackTone("success");
    setFeedback(
      approved
        ? "授权已更新。"
        : key === "localStorageApproved"
          ? "本地持久化已关闭；当前页面仍可使用，刷新后将恢复演示数据。"
          : "授权已撤回，后续会话和上传将立即遵守新设置。",
    );
  };

  return (
    <div className="memory-layout">
      <div className="memory-tabs" role="tablist" aria-label="记忆分类">
        {tabs.map((item) => {
          const Icon = item.icon;
          return (
            <button
              key={item.id}
              type="button"
              role="tab"
              aria-selected={tab === item.id}
              className={tab === item.id ? "is-active" : ""}
              onClick={() => setTab(item.id)}
            >
              <Icon aria-hidden="true" size={20} />
              {item.label}
            </button>
          );
        })}
      </div>

      {feedback && (
        <div className={`inline-alert ${feedbackTone}`} role={feedbackTone === "danger" ? "alert" : "status"}>
          <Check aria-hidden="true" size={19} />
          <span>{feedback}</span>
          <button type="button" onClick={() => setFeedback("")}>
            关闭
          </button>
        </div>
      )}

      {tab === "people" && (
        <div className="memory-content-grid" role="tabpanel">
          <section className="panel-card">
            <div className="panel-heading">
              <div>
                <p className="eyebrow">陪伴对象</p>
                <h2>长者资料</h2>
              </div>
              <span className="local-only-chip">本地保存</span>
            </div>
            <div className="profile-editor">
              <div className="profile-photo large-photo">
                {assetById(state.recipient.avatarAssetId) ? (
                  <img
                    src={assetById(state.recipient.avatarAssetId)?.dataUrl}
                    alt={`${state.recipient.name}的资料照片`}
                  />
                ) : (
                  <CircleUserRound aria-hidden="true" size={46} />
                )}
                <label className="photo-upload-button">
                  <Camera aria-hidden="true" size={17} />
                  上传照片
                  <input
                    type="file"
                    accept="image/*"
                    onChange={(event) =>
                      void uploadAndAttach(
                        event.target.files?.[0],
                        "face",
                        (assetId) =>
                          updateState((current) => ({
                            ...current,
                            recipient: {
                              ...current.recipient,
                              avatarAssetId: assetId,
                            },
                          })),
                      )
                    }
                  />
                </label>
              </div>
              <div className="form-grid two-columns">
                <label>
                  姓名
                  <input
                    value={state.recipient.name}
                    onChange={(event) =>
                      updateState((current) => ({
                        ...current,
                        recipient: {
                          ...current.recipient,
                          name: event.target.value,
                        },
                      }))
                    }
                  />
                </label>
                <label>
                  希望被称呼为
                  <input
                    value={state.recipient.preferredName}
                    onChange={(event) =>
                      updateState((current) => ({
                        ...current,
                        recipient: {
                          ...current.recipient,
                          preferredName: event.target.value,
                        },
                      }))
                    }
                  />
                </label>
                <label className="full-span">
                  沟通偏好
                  <textarea
                    rows={3}
                    value={state.recipient.communicationNotes}
                    onChange={(event) =>
                      updateState((current) => ({
                        ...current,
                        recipient: {
                          ...current.recipient,
                          communicationNotes: event.target.value,
                        },
                      }))
                    }
                  />
                  <small>例如语速、称呼、一次说几个步骤，以及不希望使用的表达。</small>
                </label>
              </div>
            </div>
          </section>

          <section className="panel-card">
            <div className="panel-heading">
              <div>
                <p className="eyebrow">授权人物</p>
                <h2>家属与照护联系人</h2>
              </div>
            </div>
            <div className="person-list">
              {state.trustedPeople.map((person) => {
                const photo = assetById(person.faceAssetId);
                return (
                  <article key={person.id} className="person-card">
                    <div className="person-photo">
                      {photo ? (
                        <img src={photo.dataUrl} alt={`${person.name}的资料照片`} />
                      ) : (
                        <span>{person.name.slice(-1)}</span>
                      )}
                    </div>
                    <div>
                      <strong>{person.name}</strong>
                      <p>{person.relationship} · {person.phone || "未填写电话"}</p>
                      <span>
                        {person.canViewEvidence ? "可查看事件摘要" : "尚未授权查看摘要"}
                      </span>
                    </div>
                    <label className="compact-upload">
                      <FileImage aria-hidden="true" size={17} />
                      上传人脸资料
                      <input
                        type="file"
                        accept="image/*"
                        onChange={(event) =>
                          void uploadAndAttach(
                            event.target.files?.[0],
                            "face",
                            (assetId) =>
                              updateState((current) => ({
                                ...current,
                                trustedPeople: current.trustedPeople.map((item) =>
                                  item.id === person.id
                                    ? { ...item, faceAssetId: assetId }
                                    : item,
                                ),
                              })),
                          )
                        }
                      />
                    </label>
                  </article>
                );
              })}
            </div>
            <form className="inline-form" onSubmit={addPerson}>
              <h3>添加联系人</h3>
              <div className="form-grid three-columns">
                <label>
                  姓名 <span aria-hidden="true">*</span>
                  <input
                    required
                    value={personForm.name}
                    onChange={(event) =>
                      setPersonForm((current) => ({
                        ...current,
                        name: event.target.value,
                      }))
                    }
                  />
                </label>
                <label>
                  与长者关系 <span aria-hidden="true">*</span>
                  <input
                    required
                    value={personForm.relationship}
                    onChange={(event) =>
                      setPersonForm((current) => ({
                        ...current,
                        relationship: event.target.value,
                      }))
                    }
                  />
                </label>
                <label>
                  联系电话
                  <input
                    type="tel"
                    value={personForm.phone}
                    onChange={(event) =>
                      setPersonForm((current) => ({
                        ...current,
                        phone: event.target.value,
                      }))
                    }
                  />
                </label>
              </div>
              <button className="secondary-button" type="submit">
                <Plus aria-hidden="true" size={18} /> 添加联系人
              </button>
            </form>
          </section>
        </div>
      )}

      {tab === "medications" && (
        <div className="memory-content-grid" role="tabpanel">
          <div className="inline-alert warning">
            <ShieldCheck aria-hidden="true" size={20} />
            <div>
              <strong>仅记录既定安排</strong>
              <span>守忆灯塔不会识别药片、判断剂量或给出用药建议。</span>
            </div>
          </div>
          <section className="panel-card">
            <div className="panel-heading">
              <div>
                <p className="eyebrow">已录入</p>
                <h2>药物与提醒日程</h2>
              </div>
              <span className="count-chip">{state.medications.length} 项</span>
            </div>
            <div className="medication-list">
              {state.medications.map((medication) => {
                const photo = assetById(medication.imageAssetId);
                return (
                  <article key={medication.id} className="medication-card">
                    <div className="medication-photo">
                      {photo ? (
                        <img src={photo.dataUrl} alt={`${medication.alias}的标签照片`} />
                      ) : (
                        <Pill aria-hidden="true" size={28} />
                      )}
                    </div>
                    <div className="medication-main">
                      <div>
                        <strong>{medication.alias}</strong>
                        <span>{medication.active ? "提醒已开启" : "已停用"}</span>
                      </div>
                      <p>{medication.name}</p>
                      <dl>
                        <div>
                          <dt>时间</dt>
                          <dd>{medication.scheduledTimes.join("、")}</dd>
                        </div>
                        <div>
                          <dt>标签</dt>
                          <dd>{medication.containerLabel || "未填写"}</dd>
                        </div>
                        <div>
                          <dt>位置</dt>
                          <dd>{medication.containerLocation || "未填写"}</dd>
                        </div>
                      </dl>
                    </div>
                    <label className="compact-upload">
                      <Upload aria-hidden="true" size={17} />
                      上传标签照片
                      <input
                        type="file"
                        accept="image/*"
                        onChange={(event) =>
                          void uploadAndAttach(
                            event.target.files?.[0],
                            "medicine",
                            (assetId) =>
                              updateState((current) => ({
                                ...current,
                                medications: current.medications.map((item) =>
                                  item.id === medication.id
                                    ? { ...item, imageAssetId: assetId }
                                    : item,
                                ),
                              })),
                          )
                        }
                      />
                    </label>
                  </article>
                );
              })}
            </div>
          </section>

          <section className="panel-card">
            <div className="panel-heading">
              <div>
                <p className="eyebrow">新增</p>
                <h2>建立药物记忆与提醒</h2>
              </div>
            </div>
            <form className="form-stack" onSubmit={addMedication}>
              <div className="form-grid two-columns">
                <label>
                  记录名称 <span aria-hidden="true">*</span>
                  <input
                    required
                    placeholder="例如：晨间降压药"
                    value={medicationForm.name}
                    onChange={(event) =>
                      setMedicationForm((current) => ({
                        ...current,
                        name: event.target.value,
                      }))
                    }
                  />
                </label>
                <label>
                  长者熟悉的叫法
                  <input
                    placeholder="例如：早上的白盒"
                    value={medicationForm.alias}
                    onChange={(event) =>
                      setMedicationForm((current) => ({
                        ...current,
                        alias: event.target.value,
                      }))
                    }
                  />
                </label>
                <label>
                  提醒时间 <span aria-hidden="true">*</span>
                  <input
                    required
                    type="time"
                    value={medicationForm.time}
                    onChange={(event) =>
                      setMedicationForm((current) => ({
                        ...current,
                        time: event.target.value,
                      }))
                    }
                  />
                </label>
                <label>
                  药盒可见标签
                  <input
                    placeholder="例如：早 · 08:30"
                    value={medicationForm.containerLabel}
                    onChange={(event) =>
                      setMedicationForm((current) => ({
                        ...current,
                        containerLabel: event.target.value,
                      }))
                    }
                  />
                </label>
                <label>
                  常放位置
                  <input
                    placeholder="例如：餐桌右侧白色托盘"
                    value={medicationForm.containerLocation}
                    onChange={(event) =>
                      setMedicationForm((current) => ({
                        ...current,
                        containerLocation: event.target.value,
                      }))
                    }
                  />
                </label>
                <label>
                  家属确认的要求
                  <input
                    placeholder="例如：早餐后，按药盒标签执行"
                    value={medicationForm.requirements}
                    onChange={(event) =>
                      setMedicationForm((current) => ({
                        ...current,
                        requirements: event.target.value,
                      }))
                    }
                  />
                </label>
              </div>
              <button className="primary-button" type="submit">
                <Clock3 aria-hidden="true" size={19} />
                保存并建立提醒
              </button>
            </form>
          </section>
        </div>
      )}

      {tab === "daily" && (
        <div className="memory-content-grid" role="tabpanel">
          <section className="panel-card">
            <div className="panel-heading">
              <div>
                <p className="eyebrow">长期上下文</p>
                <h2>生活记忆</h2>
              </div>
              <span className="count-chip">{state.memories.length} 条</span>
            </div>
            <div className="memory-card-grid">
              {state.memories.map((memory) => (
                <article key={memory.id} className="memory-card">
                  <span className="memory-kind-icon">
                    {memory.kind === "place" ? (
                      <MapPin aria-hidden="true" size={20} />
                    ) : (
                      <BookHeart aria-hidden="true" size={20} />
                    )}
                  </span>
                  <div>
                    <small>{memory.kind} · {memory.sensitivity === "sensitive" ? "敏感" : "普通"}</small>
                    <strong>{memory.title}</strong>
                    <p>{memory.content}</p>
                    <div className="tag-row">
                      {memory.tags.map((tag) => <span key={tag}>{tag}</span>)}
                    </div>
                  </div>
                  <button
                    className="icon-button danger-ghost"
                    type="button"
                    aria-label={`删除记忆：${memory.title}`}
                    onClick={() =>
                      updateState((current) => ({
                        ...current,
                        memories: current.memories.filter((item) => item.id !== memory.id),
                      }))
                    }
                  >
                    <Trash2 aria-hidden="true" size={18} />
                  </button>
                </article>
              ))}
            </div>
          </section>

          <section className="panel-card">
            <div className="panel-heading">
              <div>
                <p className="eyebrow">新增</p>
                <h2>告诉助手一件值得记住的事</h2>
              </div>
            </div>
            <form className="form-stack" onSubmit={addMemory}>
              <div className="form-grid two-columns">
                <label>
                  类型
                  <select
                    value={memoryForm.kind}
                    onChange={(event) =>
                      setMemoryForm((current) => ({
                        ...current,
                        kind: event.target.value as MemoryKind,
                      }))
                    }
                  >
                    <option value="preference">沟通偏好</option>
                    <option value="place">常用位置</option>
                    <option value="person">人物关系</option>
                    <option value="routine">生活习惯</option>
                    <option value="story">家庭故事</option>
                  </select>
                </label>
                <label>
                  标题 <span aria-hidden="true">*</span>
                  <input
                    required
                    placeholder="例如：眼镜常放位置"
                    value={memoryForm.title}
                    onChange={(event) =>
                      setMemoryForm((current) => ({
                        ...current,
                        title: event.target.value,
                      }))
                    }
                  />
                </label>
                <label className="full-span">
                  内容 <span aria-hidden="true">*</span>
                  <textarea
                    required
                    rows={4}
                    placeholder="写清信息来源和可靠边界，例如：家属记录，眼镜通常放在客厅边柜托盘。"
                    value={memoryForm.content}
                    onChange={(event) =>
                      setMemoryForm((current) => ({
                        ...current,
                        content: event.target.value,
                      }))
                    }
                  />
                </label>
                <label className="full-span">
                  标签
                  <input
                    placeholder="用逗号分隔，例如：眼镜，客厅，寻物"
                    value={memoryForm.tags}
                    onChange={(event) =>
                      setMemoryForm((current) => ({
                        ...current,
                        tags: event.target.value,
                      }))
                    }
                  />
                </label>
              </div>
              <button className="primary-button" type="submit">
                <Plus aria-hidden="true" size={19} /> 添加生活记忆
              </button>
            </form>
          </section>
        </div>
      )}

      {tab === "privacy" && (
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
            {[
              ["localStorageApproved", "在此浏览器保存陪伴档案"],
              ["cameraApproved", "会话期间使用摄像头"],
              ["microphoneApproved", "会话期间使用麦克风"],
              ["sensitiveMemoryApproved", "保存人脸、药物等敏感记忆"],
              ["cloudProcessingApproved", "把音视频发送到 ModelBest 公网服务"],
            ].map(([key, label]) => (
              <label className="consent-row" key={key}>
                <span>
                  <strong>{label}</strong>
                  {key === "cloudProcessingApproved" && (
                    <small>关闭时只能使用本地 Ascend 或演示回放。</small>
                  )}
                </span>
                <input
                  type="checkbox"
                  checked={Boolean(state.consent[key as keyof typeof state.consent])}
                  onChange={(event) =>
                    setConsent(
                      key as Exclude<keyof ConsentState, "acceptedAt">,
                      event.target.checked,
                    )
                  }
                />
              </label>
            ))}
          </section>
        </div>
      )}
    </div>
  );
};
