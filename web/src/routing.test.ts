import { describe, expect, it } from 'vitest';
import { MODULE_PATHS, parseAppRoute, pathForSchedule, pathForSong, shouldBootstrapSession } from './routing';

describe('application routes', () => {
  it('maps every main module to a stable URL', () => {
    expect(MODULE_PATHS).toEqual({
      dashboard: '/',
      schedules: '/escalas',
      repertoire: '/repertorio',
      cifrador: '/cifras',
      ministry: '/ministerio',
      liturgies: '/liturgias',
      vocal: '/exercicios-vocais',
    });
  });

  it('parses detail deep links and liturgies canonical route', () => {
    expect(parseAppRoute('/repertorio/song%201')).toMatchObject({ module: 'repertoire', songId: 'song 1' });
    expect(parseAppRoute('/escalas/schedule-1')).toMatchObject({ module: 'schedules', scheduleId: 'schedule-1' });
    expect(parseAppRoute('/liturgias')).toMatchObject({ module: 'liturgies', isKnown: true });
    expect(parseAppRoute('/exercicios-vocais')).toMatchObject({ module: 'vocal', isKnown: true });
    expect(pathForSong('song 1')).toBe('/repertorio/song%201');
    expect(pathForSchedule('schedule/1')).toBe('/escalas/schedule%2F1');
  });

  it('marks unknown paths without treating them as a valid dashboard route', () => {
    expect(parseAppRoute('/nao-existe').isKnown).toBe(false);
  });

  it('skips private session bootstrap on the self-contained vocal route', () => {
    expect(shouldBootstrapSession('vocal', false)).toBe(false);
    expect(shouldBootstrapSession('dashboard', false)).toBe(true);
    expect(shouldBootstrapSession('vocal', true)).toBe(false);
  });
});
