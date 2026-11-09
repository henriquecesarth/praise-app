import React, { useRef, useState } from 'react';
import { useRepertoireDialog } from './useRepertoireDialog';
import { X, Plus, Trash2, Check, ChevronLeft } from 'lucide-react';
import { SongVersion, SongLink, Classification } from '../types';

interface VersionEditModalProps {
  version: SongVersion;
  classifications: Classification[];
  onSave: (version: SongVersion) => void;
  onClose: () => void;
}

export const MUSICAL_KEYS = [
  'C', 'C#', 'Db', 'D', 'D#', 'Eb', 'E', 'F',
  'F#', 'Gb', 'G', 'G#', 'Ab', 'A', 'A#', 'Bb', 'B',
  'Cm', 'C#m', 'Dm', 'D#m', 'Ebm', 'Em', 'Fm',
  'F#m', 'Gm', 'G#m', 'Am', 'Bbm', 'Bm',
];

let customLinkSeq = 0;
const nextCustomLinkId = () => {
  customLinkSeq += 1;
  return `custom_${Date.now()}_${customLinkSeq}`;
};

export const VersionEditModal: React.FC<VersionEditModalProps> = ({
  version,
  classifications,
  onSave,
  onClose,
}) => {
  const dialogRef = useRef<HTMLDivElement>(null);
  useRepertoireDialog(dialogRef, true, onClose);
  const [name, setName] = useState(version.name || 'Original');
  const [selectedClassificationIds, setSelectedClassificationIds] = useState<string[]>(
    Array.isArray(version.classificationIds) ? [...version.classificationIds] : []
  );
  const [notes, setNotes] = useState(version.notes ?? '');
  const [key, setKey] = useState(version.key || 'C');
  const [bpm, setBpm] = useState(
    version.bpm !== undefined && version.bpm !== null ? String(version.bpm) : ''
  );
  const [formError, setFormError] = useState<string | null>(null);

  const parseDurationParts = (durString?: string) => {
    if (!durString) return { hours: '', minutes: '', seconds: '' };
    const clean = String(durString).trim();
    const parts = clean.split(':');
    if (parts.length === 3) {
      return { hours: parts[0], minutes: parts[1], seconds: parts[2] };
    }
    if (parts.length === 2) {
      return { hours: '00', minutes: parts[0], seconds: parts[1] };
    }
    return { hours: '', minutes: '', seconds: '' };
  };

  const initialDuration = parseDurationParts(version.duration);
  const [durationHours, setDurationHours] = useState(initialDuration.hours);
  const [durationMinutes, setDurationMinutes] = useState(initialDuration.minutes);
  const [durationSeconds, setDurationSeconds] = useState(initialDuration.seconds);

  const findLink = (labelName: string) =>
    version.links?.find((l) => !l.isCustom && l.label.toLowerCase() === labelName.toLowerCase())?.url || '';

  const [letraUrl, setLetraUrl] = useState(findLink('Letra'));
  const [cifraUrl, setCifraUrl] = useState(findLink('Cifra'));
  const [audioUrl, setAudioUrl] = useState(findLink('Áudio') || findLink('Audio'));
  const [videoUrl, setVideoUrl] = useState(findLink('Vídeo') || findLink('Video'));

  const initialCustomLinks: SongLink[] =
    version.links
      ?.filter(
        (l) =>
          l.isCustom ||
          !['letra', 'cifra', 'áudio', 'audio', 'vídeo', 'video'].includes(l.label.toLowerCase())
      )
      .map((l) => ({ ...l, isCustom: true })) || [];

  const [customLinks, setCustomLinks] = useState<SongLink[]>(initialCustomLinks);

  const toggleClassification = (id: string) => {
    setSelectedClassificationIds((prev) =>
      prev.includes(id) ? prev.filter((item) => item !== id) : [...prev, id]
    );
  };

  const handleAddCustomLink = () => {
    setCustomLinks((prev) => [
      ...prev,
      { id: nextCustomLinkId(), label: '', url: '', isCustom: true },
    ]);
  };

  const handleUpdateCustomLink = (index: number, field: 'label' | 'url', value: string) => {
    setCustomLinks((prev) => {
      const updated = [...prev];
      updated[index] = { ...updated[index], [field]: value };
      return updated;
    });
  };

  const handleRemoveCustomLink = (index: number) => {
    setCustomLinks((prev) => prev.filter((_, i) => i !== index));
  };

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (!name.trim()) {
      setFormError('Informe o nome da versão.');
      return;
    }

    let formattedDuration: string | undefined = undefined;
    if (durationHours.trim() || durationMinutes.trim() || durationSeconds.trim()) {
      const h = durationHours.trim() ? durationHours.trim().padStart(2, '0') : '00';
      const m = durationMinutes.trim() ? durationMinutes.trim().padStart(2, '0') : '00';
      const s = durationSeconds.trim() ? durationSeconds.trim().padStart(2, '0') : '00';
      if (h !== '00' || m !== '00' || s !== '00') {
        formattedDuration = `${h}:${m}:${s}`;
      }
    }

    const trimmedBpm = bpm.trim();
    const normalizedBpm =
      trimmedBpm !== ''
        ? typeof version.bpm === 'number' && !Number.isNaN(Number(trimmedBpm))
          ? Number(trimmedBpm)
          : trimmedBpm
        : undefined;

    // Only replace fields the user changed; legacy null/absent values are distinct.
    const updatedVersion: SongVersion = { ...version, id: version.id, name: name.trim() };
    if (JSON.stringify(selectedClassificationIds) !== JSON.stringify(version.classificationIds || [])) {
      updatedVersion.classificationIds = selectedClassificationIds;
    }
    if (notes !== (version.notes ?? '')) updatedVersion.notes = notes.trim();
    if (key !== (version.key || 'C')) updatedVersion.key = key.trim() || 'C';
    if (bpm !== (version.bpm == null ? '' : String(version.bpm))) updatedVersion.bpm = normalizedBpm;
    if (durationHours !== initialDuration.hours || durationMinutes !== initialDuration.minutes || durationSeconds !== initialDuration.seconds) {
      updatedVersion.duration = formattedDuration;
    }
    const linksChanged = letraUrl !== findLink('Letra') || cifraUrl !== findLink('Cifra') ||
      audioUrl !== (findLink('Áudio') || findLink('Audio')) || videoUrl !== (findLink('Vídeo') || findLink('Video')) ||
      JSON.stringify(customLinks) !== JSON.stringify(initialCustomLinks);
    if (linksChanged) {
      const standardFields = [
        { label: 'Letra', aliases: ['letra'], value: letraUrl, initial: findLink('Letra') },
        { label: 'Cifra', aliases: ['cifra'], value: cifraUrl, initial: findLink('Cifra') },
        { label: 'Áudio', aliases: ['áudio', 'audio'], value: audioUrl, initial: findLink('Áudio') || findLink('Audio') },
        { label: 'Vídeo', aliases: ['vídeo', 'video'], value: videoUrl, initial: findLink('Vídeo') || findLink('Video') },
      ];
      const standardLinks = (version.links || []).filter((link) => !link.isCustom &&
        standardFields.some((field) => field.aliases.includes(link.label.toLowerCase())));
      updatedVersion.links = standardLinks.map((link) => {
        const field = standardFields.find((item) => item.aliases.includes(link.label.toLowerCase()))!;
        const editedLink = standardLinks.find((item) => field.aliases.includes(item.label.toLowerCase()) && item.url === field.initial);
        return field.value === field.initial || link !== editedLink ? link : { ...link, url: field.value.trim() };
      });
      for (const field of standardFields) {
        if (field.value.trim() && !standardLinks.some((link) => field.aliases.includes(link.label.toLowerCase()))) {
          updatedVersion.links.push({ label: field.label, url: field.value.trim() });
        }
      }
      updatedVersion.links.push(...customLinks.filter((link) => link.label.trim() && link.url.trim()));
    }

    onSave(updatedVersion);
  };

  return (
    <div className="modal-overlay version-modal-overlay" onClick={(event) => { event.stopPropagation(); onClose(); }}>
      <div
        className="modal-content large song-form-modal version-edit-modal mobile-fullscreen-view"
        ref={dialogRef}
        tabIndex={-1}
        role="dialog"
        aria-modal="true"
        aria-labelledby="version-edit-modal-title"
        onClick={(e) => e.stopPropagation()}
      >
        {/* Cabeçalho Fixo */}
        <header className="modal-header repertoire-modal-header">
          <button
            type="button"
            className="action-icon-btn repertoire-modal-icon-btn"
            onClick={onClose}
            title="Voltar"
            aria-label="Fechar edição de versão"
          >
            <ChevronLeft size={20} className="mobile-only" />
            <X size={18} className="desktop-only" />
          </button>

          <div className="repertoire-modal-title-wrap">
            <h2 id="version-edit-modal-title" className="modal-title repertoire-modal-title">
              Editar Versão da Música
            </h2>
            <span className="repertoire-version-subtitle">{name.trim() || 'Original'}</span>
          </div>

          <button
            type="button"
            className="action-icon-btn repertoire-modal-icon-btn confirm"
            onClick={handleSubmit}
            title="Concluir Versão"
            aria-label="Concluir edição da versão"
          >
            <Check size={18} />
          </button>
        </header>

        {/* Corpo com 3 Grupos Estruturados */}
        <form id="version-edit-form" onSubmit={handleSubmit} className="repertoire-modal-body" noValidate>
          {formError && (
            <div className="repertoire-form-alert error" role="alert">
              {formError}
            </div>
          )}

          {/* Grupo 1: Identificação e Andamento */}
          <section className="repertoire-form-section" aria-labelledby="version-group-identity">
            <div className="repertoire-section-header">
              <h3 id="version-group-identity" className="repertoire-section-title">
                1. Identificação e Andamento
              </h3>
            </div>

            <div className="repertoire-form-stack">
              <div className="repertoire-field">
                <label className="repertoire-form-label" htmlFor="version-name-input">
                  Nome da Versão (ex: Original, Acústico) *
                </label>
                <input
                  id="version-name-input"
                  type="text"
                  className="repertoire-input"
                  value={name}
                  onChange={(e) => {
                    setName(e.target.value);
                    if (formError) setFormError(null);
                  }}
                  placeholder="Ex: Original, Acústica, Ao Vivo..."
                  required
                />
              </div>

              <div className="repertoire-form-grid-2">
                <div className="repertoire-field">
                  <label className="repertoire-form-label" htmlFor="version-key-select">
                    Tom *
                  </label>
                  <select
                    id="version-key-select"
                    className="repertoire-select"
                    value={key}
                    onChange={(e) => setKey(e.target.value)}
                  >
                    {MUSICAL_KEYS.map((k) => (
                      <option key={k} value={k}>
                        {k}
                      </option>
                    ))}
                  </select>
                </div>

                <div className="repertoire-field">
                  <label className="repertoire-form-label" htmlFor="version-bpm-input">
                    BPM (ex: 120)
                  </label>
                  <input
                    id="version-bpm-input"
                    type="number"
                    min={1}
                    max={999}
                    className="repertoire-input mono"
                    value={bpm}
                    onChange={(e) => setBpm(e.target.value)}
                    placeholder="Ex: 72"
                  />
                </div>
              </div>

              <div className="repertoire-field">
                <span className="repertoire-form-label">Duração</span>
                <div className="repertoire-duration-grid">
                  <div className="repertoire-field">
                    <label className="repertoire-form-sublabel" htmlFor="version-duration-hh">
                      Horas (HH)
                    </label>
                    <input
                      id="version-duration-hh"
                      type="number"
                      min={0}
                      max={23}
                      className="repertoire-input mono text-center"
                      value={durationHours}
                      onChange={(e) => setDurationHours(e.target.value)}
                      placeholder="00"
                    />
                  </div>

                  <div className="repertoire-field">
                    <label className="repertoire-form-sublabel" htmlFor="version-duration-mm">
                      Minutos (MM)
                    </label>
                    <input
                      id="version-duration-mm"
                      type="number"
                      min={0}
                      max={59}
                      className="repertoire-input mono text-center"
                      value={durationMinutes}
                      onChange={(e) => setDurationMinutes(e.target.value)}
                      placeholder="05"
                    />
                  </div>

                  <div className="repertoire-field">
                    <label className="repertoire-form-sublabel" htmlFor="version-duration-ss">
                      Segundos (SS)
                    </label>
                    <input
                      id="version-duration-ss"
                      type="number"
                      min={0}
                      max={59}
                      className="repertoire-input mono text-center"
                      value={durationSeconds}
                      onChange={(e) => setDurationSeconds(e.target.value)}
                      placeholder="30"
                    />
                  </div>
                </div>
              </div>
            </div>
          </section>

          {/* Grupo 2: Classificações e Observações */}
          <section className="repertoire-form-section" aria-labelledby="version-group-classifications">
            <div className="repertoire-section-header">
              <h3 id="version-group-classifications" className="repertoire-section-title">
                2. Classificações e Observações
              </h3>
            </div>

            <div className="repertoire-form-stack">
              <div className="repertoire-field">
                <span className="repertoire-form-label">Classificações</span>
                <div className="repertoire-classification-chips" role="group" aria-label="Classificações da versão">
                  {classifications.map((c) => {
                    const isSelected = selectedClassificationIds.includes(c.id);
                    return (
                      <button
                        type="button"
                        key={c.id}
                        aria-pressed={isSelected}
                        onClick={() => toggleClassification(c.id)}
                        className={`repertoire-classification-chip ${isSelected ? 'selected' : ''}`}
                      >
                        {isSelected && <Check size={14} />}
                        <span>{c.name}</span>
                      </button>
                    );
                  })}
                  {classifications.length === 0 && (
                    <span className="repertoire-empty-hint">
                      Nenhuma classificação cadastrada no ministério.
                    </span>
                  )}
                </div>
              </div>

              <div className="repertoire-field">
                <label className="repertoire-form-label" htmlFor="version-notes-textarea">
                  Observações da Versão (ex: ponte repetida 2x)
                </label>
                <textarea
                  id="version-notes-textarea"
                  className="repertoire-textarea"
                  rows={3}
                  value={notes}
                  onChange={(e) => setNotes(e.target.value)}
                  placeholder="Ex: Ponte repetida 2x, entrar apenas piano e voz..."
                />
              </div>
            </div>
          </section>

          {/* Grupo 3: Links e Recursos */}
          <section className="repertoire-form-section" aria-labelledby="version-group-links">
            <div className="repertoire-section-header">
              <h3 id="version-group-links" className="repertoire-section-title">
                3. Links & Recursos da Versão
              </h3>
            </div>

            <div className="repertoire-links-grid">
              <div className="repertoire-field">
                <label className="repertoire-form-label" htmlFor="version-link-letra">
                  Letra (ex: https://...)
                </label>
                <input
                  id="version-link-letra"
                  type="url"
                  className="repertoire-input"
                  value={letraUrl}
                  onChange={(e) => setLetraUrl(e.target.value)}
                  placeholder="https://letras.mus.br/..."
                />
              </div>

              <div className="repertoire-field">
                <label className="repertoire-form-label" htmlFor="version-link-cifra">
                  Cifra (ex: CifraClub, Drive)
                </label>
                <input
                  id="version-link-cifra"
                  type="url"
                  className="repertoire-input"
                  value={cifraUrl}
                  onChange={(e) => setCifraUrl(e.target.value)}
                  placeholder="https://cifraclub.com.br/..."
                />
              </div>

              <div className="repertoire-field">
                <label className="repertoire-form-label" htmlFor="version-link-audio">
                  Áudio (ex: Spotify, Drive)
                </label>
                <input
                  id="version-link-audio"
                  type="url"
                  className="repertoire-input"
                  value={audioUrl}
                  onChange={(e) => setAudioUrl(e.target.value)}
                  placeholder="https://open.spotify.com/..."
                />
              </div>

              <div className="repertoire-field">
                <label className="repertoire-form-label" htmlFor="version-link-video">
                  Vídeo (ex: YouTube)
                </label>
                <input
                  id="version-link-video"
                  type="url"
                  className="repertoire-input"
                  value={videoUrl}
                  onChange={(e) => setVideoUrl(e.target.value)}
                  placeholder="https://youtube.com/watch?v=..."
                />
              </div>
            </div>

            {customLinks.length > 0 && (
              <div className="repertoire-custom-links-list">
                <span className="repertoire-form-label">Links Customizados</span>
                {customLinks.map((link, idx) => (
                  <div key={link.id || idx} className="repertoire-custom-link-row">
                    <div className="repertoire-field custom-label-col">
                      <label
                        className="repertoire-form-sublabel"
                        htmlFor={`custom-link-label-${idx}`}
                      >
                        Rótulo (ex: Partitura)
                      </label>
                      <input
                        id={`custom-link-label-${idx}`}
                        type="text"
                        className="repertoire-input"
                        value={link.label}
                        onChange={(e) => handleUpdateCustomLink(idx, 'label', e.target.value)}
                        placeholder="Ex: Multitrack, VS, Mapa..."
                      />
                    </div>

                    <div className="repertoire-field custom-url-col">
                      <label
                        className="repertoire-form-sublabel"
                        htmlFor={`custom-link-url-${idx}`}
                      >
                        URL (ex: https://...)
                      </label>
                      <input
                        id={`custom-link-url-${idx}`}
                        type="url"
                        className="repertoire-input"
                        value={link.url}
                        onChange={(e) => handleUpdateCustomLink(idx, 'url', e.target.value)}
                        placeholder="https://..."
                      />
                    </div>

                    <button
                      type="button"
                      className="action-icon-btn danger repertoire-custom-link-remove"
                      onClick={() => handleRemoveCustomLink(idx)}
                      title="Remover Link"
                      aria-label={`Remover link personalizado ${link.label || idx + 1}`}
                    >
                      <Trash2 size={18} />
                    </button>
                  </div>
                ))}
              </div>
            )}

            <button
              type="button"
              className="btn btn-secondary repertoire-add-custom-link-btn"
              onClick={handleAddCustomLink}
            >
              <Plus size={16} />
              <span>Adicionar Link Customizado</span>
            </button>
          </section>

          {/* Rodapé Fixo */}
          <footer className="form-actions repertoire-modal-footer">
            <button
              type="button"
              className="btn btn-secondary repertoire-footer-btn"
              onClick={onClose}
            >
              Cancelar
            </button>
            <button
              type="submit"
              className="btn btn-primary repertoire-footer-btn"
            >
              Salvar Versão
            </button>
          </footer>
        </form>
      </div>
    </div>
  );
};
