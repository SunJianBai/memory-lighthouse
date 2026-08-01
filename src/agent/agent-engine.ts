import type { AgentAction, AgentState } from "../domain/types";

export const createInitialAgentState = (at = new Date().toISOString()): AgentState => ({
  phase: "idle",
  reminderCount: 0,
  lastTransitionAt: at,
  message: "守忆灯塔已待命",
});

export const transitionAgent = (
  state: AgentState,
  action: AgentAction,
): AgentState => {
  switch (action.type) {
    case "SESSION_STARTED":
      return {
        phase: "observing",
        reminderCount: 0,
        lastTransitionAt: action.at,
        message: "正在倾听并观察当前场景",
      };
    case "ROUTINE_DUE":
      return {
        phase: "reminding",
        activeRoutineId: action.routineId,
        reminderCount: state.reminderCount,
        lastTransitionAt: action.at,
        message: "既定日程已到，准备进行温和提醒",
      };
    case "REMINDER_DELIVERED":
      if (!state.activeRoutineId) return state;
      return {
        ...state,
        phase: "awaiting_confirmation",
        reminderCount: state.reminderCount + 1,
        lastTransitionAt: action.at,
        message: "提醒已送达，等待本人确认",
      };
    case "USER_CONFIRMED":
      return {
        ...state,
        phase: "completed",
        lastTransitionAt: action.at,
        message: "本人已确认，任务闭环完成",
      };
    case "CONFIRMATION_TIMEOUT":
      if (state.phase !== "awaiting_confirmation") return state;
      return {
        ...state,
        phase: "needs_attention",
        lastTransitionAt: action.at,
        message: "未获得明确确认，标记为待家属查看",
      };
    case "FAMILY_ACKNOWLEDGED":
      return {
        ...state,
        phase: "completed",
        lastTransitionAt: action.at,
        message: "家属已查看并接手确认",
      };
    case "SESSION_ENDED":
      return {
        phase: "idle",
        reminderCount: 0,
        lastTransitionAt: action.at,
        message: "会话已结束，摄像头与麦克风已关闭",
      };
  }
};
