import { useEffect, useRef } from 'react';
import { midiLabel, SUPPORTED_PIANO_MIN_MIDI, SUPPORTED_PIANO_MAX_MIDI } from '../../vocal-exercises';

interface PianoKeyboardProps {
  currentMidi: number | null;
  tessituraMin?: number;
  tessituraMax?: number;
}

interface KeyDefinition {
  midi: number;
  label: string;
  isBlack: boolean;
  whiteIndex: number;
}

export function PianoKeyboard({ currentMidi, tessituraMin, tessituraMax }: PianoKeyboardProps) {
  const containerRef = useRef<HTMLDivElement>(null);
  const activeKeyRef = useRef<HTMLDivElement | null>(null);

  // Build key definitions from min supported (48) to max supported (88)
  const keys: KeyDefinition[] = [];
  let whiteCount = 0;

  for (let midi = SUPPORTED_PIANO_MIN_MIDI; midi <= SUPPORTED_PIANO_MAX_MIDI; midi++) {
    const semitone = midi % 12;
    const isBlack = [1, 3, 6, 8, 10].includes(semitone);
    keys.push({
      midi,
      label: midiLabel(midi),
      isBlack,
      whiteIndex: isBlack ? whiteCount - 1 : whiteCount++,
    });
  }

  const totalWhiteKeys = whiteCount;

  // Auto-scroll to keep active note or tessitura visible
  useEffect(() => {
    if (activeKeyRef.current && containerRef.current) {
      activeKeyRef.current.scrollIntoView({
        behavior: 'smooth',
        block: 'nearest',
        inline: 'center',
      });
    }
  }, [currentMidi]);

  // White key width: 34px desktop, responsive
  const whiteKeyWidth = 34;
  const blackKeyWidth = 22;
  const keyboardWidth = totalWhiteKeys * whiteKeyWidth;

  return (
    <div className="vocal-keyboard-wrapper" ref={containerRef}>
      <div
        className="vocal-keyboard"
        role="region"
        aria-label="Teclado de piano"
        style={{ width: `${keyboardWidth}px`, position: 'relative', height: '140px' }}
      >
        {/* White keys */}
        {keys
          .filter((k) => !k.isBlack)
          .map((k) => {
            const isActive = currentMidi === k.midi;
            const inTessitura =
              (tessituraMin === undefined || k.midi >= tessituraMin) &&
              (tessituraMax === undefined || k.midi <= tessituraMax);

            return (
              <div
                key={k.midi}
                ref={isActive ? activeKeyRef : null}
                className={`piano-key white-key ${isActive ? 'is-active-playing' : ''} ${
                  inTessitura ? 'in-tessitura' : 'out-tessitura'
                }`}
                style={{
                  left: `${k.whiteIndex * whiteKeyWidth}px`,
                  width: `${whiteKeyWidth}px`,
                }}
                aria-label={k.label}
                data-active={isActive}
              >
                <span className="piano-key-label">{k.label}</span>
              </div>
            );
          })}

        {/* Black keys */}
        {keys
          .filter((k) => k.isBlack)
          .map((k) => {
            const isActive = currentMidi === k.midi;
            const inTessitura =
              (tessituraMin === undefined || k.midi >= tessituraMin) &&
              (tessituraMax === undefined || k.midi <= tessituraMax);
            const leftPosition = (k.whiteIndex + 1) * whiteKeyWidth - blackKeyWidth / 2;

            return (
              <div
                key={k.midi}
                ref={isActive ? activeKeyRef : null}
                className={`piano-key black-key ${isActive ? 'is-active-playing' : ''} ${
                  inTessitura ? 'in-tessitura' : 'out-tessitura'
                }`}
                style={{
                  left: `${leftPosition}px`,
                  width: `${blackKeyWidth}px`,
                }}
                aria-label={k.label}
                data-active={isActive}
              >
                <span className="piano-key-label black-label">{k.label}</span>
              </div>
            );
          })}
      </div>
    </div>
  );
}
