import { Clock3, Pill, ShieldCheck, Upload } from "lucide-react";
import type {
  Dispatch,
  FormEventHandler,
  SetStateAction,
} from "react";
import type {
  AppState,
  AssetKind,
  StoredAsset,
} from "../../domain/types";

export type MedicationForm = {
  name: string;
  alias: string;
  time: string;
  requirements: string;
  containerLabel: string;
  containerLocation: string;
};

type Props = {
  state: AppState;
  updateState: (updater: (current: AppState) => AppState) => void;
  assetById: (id?: string) => StoredAsset | undefined;
  uploadAndAttach: (
    file: File | undefined,
    kind: AssetKind,
    attach: (assetId: string) => void,
  ) => Promise<void>;
  medicationForm: MedicationForm;
  setMedicationForm: Dispatch<SetStateAction<MedicationForm>>;
  addMedication: FormEventHandler<HTMLFormElement>;
};

export const MedicationMemoryTab = ({
  state,
  updateState,
  assetById,
  uploadAndAttach,
  medicationForm,
  setMedicationForm,
  addMedication,
}: Props) => (
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
);
