import { afterEach, describe, expect, it, vi } from 'vitest';
import { api, isMinistryAudioLoopbackApi, SESSION_EXPIRED_EVENT } from './api';

describe('ministry audio transport', () => {
  afterEach(() => {
    vi.unstubAllGlobals();
    localStorage.clear();
  });

  it('restricts the experimental API to local HTTP', () => {
    expect(isMinistryAudioLoopbackApi('http://localhost:3000/api/v1')).toBe(true);
    expect(isMinistryAudioLoopbackApi('http://127.0.0.1:3000/api/v1')).toBe(true);
    for (const url of ['https://localhost/api/v1', 'http://localhost.example.test/api/v1', 'http://localhost@remote.test/api/v1', 'http://user@localhost/api/v1', 'invalid']) {
      expect(isMinistryAudioLoopbackApi(url)).toBe(false);
    }
  });

  it('uses authenticated scoped list and raw WAV upload requests', async () => {
    localStorage.setItem('praise_auth_token', 'test-session');
    const fetchMock = vi.fn().mockImplementation(async () => new Response('{}'));
    vi.stubGlobal('fetch', fetchMock);
    const { signal } = new AbortController();
    const stem = new Blob(['sample']);
    await api.ministryAudio.list('min A', { q: 'som & luz', cursor: 'a+b' }, signal);
    await api.ministryAudio.uploadStem('min A', 'take A', 'vocals', stem, signal);

    expect(fetchMock).toHaveBeenNthCalledWith(1, expect.stringContaining('/ministries/min%20A/audio-library?q=som+%26+luz&cursor=a%2Bb'), expect.objectContaining({ signal, cache: 'no-store' }));
    expect(fetchMock).toHaveBeenNthCalledWith(2, expect.stringContaining('/ministries/min%20A/audio-library/uploads/take%20A/stems/vocals'), expect.objectContaining({
      method: 'PUT', signal, body: stem, headers: expect.objectContaining({ Authorization: 'Bearer test-session', 'Content-Type': 'audio/wav' }),
    }));
  });

  it('only downloads the requested recording/stem from the configured API', async () => {
    localStorage.setItem('praise_auth_token', 'test-session');
    const fetchMock = vi.fn().mockImplementation(async () => new Response(new Uint8Array([1, 2]), { headers: { 'Content-Type': 'audio/wav' } }));
    vi.stubGlobal('fetch', fetchMock);
    const { signal } = new AbortController();
    for (const url of ['https://other.test/take/stems/vocals?ticket=t', '//other.test/take/stems/vocals?ticket=t', '/other/stems/vocals?ticket=t', '/take/stems/drums?ticket=t']) {
      await expect(api.ministryAudio.downloadStem('one', 'take', 'vocals', url, 2, signal)).rejects.toThrow();
    }
    expect(fetchMock).not.toHaveBeenCalled();

    await expect(api.ministryAudio.downloadStem('one', 'take', 'vocals', '/take/stems/vocals?ticket=t', 2, signal)).resolves.toEqual(new Uint8Array([1, 2]));
    expect(fetchMock).toHaveBeenCalledWith(expect.stringContaining('/ministries/one/audio-library/take/stems/vocals?ticket=t'), expect.objectContaining({
      cache: 'no-store', redirect: 'error', signal, headers: expect.objectContaining({ Authorization: 'Bearer test-session' }),
    }));
  });

  it('ignores a stale response that arrives with a 401 after scope cancellation', async () => {
    localStorage.setItem('praise_auth_token', 'current-test-session');
    let respond!: (value: Response) => void;
    vi.stubGlobal('fetch', vi.fn().mockImplementation(() => new Promise<Response>((resolve) => { respond = resolve; })));
    const controller = new AbortController();
    const expired = vi.fn();
    window.addEventListener(SESSION_EXPIRED_EVENT, expired);
    try {
      const result = api.ministryAudio.list('one', {}, controller.signal);
      controller.abort();
      respond(new Response('{}', { status: 401 }));
      await expect(result).rejects.toMatchObject({ name: 'AbortError' });
      expect(expired).not.toHaveBeenCalled();
    } finally {
      window.removeEventListener(SESSION_EXPIRED_EVENT, expired);
    }
  });

  it('bounds streaming audio by the exact declared manifest size', async () => {
    const response = (data: Uint8Array<ArrayBuffer>) => new Response(data, { headers: { 'Content-Type': 'audio/wav' } });
    vi.stubGlobal('fetch', vi.fn().mockResolvedValueOnce(response(new Uint8Array([1, 2, 3]))).mockResolvedValueOnce(response(new Uint8Array([1]))));
    const { signal } = new AbortController();
    const load = () => api.ministryAudio.downloadStem('one', 'take', 'vocals', '/take/stems/vocals?ticket=t', 2, signal);
    await expect(load()).rejects.toThrow('Tamanho de faixa inválido.');
    await expect(load()).rejects.toThrow('Faixa incompleta.');
  });
});
