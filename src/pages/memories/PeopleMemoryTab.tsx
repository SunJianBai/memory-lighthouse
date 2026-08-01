import { Camera, CircleUserRound, FileImage, Plus } from "lucide-react";
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

export type PersonForm = {
  name: string;
  relationship: string;
  phone: string;
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
  personForm: PersonForm;
  setPersonForm: Dispatch<SetStateAction<PersonForm>>;
  addPerson: FormEventHandler<HTMLFormElement>;
};

export const PeopleMemoryTab = ({
  state,
  updateState,
  assetById,
  uploadAndAttach,
  personForm,
  setPersonForm,
  addPerson,
}: Props) => (
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
);
