/** One real public request through the existing adapter. No app/config/DB bootstrap. */
import { performance } from 'node:perf_hooks';
import { AppError } from '../middleware/error-handler';
import { parseCifraClubHtml } from '../features/smart_chords/cifraclub_html_parser';
import { projectCifraClubHtml } from '../features/smart_chords/cifraclub_html_projection';
import { CIFRACLUB_MAX_BYTES, CIFRACLUB_TIMEOUT_MS, fetchCifraClubHtml } from '../features/smart_chords/cifraclub_http';
import { isMusicalChord, tokenizeLine } from '../features/smart_chords/smart_chord_normalizer';

async function main(): Promise<void> {
  if (!process.argv.includes('--run-public-reference')) {
    throw new Error('Explicit --run-public-reference required; performs one bounded public request.');
  }
  const start = performance.now();
  const cpu = process.cpuUsage();
  const rss = process.memoryUsage().rss;
  const evidence: Record<string, unknown> = {
    timestamp: new Date().toISOString(),
    environment: { node: process.version, platform: process.platform, execution: 'local backend Node process, not Vercel' },
    source_url: 'https://www.cifraclub.com.br/projeto-sola/glorificar/',
    conditions: { timeout_ms: CIFRACLUB_TIMEOUT_MS, max_bytes: CIFRACLUB_MAX_BYTES,
      user_agent: 'LouvAIO-HTML-Proof/1.0', accept_encoding: 'identity',
      dns: 'public IPv4 checked and pinned into TLS', redirects: false, retries: 0,
      cookies: false, credentials: false, headless: false },
    hosted_acquisition: 'Unknown / Not yet verified',
  };
  try {
    const html = await fetchCifraClubHtml(evidence.source_url as string);
    evidence.http_status = 200;
    evidence.http_elapsed_ms = Math.round(performance.now() - start);
    evidence.response_bytes = Buffer.byteLength(html, 'utf8');
    const musicalHtml = projectCifraClubHtml(html, evidence.source_url as string);
    evidence.projection_characters = musicalHtml.length;
    const result = parseCifraClubHtml(musicalHtml, evidence.source_url as string);
    const draft = result.draft;
    const sourceTabs = result.lines.filter(line => line.kind === 'tablature').map(line => line.text);
    const draftTabs = draft.content.split('\n').filter(line => /^\s*[eBGDAE]\|/.test(line));
    let pairedRows = 0;
    let alignmentExact = true;
    let outputRow = 0;
    const outputLines = draft.content.split('\n');
    for (let row = 0; row < result.lines.length; row++, outputRow++) {
      const chordRow = result.lines[row];
      const lyricRow = result.lines[row + 1];
      if (chordRow.kind !== 'chords' || lyricRow?.kind !== 'lyrics' ||
          chordRow.text.includes('\t') || lyricRow.text.includes('\t')) continue;
      const tokens = tokenizeLine(chordRow.text);
      if (!tokens.every(token => token.isChord)) continue;
      const output = outputLines[outputRow] ?? '';
      const markers = [...output.matchAll(/\[([^\]]+)\]/g)].filter(match => isMusicalChord(match[1]));
      let removed = 0;
      const restored = markers.map(match => {
        const column = match.index! - removed;
        removed += match[0].length;
        return { chord: match[1], column };
      });
      const plain = output.replace(/\[([^\]]+)\]/g, (whole, token: string) => isMusicalChord(token) ? '' : whole);
      alignmentExact &&= JSON.stringify(restored) === JSON.stringify(tokens.map(token => ({ chord: token.text, column: token.index }))) &&
        plain.trimEnd() === lyricRow.text.trimEnd();
      pairedRows++;
      row++;
    }
    evidence.http_status = 200;
    evidence.musical_summary = {
      title: draft.title, artist: draft.artist_name, explicit_key: draft.displayed_key,
      original_key: draft.original_key, characters: draft.content.length,
      source_lines: result.lines.length, tab_rows: sourceTabs.length,
      warning_codes: draft.warnings.map(warning => warning.code),
    };
    evidence.checks = {
      title_artist: draft.title === 'Glorificar' && draft.artist_name === 'Projeto Sola',
      explicit_bb: draft.displayed_key === 'Bb',
      intro: /intro/i.test(draft.content), interlude: /interl[uú]dio/i.test(draft.content),
      eb_g: draft.content.includes('Eb/G'), ab_bb: draft.content.includes('Ab/Bb'),
      tab_24_rows: sourceTabs.length === 24,
      tabs_exact: JSON.stringify(sourceTabs) === JSON.stringify(draftTabs),
      musical_content: draft.content.length > 500,
      no_manual_paste: !draft.requires_manual_paste,
      chord_lyric_pairs_checked: pairedRows,
      chord_columns_and_lyrics_exact: pairedRows > 0 && alignmentExact,
      no_duplicated_paired_rows: outputLines.length === result.lines.length - pairedRows,
    };
    const checks = evidence.checks as Record<string, unknown>;
    const integrity = Object.values(checks).filter(value => typeof value === 'boolean').every(value => value === true);
    evidence.outcome = integrity ? 'LOCAL_REAL_CONTENT_VERIFIED; not a hosted E2E PASS'
      : 'Real source acquired but draft integrity checks failed';
    if (!integrity) process.exitCode = 2;
  } catch (error: unknown) {
    const details = error instanceof AppError && typeof error.details === 'object' && error.details !== null
      ? error.details as Record<string, unknown> : {};
    evidence.http_status = details.http_status ?? evidence.http_status ?? null;
    evidence.error = { type: error instanceof Error ? error.name : 'Unknown',
      code: details.code ?? null, message: error instanceof Error ? error.message : 'Unknown error' };
    evidence.outcome = 'BLOCKED; no musical draft acquired';
    process.exitCode = 2;
  } finally {
    const used = process.cpuUsage(cpu);
    evidence.resources = { elapsed_ms: Math.round(performance.now() - start),
      process_cpu_ms: (used.user + used.system) / 1000,
      rss_before_bytes: rss, rss_after_bytes: process.memoryUsage().rss,
      note: 'Single local sample, parser/module startup excluded; not a Vercel bill or browser benchmark' };
    console.log(JSON.stringify(evidence, null, 2));
  }
}

void main().catch(() => { console.error('Proof not started; explicit public-reference flag required.'); process.exitCode = 1; });
