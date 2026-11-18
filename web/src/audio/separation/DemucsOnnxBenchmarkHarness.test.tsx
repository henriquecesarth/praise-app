import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { DemucsOnnxBenchmarkHarness } from './DemucsOnnxBenchmarkHarness';
import * as separatorMod from './demucs-onnx-separator';
import type { AudioSeparationModelDescriptor } from './demucs-onnx-separator';

describe('DemucsOnnxBenchmarkHarness (M22-A)', () => {
  it('closes Codex Finding 3: keeps run button disabled after cancel until in-flight session cleanup completes', async () => {
    const customDescriptor: AudioSeparationModelDescriptor = {
      ...separatorMod.HTDEMUCS_6S_ONNX_DESCRIPTOR,
      id: 'harness_cancel_lock_test',
      segmentSamples: 16,
      expectedModelBytes: undefined,
      expectedModelSha256: undefined,
    };

    let releasePendingSeparation: (() => void) | null = null;
    const separateSpy = vi
      .spyOn(separatorMod, 'separateStereoAudio')
      .mockImplementation(
        async () =>
          await new Promise<never>((_resolve, reject) => {
            releasePendingSeparation = () =>
              reject(
                new separatorMod.AudioSeparationError(
                  'CANCELLED',
                  'Audio separation was cancelled.'
                )
              );
          })
      );

    const wavBytes = separatorMod.encodeStereoPcm16Wav({
      sampleRate: 44100,
      left: new Float32Array(16).fill(0.1),
      right: new Float32Array(16).fill(-0.1),
    });
    const fetchSpy = vi
      .spyOn(globalThis, 'fetch')
      .mockImplementation(async () => {
        const ab = wavBytes.slice().buffer;
        return new Response(ab, {
          status: 200,
          headers: { 'Content-Type': 'audio/wav' },
        });
      });

    try {
      render(
        <DemucsOnnxBenchmarkHarness
          models={[customDescriptor]}
          initialModelUrl="/models/test.onnx"
          initialAudioUrl="/fixtures/test.wav"
        />
      );

      const runBtn = screen.getByTestId('m22a-run-button');
      const cancelBtn = screen.getByTestId('m22a-cancel-button');
      expect(runBtn).not.toBeDisabled();

      fireEvent.click(runBtn);

      await waitFor(() => {
        expect(releasePendingSeparation).not.toBeNull();
      });
      expect(runBtn).toBeDisabled();
      expect(cancelBtn).not.toBeDisabled();

      // Click Cancel while session disposal/inference is still pending
      fireEvent.click(cancelBtn);

      const statusEl = screen.getByTestId('m22a-status');
      expect(statusEl).toHaveAttribute('data-status', 'cancelled');
      expect(statusEl).toHaveAttribute('data-cleaning-up', 'true');
      // Run button MUST stay disabled until pending cleanup finishes
      expect(runBtn).toBeDisabled();
      expect(separateSpy).toHaveBeenCalledTimes(1);

      // Clicking Run while cleaning up cannot overlap a second session
      fireEvent.click(runBtn);
      expect(separateSpy).toHaveBeenCalledTimes(1);

      // Finish cleanup
      releasePendingSeparation!();
      await waitFor(() => {
        expect(statusEl).toHaveAttribute('data-cleaning-up', 'false');
      });
      expect(runBtn).not.toBeDisabled();
    } finally {
      separateSpy.mockRestore();
      fetchSpy.mockRestore();
    }
  });
});
