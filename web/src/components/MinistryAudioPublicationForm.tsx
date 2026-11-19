import { useRef, useState, type FormEvent } from 'react';
import { api, getFriendlyErrorMessage } from '../api';
import type { MinistryAudioMetadata, MinistryAudioModel, MinistryAudioReservation } from '../audio/ministry-audio-contract';
import { describeMinistryStemFiles, type MinistryStemFiles } from '../audio/ministry-audio-files';
import { CANONICAL_STEM_IDS, STEM_DISPLAY_LABELS_PT_BR, computeSha256Hex } from '../audio/separation/demucs-onnx-separator';
import { AUDIO_ACTIONS, AUDIO_CARD, AUDIO_FORM_FIELD, AUDIO_FORM_GRID, AUDIO_FORM_INPUT, AudioMetadataFields, trimAudioMetadata, useAudioRequest } from './ministry-audio-form';

interface PublicationAttempt {
  input: MinistryAudioReservation;
  uploadId?: string;
}

async function getPublicationKey(
  storageKey: string,
  input: Omit<MinistryAudioReservation, 'idempotencyKey' | 'confirmed'>,
  signal: AbortSignal,
) {
  const fingerprint = await computeSha256Hex(new TextEncoder().encode(JSON.stringify(input)));
  signal.throwIfAborted();
  const nextKey = crypto.randomUUID();
  try {
    const saved = sessionStorage.getItem(storageKey);
    const [savedFingerprint, savedKey] = saved?.split(':') ?? [];
    if (savedFingerprint === fingerprint && /^[A-Za-z0-9_-]{16,128}$/.test(savedKey)) return savedKey;
    sessionStorage.setItem(storageKey, `${fingerprint}:${nextKey}`);
  } catch {
    // Browsers can disable sessionStorage. The open form still retains its attempt.
  }
  return nextKey;
}

function clearPublicationKey(storageKey: string, idempotencyKey: string) {
  try {
    if (sessionStorage.getItem(storageKey)?.split(':')[1] === idempotencyKey) sessionStorage.removeItem(storageKey);
  } catch {
    // sessionStorage is optional.
  }
}

export function MinistryAudioPublicationForm({ ministryId, userId, onCancel, onPublished }: {
  ministryId: string;
  userId: string;
  onCancel: () => void;
  onPublished: () => void;
}) {
  const storageKey = `louvaio:ministry-audio:${encodeURIComponent(userId)}:${encodeURIComponent(ministryId)}`;
  const [metadata, setMetadata] = useState<MinistryAudioMetadata>({ title: '', artist: '', version: '' });
  const [model, setModel] = useState<MinistryAudioModel>({ id: '', version: '' });
  const [files, setFiles] = useState<MinistryStemFiles>({});
  const [confirmed, setConfirmed] = useState(false);
  const [busy, setBusy] = useState(false);
  const [locked, setLocked] = useState(false);
  const [ended, setEnded] = useState(false);
  const [progress, setProgress] = useState<number | null>(null);
  const [error, setError] = useState<string | null>(null);
  const inFlight = useRef(false);
  const attempt = useRef<PublicationAttempt | null>(null);
  const { start } = useAudioRequest();

  async function publish(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!confirmed || inFlight.current) return;
    inFlight.current = true;
    const { signal } = start();
    setBusy(true);
    setError(null);

    try {
      if (!attempt.current) {
        const trimmed = trimAudioMetadata(metadata);
        const trimmedModel = { id: model.id.trim(), version: model.version.trim() };
        if (!trimmed.title || !trimmed.version || !trimmedModel.id || !trimmedModel.version) {
          throw new Error('Informe título, versão, modelo e versão do modelo.');
        }
        const stems = await describeMinistryStemFiles(files, signal);
        const input = { ...trimmed, model: trimmedModel, stems };
        const idempotencyKey = await getPublicationKey(storageKey, input, signal);
        signal.throwIfAborted();
        attempt.current = { input: { ...input, idempotencyKey, confirmed: true } };
        setLocked(true);
      }

      const current = attempt.current;
      let upload = current.uploadId
        ? await api.ministryAudio.getUpload(ministryId, current.uploadId, signal)
        : await api.ministryAudio.reserve(ministryId, current.input, signal);
      signal.throwIfAborted();
      current.uploadId = upload.id;
      if (upload.status === 'published') {
        clearPublicationKey(storageKey, current.input.idempotencyKey);
        onPublished();
        return;
      }
      if (upload.status !== 'uploading') {
        clearPublicationKey(storageKey, current.input.idempotencyKey);
        setEnded(true);
        throw new Error('Este envio foi encerrado. Feche o formulário e inicie uma nova publicação.');
      }

      setProgress(upload.uploadedStemIds.length);
      for (const { id } of current.input.stems) {
        if (upload.uploadedStemIds.includes(id)) continue;
        const file = files[id];
        if (!file) throw new Error(`Selecione o arquivo WAV da faixa ${STEM_DISPLAY_LABELS_PT_BR[id]}.`);
        const uploadStem = upload.transfer === 'direct' ? api.ministryAudio.uploadDirectStem : api.ministryAudio.uploadStem;
        upload = await uploadStem(ministryId, current.uploadId, id, file, signal);
        signal.throwIfAborted();
        setProgress(upload.uploadedStemIds.length);
      }
      await api.ministryAudio.finalize(ministryId, current.uploadId, signal);
      signal.throwIfAborted();
      clearPublicationKey(storageKey, current.input.idempotencyKey);
      onPublished();
    } catch (reason) {
      if (!signal.aborted) setError(getFriendlyErrorMessage(reason));
    } finally {
      inFlight.current = false;
      if (!signal.aborted) setBusy(false);
    }
  }

  return (
    <form className={AUDIO_CARD} onSubmit={publish} aria-label="Publicar gravação de seis faixas">
      <h3 className="text-lg font-semibold">Nova gravação</h3>
      <fieldset disabled={busy || locked} className="grid min-w-0 gap-3">
        <AudioMetadataFields value={metadata} onChange={setMetadata} />
        <div className={AUDIO_FORM_GRID}>
          <label className={AUDIO_FORM_FIELD}>
            Modelo
            <input className={AUDIO_FORM_INPUT} required maxLength={120} value={model.id} onChange={(event) => setModel({ ...model, id: event.target.value })} />
          </label>
          <label className={AUDIO_FORM_FIELD}>
            Versão do modelo
            <input className={AUDIO_FORM_INPUT} required maxLength={120} value={model.version} onChange={(event) => setModel({ ...model, version: event.target.value })} />
          </label>
        </div>
        <p className="text-sm text-[var(--text-secondary)]">Selecione seis WAVs PCM de 16 bits em estéreo, com duração de até 5 minutos. Você pode usar os arquivos exportados pelo separador.</p>
        <div className={AUDIO_FORM_GRID}>
          {CANONICAL_STEM_IDS.map((id) => (
            <label key={id} className={AUDIO_FORM_FIELD}>
              {STEM_DISPLAY_LABELS_PT_BR[id]}
              <input
                type="file" accept=".wav,audio/wav,audio/x-wav" required className={AUDIO_FORM_INPUT}
                data-testid={`audio-stem-${id}`}
                onChange={(event) => setFiles({ ...files, [id]: event.target.files?.[0] })}
              />
            </label>
          ))}
        </div>
      </fieldset>
      <label className="flex min-h-[44px] items-center gap-2">
        <input type="checkbox" required disabled={busy || locked} checked={confirmed} onChange={(event) => setConfirmed(event.target.checked)} />
        Confirmo a publicação destas faixas no ministério
      </label>
      {busy && <p role="status">{progress === null ? 'Validando arquivos e preparando o envio…' : `Faixas enviadas: ${progress} de 6`}</p>}
      {error && (
        <div className="grid gap-1" role="alert">
          <p>{error}</p>
          {locked && !ended && <p>Se atualizar esta página, selecione os mesmos arquivos e informe os mesmos dados para retomar o envio.</p>}
        </div>
      )}
      <div className={AUDIO_ACTIONS}>
        {!ended && (
          <button type="submit" className="btn btn-primary min-h-[44px]" disabled={!confirmed || busy}>
            {locked && error ? 'Retomar publicação' : 'Publicar gravação'}
          </button>
        )}
        <button type="button" className="btn btn-secondary min-h-[44px]" disabled={busy} onClick={onCancel}>Fechar formulário</button>
      </div>
    </form>
  );
}
