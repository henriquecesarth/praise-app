import { useCallback, useLayoutEffect, useRef } from 'react';
import type { MinistryAudioMetadata } from '../audio/ministry-audio-contract';

export const AUDIO_FORM_GRID = 'grid gap-3 sm:grid-cols-2';
export const AUDIO_FORM_FIELD = 'grid min-w-0 gap-1 font-medium';
export const AUDIO_FORM_INPUT = 'input-field min-h-[44px] w-full min-w-0';
export const AUDIO_ACTIONS = 'flex flex-wrap items-center gap-2';
export const AUDIO_CARD = 'grid gap-4 rounded-xl border border-[var(--border-color)] p-4';

export function AudioMetadataFields({ value, onChange }: { value: MinistryAudioMetadata; onChange: (value: MinistryAudioMetadata) => void }) {
  return (
    <div className={AUDIO_FORM_GRID}>
      <label className={AUDIO_FORM_FIELD}>
        Título
        <input className={AUDIO_FORM_INPUT} required maxLength={160} value={value.title} onChange={(event) => onChange({ ...value, title: event.target.value })} />
      </label>
      <label className={AUDIO_FORM_FIELD}>
        Artista
        <input className={AUDIO_FORM_INPUT} maxLength={160} value={value.artist} onChange={(event) => onChange({ ...value, artist: event.target.value })} />
      </label>
      <label className={AUDIO_FORM_FIELD}>
        Versão
        <input className={AUDIO_FORM_INPUT} required maxLength={120} value={value.version} onChange={(event) => onChange({ ...value, version: event.target.value })} />
      </label>
    </div>
  );
}

export function trimAudioMetadata({ title, artist, version }: MinistryAudioMetadata): MinistryAudioMetadata {
  return { title: title.trim(), artist: artist.trim(), version: version.trim() };
}

export function useAudioRequest() {
  const current = useRef<AbortController | null>(null);
  const cancel = useCallback(() => {
    current.current?.abort();
    current.current = null;
  }, []);
  useLayoutEffect(() => cancel, [cancel]);

  const start = useCallback(() => {
    cancel();
    const request = new AbortController();
    current.current = request;
    return request;
  }, [cancel]);
  return { start, cancel };
}
