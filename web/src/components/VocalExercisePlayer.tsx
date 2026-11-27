import { useEffect, useRef, useState } from 'react';
import { Link } from 'react-router-dom';
import { VOCAL_EXERCISES } from '../vocal-exercises';
import { SampledPiano, type MusicalRenderer } from '../audio/sampled-piano';

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

  return <section aria-labelledby="vocal-title" style={{ maxWidth: 920, margin: '0 auto', padding: 24 }}>
    <Link to="/" style={{ display: 'inline-flex', alignItems: 'center', minHeight: 44 }}>Voltar ao LouvAIO</Link>
    <h1 id="vocal-title">Exercícios vocais</h1>
    <p>Exercícios originais com andamento e metrônomo opcional. A progressão percorre toda a faixa válida em semitons, com uma semínima de pausa entre repetições. Disponível offline após primeiro acesso online. Piano acústico gravado: FreePats Upright KW.</p>
    <label style={{ display: 'grid', gap: 8, margin: '20px 0' }}>Exercício
      <select value={exerciseId} disabled={playing || loading} onChange={(event) => { stop(); setExerciseId(event.target.value); }}>
        {VOCAL_EXERCISES.map((item) => <option key={item.id} value={item.id}>{item.title}</option>)}
      </select>
    </label>
    <p>{exercise.description}</p>
    <label style={{ display: 'grid', gap: 8, margin: '20px 0' }}>Andamento: {bpm} BPM
      <input aria-label="Andamento BPM" disabled={playing || loading} type="range" min="40" max="180" value={bpm} onChange={(event) => setBpm(Number(event.target.value))} />
    </label>
    <label style={{ display: 'flex', alignItems: 'center', gap: 10, minHeight: 44 }}>
      <input aria-label="Ativar metrônomo" type="checkbox" disabled={playing || loading} checked={metronomeEnabled} onChange={(event) => setMetronomeEnabled(event.target.checked)} />
      Usar metrônomo
    </label>
    <fieldset disabled={playing || loading} style={{ display: 'flex', gap: 16, flexWrap: 'wrap', margin: '20px 0' }}>
      <legend>Tessitura vocal (notas MIDI)</legend>
      <label>Mais grave
        <input aria-label="Nota MIDI mais grave" type="number" min="0" max={tessituraMax - 1} value={tessituraMin} onChange={(event) => setTessituraMin(Math.min(tessituraMax - 1, clampMidi(Number(event.target.value))))} />
      </label>
      <label>Mais aguda
        <input aria-label="Nota MIDI mais aguda" type="number" min={tessituraMin + 1} max="127" value={tessituraMax} onChange={(event) => setTessituraMax(Math.max(tessituraMin + 1, clampMidi(Number(event.target.value))))} />
      </label>
    </fieldset>
    <label style={{ display: 'grid', gap: 8, margin: '20px 0' }}>Direção da progressão
      <select aria-label="Direção da progressão" disabled={playing || loading} value={progressionDirection} onChange={(event) => setProgressionDirection(Number(event.target.value) as -1 | 1)}>
        <option value={1}>Subir semitom a semitom</option><option value={-1}>Descer semitom a semitom</option>
      </select>
    </label>
    <div style={{ display: 'flex', gap: 12, flexWrap: 'wrap' }}>
      <button type="button" disabled={playing || loading || minTranspose > maxTranspose} onClick={() => void start()} style={{ minHeight: 44 }}>{loading ? 'Carregando piano…' : playing ? 'Reproduzindo…' : 'Tocar progressão'}</button>
      <button type="button" disabled={!playing && !loading} onClick={stop} style={{ minHeight: 44 }}>Parar</button>
      <button type="button" disabled={!playing} onClick={() => void togglePause()} style={{ minHeight: 44 }}>{paused ? 'Retomar' : 'Pausar'}</button>
    </div>
    {minTranspose > maxTranspose && <p role="alert">Este exercício não cabe na tessitura selecionada. Ajuste os limites de MIDI.</p>}
    {error && <p role="alert">{error} <button type="button" disabled={minTranspose > maxTranspose} onClick={() => void start()}>Tentar novamente</button></p>}
    <p role="status">{loading ? 'Carregando piano acústico…' : paused ? 'Pausado' : currentMidi === null ? (playing ? 'Pausa musical' : 'Pronto para começar.') : `Nota atual: ${midiLabel(currentMidi)} · MIDI ${currentMidi}`}</p>
  </section>;
}

function midiLabel(midi: number) {
  return `${['Dó', 'Dó♯', 'Ré', 'Ré♯', 'Mi', 'Fá', 'Fá♯', 'Sol', 'Sol♯', 'Lá', 'Lá♯', 'Si'][midi % 12]}${Math.floor(midi / 12) - 1}`;
}

function clampMidi(value: number) {
  if (!Number.isFinite(value)) return 60;
  return Math.max(0, Math.min(127, Math.round(value)));
}
