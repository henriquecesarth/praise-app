import { useState, useRef, useEffect, useCallback } from 'react';
import { X, Plus, Trash2, ArrowUp, ArrowDown, Play, Square, Sparkles, AlertCircle } from 'lucide-react';
import { useRepertoireDialog } from '../useRepertoireDialog';
import {
  type VocalExercise,
  type MelodicCategory,
  SELECTABLE_VOCAL_NOTES,
} from '../../vocal-exercises';

interface CustomExerciseModalProps {
  initialExercise?: VocalExercise | null;
  isOpen: boolean;
  onClose: () => void;
  onSave: (data: {
    title: string;
    description: string;
    notes: number[];
    noteDurations: number[];
    minTranspose: number;
    maxTranspose: number;
    category: MelodicCategory;
  }) => Promise<void>;
}

interface EditableNote {
  id: string;
  midi: number;
  duration: number;
}

const COMMON_DURATIONS = [
  { value: 0.5, label: '0.5 tempo (Colcheia)' },
  { value: 1, label: '1 tempo (Semínima)' },
  { value: 1.5, label: '1.5 tempos (Semínima pontuada)' },
  { value: 2, label: '2 tempos (Mínima)' },
  { value: 3, label: '3 tempos (Mínima pontuada)' },
  { value: 4, label: '4 tempos (Semibreve)' },
];

const DEFAULT_EDITABLE_NOTES: EditableNote[] = [
  { id: '1', midi: 60, duration: 1 },
  { id: '2', midi: 62, duration: 1 },
  { id: '3', midi: 64, duration: 1 },
  { id: '4', midi: 65, duration: 1 },
  { id: '5', midi: 67, duration: 2 },
];

function buildInitialNotes(initialExercise?: VocalExercise | null): EditableNote[] {
  if (initialExercise && initialExercise.notes.length > 0) {
    return initialExercise.notes.map((midi, index) => ({
      id: `note-${index}-${Date.now()}`,
      midi,
      duration: initialExercise.noteDurations[index] || 1,
    }));
  }
  return DEFAULT_EDITABLE_NOTES.map((note) => ({ ...note }));
}

export function CustomExerciseModal({
  initialExercise,
  isOpen,
  onClose,
  onSave,
}: CustomExerciseModalProps) {
  const [title, setTitle] = useState(initialExercise?.title || '');
  const [description, setDescription] = useState(initialExercise?.description || '');
  const [category, setCategory] = useState<MelodicCategory>(initialExercise?.category || 'misto');
  const [autoDetectCategory, setAutoDetectCategory] = useState(!initialExercise);
  const [minTranspose, setMinTranspose] = useState(initialExercise?.minTranspose ?? -12);
  const [maxTranspose, setMaxTranspose] = useState(initialExercise?.maxTranspose ?? 12);

  const [notes, setNotes] = useState<EditableNote[]>(() => buildInitialNotes(initialExercise));

  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');
  const [previewActiveMidi, setPreviewActiveMidi] = useState<number | null>(null);
  const [isPreviewPlaying, setIsPreviewPlaying] = useState(false);

  const previewAudioRef = useRef<AudioContext | null>(null);
  const previewTimerRef = useRef<number[]>([]);
  const modalCardRef = useRef<HTMLDivElement>(null);

  const stopPreview = useCallback(() => {
    previewTimerRef.current.forEach((id) => window.clearTimeout(id));
    previewTimerRef.current = [];
    if (previewAudioRef.current) {
      try {
        previewAudioRef.current.close();
      } catch {
        /* ignore */
      }
      previewAudioRef.current = null;
    }
    setIsPreviewPlaying(false);
    setPreviewActiveMidi(null);
  }, []);

  useEffect(() => {
    stopPreview();
    if (!isOpen) return;
    setTitle(initialExercise?.title || '');
    setDescription(initialExercise?.description || '');
    setCategory(initialExercise?.category || 'misto');
    setAutoDetectCategory(!initialExercise);
    setMinTranspose(initialExercise?.minTranspose ?? -12);
    setMaxTranspose(initialExercise?.maxTranspose ?? 12);
    setNotes(buildInitialNotes(initialExercise));
    setError('');
  }, [initialExercise, isOpen, stopPreview]);

  useEffect(() => {
    return () => {
      stopPreview();
    };
  }, [stopPreview]);

  useRepertoireDialog(modalCardRef, isOpen, () => {
    if (!saving) {
      stopPreview();
      onClose();
    }
  });

  if (!isOpen) return null;

  const handleAddNote = () => {
    const lastNote = notes[notes.length - 1];
    const newMidi = lastNote ? Math.min(88, lastNote.midi + 2) : 60;
    setNotes([
      ...notes,
      {
        id: `note-${Date.now()}-${Math.random()}`,
        midi: newMidi,
        duration: 1,
      },
    ]);
  };

  const handleRemoveNote = (index: number) => {
    if (notes.length <= 1) {
      setError('O exercício deve conter pelo menos uma nota.');
      return;
    }
    setError('');
    setNotes(notes.filter((_, i) => i !== index));
  };

  const handleMoveNote = (index: number, direction: 'up' | 'down') => {
    const targetIndex = direction === 'up' ? index - 1 : index + 1;
    if (targetIndex < 0 || targetIndex >= notes.length) return;
    const newNotes = [...notes];
    const temp = newNotes[index];
    newNotes[index] = newNotes[targetIndex];
    newNotes[targetIndex] = temp;
    setNotes(newNotes);
  };

  const handleNoteChange = (index: number, midi: number) => {
    const newNotes = [...notes];
    newNotes[index] = { ...newNotes[index], midi };
    setNotes(newNotes);
  };

  const handleDurationChange = (index: number, duration: number) => {
    const newNotes = [...notes];
    newNotes[index] = { ...newNotes[index], duration };
    setNotes(newNotes);
  };

  const detectDirection = (noteList: EditableNote[]): MelodicCategory => {
    if (noteList.length <= 1) return 'misto';
    let hasUp = false;
    let hasDown = false;
    for (let i = 1; i < noteList.length; i++) {
      if (noteList[i].midi > noteList[i - 1].midi) hasUp = true;
      if (noteList[i].midi < noteList[i - 1].midi) hasDown = true;
    }
    if (hasUp && !hasDown) return 'ascendente';
    if (!hasUp && hasDown) return 'descendente';
    return 'misto';
  };

  // stopPreview defined above hooks before early return

  const handlePreviewSound = async () => {
    stopPreview();
    if (notes.length === 0) return;

    try {
      const audioCtx = new AudioContext();
      previewAudioRef.current = audioCtx;
      await audioCtx.resume();
      setIsPreviewPlaying(true);

      const bpm = 100;
      let cumulativeTime = audioCtx.currentTime + 0.1;

      notes.forEach((item) => {
        const noteDurationSeconds = (item.duration * 60) / bpm;
        const playTime = cumulativeTime;
        const noteMidi = item.midi;

        // Schedule visual highlight
        const delayMs = Math.max(0, (playTime - audioCtx.currentTime) * 1000);
        const timerId = window.setTimeout(() => {
          setPreviewActiveMidi(noteMidi);
        }, delayMs);
        previewTimerRef.current.push(timerId);

        // Schedule sound with synthesis oscillator
        const osc = audioCtx.createOscillator();
        const gain = audioCtx.createGain();
        const freq = 440 * Math.pow(2, (noteMidi - 69) / 12);
        osc.type = 'triangle';
        osc.frequency.setValueAtTime(freq, playTime);

        gain.gain.setValueAtTime(0, playTime);
        gain.gain.linearRampToValueAtTime(0.25, playTime + 0.02);
        gain.gain.exponentialRampToValueAtTime(0.001, playTime + noteDurationSeconds * 0.9);

        osc.connect(gain);
        gain.connect(audioCtx.destination);
        osc.start(playTime);
        osc.stop(playTime + noteDurationSeconds);

        cumulativeTime += noteDurationSeconds;
      });

      // Schedule stop after sequence completes
      const totalDelay = Math.max(0, (cumulativeTime - audioCtx.currentTime) * 1000);
      const endTimer = window.setTimeout(() => {
        stopPreview();
      }, totalDelay);
      previewTimerRef.current.push(endTimer);
    } catch {
      stopPreview();
    }
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!title.trim()) {
      setError('Por favor, informe um título para o exercício.');
      return;
    }
    if (notes.length === 0) {
      setError('O exercício deve conter pelo menos uma nota.');
      return;
    }
    if (minTranspose > maxTranspose) {
      setError('A transposição mínima não pode ser maior que a máxima.');
      return;
    }

    const effectiveCategory = autoDetectCategory ? detectDirection(notes) : category;

    setError('');
    setSaving(true);
    try {
      await onSave({
        title: title.trim(),
        description: description.trim(),
        notes: notes.map((n) => n.midi),
        noteDurations: notes.map((n) => n.duration),
        minTranspose,
        maxTranspose,
        category: effectiveCategory,
      });
      stopPreview();
      onClose();
    } catch (err: any) {
      setError(err?.message || 'Falha ao salvar o exercício vocal.');
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="vocal-modal-overlay" role="dialog" aria-modal="true" aria-labelledby="modal-exercise-title">
      <div ref={modalCardRef} className="vocal-modal-card">
        <div className="vocal-modal-header">
          <div className="vocal-modal-title-wrap">
            <Sparkles size={20} className="vocal-modal-icon" aria-hidden="true" />
            <h2 id="modal-exercise-title" className="vocal-modal-title">
              {initialExercise ? 'Editar exercício vocal' : 'Novo exercício vocal'}
            </h2>
          </div>
          <button
            type="button"
            className="vocal-modal-close"
            disabled={saving}
            onClick={() => {
              stopPreview();
              onClose();
            }}
            aria-label="Fechar editor"
          >
            <X size={18} aria-hidden="true" />
          </button>
        </div>

        <form onSubmit={handleSubmit} className="vocal-modal-form">
          {error && (
            <div role="alert" className="vocal-alert-banner is-danger">
              <AlertCircle size={18} aria-hidden="true" />
              <span>{error}</span>
            </div>
          )}

          <div className="vocal-modal-body">
            {/* Title & Description */}
            <label className="vocal-form-field">
              <span className="vocal-form-label">Nome do exercício *</span>
              <input
                type="text"
                className="vocal-form-input"
                placeholder="Ex.: Meu Vocalize Maior em Quintas"
                value={title}
                onChange={(e) => setTitle(e.target.value)}
                required
                maxLength={100}
              />
            </label>

            <label className="vocal-form-field">
              <span className="vocal-form-label">Descrição (opcional)</span>
              <input
                type="text"
                className="vocal-form-input"
                placeholder="Breve instrução de respiração, vocalize ou dinâmica"
                value={description}
                onChange={(e) => setDescription(e.target.value)}
                maxLength={500}
              />
            </label>

            {/* Direction Category */}
            <div className="vocal-form-row">
              <label className="vocal-form-field">
                <span className="vocal-form-label">Direção melódica</span>
                <select
                  className="vocal-form-select"
                  value={autoDetectCategory ? 'auto' : category}
                  onChange={(e) => {
                    if (e.target.value === 'auto') {
                      setAutoDetectCategory(true);
                      setCategory(detectDirection(notes));
                    } else {
                      setAutoDetectCategory(false);
                      setCategory(e.target.value as MelodicCategory);
                    }
                  }}
                >
                  <option value="auto">Automática (detectar pelas notas)</option>
                  <option value="ascendente">Ascendente</option>
                  <option value="descendente">Descendente</option>
                  <option value="misto">Misto</option>
                </select>
              </label>

              <div className="vocal-form-field">
                <span className="vocal-form-label">Direção calculada</span>
                <div className="vocal-calculated-badge">
                  {autoDetectCategory ? `Detectado: ${detectDirection(notes)}` : category}
                </div>
              </div>
            </div>

            {/* Notes Sequence Builder */}
            <div className="vocal-sequence-section">
              <div className="vocal-sequence-header">
                <div>
                  <h3 className="vocal-sequence-title">Sequência de notas ({notes.length})</h3>
                  <span className="vocal-sequence-hint">
                    Defina a nota e a duração de cada tempo musical.
                  </span>
                </div>

                <div className="vocal-sequence-actions">
                  <button
                    type="button"
                    className={`btn btn-secondary vocal-btn-preview ${
                      isPreviewPlaying ? 'is-active' : ''
                    }`}
                    onClick={isPreviewPlaying ? stopPreview : handlePreviewSound}
                  >
                    {isPreviewPlaying ? (
                      <>
                        <Square size={14} aria-hidden="true" />
                        <span>Parar teste</span>
                      </>
                    ) : (
                      <>
                        <Play size={14} aria-hidden="true" />
                        <span>Testar som</span>
                      </>
                    )}
                  </button>

                  <button
                    type="button"
                    className="btn btn-secondary vocal-btn-add-note"
                    onClick={handleAddNote}
                  >
                    <Plus size={14} aria-hidden="true" />
                    <span>Adicionar nota</span>
                  </button>
                </div>
              </div>

              {/* Notes List Table */}
              <div className="vocal-notes-table" role="list" aria-label="Notas do exercício">
                {notes.map((item, index) => {
                  const isActive = previewActiveMidi === item.midi && isPreviewPlaying;

                  return (
                    <div
                      key={item.id}
                      role="listitem"
                      className={`vocal-note-row ${isActive ? 'is-preview-active' : ''}`}
                    >
                      <span className="vocal-note-index">{index + 1}º</span>

                      <div className="vocal-note-select-wrap">
                        <select
                          className="vocal-note-select"
                          value={item.midi}
                          onChange={(e) => handleNoteChange(index, Number(e.target.value))}
                          aria-label={`Nota da posição ${index + 1}`}
                        >
                          {SELECTABLE_VOCAL_NOTES.map((opt) => (
                            <option key={opt.midi} value={opt.midi}>
                              {opt.label}
                            </option>
                          ))}
                        </select>
                      </div>

                      <div className="vocal-duration-select-wrap">
                        <select
                          className="vocal-duration-select"
                          value={item.duration}
                          onChange={(e) => handleDurationChange(index, Number(e.target.value))}
                          aria-label={`Duração da nota ${index + 1}`}
                        >
                          {COMMON_DURATIONS.map((dur) => (
                            <option key={dur.value} value={dur.value}>
                              {dur.label}
                            </option>
                          ))}
                        </select>
                      </div>

                      <div className="vocal-note-order-btns">
                        <button
                          type="button"
                          className="vocal-order-btn"
                          disabled={index === 0}
                          onClick={() => handleMoveNote(index, 'up')}
                          title="Mover para cima"
                          aria-label={`Mover nota ${index + 1} para cima`}
                        >
                          <ArrowUp size={13} aria-hidden="true" />
                        </button>
                        <button
                          type="button"
                          className="vocal-order-btn"
                          disabled={index === notes.length - 1}
                          onClick={() => handleMoveNote(index, 'down')}
                          title="Mover para baixo"
                          aria-label={`Mover nota ${index + 1} para baixo`}
                        >
                          <ArrowDown size={13} aria-hidden="true" />
                        </button>
                      </div>

                      <button
                        type="button"
                        className="vocal-note-remove-btn"
                        onClick={() => handleRemoveNote(index)}
                        title="Remover nota"
                        aria-label={`Remover nota ${index + 1}`}
                        disabled={notes.length <= 1}
                      >
                        <Trash2 size={14} aria-hidden="true" />
                      </button>
                    </div>
                  );
                })}
              </div>
            </div>
          </div>

          <div className="vocal-modal-footer">
            <button
              type="button"
              className="btn btn-secondary"
              onClick={() => {
                stopPreview();
                onClose();
              }}
              disabled={saving}
            >
              Cancelar
            </button>
            <button
              type="submit"
              className="btn btn-primary"
              disabled={saving}
            >
              {saving ? 'Salvando…' : initialExercise ? 'Salvar alterações' : 'Criar exercício'}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}
