import { useCallback, useEffect, useRef, useState, type FormEvent } from 'react';
import { api, ApiError, getFriendlyErrorMessage } from '../api';
import {
  MAX_MINISTRY_AUDIO_SAMPLE_RATE,
  MAX_MINISTRY_AUDIO_SECONDS,
  MAX_MINISTRY_STEM_BYTES,
  type MinistryAudioMetadata,
  type MinistryAudioPage,
  type MinistryAudioRecord,
} from '../audio/ministry-audio-contract';
import { prepareMinistryMixerTracks } from '../audio/ministry-audio-files';
import { SixStemMixerPanel } from '../audio/separation/SixStemMixerPanel';
import { SixStemWebAudioMixerController, type SeparatedMixerMetadata, type SeparatedStemMixerInput } from '../audio/separation/six-stem-mixer';
import { ConfirmDialog } from './ui/ConfirmDialog';
import { MinistryAudioPublicationForm } from './MinistryAudioPublicationForm';
import { AUDIO_ACTIONS, AUDIO_CARD, AUDIO_FORM_INPUT, AudioMetadataFields, trimAudioMetadata, useAudioRequest } from './ministry-audio-form';

interface LibraryPage extends MinistryAudioPage {
  query: string;
  loading: boolean;
  error: string | null;
}

type Playback = { recording: MinistryAudioRecord } & (
  { state: 'loading' } |
  { state: 'ready'; stems: SeparatedStemMixerInput[] | null; metadata: SeparatedMixerMetadata } |
  { state: 'error'; error: string }
);

const EMPTY_PAGE: LibraryPage = { items: [], nextCursor: null, query: '', loading: true, error: null };

const createLibraryMixer = () => new SixStemWebAudioMixerController({
  limits: {
    seconds: MAX_MINISTRY_AUDIO_SECONDS,
    frames: MAX_MINISTRY_AUDIO_SECONDS * MAX_MINISTRY_AUDIO_SAMPLE_RATE,
    wavBytes: MAX_MINISTRY_STEM_BYTES,
  },
  enableWavDownloads: false,
});

export default function MinistryAudioLibraryView({ ministryId, ministryName, userId, isAdmin, onBack }: {
  ministryId: string;
  ministryName: string;
  userId: string;
  isAdmin: boolean;
  onBack: () => void;
}) {
  const [search, setSearch] = useState('');
  const [page, setPage] = useState(EMPTY_PAGE);
  const [playback, setPlayback] = useState<Playback | null>(null);
  const [showPublisher, setShowPublisher] = useState(false);
  const [edit, setEdit] = useState<{ recording: MinistryAudioRecord; metadata: MinistryAudioMetadata } | null>(null);
  const [archive, setArchive] = useState<MinistryAudioRecord | null>(null);
  const [mutating, setMutating] = useState(false);
  const [mutationError, setMutationError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const { start: startList } = useAudioRequest();
  const { start: startPlayback, cancel: cancelPlayback } = useAudioRequest();
  const { start: startMutation } = useAudioRequest();
  const mutatingRef = useRef(false);
  const playbackId = useRef<string | null>(null);
  const listedQuery = useRef('');

  const loadRecordings = useCallback(async (query: string, cursor?: string) => {
    const { signal } = startList();
    listedQuery.current = query;
    setPage((current) => ({ ...(cursor ? current : { ...EMPTY_PAGE, query }), loading: true, error: null }));
    try {
      const response = await api.ministryAudio.list(ministryId, { q: query, cursor, limit: 20 }, signal);
      if (signal.aborted) return;
      setPage((current) => {
        const known = new Set(current.items.map(({ id }) => id));
        const items = cursor ? [...current.items, ...response.items.filter(({ id }) => !known.has(id))] : response.items;
        return { ...response, items, query, loading: false, error: null };
      });
    } catch (reason) {
      if (!signal.aborted) setPage((current) => ({ ...current, loading: false, error: getFriendlyErrorMessage(reason) }));
    }
  }, [ministryId, startList]);

  useEffect(() => { void loadRecordings(''); }, [loadRecordings]);

  function closePlayback() {
    cancelPlayback();
    playbackId.current = null;
    setPlayback(null);
  }

  async function openPlayback(recording: MinistryAudioRecord) {
    const request = startPlayback();
    const { signal } = request;
    playbackId.current = recording.id;
    setPlayback({ state: 'loading', recording });
    try {
      const response = await api.ministryAudio.getPlayback(ministryId, recording.id, signal);
      signal.throwIfAborted();
      let activeGrant = response;
      // Bounds extra grants when failures are not caused by expiry (CORS misconfiguration, captive portal).
      let renewals = 0;
      async function renewPlayback() {
        if (renewals >= 2) throw new Error('Autorização de reprodução inválida.');
        renewals += 1;
        const next = await api.ministryAudio.getPlayback(ministryId, recording.id, signal);
        signal.throwIfAborted();
        if (next.transfer !== 'direct' || next.manifest.recordingId !== recording.id ||
            !Number.isSafeInteger(next.expiresAt)) {
          throw new Error('Autorização de reprodução inválida.');
        }
        activeGrant = next;
      }
      const prepared = prepareMinistryMixerTracks(recording.id, response, async (stem, track) => {
        if (response.transfer !== 'direct') {
          return api.ministryAudio.downloadStem(ministryId, recording.id, stem.id, track.url, stem.sizeBytes, signal);
        }
        const download = () => {
          const signed = activeGrant.tracks.find(({ id }) => id === stem.id);
          if (!signed) throw new Error('Autorização de reprodução inválida.');
          return api.ministryAudio.downloadDirectStem(signed.url, signed.headers, stem.sizeBytes, signal);
        };
        if (!Number.isSafeInteger(activeGrant.expiresAt)) throw new Error('Autorização de reprodução inválida.');
        // The device clock is not trusted for expiry; an expired GET is renewed on 401/403.
        try {
          return await download();
        } catch (reason) {
          if (!(reason instanceof ApiError) || (reason.statusCode !== 0 && reason.statusCode !== 401 && reason.statusCode !== 403)) throw reason;
          await renewPlayback();
          return download();
        }
      });
      // Direct playback fetches and decodes each WAV before moving on to the next.
      const stems = response.transfer === 'direct' ? prepared : await Promise.all(prepared.map(async (stem) => ({
        ...stem, wavBytes: await stem.wavBytes(),
      })));
      signal.throwIfAborted();
      setPlayback({
        state: 'ready', recording, stems,
        metadata: { modelId: response.manifest.model.id, modelVersion: response.manifest.model.version },
      });
    } catch (reason) {
      if (signal.aborted) return;
      request.abort();
      setPlayback({ state: 'error', recording, error: getFriendlyErrorMessage(reason) });
    }
  }

  async function updateRecording(action: 'edit' | 'archive', event?: FormEvent<HTMLFormElement>) {
    event?.preventDefault();
    if (!isAdmin || mutatingRef.current) return;
    const recording = action === 'edit' ? edit?.recording : archive;
    if (!recording) return;
    const metadata = edit && trimAudioMetadata(edit.metadata);
    if (action === 'edit' && (!metadata?.title || !metadata.version)) {
      setMutationError('Informe título e versão.');
      return;
    }
    mutatingRef.current = true;
    setMutating(true);
    setMutationError(null);
    setNotice(null);
    const { signal } = startMutation();
    try {
      if (action === 'archive') {
        await api.ministryAudio.archive(ministryId, recording.id, signal);
        signal.throwIfAborted();
        if (playbackId.current === recording.id) closePlayback();
        setNotice('Gravação arquivada.');
      } else if (metadata) {
        const updated = await api.ministryAudio.update(ministryId, recording.id, metadata, signal);
        signal.throwIfAborted();
        setPlayback((current) => current?.recording.id === updated.id ? { ...current, recording: updated } : current);
        setNotice('Metadados atualizados.');
      }
      setEdit(null);
      await loadRecordings(listedQuery.current);
    } catch (reason) {
      if (!signal.aborted) setMutationError(getFriendlyErrorMessage(reason));
    } finally {
      mutatingRef.current = false;
      if (!signal.aborted) {
        setArchive(null);
        setMutating(false);
      }
    }
  }

  return (
    <section aria-labelledby="ministry-audio-heading" className="mx-auto grid max-w-5xl min-w-0 gap-4">
      <header className="grid gap-2">
        <button type="button" className="btn btn-secondary min-h-[44px] justify-self-start" onClick={onBack}>Voltar ao ministério</button>
        <h2 className="text-2xl font-bold" id="ministry-audio-heading">Biblioteca Ministerial</h2>
        <p className="text-[var(--text-secondary)]">Gravações de {ministryName}</p>
      </header>

      <div className={AUDIO_ACTIONS}>
        <form className={`${AUDIO_ACTIONS} min-w-0 flex-1`} role="search" onSubmit={(event) => { event.preventDefault(); void loadRecordings(search.trim()); }}>
          <input className={`${AUDIO_FORM_INPUT} flex-1`} type="search" aria-label="Buscar gravações" placeholder="Título, artista ou versão" maxLength={160} value={search} onChange={(event) => setSearch(event.target.value)} />
          <button className="btn btn-secondary min-h-[44px]" type="submit">Buscar</button>
        </form>
        {isAdmin && !showPublisher && <button className="btn btn-primary min-h-[44px]" type="button" onClick={() => { setNotice(null); setShowPublisher(true); }}>Nova gravação</button>}
      </div>

      {isAdmin && showPublisher && (
        <MinistryAudioPublicationForm ministryId={ministryId} userId={userId} onCancel={() => setShowPublisher(false)} onPublished={() => {
          setShowPublisher(false);
          setNotice('Gravação publicada.');
          void loadRecordings(listedQuery.current);
        }} />
      )}
      {notice && <p role="status">{notice}</p>}
      {mutationError && <p role="alert">{mutationError}</p>}

      {playback && (
        <section className={AUDIO_CARD} aria-label="Reprodução da gravação">
          <div className={`${AUDIO_ACTIONS} justify-between`}>
            <h3 className="font-semibold">{playback.recording.title} · {playback.recording.version}</h3>
            <button type="button" className="btn btn-secondary min-h-[44px]" onClick={closePlayback}>Fechar mixer</button>
          </div>
          {playback.state === 'loading' && <p role="status">Carregando as seis faixas…</p>}
          {playback.state === 'error' && (
            <div className={AUDIO_ACTIONS} role="alert">
              <span>{playback.error}</span>
              <button type="button" className="btn btn-secondary min-h-[44px]" onClick={() => void openPlayback(playback.recording)}>Tentar reprodução novamente</button>
            </div>
          )}
          {playback.state === 'ready' && (
            <SixStemMixerPanel
              playbackOnly stems={playback.stems} metadata={playback.metadata} createController={createLibraryMixer}
              onInputsCaptured={(stems) => setPlayback((current) => current?.state === 'ready' && current.stems === stems
                ? { ...current, stems: null } : current)}
              onPlaybackError={(error) => setPlayback((current) => current?.state === 'ready' && current.metadata === playback.metadata
                ? { state: 'error', recording: current.recording, error } : current)}
              onDisposed={closePlayback}
            />
          )}
        </section>
      )}

      {page.loading && <p role="status">Carregando gravações…</p>}
      {page.error && (
        <div className={AUDIO_ACTIONS} role="alert">
          <span>{page.error}</span>
          <button type="button" className="btn btn-secondary min-h-[44px]" onClick={() => void loadRecordings(page.query, page.nextCursor ?? undefined)}>Tentar novamente</button>
        </div>
      )}
      {!page.loading && !page.error && !page.items.length && <p>{page.nextCursor ? 'Nenhuma gravação nesta página.' : 'Nenhuma gravação encontrada.'}</p>}
      {page.items.length > 0 && (
        <ul className="grid gap-3" aria-label="Gravações do ministério">
          {page.items.map((recording) => (
            <li key={recording.id} className={AUDIO_CARD}>
              <div className="min-w-0 break-words">
                <h3 className="text-lg font-semibold">{recording.title}</h3>
                <p className="text-sm text-[var(--text-secondary)]">{[recording.artist, recording.version].filter(Boolean).join(' · ')}</p>
              </div>
              <div className={AUDIO_ACTIONS}>
                <button className="btn btn-primary min-h-[44px]" type="button" onClick={() => void openPlayback(recording)}>Abrir mixer</button>
                {isAdmin && (
                  <>
                    <button className="btn btn-secondary min-h-[44px]" type="button" disabled={mutating} onClick={() => { setMutationError(null); setEdit({ recording, metadata: trimAudioMetadata(recording) }); }}>Editar metadados</button>
                    <button className="btn btn-secondary min-h-[44px]" type="button" disabled={mutating} onClick={() => { setMutationError(null); setArchive(recording); }}>Arquivar gravação</button>
                  </>
                )}
              </div>
              {isAdmin && edit?.recording.id === recording.id && (
                <form className="grid gap-3" onSubmit={(event) => void updateRecording('edit', event)} aria-label="Editar metadados">
                  <fieldset disabled={mutating}><AudioMetadataFields value={edit.metadata} onChange={(metadata) => setEdit({ recording, metadata })} /></fieldset>
                  <div className={AUDIO_ACTIONS}>
                    <button className="btn btn-primary min-h-[44px]" type="submit" disabled={mutating}>Salvar metadados</button>
                    <button className="btn btn-secondary min-h-[44px]" type="button" disabled={mutating} onClick={() => { setEdit(null); setMutationError(null); }}>Cancelar edição</button>
                  </div>
                </form>
              )}
            </li>
          ))}
        </ul>
      )}
      {page.nextCursor && !page.error && (
        <button type="button" className="btn btn-secondary min-h-[44px] justify-self-start" disabled={page.loading} onClick={() => void loadRecordings(page.query, page.nextCursor ?? undefined)}>Carregar mais</button>
      )}
      {isAdmin && archive && <ConfirmDialog isOpen title="Arquivar gravação" message={`Arquivar “${archive.title}” e encerrar o acesso às faixas da biblioteca?`} confirmLabel="Confirmar arquivamento" busy={mutating} onConfirm={() => updateRecording('archive')} onCancel={() => setArchive(null)} />}
    </section>
  );
}
