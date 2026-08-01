export type VoiceCommand = "confirm" | "repeat" | "family";

export const classifyVoiceCommand = (transcript: string): VoiceCommand | null => {
  const command = transcript.replace(/[\s，。！？,.!?]/g, "").trim();

  const familyRequest =
    /(?:联系|找|叫)(?:一下|我的)?(?:家人|家属|女儿|儿子)/.test(command);
  const familyNegated =
    /(?:不|别|不要|不用|无需|先别).{0,5}(?:联系|找|叫)/.test(command) ||
    /(?:联系|找|叫).{0,5}(?:不|别|不要|不用|无需)/.test(command);
  if (familyRequest && !familyNegated) {
    return "family";
  }

  const repeatRequest = /再说(?:一遍|一次)|重复(?:一遍|一次)|没听清/.test(
    command,
  );
  const repeatNegated =
    /(?:不|别|不要|不用|无需|先别|没说).{0,6}(?:再说|重复)/.test(
      command,
    );
  if (repeatRequest && !repeatNegated) return "repeat";

  const explicitConfirmation =
    /^(?:好的?|嗯|对|是的)*(?:我)?(?:已经|都|刚刚|刚才|现在)?(?:完成了?|做好了?|弄好了?)(?:谢谢(?:你)?|可以了|好啦|呀|啊|哦)*$/.test(
      command,
    );
  if (explicitConfirmation) return "confirm";

  return null;
};
