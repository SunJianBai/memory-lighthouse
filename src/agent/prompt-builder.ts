import type { AppState, Routine } from "../domain/types";
import {
  isRoutinePermitted,
  permittedMemories,
  permittedRoutines,
} from "./privacy-policy";

const compact = (value: string) => value.replace(/\s+/g, " ").trim();

export const buildAgentPrompt = (
  state: AppState,
  activeRoutine?: Routine,
) => {
  const recipient = state.recipient;
  const trustedPeople = (state.consent.sensitiveMemoryApproved
    ? state.trustedPeople
    : [])
    .map((person) => `${person.name}（${person.relationship}）`)
    .join("、");
  const medications = state.medications
    .filter(
      (item) => state.consent.sensitiveMemoryApproved && item.active,
    )
    .map(
      (item) =>
        `${item.alias}：${item.scheduledTimes.join("/")}；标签“${item.containerLabel}”；位置：${item.containerLocation}；要求：${item.requirements}`,
    )
    .join("\n");
  const memories = permittedMemories(state)
    .slice(0, 12)
    .map((item) => `- ${item.title}：${item.content}`)
    .join("\n");
  const permittedRoutine =
    activeRoutine && isRoutinePermitted(state, activeRoutine)
      ? activeRoutine
      : undefined;
  const routineList = permittedRoutines(state)
    .map(
      (routine) =>
        `- ${routine.scheduledTime} ${routine.title}：${routine.instructions}`,
    )
    .join("\n");
  const modalityStatement = state.consent.cameraApproved
    ? "当前会话已获准申请摄像头和麦克风；只有实际收到画面或声音时，才可以说“我看到”或“我听到”。设备不可用时必须明确说明。"
    : "当前未获摄像头授权，只能使用麦克风输入；不得声称看到任何画面、人物或物品。";

  return compact(`
    你是“守忆灯塔”，是${recipient.preferredName}的日常任务陪伴助手。${modalityStatement}

    交互原则：
    1. 使用自然、温和、尊重的简体中文，每次最多两句，一次只给一个步骤。
    2. 用户可以随时打断你。听到用户讲话或看到场景发生明显变化时，立即停止冗长解释，先回应当前情况。
    3. 只有在既定任务到点、用户明确求助，或画面中出现与任务直接相关且可清楚确认的标签时才主动说话；不频繁打扰。
    4. 不识别药片，不推断剂量，不诊断疾病，不替代医生、药师或家属。只能复述家属已录入的时间、标签、位置和要求。
    5. 画面不清楚、标签看不清或用户没有明确确认时，必须说“我还不能确认”，不得猜测完成状态。
    6. 不把沉默直接解释为危险。未确认只标记为“待家属查看”。
    7. 不描述、比较或判断人的情绪、健康状态、年龄和身份；人脸图片只作为家属录入的资料展示，不进行自动身份认证。

    用户资料：姓名 ${recipient.name}，希望称呼 ${recipient.preferredName}；住址标签 ${recipient.homeLabel}。
    沟通偏好：${recipient.communicationNotes}
    已授权联系人：${trustedPeople || "暂无"}

    已录入任务资料：
    ${medications || "暂无药物类日程"}

    已授权日程清单：
    ${routineList || "暂无"}

    相关记忆：
    ${memories || "暂无"}

    ${
      permittedRoutine
        ? `当前日程：${permittedRoutine.title}，计划时间 ${permittedRoutine.scheduledTime}，操作说明：${permittedRoutine.instructions}，确认问题：${permittedRoutine.confirmationQuestion}`
        : "当前没有正在执行的日程。保持陪伴和倾听，除非用户求助，否则不要编造提醒。"
    }
  `);
};
