import { afterEach, describe, expect, it, vi } from 'vitest';
import { AppError } from '../../middleware/error-handler';
import { extractSmartChordFromUrl, parseCifraClubUrl, slugToReadable } from './smart_chord_url_extractor';

afterEach(() => vi.restoreAllMocks());

describe('smart_chord_url_extractor', () => {
  it('formats slug metadata while preserving Portuguese particles', () => {
    expect(slugToReadable('lugar-secreto')).toBe('Lugar Secreto');
    expect(slugToReadable('hino-da-vitoria')).toBe('Hino da Vitoria');
    expect(parseCifraClubUrl('https://www.cifraclub.com.br/gabriela-rocha/lugar-secreto/')).toEqual({
      artistName: 'Gabriela Rocha',
      title: 'Lugar Secreto',
    });
  });

  it('decodes percent encoded Unicode slug characters safely', () => {
    expect(parseCifraClubUrl('https://cifraclub.com.br/jo%C3%A3o/cora%C3%A7%C3%A3o/')).toEqual({
      artistName: 'João',
      title: 'Coração',
    });
  });

  it.each([
    'not-a-url',
    'ftp://www.cifraclub.com.br/artist/song',
    'https://cifraclub.com.br.evil.test/artist/song',
    'https://evilcifraclub.com.br/artist/song',
    'https://sub.cifraclub.com.br/artist/song',
    'https://user@www.cifraclub.com.br/artist/song',
    'https://www.cifraclub.com.br:8443/artist/song',
    'https://www.cifraclub.com.br/%2fadmin/song',
    'https://www.cifraclub.com.br/%E0%A4%A/song',
  ])('rejects unsafe or unsupported URL %s as HTTP 400', async (url) => {
    await expect(extractSmartChordFromUrl(url)).rejects.toMatchObject({
      statusCode: 400,
    } satisfies Partial<AppError>);
  });

  it('returns metadata only, requires manual paste, and never fetches the URL', async () => {
    const fetchSpy = vi.spyOn(globalThis, 'fetch');
    const sourceUrl = 'https://www.cifraclub.com.br/gabriela-rocha/lugar-secreto/?instrument=guitar';

    const draft = await extractSmartChordFromUrl(sourceUrl);

    expect(fetchSpy).not.toHaveBeenCalled();
    expect(draft).toMatchObject({
      title: 'Lugar Secreto',
      artist_name: 'Gabriela Rocha',
      original_key: null,
      content: '',
      source_type: 'url',
      requires_manual_paste: true,
      source_url: sourceUrl,
    });
    expect(draft.warnings).toEqual([
      expect.objectContaining({ code: 'URL_MANUAL_PASTE_REQUIRED' }),
    ]);
  });

  it('uses a neutral title when the URL has no artist and song slugs', async () => {
    await expect(extractSmartChordFromUrl('https://cifraclub.com.br/')).resolves.toMatchObject({
      title: 'Cifra Importada via URL',
      artist_name: null,
      requires_manual_paste: true,
    });
  });
});
