import { AppError } from '../../middleware/error-handler';
import { SmartChordImportDraft } from './smart_chord_import.types';

const ALLOWED_HOSTS = new Set(['cifraclub.com.br', 'www.cifraclub.com.br']);
const MAX_SLUG_LENGTH = 160;

function parseAllowedCifraClubUrl(urlStr: string): URL {
  let url: URL;
  try {
    url = new URL(urlStr);
  } catch {
    throw new AppError(400, 'URL inválida fornecida para importação.');
  }

  if (url.protocol !== 'http:' && url.protocol !== 'https:') {
    throw new AppError(400, 'Protocolo de URL não suportado. Utilize http:// ou https://.');
  }
  if (!ALLOWED_HOSTS.has(url.hostname.toLowerCase())) {
    throw new AppError(400, 'Utilize um link de cifra do Cifra Club (cifraclub.com.br).');
  }
  if (url.username || url.password) {
    throw new AppError(400, 'A URL não pode conter credenciais.');
  }
  if (url.port) {
    throw new AppError(400, 'A URL não pode usar uma porta personalizada.');
  }

  return url;
}

function decodeSlug(segment: string): string {
  let decoded: string;
  try {
    decoded = decodeURIComponent(segment);
  } catch {
    throw new AppError(400, 'O link do Cifra Club contém um caminho inválido.');
  }

  if (
    decoded.length === 0 ||
    decoded.length > MAX_SLUG_LENGTH ||
    /[/\\\u0000-\u001f\u007f]/u.test(decoded)
  ) {
    throw new AppError(400, 'O link do Cifra Club contém um caminho inválido.');
  }

  return decoded;
}

export function slugToReadable(slug: string): string {
  const words = slug.replace(/[_-]+/g, ' ').trim().split(/\s+/).filter(Boolean);
  return words
    .map((word) => {
      const lower = word.toLocaleLowerCase('pt-BR');
      if (['de', 'da', 'do', 'das', 'dos', 'e', 'em'].includes(lower)) return lower;
      return lower.charAt(0).toLocaleUpperCase('pt-BR') + lower.slice(1);
    })
    .join(' ');
}

export function parseCifraClubUrl(urlStr: string): { artistName: string | null; title: string | null } {
  const url = parseAllowedCifraClubUrl(urlStr);
  const parts = url.pathname.split('/').filter(Boolean);
  if (parts.length < 2) return { artistName: null, title: null };

  const artist = slugToReadable(decodeSlug(parts[0]));
  const title = slugToReadable(decodeSlug(parts[1]));
  return {
    artistName: artist || null,
    title: title || null,
  };
}

export async function extractSmartChordFromUrl(urlStr: string): Promise<SmartChordImportDraft> {
  const url = parseAllowedCifraClubUrl(urlStr);
  const parts = url.pathname.split('/').filter(Boolean);
  const artistName = parts.length >= 2 ? slugToReadable(decodeSlug(parts[0])) || null : null;
  const title = parts.length >= 2 ? slugToReadable(decodeSlug(parts[1])) || null : null;

  return {
    title: title || 'Cifra Importada via URL',
    artist_name: artistName,
    original_key: null,
    content: '',
    warnings: [
      {
        code: 'URL_MANUAL_PASTE_REQUIRED',
        message:
          'O link foi usado apenas para identificar título e artista. Para continuar, cole manualmente o texto da cifra; o conteúdo do site não é acessado automaticamente.',
      },
    ],
    source_type: 'url',
    requires_manual_paste: true,
    source_url: urlStr,
  };
}
