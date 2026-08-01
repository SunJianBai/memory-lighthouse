export type VoiceCommand = "confirm" | "repeat" | "family";

export const classifyVoiceCommand = (transcript: string): VoiceCommand | null => {
  const command = transcript.replace(/\s+/g, "").trim();
  if (/完成了|已经完成|做好了|弄好了/.test(command)) return "confirm";
  if (/再说(一遍|一次)|重复(一遍|一次)|没听清/.test(command)) return "repeat";
  if (/联系.*(家人|家属|女儿|儿子)|找.*(家人|家属|女儿|儿子)/.test(command)) {
    return "family";
  }
  return null;
};
