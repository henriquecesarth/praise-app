import { beforeAll, describe, expect, it } from 'vitest';
import { createSeparationDraft } from './local-separation-draft';
import { fakeResult, fakeStem, polyfillBlobArrayBuffer } from './local-separation-fixtures';
import {
  CANONICAL_STEM_IDS,
  HTDEMUCS_6S_ONNX_DESCRIPTOR,
  computeSha256Hex,
  type CanonicalStemId,
} from './separation/demucs-onnx-separator';

describe('createSeparationDraft', () => {
  beforeAll(polyfillBlobArrayBuffer);

  it('maps six stems to canonical files regardless of arrival order and carries the model', async () => {
    const draft = await createSeparationDraft(await fakeResult([...CANONICAL_STEM_IDS].reverse()));
    const files = draft.files();
    expect(Object.keys(files).sort()).toEqual([...CANONICAL_STEM_IDS].sort());
    for (const id of CANONICAL_STEM_IDS) expect(files[id]!.name).toBe(`${id}.wav`);
    expect(draft.model).toEqual({ id: HTDEMUCS_6S_ONNX_DESCRIPTOR.id, version: HTDEMUCS_6S_ONNX_DESCRIPTOR.version });
  });

  it('rejects incomplete, duplicated and unknown stems', async () => {
    const full = await fakeResult();
    await expect(createSeparationDraft({ ...full, orderedStems: full.orderedStems.slice(1) })).rejects.toThrow('seis faixas');
    await expect(createSeparationDraft({ ...full, orderedStems: [...full.orderedStems.slice(1), full.orderedStems[1]] })).rejects.toThrow('seis faixas');
    await expect(createSeparationDraft({ ...full, orderedStems: [...full.orderedStems.slice(1), { ...full.orderedStems[0], id: 'kick' as CanonicalStemId }] })).rejects.toThrow('seis faixas');
  });

  it('rejects divergent length or rate and corrupt bytes', async () => {
    const full = await fakeResult();
    const longer = await fakeStem('bass', 40);
    await expect(createSeparationDraft({ ...full, orderedStems: full.orderedStems.map((s) => (s.id === 'bass' ? longer : s)) })).rejects.toThrow('mesma duração');
    const faster = await fakeStem('bass', 20, 16000);
    await expect(createSeparationDraft({ ...full, orderedStems: full.orderedStems.map((s) => (s.id === 'bass' ? faster : s)) })).rejects.toThrow('mesma duração');
    const corrupt = { ...full.orderedStems[0], sha256: 'f'.repeat(64) };
    await expect(createSeparationDraft({ ...full, orderedStems: [corrupt, ...full.orderedStems.slice(1)] })).rejects.toThrow('corrompida');
    const bad = { ...full.orderedStems[0], wavBytes: new Uint8Array(100), byteLength: 100 };
    await expect(createSeparationDraft({ ...full, orderedStems: [bad, ...full.orderedStems.slice(1)] })).rejects.toThrow();
  });

  it('keeps the upload files intact when the preview consumes or drops its copies', async () => {
    const draft = await createSeparationDraft(await fakeResult());
    const inputs = draft.mixerInputs();
    const loaded = await Promise.all(inputs.map((i) => (i.wavBytes as () => Promise<Uint8Array>)()));
    loaded.forEach((bytes) => bytes.fill(0)); // the mixer owns and may destroy these
    const again = await (draft.mixerInputs()[0].wavBytes as () => Promise<Uint8Array>)();
    expect(await computeSha256Hex(again)).toBe(inputs[0].sha256);
    expect(await draft.files().vocals!.arrayBuffer()).toEqual(again.buffer);
  });

  it('refuses use after dispose and honours abort', async () => {
    const draft = await createSeparationDraft(await fakeResult());
    draft.dispose();
    draft.dispose();
    expect(draft.disposed).toBe(true);
    expect(() => draft.files()).toThrow();
    const abort = new AbortController();
    abort.abort();
    await expect(createSeparationDraft(await fakeResult(), abort.signal)).rejects.toThrow();
  });
});
