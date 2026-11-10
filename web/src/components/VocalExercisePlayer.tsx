import { useEffect, useRef, useState } from 'react';
import { Link } from 'react-router-dom';
import { ArrowLeft, Play, Pause, Square, Music2, Activity, Sliders, Volume2, WifiOff, AlertCircle } from 'lucide-react';
import { VOCAL_EXERCISES } from '../vocal-exercises';
import { SampledPiano, type MusicalRenderer } from '../audio/sampled-piano';
import '../styles/vocal-exercise.css';

export function buildExerciseTimeline(notes: number[], durations: number[], bpm: number, transpose: number, startAt: number) {
  if (notes.length === 0 || notes.length !== durations.length || !Number.isFinite(bpm) || bpm < 40 || bpm > 180 || !Number.isInteger(transpose) || !Number.isFinite(startAt)) {
    throw new RangeError('Invalid vocal exercise timeline configuration.');
  }
  if (notes.some((note) => !Number.isInteger(note) || note < 0 || note > 127) || durations.some((duration) => !Number.isFinite(duration) || duration <= 0)) {
    throw new RangeError('Invalid MIDI note or quarter-note duration.');
  }
  let beat = 0;
  return notes.map((midi, index) => {
    const event = { midi: midi + transpose, startAt: startAt + beat * 60 / bpm, durationSeconds: durations[index] * 60 / bpm * 0.82 };
    beat += durations[index];
    return event;
  });
}

export function buildProgressionTimeline(notes: number[], durations: number[], bpm: number, startAt: number, direction: -1 | 1, minTranspose: number, maxTranspose: number) {
  if (!Number.isInteger(minTranspose) || !Number.isInteger(maxTranspose) || minTranspose > maxTranspose || (direction !== -1 && direction !== 1)) {
    throw new RangeError('Invalid vocal exercise progression range.');
  }
  const beatsPerPhrase = durations.reduce((sum, value) => sum + value, 0) + 1;
  const transpose = direction > 0 ? minTranspose : maxTranspose;
  const count = maxTranspose - minTranspose + 1;
  return Array.from({ length: Math.max(1, count) }, (_, repetition) => {
    const step = transpose + repetition * direction;
    return buildExerciseTimeline(notes, durations, bpm, step, startAt + repetition * beatsPerPhrase * 60 / bpm);
  }).flat();
}

export function VocalExercisePlayer() {
  const [exerciseId, setExerciseId] = useState(VOCAL_EXERCISES[0].id);
  const [bpm, setBpm] = useState(80);
  const [metronomeEnabled, setMetronomeEnabled] = useState(true);
  const [tessituraMin, setTessituraMin] = useState(48);
  const [tessituraMax, setTessituraMax] = useState(84);
  const [progressionDirection, setProgressionDirection] = useState<-1 | 1>(1);
  const [playing, setPlaying] = useState(false);
  const [loading, setLoading] = useState(false);
  const [paused, setPaused] = useState(false);
  const [currentMidi, setCurrentMidi] = useState<number | null>(null);
  const [error, setError] = useState('');
  const timer = useRef<number | undefined>(undefined);
  const context = useRef<AudioContext | null>(null);
  const generation = useRef(0);
  const oscillators = useRef<OscillatorNode[]>([]);
  const renderer = useRef<MusicalRenderer | null>(null);
  const pauseBusy = useRef(false);
  const frame = useRef<number | undefined>(undefined);
  const pauseRequested = useRef(false);
  const exercise = VOCAL_EXERCISES.find((item) => item.id === exerciseId)!;
  const minTranspose = Math.max(exercise.minTranspose, tessituraMin - Math.min(...exercise.notes));
  const maxTranspose = Math.min(exercise.maxTranspose, tessituraMax - Math.max(...exercise.notes));

  useEffect(() => {
    const onVisibilityChange = () => { if (document.visibilityState !== 'visible') stop(); };
    document.addEventListener('visibilitychange', onVisibilityChange);
    return () => {
      generation.current += 1;
      if (frame.current !== undefined) cancelAnimationFrame(frame.current);
      window.clearTimeout(timer.current);
      renderer.current?.stop();
      oscillators.current.forEach((oscillator) => { try { oscillator.stop((context.current?.currentTime ?? 0) + 0.02); } catch { /* already stopped */ } });
      document.removeEventListener('visibilitychange', onVisibilityChange);
      const audio = context.current;
      if (audio) {
        const fade = audio.state === 'running' && renderer.current ? renderer.current.fadeOut() : Promise.resolve();
        void fade.catch(() => undefined).then(() => audio.close()).catch(() => undefined);
      }
    };
  }, []);

  const stop = () => {
    generation.current += 1;
    if (frame.current !== undefined) cancelAnimationFrame(frame.current);
    pauseRequested.current = false;
    window.clearTimeout(timer.current);
    renderer.current?.stop();
    oscillators.current.forEach((oscillator) => { try { oscillator.stop((context.current?.currentTime ?? 0) + 0.02); } catch { /* already stopped */ } });
    oscillators.current = [];
    setPlaying(false);
    setLoading(false);
    pauseBusy.current = false;
    setPaused(false);
    setCurrentMidi(null);
  };

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
      if (run === generation.current) { stop(); setError('Não foi possível pausar ou retomar o áudio.'); }
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
      audio.onstatechange = () => { if (audio.state === 'suspended' && !pauseRequested.current && generation.current === run) stop(); };
      pauseRequested.current = true;
      await audio.resume();
      if (run !== generation.current) return;
      pauseRequested.current = false;
      const session = new SampledPiano(audio);
      renderer.current = session;
      await session.load();
      if (run !== generation.current) { session.stop(); return; }
      setLoading(false);
      setPlaying(true);
      const bpmAtStart = bpm;
      const startAt = audio.currentTime + 0.12;
      if (minTranspose > maxTranspose) throw new Error('Exercise does not fit the selected MIDI tessitura.');
      const timeline = buildProgressionTimeline(exercise.notes, exercise.noteDurations, bpmAtStart, startAt, progressionDirection, minTranspose, maxTranspose);
      timeline.forEach(({ midi, startAt: noteAt, durationSeconds }) => {
        session.noteOn(midi, noteAt, durationSeconds);
      });
      const phraseBeats = exercise.noteDurations.reduce((sum, duration) => sum + duration, 0);
      const repetitions = maxTranspose - minTranspose + 1;
      const totalBeats = repetitions * phraseBeats + Math.max(0, repetitions - 1);
      if (metronomeEnabled) for (let beat = 0; beat < totalBeats; beat += 1) {
        const now = startAt + beat * 60 / bpmAtStart;
        const clickOsc = audio.createOscillator();
        const clickGain = audio.createGain();
        clickOsc.frequency.value = beat % 4 === 0 ? 1200 : 850;
        clickGain.gain.setValueAtTime(0, now);
        clickGain.gain.linearRampToValueAtTime(0.07, now + 0.001);
        clickGain.gain.exponentialRampToValueAtTime(0.0001, now + 0.035);
        clickOsc.connect(clickGain).connect(session.output);
        clickOsc.start(now);
        clickOsc.stop(now + 0.04);
        oscillators.current.push(clickOsc);
      }
      const endsAt = Math.max(startAt + totalBeats * 60 / bpmAtStart, ...timeline.map((event) => event.startAt + event.durationSeconds + 0.6));
      const update = () => {
        if (run !== generation.current) return;
        if (audio.currentTime >= endsAt) { stop(); return; }
        const note = timeline.find((event) => audio.currentTime >= event.startAt && audio.currentTime < event.startAt + event.durationSeconds);
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

  const statusLabel = loading ? 'Carregando piano acústico…' : paused ? 'Pausado' : currentMidi === null ? (playing ? 'Pausa musical' : 'Pronto para começar.') : `Nota atual: ${midiLabel(currentMidi)} · MIDI ${currentMidi}`;

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
            Exercícios originais com andamento e metrônomo opcional. A progressão percorre toda a faixa válida em semitons, com uma semínima de pausa entre repetições. Disponível offline após primeiro acesso online. Piano acústico gravado: FreePats Upright KW.
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
          <div className={`vocal-monitor-status-pill ${loading ? 'is-loading' : playing ? (paused ? 'is-paused' : 'is-playing') : ''}`}>
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
              <span className="vocal-active-midi-badge">MIDI {currentMidi}</span>
            </div>
          ) : (
            <div className="vocal-note-idle-box">
              <Activity size={32} className="vocal-idle-icon" aria-hidden="true" />
              <span className="vocal-idle-text">
                {loading ? 'Carregando piano acústico…' : paused ? 'Reprodução pausada' : playing ? 'Pausa musical' : 'Toque em "Tocar progressão" para iniciar'}
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
        </div>
      </div>

      {/* Alerts */}
      {minTranspose > maxTranspose && (
        <div role="alert" className="vocal-alert-banner is-warning">
          <AlertCircle size={20} aria-hidden="true" />
          <span>Este exercício não cabe na tessitura selecionada. Ajuste os limites de MIDI.</span>
        </div>
      )}
      {error && (
        <div role="alert" className="vocal-alert-banner is-danger">
          <AlertCircle size={20} aria-hidden="true" />
          <span>{error}</span>
          <button type="button" disabled={minTranspose > maxTranspose} onClick={() => void start()}>
            Tentar novamente
          </button>
        </div>
      )}

      {/* Settings Grid */}
      <div className="vocal-settings-grid">
        {/* Card 1: Exercício */}
        <div className="vocal-card">
          <h2 className="vocal-card-title">
            <Music2 size={18} className="vocal-card-icon" aria-hidden="true" />
            Padrão Melódico
          </h2>
          <label className="vocal-field">
            <span className="vocal-field-label">Exercício</span>
            <select
              className="vocal-select"
              value={exerciseId}
              disabled={playing || loading}
              onChange={(event) => { stop(); setExerciseId(event.target.value); }}
            >
              {VOCAL_EXERCISES.map((item) => (
                <option key={item.id} value={item.id}>
                  {item.title}
                </option>
              ))}
            </select>
          </label>
          <div className="vocal-desc-box">
            {exercise.description}
          </div>
        </div>

        {/* Card 2: Andamento & Metrônomo */}
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

        {/* Card 3: Tessitura Vocal */}
        <div className="vocal-card">
          <h2 className="vocal-card-title">
            <Volume2 size={18} className="vocal-card-icon" aria-hidden="true" />
            Extensão Vocal
          </h2>
          <fieldset disabled={playing || loading} className="vocal-fieldset">
            <legend className="vocal-legend">Tessitura vocal (notas MIDI)</legend>
            <div className="vocal-tessitura-grid">
              <div className="vocal-midi-field">
                <div className="vocal-midi-field-top">
                  <span className="vocal-field-label">Mais grave</span>
                  <span className="vocal-midi-note-badge">{midiLabel(tessituraMin)}</span>
                </div>
                <input
                  aria-label="Nota MIDI mais grave"
                  type="number"
                  min="0"
                  max={tessituraMax - 1}
                  value={tessituraMin}
                  className="vocal-midi-input"
                  onChange={(event) => setTessituraMin(Math.min(tessituraMax - 1, clampMidi(Number(event.target.value))))}
                />
              </div>
              <div className="vocal-midi-field">
                <div className="vocal-midi-field-top">
                  <span className="vocal-field-label">Mais aguda</span>
                  <span className="vocal-midi-note-badge">{midiLabel(tessituraMax)}</span>
                </div>
                <input
                  aria-label="Nota MIDI mais aguda"
                  type="number"
                  min={tessituraMin + 1}
                  max="127"
                  value={tessituraMax}
                  className="vocal-midi-input"
                  onChange={(event) => setTessituraMax(Math.max(tessituraMin + 1, clampMidi(Number(event.target.value))))}
                />
              </div>
            </div>
          </fieldset>
          <div className="vocal-bpm-presets">
            <button
              type="button"
              disabled={playing || loading}
              className={`vocal-preset-chip ${tessituraMin === 48 && tessituraMax === 72 ? 'active' : ''}`}
              onClick={() => { setTessituraMin(48); setTessituraMax(72); }}
            >
              Voz Grave (C2–C4)
            </button>
            <button
              type="button"
              disabled={playing || loading}
              className={`vocal-preset-chip ${tessituraMin === 57 && tessituraMax === 84 ? 'active' : ''}`}
              onClick={() => { setTessituraMin(57); setTessituraMax(84); }}
            >
              Voz Aguda (A3–C5)
            </button>
            <button
              type="button"
              disabled={playing || loading}
              className={`vocal-preset-chip ${tessituraMin === 48 && tessituraMax === 84 ? 'active' : ''}`}
              onClick={() => { setTessituraMin(48); setTessituraMax(84); }}
            >
              Padrão (C2–C5)
            </button>
          </div>
        </div>

        {/* Card 4: Direção da Progressão */}
        <div className="vocal-card">
          <h2 className="vocal-card-title">
            <Activity size={18} className="vocal-card-icon" aria-hidden="true" />
            Direção da Progressão
          </h2>
          <label className="vocal-field">
            <span className="vocal-field-label">Direção da progressão</span>
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
            A progressão modulará semitom a semitom com pausa de 1 tempo entre cada repetição.
          </div>
        </div>
      </div>
    </section>
  );
}

function midiLabel(midi: number) {
  return `${['Dó', 'Dó♯', 'Ré', 'Ré♯', 'Mi', 'Fá', 'Fá♯', 'Sol', 'Sol♯', 'Lá', 'Lá♯', 'Si'][midi % 12]}${Math.floor(midi / 12) - 1}`;
}

function clampMidi(value: number) {
  if (!Number.isFinite(value)) return 60;
  return Math.max(0, Math.min(127, Math.round(value)));
}
