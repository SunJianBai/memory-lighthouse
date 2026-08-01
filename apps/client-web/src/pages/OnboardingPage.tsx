import {
  ArrowLeft,
  ArrowRight,
  Check,
  CircleUserRound,
  HeartHandshake,
  ShieldCheck,
  Sparkles,
} from "lucide-react";
import { useState } from "react";
import { navigate } from "../app/navigation";
import { useAppState } from "../state/app-state";

const steps = [
  { number: 1, label: "长者资料" },
  { number: 2, label: "家属关系" },
  { number: 3, label: "授权边界" },
  { number: 4, label: "完成" },
];

export const OnboardingPage = () => {
  const { state, updateState } = useAppState();
  const [step, setStep] = useState(1);

  const next = () => setStep((current) => Math.min(4, current + 1));
  const previous = () => setStep((current) => Math.max(1, current - 1));

  const finish = () => {
    updateState((current) => ({
      ...current,
      initialized: true,
      consent: {
        ...current.consent,
        acceptedAt: new Date().toISOString(),
      },
    }));
    navigate("memories");
  };

  return (
    <div className="onboarding-layout">
      <ol className="stepper" aria-label="建档进度">
        {steps.map((item) => (
          <li
            key={item.number}
            className={item.number === step ? "is-current" : item.number < step ? "is-done" : ""}
            aria-current={item.number === step ? "step" : undefined}
          >
            <span>{item.number < step ? <Check size={17} /> : item.number}</span>
            <strong>{item.label}</strong>
          </li>
        ))}
      </ol>

      <section className="onboarding-card">
        {step === 1 && (
          <div className="onboarding-step">
            <span className="onboarding-icon">
              <CircleUserRound aria-hidden="true" size={30} />
            </span>
            <p className="eyebrow">第一步</p>
            <h2>助手应该如何称呼长者？</h2>
            <p className="step-intro">
              只录入日常陪伴真正需要的信息。诊断、证件号码和金融信息不应进入 Demo。
            </p>
            <div className="form-grid two-columns">
              <label>
                姓名
                <input
                  value={state.recipient.name}
                  onChange={(event) =>
                    updateState((current) => ({
                      ...current,
                      recipient: { ...current.recipient, name: event.target.value },
                    }))
                  }
                />
              </label>
              <label>
                日常称呼
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
              <label>
                生日
                <input
                  type="date"
                  value={state.recipient.birthday}
                  onChange={(event) =>
                    updateState((current) => ({
                      ...current,
                      recipient: {
                        ...current.recipient,
                        birthday: event.target.value,
                      },
                    }))
                  }
                />
              </label>
              <label>
                家庭位置标签
                <input
                  value={state.recipient.homeLabel}
                  onChange={(event) =>
                    updateState((current) => ({
                      ...current,
                      recipient: {
                        ...current.recipient,
                        homeLabel: event.target.value,
                      },
                    }))
                  }
                />
              </label>
              <label className="full-span">
                沟通偏好
                <textarea
                  rows={4}
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
              </label>
            </div>
          </div>
        )}

        {step === 2 && (
          <div className="onboarding-step">
            <span className="onboarding-icon">
              <HeartHandshake aria-hidden="true" size={30} />
            </span>
            <p className="eyebrow">第二步</p>
            <h2>谁可以接收“待人工确认”？</h2>
            <p className="step-intro">
              系统不自动呼叫急救服务。未明确确认时，只通知经过授权的家属查看。
            </p>
            {state.trustedPeople.slice(0, 1).map((person) => (
              <div className="form-grid two-columns" key={person.id}>
                <label>
                  联系人姓名
                  <input
                    value={person.name}
                    onChange={(event) =>
                      updateState((current) => ({
                        ...current,
                        trustedPeople: current.trustedPeople.map((item) =>
                          item.id === person.id ? { ...item, name: event.target.value } : item,
                        ),
                      }))
                    }
                  />
                </label>
                <label>
                  与长者关系
                  <input
                    value={person.relationship}
                    onChange={(event) =>
                      updateState((current) => ({
                        ...current,
                        trustedPeople: current.trustedPeople.map((item) =>
                          item.id === person.id
                            ? { ...item, relationship: event.target.value }
                            : item,
                        ),
                      }))
                    }
                  />
                </label>
                <label className="full-span">
                  电话号码
                  <input
                    type="tel"
                    value={person.phone}
                    onChange={(event) =>
                      updateState((current) => ({
                        ...current,
                        trustedPeople: current.trustedPeople.map((item) =>
                          item.id === person.id ? { ...item, phone: event.target.value } : item,
                        ),
                      }))
                    }
                  />
                </label>
                <label className="check-row full-span">
                  <input
                    type="checkbox"
                    checked={person.canViewEvidence}
                    onChange={(event) =>
                      updateState((current) => ({
                        ...current,
                        trustedPeople: current.trustedPeople.map((item) =>
                          item.id === person.id
                            ? { ...item, canViewEvidence: event.target.checked }
                            : item,
                        ),
                      }))
                    }
                  />
                  <span>
                    <strong>允许查看事件摘要</strong>
                    <small>不包含持续录像，只展示必要的时间、文字和经授权截图。</small>
                  </span>
                </label>
              </div>
            ))}
          </div>
        )}

        {step === 3 && (
          <div className="onboarding-step">
            <span className="onboarding-icon">
              <ShieldCheck aria-hidden="true" size={30} />
            </span>
            <p className="eyebrow">第三步</p>
            <h2>明确数据与能力边界</h2>
            <p className="step-intro">
              每项授权都可以在“记忆中心”撤回。不同意公网处理不影响本地演示。
            </p>
            <div className="consent-list">
              {[
                ["localStorageApproved", "允许在此浏览器保存陪伴档案", "用于刷新页面后恢复数据。"],
                ["cameraApproved", "允许在会话期间使用摄像头", "结束会话后立即停止轨道。"],
                ["microphoneApproved", "允许在会话期间使用麦克风", "用于全双工语音交互。"],
                ["sensitiveMemoryApproved", "允许保存人脸和药盒标签照片", "仅作资料和上下文，不自动认证身份或识别药片。"],
              ].map(([key, title, description]) => (
                <label className="consent-row boxed" key={key}>
                  <span>
                    <strong>{title}</strong>
                    <small>{description}</small>
                  </span>
                  <input
                    type="checkbox"
                    checked={Boolean(state.consent[key as keyof typeof state.consent])}
                    onChange={(event) =>
                      updateState((current) => ({
                        ...current,
                        consent: {
                          ...current.consent,
                          [key]: event.target.checked,
                        },
                      }))
                    }
                  />
                </label>
              ))}
            </div>
          </div>
        )}

        {step === 4 && (
          <div className="onboarding-step completion-step">
            <span className="completion-mark">
              <Sparkles aria-hidden="true" size={36} />
            </span>
            <p className="eyebrow">准备完成</p>
            <h2>{state.recipient.preferredName}的陪伴档案已建立</h2>
            <p>
              接下来可以上传家属照片、药盒标签、日程和常用位置。助手只会使用已经保存且与当前场景相关的信息。
            </p>
            <div className="completion-summary">
              <span><Check size={18} /> 1 位陪伴对象</span>
              <span><Check size={18} /> {state.trustedPeople.length} 位联系人</span>
              <span><Check size={18} /> {state.routines.length} 项日程</span>
            </div>
          </div>
        )}

        <footer className="onboarding-actions">
          <button
            className="secondary-button"
            type="button"
            disabled={step === 1}
            onClick={previous}
          >
            <ArrowLeft aria-hidden="true" size={19} /> 上一步
          </button>
          {step < 4 ? (
            <button className="primary-button" type="button" onClick={next}>
              下一步 <ArrowRight aria-hidden="true" size={19} />
            </button>
          ) : (
            <button className="primary-button" type="button" onClick={finish}>
              完成并进入记忆中心 <ArrowRight aria-hidden="true" size={19} />
            </button>
          )}
        </footer>
      </section>
    </div>
  );
};
