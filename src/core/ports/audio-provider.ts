export type VoiceRequest = {
  text: string;

  voice: string;

  language: string;

  speed?: number;
};

export type VoiceResult = {
  uri: string;

  durationSeconds?: number;
};

export interface AudioProvider {
  synthesizeVoice(
    request: VoiceRequest,
  ): Promise<VoiceResult>;
}