import { describe, expect, it } from 'vitest';
import {
  extractSmartChordFromImage,
  MAX_SMART_CHORD_IMAGE_SIZE,
  validateImageMagicBytes,
} from './smart_chord_image_extractor';

const PNG = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
const JPEG = Buffer.from([0xff, 0xd8, 0xff, 0xe0]);
const WEBP = Buffer.from('RIFF0000WEBP');

describe('smart_chord_image_extractor', () => {
  it.each([
    [PNG, 'png'],
    [JPEG, 'jpeg'],
    [WEBP, 'webp'],
  ] as const)('recognizes a %s signature', (buffer, format) => {
    expect(validateImageMagicBytes(buffer)).toBe(format);
  });

  it('rejects a truncated PNG signature and non-image data', () => {
    expect(validateImageMagicBytes(PNG.subarray(0, 4))).toBeNull();
    expect(validateImageMagicBytes(Buffer.from('%PDF-1.7'))).toBeNull();
  });

  it('rejects empty, unsupported, and oversized input with HTTP 400 errors', async () => {
    await expect(extractSmartChordFromImage(Buffer.alloc(0), 'empty.png')).rejects.toMatchObject({
      statusCode: 400,
    });
    await expect(extractSmartChordFromImage(Buffer.from('not an image'), 'bad.png')).rejects.toMatchObject({
      statusCode: 400,
    });
    await expect(
      extractSmartChordFromImage(Buffer.alloc(MAX_SMART_CHORD_IMAGE_SIZE + 1), 'large.png')
    ).rejects.toMatchObject({ statusCode: 400 });
  });

  it('accepts exactly 5 MiB and returns a manual transcription draft without parsing image chunks', async () => {
    const textChunk = Buffer.concat([
      PNG,
      Buffer.from([0x00, 0x00, 0x00, 0x0e, 0x74, 0x45, 0x58, 0x74]),
      Buffer.from('Chord\n[G]Lyric'),
      Buffer.alloc(4),
    ]);
    const pngWithTextChunk = Buffer.concat([
      textChunk,
      Buffer.alloc(MAX_SMART_CHORD_IMAGE_SIZE - textChunk.length),
    ]);

    const draft = await extractSmartChordFromImage(pngWithTextChunk, 'folder\\cifra-bondade.png');

    expect(pngWithTextChunk).toHaveLength(MAX_SMART_CHORD_IMAGE_SIZE);
    expect(draft).toMatchObject({
      title: 'Cifra bondade',
      artist_name: null,
      original_key: null,
      content: '',
      source_type: 'image',
      requires_manual_paste: true,
    });
    expect(draft.warnings).toEqual([
      expect.objectContaining({ code: 'IMAGE_MANUAL_TRANSCRIPTION_REQUIRED' }),
    ]);
    expect(draft.warnings[0].message).toMatch(/reconhecimento de texto não está disponível/i);
  });
});
