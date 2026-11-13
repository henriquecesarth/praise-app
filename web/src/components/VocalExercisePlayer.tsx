import { useEffect, useRef, useState, useCallback } from 'react';
import { Link } from 'react-router-dom';
import {
  ArrowLeft,
  Play,
  Pause,
  Square,
  Music2,
  Activity,
  Sliders,
  Volume2,
  WifiOff,
  AlertCircle,
  Save,
  Check,
  Piano as PianoIcon,
} from 'lucide-react';
import {
  VOCAL_EXERCISES,
  VOCAL_PRESETS,
  SELECTABLE_VOCAL_NOTES,
  midiLabel,
  type VocalExercise,
} from '../vocal-exercises';
import { SampledPiano, type MusicalRenderer } from '../audio/sampled-piano';
import { api } from '../api';
import { PianoKeyboard } from './vocal/PianoKeyboard';
import { ExerciseLibrary } from './vocal/ExerciseLibrary';
import { CustomExerciseModal } from './vocal/CustomExerciseModal';
import { ConfirmDialog } from './ui/ConfirmDialog';
import '../styles/vocal-exercise.css';

export function buildExerciseTimeline(
  notes: number[],
  durations: number[],
  bpm: number,
  transpose: number,
  startAt: number
) {
  if (
    notes.length === 0 ||
    notes.length !== durations.length ||
    !Number.isFinite(bpm) ||
    bpm < 40 ||
    bpm > 180 ||
    !Number.isInteger(transpose) ||
    !Number.isFinite(startAt)
  ) {
    throw new RangeError('Invalid vocal exercise timeline configuration.');
  }
  if (
    notes.some((note) => !Number.isInteger(note) || note < 0 || note > 127) ||
    durations.some((duration) => !Number.isFinite(duration) || duration <= 0)
  ) {
    throw new RangeError('Invalid MIDI note or quarter-note duration.');
  }
  let beat = 0;
  return notes.map((midi, index) => {
    const event = {
      midi: midi + transpose,
      startAt: startAt + (beat * 60) / bpm,
      durationSeconds: (durations[index] * 60) / bpm * 0.82,
    };
    beat += durations[index];
    return event;
  });
}

export function buildProgressionTimeline(
  notes: number[],
  durations: number[],
  bpm: number,
  startAt: number,
  direction: -1 | 1,
  minTranspose: number,
  maxTranspose: number
) {
  if (
    !Number.isInteger(minTranspose) ||
    !Number.isInteger(maxTranspose) ||
    minTranspose > maxTranspose ||
    (direction !== -1 && direction !== 1)
  ) {
    throw new RangeError('Invalid vocal exercise progression range.');
  }
  const beatsPerPhrase = durations.reduce((sum, value) => sum + value, 0) + 1;
  const transpose = direction > 0 ? minTranspose : maxTranspose;
  const count = maxTranspose - minTranspose + 1;
  return Array.from({ length: Math.max(1, count) }, (_, repetition) => {
    const step = transpose + repetition * direction;
    return buildExerciseTimeline(
      notes,
      durations,
      bpm,
      step,
      startAt + (repetition * beatsPerPhrase * 60) / bpm
    );
  }).flat();
}

export function VocalExercisePlayer() {
  const [exerciseId, setExerciseId] = useState(VOCAL_EXERCISES[0].id);
  const [bpm, setBpm] = useState(80);
  const [metronomeEnabled, setMetronomeEnabled] = useState(true);
  const [tessituraMin, setTessituraMin] = useState(48); // Dó3
  const [tessituraMax, setTessituraMax] = useState(84); // Dó6
  const [progressionDirection, setProgressionDirection] = useState<-1 | 1>(1);
  const [playing, setPlaying] = useState(false);
  const [loading, setLoading] = useState(false);
  const [paused, setPaused] = useState(false);
  const [currentMidi, setCurrentMidi] = useState<number | null>(null);
  const [error, setError] = useState('');

  // Keyboard toggle
  const [showKeyboard, setShowKeyboard] = useState(false);

  // Range saving feedback
  const [savingRange, setSavingRange] = useState(false);
  const [rangeFeedback, setRangeFeedback] = useState<{ message: string; type: 'success' | 'error' } | null>(null);

  // Custom exercises state & modal
  const [customExercises, setCustomExercises] = useState<VocalExercise[]>([]);
  const [customLoadError, setCustomLoadError] = useState<string | null>(null);
  const [loadingCustomExercises, setLoadingCustomExercises] = useState(false);
  const [modalOpen, setModalOpen] = useState(false);
  const [editingExercise, setEditingExercise] = useState<VocalExercise | null>(null);
  const [pendingDeleteExercise, setPendingDeleteExercise] = useState<VocalExercise | null>(null);
  const [deletingExercise, setDeletingExercise] = useState(false);

  const timer = useRef<number | undefined>(undefined);
  const rangeTimerRef = useRef<number | undefined>(undefined);
  const context = useRef<AudioContext | null>(null);
  const generation = useRef(0);
  const oscillators = useRef<Set<OscillatorNode>>(new Set());
  const renderer = useRef<MusicalRenderer | null>(null);
  const pauseBusy = useRef(false);
  const frame = useRef<number | undefined>(undefined);
  const pauseRequested = useRef(false);
  const isMountedRef = useRef(true);

  const loadCustomExercises = useCallback(async (surfaceError = true) => {
    setLoadingCustomExercises(true);
    try {
      const custom = await api.getCustomVocalExercises();
      if (!isMountedRef.current) return;
      setCustomExercises(custom);
      setCustomLoadError(null);
    } catch (err: any) {
      if (!isMountedRef.current) return;
      if (surfaceError) {
        setCustomLoadError(err?.message || 'Não foi possível carregar os exercícios personalizados.');
      }
    } finally {
      if (isMountedRef.current) {
        setLoadingCustomExercises(false);
      }
    }
  }, []);

  // Load custom exercises and user preferences on mount
  useEffect(() => {
    isMountedRef.current = true;

    async function loadInitialData() {
      let hasAuthenticatedUser = false;
      try {
        const user = await api.getMe().catch(() => null);
        if (user) {
          hasAuthenticatedUser = true;
        }
        if (isMountedRef.current && user?.preferences) {
          if (typeof user.preferences.vocalMinMidi === 'number') {
            setTessituraMin(user.preferences.vocalMinMidi);
          }
          if (typeof user.preferences.vocalMaxMidi === 'number') {
            setTessituraMax(user.preferences.vocalMaxMidi);
          }
        }
      } catch {
        /* ignore preference load failure */
      }

      await loadCustomExercises(hasAuthenticatedUser);
    }

    void loadInitialData();

    return () => {
      isMountedRef.current = false;
    };
  }, [loadCustomExercises]);

  const allExercises: VocalExercise[] = [...VOCAL_EXERCISES, ...customExercises];
  const exercise = allExercises.find((item) => item.id === exerciseId) || VOCAL_EXERCISES[0];
  const minTranspose = Math.max(exercise.minTranspose, tessituraMin - Math.min(...exercise.notes));
  const maxTranspose = Math.min(exercise.maxTranspose, tessituraMax - Math.max(...exercise.notes));

  useEffect(() => {
    const onVisibilityChange = () => {
      if (document.visibilityState !== 'visible') stop();
    };
    document.addEventListener('visibilitychange', onVisibilityChange);
    return () => {
      generation.current += 1;
      if (frame.current !== undefined) cancelAnimationFrame(frame.current);
      window.clearTimeout(timer.current);
      window.clearTimeout(rangeTimerRef.current);
      renderer.current?.stop();
      oscillators.current.forEach((oscillator) => {
        try {
          oscillator.stop((context.current?.currentTime ?? 0) + 0.02);
        } catch {
          /* already stopped */
        }
      });
      oscillators.current.clear();
      document.removeEventListener('visibilitychange', onVisibilityChange);
      const audio = context.current;
      if (audio) {
        const fade = audio.state === 'running' && renderer.current ? renderer.current.fadeOut() : Promise.resolve();
        void fade.catch(() => undefined).then(() => audio.close()).catch(() => undefined);
      }
    };
  }, []);

  const stop = useCallback(() => {
    generation.current += 1;
    if (frame.current !== undefined) cancelAnimationFrame(frame.current);
    pauseRequested.current = false;
    window.clearTimeout(timer.current);
    renderer.current?.stop();
    oscillators.current.forEach((oscillator) => {
      try {
        oscillator.stop((context.current?.currentTime ?? 0) + 0.02);
      } catch {
        /* already stopped */
      }
    });
    oscillators.current.clear();
    setPlaying(false);
    setLoading(false);
    pauseBusy.current = false;
    setPaused(false);
    setCurrentMidi(null);
  }, []);

  const togglePause = async () => {
    const audio = context.current;
    if (!audio || !renderer.current || pauseBusy.current) return;
    pauseBusy.current = true;
    const session = renderer.current;
    const run = generation.current;
    try {
      if (audio.state === 'running') {
        pauseRequested.current = true;
        await session.fadeOut();
        if (run !== generation.current) return;
        await audio.suspend();
        if (run === generation.current) setPaused(true);
      } else {
        await audio.resume();
        if (run === generation.current) {
          pauseRequested.current = false;
          session.fadeIn();
          setPaused(false);
        }
      }
    } catch {
      if (run === generation.current) {
        stop();
        setError('Não foi possível pausar ou retomar o áudio.');
      }
    } finally {
      if (run === generation.current) pauseBusy.current = false;
    }
  };

  const start = async () => {
    stop();
    const run = generation.current;
    setError('');
    setLoading(true);
    try {
      const audio = context.current && context.current.state !== 'closed' ? context.current : new AudioContext();
      context.current = audio;
      audio.onstatechange = () => {
        if (audio.state === 'suspended' && !pauseRequested.current && generation.current === run) stop();
      };
      pauseRequested.current = true;
      await audio.resume();
      if (run !== generation.current) return;
      pauseRequested.current = false;
      const session = new SampledPiano(audio);
      renderer.current = session;
      await session.load();
      if (run !== generation.current) {
        session.stop();
        return;
      }
      setLoading(false);
      setPlaying(true);
      const bpmAtStart = bpm;
      const startAt = audio.currentTime + 0.12;
      if (minTranspose > maxTranspose) throw new Error('Exercise does not fit the selected MIDI tessitura.');
      const timeline = buildProgressionTimeline(
        exercise.notes,
        exercise.noteDurations,
        bpmAtStart,
        startAt,
        progressionDirection,
        minTranspose,
        maxTranspose
      );
      timeline.forEach(({ midi, startAt: noteAt, durationSeconds }) => {
        session.noteOn(midi, noteAt, durationSeconds);
      });
      const phraseBeats = exercise.noteDurations.reduce((sum, duration) => sum + duration, 0);
      const repetitions = maxTranspose - minTranspose + 1;
      const totalBeats = repetitions * phraseBeats + Math.max(0, repetitions - 1);
      if (metronomeEnabled) {
        for (let beat = 0; beat < totalBeats; beat += 1) {
          const now = startAt + (beat * 60) / bpmAtStart;
          const clickOsc = audio.createOscillator();
          const clickGain = audio.createGain();
          clickOsc.frequency.value = beat % 4 === 0 ? 1200 : 850;
          clickGain.gain.setValueAtTime(0, now);
          clickGain.gain.linearRampToValueAtTime(0.07, now + 0.001);
          clickGain.gain.exponentialRampToValueAtTime(0.0001, now + 0.035);
          clickOsc.connect(clickGain).connect(session.output);
          clickOsc.onended = () => {
            oscillators.current.delete(clickOsc);
          };
          clickOsc.start(now);
          clickOsc.stop(now + 0.04);
          oscillators.current.add(clickOsc);
        }
      }
      const endsAt = Math.max(
        startAt + (totalBeats * 60) / bpmAtStart,
        ...timeline.map((event) => event.startAt + event.durationSeconds + 0.6)
      );
      const update = () => {
        if (run !== generation.current) return;
        if (audio.currentTime >= endsAt) {
          stop();
          return;
        }
        const note = timeline.find(
          (event) => audio.currentTime >= event.startAt && audio.currentTime < event.startAt + event.durationSeconds
        );
        setCurrentMidi(note?.midi ?? null);
        frame.current = requestAnimationFrame(update);
      };
      frame.current = requestAnimationFrame(update);
    } catch {
      if (run !== generation.current) return;
      stop();
      setError('Não foi possível carregar o piano. Conecte-se uma vez para guardar os samples e tente novamente.');
    }
  };

  const handleSaveRange = async () => {
    setSavingRange(true);
    setRangeFeedback(null);
    try {
      await api.updateUserPreferences({
        vocalMinMidi: tessituraMin,
        vocalMaxMidi: tessituraMax,
      });
      setRangeFeedback({
        message: 'Extensão vocal salva com sucesso na sua conta!',
        type: 'success',
      });
      window.clearTimeout(rangeTimerRef.current);
      rangeTimerRef.current = window.setTimeout(() => setRangeFeedback(null), 4000);
    } catch (err: any) {
      setRangeFeedback({
        message: err?.message || 'Erro ao salvar a extensão vocal.',
        type: 'error',
      });
    } finally {
      setSavingRange(false);
    }
  };

  const handleCreateExercise = () => {
    stop();
    setEditingExercise(null);
    setModalOpen(true);
  };

  const handleEditExercise = (ex: VocalExercise) => {
    stop();
    setEditingExercise(ex);
    setModalOpen(true);
  };

  const handleDuplicateExercise = (ex: VocalExercise) => {
    stop();
    setEditingExercise({
      ...ex,
      id: '',
      title: `${ex.title} (Cópia)`,
      isCustom: true,
    });
    setModalOpen(true);
  };

  const handleDeleteExercise = (ex: VocalExercise) => {
    setPendingDeleteExercise(ex);
  };

  const confirmDeleteExercise = async () => {
    if (!pendingDeleteExercise || deletingExercise) return;
    setDeletingExercise(true);
    try {
      await api.deleteCustomVocalExercise(pendingDeleteExercise.id);
      setCustomExercises((prev) => prev.filter((item) => item.id !== pendingDeleteExercise.id));
      if (exerciseId === pendingDeleteExercise.id) {
        setExerciseId(VOCAL_EXERCISES[0].id);
      }
      setPendingDeleteExercise(null);
    } catch (err: any) {
      setError(err?.message || 'Erro ao excluir o exercício personalizado.');
      setPendingDeleteExercise(null);
    } finally {
      setDeletingExercise(false);
    }
  };

  const handleSaveModalExercise = async (data: any) => {
    if (editingExercise?.id) {
      // Update
      const updated = await api.updateCustomVocalExercise(editingExercise.id, data);
      setCustomExercises((prev) => prev.map((item) => (item.id === updated.id ? updated : item)));
      setExerciseId(updated.id);
    } else {
      // Create
      const created = await api.createCustomVocalExercise(data);
      setCustomExercises((prev) => [created, ...prev]);
      setExerciseId(created.id);
    }
  };

  const statusLabel = loading
    ? 'Carregando piano acústico…'
    : paused
    ? 'Pausado'
    : currentMidi === null
    ? playing
      ? 'Pausa musical'
      : 'Pronto para começar.'
    : `Nota atual: ${midiLabel(currentMidi)}`;

  return (
    <section aria-labelledby="vocal-title" className="vocal-exercise-container">
      {/* Header & Back Navigation */}
      <header className="vocal-header">
        <Link to="/" className="vocal-back-btn">
          <ArrowLeft size={16} aria-hidden="true" />
          <span>Voltar ao LouvAIO</span>
        </Link>
        <div className="vocal-title-area">
          <h1 id="vocal-title" className="vocal-title">
            <Music2 size={28} className="vocal-title-icon" aria-hidden="true" />
            Exercícios vocais
          </h1>
          <p className="vocal-subtitle">
            Exercícios vocais interativos com piano acústico gravado, andamento ajustável, metrônomo e biblioteca completa de padrões melódicos.
          </p>
          <div className="vocal-badge-offline">
            <WifiOff size={14} aria-hidden="true" />
            <span>Suporte offline ativo · Amostras PCM gravadas</span>
          </div>
        </div>
      </header>

      {/* Monitor Display & Transport Bar */}
      <div className="vocal-monitor-card">
        <div className="vocal-monitor-header">
          <div
            className={`vocal-monitor-status-pill ${
              loading ? 'is-loading' : playing ? (paused ? 'is-paused' : 'is-playing') : ''
            }`}
          >
            {(playing || loading) && <span className="vocal-pulse-dot" aria-hidden="true" />}
            <span>{loading ? 'Carregando' : paused ? 'Em pausa' : playing ? 'Reproduzindo' : 'Aguardando início'}</span>
          </div>
          <span className="vocal-range-summary">
            {exercise.title} · {bpm} BPM
          </span>
        </div>

        <div className="vocal-monitor-display">
          {currentMidi !== null ? (
            <div className="vocal-note-active-box">
              <span className="vocal-active-note-name">{midiLabel(currentMidi)}</span>
            </div>
          ) : (
            <div className="vocal-note-idle-box">
              <Activity size={32} className="vocal-idle-icon" aria-hidden="true" />
              <span className="vocal-idle-text">
                {loading
                  ? 'Carregando piano acústico…'
                  : paused
                  ? 'Reprodução pausada'
                  : playing
                  ? 'Pausa musical'
                  : 'Toque em "Tocar progressão" para iniciar'}
              </span>
            </div>
          )}
        </div>

        {/* Live status line for screen readers & vitest assertions */}
        <p role="status" className="vocal-live-status-line">
          {statusLabel}
        </p>

        {/* Transport Toolbar */}
        <div className="vocal-transport-bar">
          <button
            type="button"
            className="btn btn-primary vocal-btn-play"
            disabled={playing || loading || minTranspose > maxTranspose}
            onClick={() => void start()}
            style={{ minHeight: 44 }}
          >
            <Play size={18} aria-hidden="true" />
            <span>{loading ? 'Carregando piano…' : playing ? 'Reproduzindo…' : 'Tocar progressão'}</span>
          </button>
          <button
            type="button"
            className="btn btn-secondary vocal-btn-pause"
            disabled={!playing}
            onClick={() => void togglePause()}
            style={{ minHeight: 44 }}
          >
            {paused ? <Play size={18} aria-hidden="true" /> : <Pause size={18} aria-hidden="true" />}
            <span>{paused ? 'Retomar' : 'Pausar'}</span>
          </button>
          <button
            type="button"
            className="btn btn-secondary vocal-btn-stop"
            disabled={!playing && !loading}
            onClick={stop}
            style={{ minHeight: 44 }}
          >
            <Square size={18} aria-hidden="true" />
            <span>Parar</span>
          </button>

          <button
            type="button"
            className={`btn btn-secondary vocal-btn-toggle-keyboard ${showKeyboard ? 'is-active' : ''}`}
            onClick={() => setShowKeyboard((prev) => !prev)}
            aria-expanded={showKeyboard}
            style={{ minHeight: 44 }}
            title="Alternar exibição do teclado musical sincronizado"
          >
            <PianoIcon size={18} aria-hidden="true" />
            <span>{showKeyboard ? 'Ocultar teclado' : 'Mostrar teclado'}</span>
          </button>
        </div>
      </div>

      {/* Piano Keyboard (Optional Display) */}
      {showKeyboard && (
        <div className="vocal-keyboard-card animate-fade-in">
          <div className="vocal-keyboard-card-header">
            <span className="vocal-keyboard-title">Teclado de acompanhamento visual</span>
            <span className="vocal-keyboard-hint">
              {currentMidi ? `Nota em execução: ${midiLabel(currentMidi)}` : 'Acompanhe as notas reproduzidas'}
            </span>
          </div>
          <PianoKeyboard
            currentMidi={currentMidi}
            tessituraMin={tessituraMin}
            tessituraMax={tessituraMax}
          />
        </div>
      )}

      {/* Alerts */}
      {minTranspose > maxTranspose && (
        <div role="alert" className="vocal-alert-banner is-warning">
          <AlertCircle size={20} aria-hidden="true" />
          <span>Este exercício não cabe na tessitura selecionada. Ajuste as notas da sua extensão vocal.</span>
        </div>
      )}
      {customLoadError && (
        <div role="alert" className="vocal-alert-banner is-warning">
          <AlertCircle size={20} aria-hidden="true" />
          <span>{customLoadError}</span>
          <button
            type="button"
            disabled={loadingCustomExercises}
            onClick={() => void loadCustomExercises(true)}
            style={{ minHeight: '44px' }}
          >
            {loadingCustomExercises ? 'Recarregando...' : 'Tentar novamente'}
          </button>
        </div>
      )}
      {error && (
        <div role="alert" className="vocal-alert-banner is-danger">
          <AlertCircle size={20} aria-hidden="true" />
          <span>{error}</span>
          <button
            type="button"
            disabled={minTranspose > maxTranspose}
            style={{ minHeight: '44px' }}
            onClick={() => void start()}
          >
            Tentar novamente
          </button>
        </div>
      )}

      {/* Library of Exercises */}
      <ExerciseLibrary
        exercises={allExercises}
        selectedExerciseId={exerciseId}
        onSelectExercise={(ex) => {
          stop();
          setExerciseId(ex.id);
        }}
        onNewExercise={handleCreateExercise}
        onEditExercise={handleEditExercise}
        onDuplicateExercise={handleDuplicateExercise}
        onDeleteExercise={handleDeleteExercise}
        disabled={playing || loading}
      />

      {/* Settings Grid */}
      <div className="vocal-settings-grid">
        {/* Card 1: Andamento & Metrônomo */}
        <div className="vocal-card">
          <h2 className="vocal-card-title">
            <Sliders size={18} className="vocal-card-icon" aria-hidden="true" />
            Tempo e Metrônomo
          </h2>
          <label className="vocal-field">
            <div className="vocal-bpm-display">
              <span className="vocal-field-label">Andamento:</span>
              <span className="vocal-bpm-val">{bpm} BPM</span>
            </div>
            <input
              aria-label="Andamento BPM"
              disabled={playing || loading}
              type="range"
              min="40"
              max="180"
              value={bpm}
              className="vocal-range-slider"
              onChange={(event) => setBpm(Number(event.target.value))}
            />
          </label>
          <div className="vocal-bpm-presets">
            {[60, 72, 80, 96, 120].map((preset) => (
              <button
                key={preset}
                type="button"
                disabled={playing || loading}
                className={`vocal-preset-chip ${bpm === preset ? 'active' : ''}`}
                onClick={() => setBpm(preset)}
              >
                {preset} BPM
              </button>
            ))}
          </div>
          <label className="vocal-checkbox-row">
            <input
              aria-label="Ativar metrônomo"
              type="checkbox"
              disabled={playing || loading}
              checked={metronomeEnabled}
              onChange={(event) => setMetronomeEnabled(event.target.checked)}
            />
            <span>Usar metrônomo (click sonoro a cada tempo)</span>
          </label>
        </div>

        {/* Card 2: Extensão Vocal (Notas Musicais) */}
        <div className="vocal-card">
          <div className="vocal-card-title-row">
            <h2 className="vocal-card-title">
              <Volume2 size={18} className="vocal-card-icon" aria-hidden="true" />
              Extensão Vocal
            </h2>
            <button
              type="button"
              className="btn btn-secondary vocal-btn-save-range"
              disabled={playing || loading || savingRange}
              onClick={handleSaveRange}
              title="Salvar esta tessitura na sua conta"
            >
              <Save size={14} aria-hidden="true" />
              <span>{savingRange ? 'Salvando…' : 'Salvar minha extensão'}</span>
            </button>
          </div>

          {rangeFeedback && (
            <div
              role="status"
              className={`vocal-range-toast ${
                rangeFeedback.type === 'success' ? 'is-success' : 'is-error'
              }`}
            >
              {rangeFeedback.type === 'success' ? (
                <Check size={14} aria-hidden="true" />
              ) : (
                <AlertCircle size={14} aria-hidden="true" />
              )}
              <span>{rangeFeedback.message}</span>
            </div>
          )}

          <fieldset disabled={playing || loading} className="vocal-fieldset">
            <legend className="vocal-legend">Limites da extensão vocal</legend>
            <div className="vocal-tessitura-grid">
              <label className="vocal-field">
                <span className="vocal-field-label">Mais grave</span>
                <select
                  aria-label="Nota mais grave"
                  value={tessituraMin}
                  className="vocal-select"
                  onChange={(e) => setTessituraMin(Number(e.target.value))}
                >
                  {SELECTABLE_VOCAL_NOTES.filter((n) => n.midi < tessituraMax).map((n) => (
                    <option key={n.midi} value={n.midi}>
                      {n.label}
                    </option>
                  ))}
                </select>
              </label>

              <label className="vocal-field">
                <span className="vocal-field-label">Mais aguda</span>
                <select
                  aria-label="Nota mais aguda"
                  value={tessituraMax}
                  className="vocal-select"
                  onChange={(e) => setTessituraMax(Number(e.target.value))}
                >
                  {SELECTABLE_VOCAL_NOTES.filter((n) => n.midi > tessituraMin).map((n) => (
                    <option key={n.midi} value={n.midi}>
                      {n.label}
                    </option>
                  ))}
                </select>
              </label>
            </div>
          </fieldset>

          <div className="vocal-bpm-presets">
            {VOCAL_PRESETS.map((preset) => (
              <button
                key={preset.id}
                type="button"
                disabled={playing || loading}
                className={`vocal-preset-chip ${
                  tessituraMin === preset.min && tessituraMax === preset.max ? 'active' : ''
                }`}
                onClick={() => {
                  setTessituraMin(preset.min);
                  setTessituraMax(preset.max);
                }}
              >
                {preset.label}
              </button>
            ))}
          </div>
        </div>

        {/* Card 3: Direção da Progressão */}
        <div className="vocal-card">
          <h2 className="vocal-card-title">
            <Activity size={18} className="vocal-card-icon" aria-hidden="true" />
            Direção da Progressão
          </h2>
          <label className="vocal-field">
            <span className="vocal-field-label">Sentido de modulação</span>
            <select
              aria-label="Direção da progressão"
              disabled={playing || loading}
              value={progressionDirection}
              className="vocal-select"
              onChange={(event) => setProgressionDirection(Number(event.target.value) as -1 | 1)}
            >
              <option value={1}>Subir semitom a semitom (Grave → Agudo)</option>
              <option value={-1}>Descer semitom a semitom (Agudo → Grave)</option>
            </select>
          </label>
          <div className="vocal-desc-box">
            A progressão transporá o exercício semitom a semitom entre as repetições, independente da direção melódica interna das notas.
          </div>
        </div>
      </div>

      {/* Custom Exercise Modal */}
      {modalOpen && (
        <CustomExerciseModal
          key={editingExercise?.id || 'new'}
          initialExercise={editingExercise}
          isOpen={modalOpen}
          onClose={() => setModalOpen(false)}
          onSave={handleSaveModalExercise}
        />
      )}

      <ConfirmDialog
        isOpen={Boolean(pendingDeleteExercise)}
        title="Excluir exercício personalizado"
        message={
          pendingDeleteExercise
            ? `Deseja realmente excluir o exercício "${pendingDeleteExercise.title}"? Esta ação não pode ser desfeita.`
            : ''
        }
        confirmLabel="Excluir"
        tone="danger"
        busy={deletingExercise}
        onConfirm={confirmDeleteExercise}
        onCancel={() => {
          if (!deletingExercise) setPendingDeleteExercise(null);
        }}
      />
    </section>
  );
}
