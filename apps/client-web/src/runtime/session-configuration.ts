export const DEFAULT_COMPANION_LENGTH_PENALTY = 1.0;

export const createRealtimeSessionInit = (
  effectivePrompt: string,
  referenceAudio: string | null,
) => ({
  type: "session.init",
  payload: {
    system_prompt: effectivePrompt,
    config: { length_penalty: DEFAULT_COMPANION_LENGTH_PENALTY },
    ...(referenceAudio
      ? {
          voice: {
            ref_audio_base64: referenceAudio,
            tts_ref_audio_base64: referenceAudio,
          },
        }
      : {}),
  },
});
