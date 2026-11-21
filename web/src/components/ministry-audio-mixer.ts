import {
  MAX_MINISTRY_AUDIO_SAMPLE_RATE,
  MAX_MINISTRY_AUDIO_SECONDS,
  MAX_MINISTRY_STEM_BYTES,
} from '../audio/ministry-audio-contract';
import { SixStemWebAudioMixerController } from '../audio/separation/six-stem-mixer';

/** The mixer of the ministry library (playback only, no WAV downloads), shared by the library and the local preview. */
export const createLibraryMixer = () => new SixStemWebAudioMixerController({
  limits: {
    seconds: MAX_MINISTRY_AUDIO_SECONDS,
    frames: MAX_MINISTRY_AUDIO_SECONDS * MAX_MINISTRY_AUDIO_SAMPLE_RATE,
    wavBytes: MAX_MINISTRY_STEM_BYTES,
  },
  enableWavDownloads: false,
});
