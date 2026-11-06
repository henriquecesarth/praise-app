import { load } from 'cheerio';
import type { AnyNode } from 'domhandler';
import { AppError } from '../../middleware/error-handler';
import { SmartChordImportDraft, ImportWarning } from './smart_chord_import.types';
import { isChordLine, isMusicalChord, tokenizeLine } from './smart_chord_normalizer';

export interface CifraClubLine {
  kind: 'blank' | 'section' | 'progression' | 'chords' | 'lyrics' | 'tablature';
  text: string;
}

export interface CifraClubHtmlResult {
  draft: SmartChordImportDraft;
  version: string | null;
  lines: CifraClubLine[];
}

const KEY = /^(?:Tom(?: original)?\s*:\s*)?([A-G][#b]?(?:m|maj|min)?)$/i;
const SECTION = /^\s*\[(?:Intro|Introdução|Verso|Primeira parte|Segunda parte|Pré-refrão|Refrão|Coro|Ponte|Solo|Interlúdio|Instrumental|Final|Coda|Tag)(?:\s+\d+)?\]/i;
const TAB = /^\s*(?:[A-Ga-g][#b]?\s*)?\|[-\d\s.xXhHpPbBrRtTvV~\/\\<>()[\]^=|:*]+\s*$/;

/** Pure HTML parsing: never fetches, executes scripts or writes to a repository. */
export function parseCifraClubHtml(html: string, sourceUrl: string): CifraClubHtmlResult {
  if (Buffer.byteLength(html, 'utf8') > 2 * 1024 * 1024) {
    throw new AppError(422, 'HTML excede 2 MiB.', { code: 'HTML_TOO_LARGE' });
  }
  const $ = load(html);
  if ($('iframe[src*="captcha"], .g-recaptcha, #challenge-form').length) {
    throw new AppError(422, 'Página exige verificação de acesso.', { code: 'SOURCE_ACCESS_RESTRICTED' });
  }
  const pre = $('.cifra_cnt pre, pre.js-tab-content');
  if (pre.length !== 1) {
    throw new AppError(422, 'Esperado um único bloco musical pre em .cifra_cnt.', { code: 'UNSUPPORTED_LAYOUT' });
  }
  const warnings: ImportWarning[] = [];
  let raw = '';
  // Text nodes retain spaces; BR is a newline, never a second copy of its parent.
  const walk = (node: AnyNode): void => {
    if (node.type === 'text') { raw += node.data; return; }
    if (node.type !== 'tag') return;
    if (['script', 'style', 'button'].includes(node.name) ||
        $(node).attr('aria-hidden') === 'true' || $(node).attr('hidden') !== undefined) return;
    if (node.name === 'br') { raw += '\n'; return; }
    if (['div', 'p'].includes(node.name)) {
      throw new AppError(422, 'Blocos dentro de pre exigem revisão do layout.', { code: 'UNSUPPORTED_LAYOUT' });
    }
    node.children.forEach(walk);
  };
  pre.contents().each((_index, node) => walk(node));
  raw = raw.replace(/\r\n?/g, '\n').replace(/\u00a0/g, ' ');
  if (!raw.trim()) throw new AppError(422, 'HTML sem conteúdo musical.', { code: 'URL_EXTRACTION_PARTIAL' });
  // A tab character has no portable visual width. Do not silently guess columns.
  if (raw.includes('\t')) warnings.push({ code: 'CHORD_ALIGNMENT_UNCERTAIN', message: 'Tabulações preservadas; revise a largura visual no editor.' });
  const lines: CifraClubLine[] = raw.split('\n').map(text => ({
    text,
    kind: !text.trim() ? 'blank' : TAB.test(text) ? 'tablature' :
      SECTION.test(text) ? (/\]\s*\S/.test(text) ? 'progression' : 'section') :
      /^\s*\[\s*[A-G][^\]]*\]\s*$/.test(text) &&
        text.trim().slice(1, -1).split(/\s+/).filter(Boolean).every(token => isMusicalChord(token) || /^[|%:]+$/.test(token)) ? 'progression' :
      isChordLine(text) ? (/[|%]/.test(text) ? 'progression' : 'chords') : 'lyrics',
  }));
  if (!lines.some(line => ['chords', 'progression', 'tablature'].includes(line.kind))) {
    throw new AppError(422, 'Bloco sem acordes ou tablatura reconhecíveis.', { code: 'URL_EXTRACTION_PARTIAL' });
  }
  const content: string[] = [];
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    const next = lines[i + 1];
    if (line.kind === 'chords' && next?.kind === 'lyrics' &&
        !line.text.includes('\t') && !next.text.includes('\t') &&
        tokenizeLine(line.text).every(token => token.isChord)) {
      const chords = tokenizeLine(line.text);
      let lyric = next.text;
      const lastColumn = chords[chords.length - 1].index;
      lyric = lyric.padEnd(Math.max(lyric.length, lastColumn), ' ');
      for (const chord of [...chords].reverse()) {
        lyric = lyric.slice(0, chord.index) + `[${chord.text}]` + lyric.slice(chord.index);
      }
      content.push(lyric);
      i++;
    } else if (line.kind === 'chords' || line.kind === 'progression') {
      // Bracket only chords, retaining every original space/bar/repeat marker.
      const bracketed = line.text.trim();
      const alreadyProgression = bracketed.startsWith('[') && bracketed.endsWith(']') && !SECTION.test(line.text);
      content.push(alreadyProgression ? line.text :
        line.text.replace(/(?:^|\s)([A-G][^\s]*)/g, (whole, token: string) =>
          isMusicalChord(token) ? whole.replace(token, `[${token}]`) : whole));
    } else {
      content.push(line.text);
    }
  }
  const title = $('h1.t1, .cifra h1').first().text().trim();
  const artist = $('h2.t3, .cifra .t3').first().text().trim();
  const key = $('#cifra_tom').first().text().trim().match(KEY)?.[1] ?? null;
  const capoText = $('#cifra_capo, .capotraste').first().text().trim();
  const capoMatch = capoText.match(/^(?:(?:Capotraste|Capo)\s*:\s*)?(\d{1,2})(?:\s*(?:ª|a|º|o)?\s*casa)?$/i);
  const capo = capoMatch && Number(capoMatch[1]) <= 24 ? Number(capoMatch[1]) : null;
  if (!key) warnings.push({ code: 'MISSING_ORIGINAL_KEY', message: 'Tom explícito ausente ou inválido; nenhum acorde foi usado para inferir o tom.' });
  if (!title || !artist || (capoText && capo === null)) warnings.push({ code: 'METADATA_AMBIGUOUS', message: 'Título, artista ou capotraste ausente/inválido; revise os campos.' });
  const originalKey = $('#cifra_tom_original').first().text().trim().match(KEY)?.[1] ?? null;
  if (capo && !originalKey) warnings.push({ code: 'MISSING_ORIGINAL_KEY', message: 'Tom indicado preservado como tom exibido; tom original com capo exige confirmação.' });
  const version = $('#cifra_versao, .cifra_version').first().text().trim().replace(/^Vers[aã]o\s*:\s*/i, '') || null;
  return {
    version, lines,
    draft: {
      title: title || 'Cifra importada (revisar título)', artist_name: artist || null,
      original_key: originalKey ?? (capo ? null : key), displayed_key: key, capo,
      content: content.join('\n'), original_text: raw, warnings,
      source_type: 'url', source_url: sourceUrl, requires_manual_paste: false,
    },
  };
}
