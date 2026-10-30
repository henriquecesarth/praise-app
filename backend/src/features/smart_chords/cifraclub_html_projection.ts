import { load } from 'cheerio';
import type { AnyNode } from 'domhandler';
import { AppError } from '../../middleware/error-handler';
import { CIFRACLUB_MAX_BYTES, validateCifraClubHttpUrl } from './cifraclub_http';

const MAX_PROJECTED_HTML_CHARS = 100000;
const MAX_RAW_MUSIC_CHARS = 90000;
const KEY_VALUE = '[A-G][#b]?(?:m|maj|min)?';
const TOM_LABEL = /^Tom:\s*$/i;
const CAPO_LABEL = /^(?:Capotraste|Capo):\s*$/i;
const ORIGINAL_KEY_LABEL = /^Tom original:\s*$/i;
const VERSION_LABEL = /^Vers[aã]o:\s*$/i;

function unsupportedLayout(message: string): never {
  throw new AppError(422, message, { code: 'UNSUPPORTED_LAYOUT' });
}

function escapeText(value: string): string {
  return value.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}

/**
 * Projects supported CifraClub DOM fields into the minimal structural HTML
 * accepted by the authoritative TypeScript parser. This function does not
 * interpret chords or otherwise transform musical text.
 */
export function projectCifraClubHtml(html: string, sourceUrl: string): string {
  const url = validateCifraClubHttpUrl(sourceUrl);
  if (Buffer.byteLength(html, 'utf8') > CIFRACLUB_MAX_BYTES) {
    throw new AppError(422, 'HTML excede 2 MiB.', { code: 'HTML_TOO_LARGE' });
  }

  const $ = load(html);
  const pageTitle = $('title').first().text().trim();
  if ($('#challenge-form, .g-recaptcha, iframe[src*="captcha"]').length ||
      /access denied|just a moment|verify you are human|captcha|403 forbidden/i.test(pageTitle)) {
    throw new AppError(422, 'Página exige verificação de acesso.', { code: 'SOURCE_ACCESS_RESTRICTED' });
  }

  const headings = $('h1');
  if (headings.length !== 1) unsupportedLayout('Esperado um único título h1.');
  const title = headings.first().text().trim();
  if (!title) unsupportedLayout('Título da música ausente.');

  const artistSegment = url.pathname.split('/').filter(Boolean)[0];
  const artistPath = `/${artistSegment}/`;
  const artistLinks = $('a[href]').filter((_index, element) => $(element).attr('href') === artistPath);
  if (artistLinks.length > 1) unsupportedLayout('Mais de um artista corresponde ao caminho da música.');
  const legacyArtists = $('h2.t3, .cifra .t3');
  if (artistLinks.length === 0 && legacyArtists.length !== 1) {
    unsupportedLayout('Artista ausente ou ambíguo.');
  }
  const artist = (artistLinks.length === 1 ? artistLinks.first() : legacyArtists.first()).text().trim();
  if (!artist) unsupportedLayout('Nome do artista ausente.');

  const musicBlocks = $('article pre, .cifra_cnt pre, pre.js-tab-content');
  if (musicBlocks.length !== 1) unsupportedLayout('Esperado um único bloco musical pre.');
  const pre = musicBlocks.first();
  const allowedElements = new Set(['div', 'b', 'span', 'br']);
  let rawMusic = '';
  const readMusic = (node: AnyNode): void => {
    if (node.type === 'text') {
      rawMusic += node.data;
      return;
    }
    if (node.type === 'script' || node.type === 'style') {
      unsupportedLayout('Script ou estilo não suportado dentro do bloco musical.');
    }
    if (node.type === 'tag') {
      if ($(node).attr('aria-hidden') === 'true' || $(node).attr('hidden') !== undefined) return;
      if (!allowedElements.has(node.name)) unsupportedLayout('Elemento não suportado dentro do bloco musical.');
      if (node.name === 'br') {
        rawMusic += '\n';
        return;
      }
      node.children.forEach(readMusic);
    }
  };
  pre.contents().each((_index, node) => readMusic(node));
  if (!rawMusic.trim()) unsupportedLayout('Bloco musical vazio.');
  if (rawMusic.length > MAX_RAW_MUSIC_CHARS) {
    throw new AppError(422, 'Conteúdo musical excede o limite permitido.', { code: 'HTML_TOO_LARGE' });
  }

  const parseKey = (value: string): string | null =>
    value.trim().match(new RegExp(`^(?:Tom:\\s*)?(${KEY_VALUE})$`, 'i'))?.[1] ?? null;
  const keyLabels = $('span').filter((_index, element) => TOM_LABEL.test($(element).text().trim()));
  if (keyLabels.length > 1) unsupportedLayout('Tom explícito ambíguo.');
  const labelKey = keyLabels.length === 1 ? parseKey(keyLabels.first().parent().text()) : null;
  if (keyLabels.length === 1 && !labelKey) unsupportedLayout('Tom explícito inválido.');
  const legacyKeyElements = $('#cifra_tom');
  if (legacyKeyElements.length > 1) unsupportedLayout('Tom explícito ambíguo.');
  const legacyKeyText = legacyKeyElements.first().text().trim();
  const legacyKey = legacyKeyText ? parseKey(legacyKeyText) : null;
  if (legacyKeyText && !legacyKey) unsupportedLayout('Tom explícito inválido.');
  if (labelKey && legacyKey && labelKey !== legacyKey) unsupportedLayout('Tom explícito ambíguo.');
  const key = labelKey ?? legacyKey;
  if (!key) unsupportedLayout('Tom explícito ausente.');

  const explicitField = (
    label: RegExp,
    pattern: RegExp,
    legacySelector: string,
    fieldName: string,
  ): string | null => {
    const labels = $('span').filter((_index, element) => label.test($(element).text().trim()));
    const legacy = $(legacySelector);
    if (legacy.length > 1) unsupportedLayout(`${fieldName} explícito ambíguo.`);
    const candidates = labels.map((_index, element) => $(element).parent().text().trim()).get();
    const legacyText = legacy.first().text().trim();
    if (legacyText && !candidates.includes(legacyText)) candidates.push(legacyText);
    const values = candidates.map(candidate => candidate.match(pattern)?.[1] ?? null);
    if (values.some(value => value === null)) unsupportedLayout(`${fieldName} explícito inválido.`);
    const unique = [...new Set(values)];
    if (unique.length > 1) unsupportedLayout(`${fieldName} explícito ambíguo.`);
    return unique[0] ?? null;
  };

  const capo = explicitField(
    CAPO_LABEL,
    /^(?:(?:Capotraste|Capo):\s*)?(\d{1,2})(?:\s*(?:ª|a|º|o)?\s*casa)?$/i,
    '#cifra_capo, .capotraste',
    'Capotraste',
  );
  if (capo !== null && Number(capo) > 24) unsupportedLayout('Capotraste explícito inválido.');
  const originalKey = explicitField(
    ORIGINAL_KEY_LABEL,
    new RegExp(`^(?:Tom original:\\s*)?(${KEY_VALUE})$`, 'i'),
    '#cifra_tom_original',
    'Tom original',
  );
  const version = explicitField(
    VERSION_LABEL,
    /^(?:Vers[aã]o:\s*)?(.{1,120})$/i,
    '#cifra_versao, .cifra_version',
    'Versão',
  );

  const projection =
    `<h1 class="t1">${escapeText(title)}</h1>` +
    `<h2 class="t3">${escapeText(artist)}</h2>` +
    `<div id="cifra_tom">Tom: ${escapeText(key)}</div>` +
    (capo === null ? '' : `<div id="cifra_capo">Capotraste: ${escapeText(capo)}</div>`) +
    (originalKey === null ? '' : `<div id="cifra_tom_original">Tom original: ${escapeText(originalKey)}</div>`) +
    (version === null ? '' : `<span id="cifra_versao">Versão: ${escapeText(version)}</span>`) +
    `<div class="cifra_cnt"><pre>${escapeText(rawMusic)}</pre></div>`;
  if (projection.length > MAX_PROJECTED_HTML_CHARS) {
    throw new AppError(422, 'HTML projetado excede o limite permitido.', { code: 'HTML_TOO_LARGE' });
  }
  return projection;
}
