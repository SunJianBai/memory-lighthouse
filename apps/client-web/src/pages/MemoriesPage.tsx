import { BookHeart, Check, Pill, ShieldCheck, UsersRound } from "lucide-react";
import { useState, type FormEvent } from "react";
import { prepareAsset } from "../data/storage";
import type { AssetKind, ConsentState, MemoryKind } from "../domain/types";
import { useAppState } from "../state/app-state";
import {
  DailyMemoryTab,
  type MemoryForm,
} from "./memories/DailyMemoryTab";
import {
  MedicationMemoryTab,
  type MedicationForm,
} from "./memories/MedicationMemoryTab";
import {
  PeopleMemoryTab,
  type PersonForm,
} from "./memories/PeopleMemoryTab";
import { PrivacyMemoryTab } from "./memories/PrivacyMemoryTab";

type TabId = "people" | "medications" | "daily" | "privacy";

const tabs = [
  { id: "people" as const, label: "人物与称呼", icon: UsersRound },
  { id: "medications" as const, label: "药物与日程", icon: Pill },
  { id: "daily" as const, label: "生活记忆", icon: BookHeart },
  { id: "privacy" as const, label: "授权与数据", icon: ShieldCheck },
];

export const MemoriesPage = () => {
  const { state, updateState, addAsset, deleteAsset } = useAppState();
  const [tab, setTab] = useState<TabId>("people");
  const [feedback, setFeedback] = useState("");
  const [feedbackTone, setFeedbackTone] = useState<"success" | "danger">(
    "success",
  );
  const [personForm, setPersonForm] = useState<PersonForm>({
    name: "",
    relationship: "",
    phone: "",
  });
  const [medicationForm, setMedicationForm] = useState<MedicationForm>({
    name: "",
    alias: "",
    time: "08:30",
    requirements: "",
    containerLabel: "",
    containerLocation: "",
  });
  const [memoryForm, setMemoryForm] = useState<MemoryForm>({
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
    if (
      memoryForm.kind === "person" &&
      !state.consent.sensitiveMemoryApproved
    ) {
      setFeedbackTone("danger");
      setFeedback("人物关系属于敏感记忆，请先在“授权与数据”中允许保存。");
      return;
    }
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
          sensitivity: memoryForm.kind === "person" ? "sensitive" : "normal",
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
        <div
          className={`inline-alert ${feedbackTone}`}
          role={feedbackTone === "danger" ? "alert" : "status"}
        >
          <Check aria-hidden="true" size={19} />
          <span>{feedback}</span>
          <button type="button" onClick={() => setFeedback("")}>
            关闭
          </button>
        </div>
      )}

      {tab === "people" && (
        <PeopleMemoryTab
          state={state}
          updateState={updateState}
          assetById={assetById}
          uploadAndAttach={uploadAndAttach}
          personForm={personForm}
          setPersonForm={setPersonForm}
          addPerson={addPerson}
        />
      )}
      {tab === "medications" && (
        <MedicationMemoryTab
          state={state}
          updateState={updateState}
          assetById={assetById}
          uploadAndAttach={uploadAndAttach}
          medicationForm={medicationForm}
          setMedicationForm={setMedicationForm}
          addMedication={addMedication}
        />
      )}
      {tab === "daily" && (
        <DailyMemoryTab
          state={state}
          updateState={updateState}
          memoryForm={memoryForm}
          setMemoryForm={setMemoryForm}
          addMemory={addMemory}
        />
      )}
      {tab === "privacy" && (
        <PrivacyMemoryTab
          state={state}
          deleteAsset={deleteAsset}
          setConsent={setConsent}
        />
      )}
    </div>
  );
};
