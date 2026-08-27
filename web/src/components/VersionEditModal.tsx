import React, { useState } from 'react';
import { X, Plus, Trash2, Check, ChevronLeft } from 'lucide-react';
import { SongVersion, SongLink, Classification } from '../types';
import { FloatingInput } from './ui/FloatingInput';
import { FloatingTextarea } from './ui/FloatingTextarea';
import { FloatingSelect } from './ui/FloatingSelect';

interface VersionEditModalProps {
  version: SongVersion;
  classifications: Classification[];
  onSave: (version: SongVersion) => void;
  onClose: () => void;
}

const MUSICAL_KEYS = [
  'C', 'C#', 'Db', 'D', 'D#', 'Eb', 'E', 'F',
  'F#', 'Gb', 'G', 'G#', 'Ab', 'A', 'A#', 'Bb', 'B',
  'Cm', 'C#m', 'Dm', 'D#m', 'Ebm', 'Em', 'Fm',
  'F#m', 'Gm', 'G#m', 'Am', 'Bbm', 'Bm'
];

export const VersionEditModal: React.FC<VersionEditModalProps> = ({
  version,
  classifications,
  onSave,
  onClose,
}) => {
  const [name, setName] = useState(version.name || 'Original');
  const [selectedClassificationIds, setSelectedClassificationIds] = useState<string[]>(
    version.classificationIds || []
  );
  const [notes, setNotes] = useState(version.notes || '');
  const [key, setKey] = useState(version.key || 'C');
  const [bpm, setBpm] = useState(version.bpm !== undefined ? String(version.bpm) : '');

  // Parse duration into Hours, Minutes, Seconds
  const parseDurationParts = (durString?: string) => {
    if (!durString) return { hours: '', minutes: '', seconds: '' };
    const clean = String(durString).trim();
    const parts = clean.split(':');
    if (parts.length === 3) {
      return { hours: parts[0], minutes: parts[1], seconds: parts[2] };
    } else if (parts.length === 2) {
      return { hours: '00', minutes: parts[0], seconds: parts[1] };
    }
    return { hours: '', minutes: '', seconds: '' };
  };

  const initialDuration = parseDurationParts(version.duration);
  const [durationHours, setDurationHours] = useState(initialDuration.hours);
  const [durationMinutes, setDurationMinutes] = useState(initialDuration.minutes);
  const [durationSeconds, setDurationSeconds] = useState(initialDuration.seconds);

  // Extract initial standard links (Letra, Cifra, Áudio, Vídeo)
  const findLink = (labelName: string) =>
    version.links?.find((l) => l.label.toLowerCase() === labelName.toLowerCase())?.url || '';

  const [letraUrl, setLetraUrl] = useState(findLink('Letra'));
  const [cifraUrl, setCifraUrl] = useState(findLink('Cifra'));
  const [audioUrl, setAudioUrl] = useState(findLink('Áudio') || findLink('Audio'));
  const [videoUrl, setVideoUrl] = useState(findLink('Vídeo') || findLink('Video'));

  // Custom links
  const initialCustomLinks: SongLink[] =
    version.links?.filter(
      (l) =>
        l.isCustom ||
        !['letra', 'cifra', 'áudio', 'audio', 'vídeo', 'video'].includes(l.label.toLowerCase())
    ) || [];

  const [customLinks, setCustomLinks] = useState<SongLink[]>(initialCustomLinks);

  const toggleClassification = (id: string) => {
    setSelectedClassificationIds((prev) =>
      prev.includes(id) ? prev.filter((item) => item !== id) : [...prev, id]
    );
  };

  const handleAddCustomLink = () => {
    setCustomLinks((prev) => [
      ...prev,
      { id: `custom_${Date.now()}`, label: '', url: '', isCustom: true },
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

    // Format duration to HH:MM:SS
    let formattedDuration: string | undefined = undefined;
    if (durationHours.trim() || durationMinutes.trim() || durationSeconds.trim()) {
      const h = durationHours.trim() ? durationHours.trim().padStart(2, '0') : '00';
      const m = durationMinutes.trim() ? durationMinutes.trim().padStart(2, '0') : '00';
      const s = durationSeconds.trim() ? durationSeconds.trim().padStart(2, '0') : '00';
      if (h !== '00' || m !== '00' || s !== '00') {
        formattedDuration = `${h}:${m}:${s}`;
      }
    }

    const allLinks: SongLink[] = [
      { label: 'Letra', url: letraUrl.trim() },
      { label: 'Cifra', url: cifraUrl.trim() },
      { label: 'Áudio', url: audioUrl.trim() },
      { label: 'Vídeo', url: videoUrl.trim() },
      ...customLinks
        .filter((l) => l.label.trim() && l.url.trim())
        .map((l) => ({ ...l, label: l.label.trim(), url: l.url.trim(), isCustom: true })),
    ];

    const updatedVersion: SongVersion = {
      ...version,
      name: name.trim() || 'Original',
      classificationIds: selectedClassificationIds,
      notes: notes.trim() || undefined,
      key: key.trim() || 'C',
      bpm: bpm ? bpm.trim() : undefined,
      duration: formattedDuration || undefined,
      links: allLinks,
    };

    onSave(updatedVersion);
  };

  return (
    <div className="modal-overlay" onClick={onClose}>
      <div
        className="modal-content large mobile-fullscreen-view"
        onClick={(e) => e.stopPropagation()}
        style={{
          maxHeight: '92vh',
          display: 'flex',
          flexDirection: 'column',
          backgroundColor: 'var(--surface-color)',
          borderColor: 'var(--border-color)',
          padding: '24px',
        }}
      >
        {/* Header */}
        <div
          className="modal-header"
          style={{
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'space-between',
            paddingBottom: '16px',
            borderBottom: '1px solid var(--border-color)',
            marginBottom: '16px',
          }}
        >
          <button
            type="button"
            className="action-icon-btn"
            onClick={onClose}
            title="Voltar"
            style={{
              width: '44px',
              height: '44px',
              minWidth: '44px',
              minHeight: '44px',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              borderRadius: '10px',
            }}
          >
            <ChevronLeft size={22} className="mobile-only" />
            <X size={20} className="desktop-only" />
          </button>

          <div
            className="modal-title"
            style={{
              flex: 1,
              textAlign: 'center',
              margin: 0,
              fontSize: '1.1rem',
              fontWeight: 700,
              color: 'var(--text-primary)',
            }}
          >
            Editar Versão da Música
          </div>

          <button
            type="button"
            className="action-icon-btn"
            onClick={handleSubmit}
            title="Concluir Versão"
            style={{
              width: '44px',
              height: '44px',
              minWidth: '44px',
              minHeight: '44px',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              borderRadius: '10px',
              color: 'var(--primary-light)',
            }}
          >
            <Check size={20} />
          </button>
        </div>

        {/* Form Body com Floating Labels */}
        <form onSubmit={handleSubmit} style={{ flex: 1, overflowY: 'auto', padding: '4px 6px', display: 'flex', flexDirection: 'column', gap: '16px' }}>
          <FloatingInput
            label="Nome da Versão (ex: Original, Acústico) *"
            value={name}
            onChange={(e) => setName(e.target.value)}
            required
          />

          {/* Classificações (Chips / Multi-Select) */}
          <div>
            <label style={{ fontWeight: 600, fontSize: '0.85rem', color: 'var(--text-secondary)', marginBottom: '8px', display: 'block' }}>
              Classificações
            </label>
            <div style={{ display: 'flex', flexWrap: 'wrap', gap: '8px', padding: '2px 0' }}>
              {classifications.map((c) => {
                const isSelected = selectedClassificationIds.includes(c.id);
                return (
                  <button
                    type="button"
                    key={c.id}
                    onClick={() => toggleClassification(c.id)}
                    style={{
                      minHeight: '44px',
                      padding: '6px 14px',
                      borderRadius: '20px',
                      fontSize: '0.82rem',
                      fontWeight: 600,
                      cursor: 'pointer',
                      border: `1px solid ${isSelected ? c.color || 'var(--primary-color)' : 'var(--border-color)'}`,
                      backgroundColor: isSelected ? `${c.color || 'var(--primary-color)'}25` : 'var(--surface-variant)',
                      color: isSelected ? c.color || 'var(--primary-light)' : 'var(--text-secondary)',
                      transition: 'all 0.15s ease',
                      display: 'inline-flex',
                      alignItems: 'center',
                      gap: '6px',
                    }}
                  >
                    {isSelected && <Check size={14} />}
                    {c.name}
                  </button>
                );
              })}
              {classifications.length === 0 && (
                <span style={{ fontSize: '0.82rem', color: 'var(--text-tertiary)' }}>
                  Nenhuma classificação cadastrada no ministério.
                </span>
              )}
            </div>
          </div>

          {/* Observações da Versão */}
          <FloatingTextarea
            label="Observações da Versão (ex: ponte repetida 2x)"
            value={notes}
            onChange={(e) => setNotes(e.target.value)}
          />

          {/* Tom & BPM */}
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '14px' }}>
            <FloatingSelect
              label="Tom *"
              value={key}
              onChange={(e) => setKey(e.target.value)}
            >
              {MUSICAL_KEYS.map((k) => (
                <option key={k} value={k}>
                  {k}
                </option>
              ))}
            </FloatingSelect>

            <FloatingInput
              label="BPM (ex: 120)"
              type="number"
              value={bpm}
              onChange={(e) => setBpm(e.target.value)}
            />
          </div>

          {/* Duração em 3 Campos com Floating Label (Horas, Minutos e Segundos) */}
          <div>
            <label style={{ fontWeight: 600, fontSize: '0.85rem', color: 'var(--text-secondary)', marginBottom: '8px', display: 'block' }}>
              Duração
            </label>
            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1fr', gap: '10px' }}>
              <FloatingInput
                label="Horas (HH)"
                type="number"
                min={0}
                max={23}
                value={durationHours}
                onChange={(e) => setDurationHours(e.target.value)}
                className="text-center font-semibold"
              />
              <FloatingInput
                label="Minutos (MM)"
                type="number"
                min={0}
                max={59}
                value={durationMinutes}
                onChange={(e) => setDurationMinutes(e.target.value)}
                className="text-center font-semibold"
              />
              <FloatingInput
                label="Segundos (SS)"
                type="number"
                min={0}
                max={59}
                value={durationSeconds}
                onChange={(e) => setDurationSeconds(e.target.value)}
                className="text-center font-semibold"
              />
            </div>
          </div>

          {/* Seção de Links */}
          <div style={{ marginTop: '12px', borderTop: '1px solid var(--border-color)', paddingTop: '18px' }}>
            <div style={{ fontWeight: 700, fontSize: '1rem', color: 'var(--primary-light)', marginBottom: '14px' }}>
              Links & Recursos da Versão
            </div>

            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(230px, 1fr))', gap: '14px' }}>
              <FloatingInput
                label="Letra (ex: https://...)"
                value={letraUrl}
                onChange={(e) => setLetraUrl(e.target.value)}
              />

              <FloatingInput
                label="Cifra (ex: CifraClub, Drive)"
                value={cifraUrl}
                onChange={(e) => setCifraUrl(e.target.value)}
              />

              <FloatingInput
                label="Áudio (ex: Spotify, Drive)"
                value={audioUrl}
                onChange={(e) => setAudioUrl(e.target.value)}
              />

              <FloatingInput
                label="Vídeo (ex: YouTube)"
                value={videoUrl}
                onChange={(e) => setVideoUrl(e.target.value)}
              />
            </div>

            {/* Links Customizados */}
            {customLinks.length > 0 && (
              <div style={{ marginTop: '18px', display: 'flex', flexDirection: 'column', gap: '12px' }}>
                <div style={{ fontSize: '0.85rem', fontWeight: 600, color: 'var(--text-secondary)' }}>
                  Links Customizados
                </div>
                {customLinks.map((link, idx) => (
                  <div
                    key={link.id || idx}
                    style={{
                      display: 'flex',
                      gap: '10px',
                      alignItems: 'center',
                    }}
                  >
                    <div style={{ flex: 1 }}>
                      <FloatingInput
                        label="Rótulo (ex: Partitura)"
                        value={link.label}
                        onChange={(e) => handleUpdateCustomLink(idx, 'label', e.target.value)}
                      />
                    </div>
                    <div style={{ flex: 2 }}>
                      <FloatingInput
                        label="URL (ex: https://...)"
                        value={link.url}
                        onChange={(e) => handleUpdateCustomLink(idx, 'url', e.target.value)}
                      />
                    </div>
                    <button
                      type="button"
                      className="action-icon-btn danger"
                      onClick={() => handleRemoveCustomLink(idx)}
                      title="Remover Link"
                      style={{
                        width: '52px',
                        height: '52px',
                        minWidth: '52px',
                        minHeight: '52px',
                        display: 'flex',
                        alignItems: 'center',
                        justifyContent: 'center',
                        borderRadius: '10px',
                        color: 'var(--error-color)',
                      }}
                    >
                      <Trash2 size={18} />
                    </button>
                  </div>
                ))}
              </div>
            )}

            <button
              type="button"
              className="btn btn-secondary"
              onClick={handleAddCustomLink}
              style={{
                marginTop: '18px',
                width: '100%',
                minHeight: '52px',
                borderRadius: '12px',
                display: 'inline-flex',
                alignItems: 'center',
                justifyContent: 'center',
                gap: '8px',
                fontWeight: 600,
                fontSize: '0.88rem',
              }}
            >
              <Plus size={18} />
              Adicionar Link Customizado
            </button>
          </div>

          <div
            className="form-actions"
            style={{
              marginTop: '28px',
              paddingTop: '16px',
              borderTop: '1px solid var(--border-color)',
              display: 'flex',
              gap: '12px',
            }}
          >
            <button
              type="button"
              className="btn btn-secondary"
              onClick={onClose}
              style={{ flex: 1, minHeight: '52px' }}
            >
              Cancelar
            </button>
            <button
              type="submit"
              className="btn btn-primary"
              style={{ flex: 1, minHeight: '52px' }}
            >
              Salvar Versão
            </button>
          </div>
        </form>
      </div>
    </div>
  );
};
