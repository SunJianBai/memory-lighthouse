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

  const confirmRequest = /(?:已经|都|刚刚|刚才|我)?(?:完成了?|做好了?|弄好了?)/.test(
    command,
  );
  const confirmUncertain =
    /(?:没|没有|还没|未|尚未|不是|不确定|不知道|记不清|不太确定).{0,12}(?:完成|做好|弄好)/.test(
      command,
    ) ||
    /(?:完成|做好|弄好).{0,5}(?:吗|没有|没|不确定|不知道)/.test(
      command,
    );
  if (confirmRequest && !confirmUncertain) return "confirm";

  return null;
};
