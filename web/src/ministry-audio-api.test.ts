import { afterEach, describe, expect, it, vi } from 'vitest';
import { api, isMinistryAudioLoopbackApi, SESSION_EXPIRED_EVENT } from './api';

describe('ministry audio transport', () => {
  afterEach(() => {
    vi.unstubAllGlobals();
    vi.unstubAllEnvs();
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

  const r2Origin = `https://${'a'.repeat(32)}.r2.cloudflarestorage.com`;
  const signedUrl = `${r2Origin}/private/stem.wav?X-Amz-Signature=fixture`;
  const putHeaders = { 'if-none-match': '*', 'content-type': 'audio/wav', 'cache-control': 'private, no-store' };
  const grant = (attempt = 1, expiresAt = Date.now() + 60_000) => Response.json({ attempt, expiresAt, url: signedUrl, headers: putHeaders });
  const missing = () => Response.json({ error: { message: 'Missing', details: { code: 'AUDIO_UPLOAD_MISSING' } } }, { status: 409 });

  it.each([409, 412, 'network'])('recovers a direct upload with a %s response after a grant', async (failure) => {
    vi.stubEnv('VITE_MINISTRY_AUDIO_R2_ORIGIN', r2Origin);
    localStorage.setItem('praise_auth_token', 'test-session');
    const fetchMock = vi.fn().mockResolvedValueOnce(grant()).mockResolvedValueOnce(missing());
    if (failure === 'network') fetchMock.mockRejectedValueOnce(new TypeError('Network error'));
    else fetchMock.mockResolvedValueOnce(new Response(null, { status: Number(failure) }));
    const result = { uploadedStemIds: ['vocals'] };
    fetchMock.mockResolvedValueOnce(Response.json(result));
    vi.stubGlobal('fetch', fetchMock);
    const { signal } = new AbortController();
    const file = new Blob(['sample']);

    await expect(api.ministryAudio.uploadDirectStem('one', 'take', 'vocals', file, signal)).resolves.toEqual(result);
    expect(fetchMock).toHaveBeenNthCalledWith(1, expect.stringContaining('/uploads/take/stems/vocals/upload-url'), expect.objectContaining({ method: 'POST', headers: expect.objectContaining({ Authorization: 'Bearer test-session' }) }));
    expect(fetchMock.mock.calls[0][1].body).toBeUndefined();
    for (const index of [2, 4]) expect(fetchMock).toHaveBeenNthCalledWith(index, expect.stringContaining('/uploads/take/stems/vocals/complete'), expect.objectContaining({ method: 'POST', body: '{"attempt":1}' }));
    expect(fetchMock).toHaveBeenNthCalledWith(3, signedUrl, expect.objectContaining({ method: 'PUT', body: file, credentials: 'omit', redirect: 'error', signal, headers: putHeaders }));
  });

  it('requests a fresh grant after expiry and completes before sending bytes again', async () => {
    vi.stubEnv('VITE_MINISTRY_AUDIO_R2_ORIGIN', r2Origin);
    const result = { uploadedStemIds: ['vocals'] };
    // Provider rejects the expired grant with 403, regardless of the device clock.
    const fetchMock = vi.fn().mockResolvedValueOnce(grant(1)).mockResolvedValueOnce(missing()).mockResolvedValueOnce(new Response(null, { status: 403 }))
      .mockResolvedValueOnce(missing()).mockResolvedValueOnce(grant(2)).mockResolvedValueOnce(Response.json(result));
    vi.stubGlobal('fetch', fetchMock);

    await expect(api.ministryAudio.uploadDirectStem('one', 'take', 'vocals', new Blob(['sample']), new AbortController().signal)).resolves.toEqual(result);
    expect(fetchMock.mock.calls.map(([, request]) => request.method)).toEqual(['POST', 'POST', 'PUT', 'POST', 'POST', 'POST']);
    expect(fetchMock.mock.calls[5][1].body).toBe('{"attempt":2}');
  });

  it('renews once after an opaque network failure only when the API confirms the object is absent', async () => {
    localStorage.setItem('praise_auth_token', 'test-session');
    const result = { uploadedStemIds: ['vocals'] };
    const fetchMock = vi.fn().mockResolvedValueOnce(grant(1)).mockResolvedValueOnce(missing()).mockRejectedValueOnce(new TypeError('CORS'))
      .mockResolvedValueOnce(missing()).mockResolvedValueOnce(grant(1)).mockResolvedValueOnce(missing()).mockResolvedValueOnce(new Response(null, { status: 200 }))
      .mockResolvedValueOnce(Response.json(result));
    vi.stubGlobal('fetch', fetchMock);

    await expect(api.ministryAudio.uploadDirectStem('one', 'take', 'vocals', new Blob(['sample']), new AbortController().signal)).resolves.toEqual(result);
    expect(fetchMock.mock.calls.map(([, request]) => request.method)).toEqual(['POST', 'POST', 'PUT', 'POST', 'POST', 'POST', 'PUT', 'POST']);
  });

  it('stops after a single renewal when the network keeps failing', async () => {
    localStorage.setItem('praise_auth_token', 'test-session');
    const fetchMock = vi.fn().mockResolvedValueOnce(grant(1)).mockResolvedValueOnce(missing()).mockRejectedValueOnce(new TypeError('CORS'))
      .mockResolvedValueOnce(missing()).mockResolvedValueOnce(grant(1)).mockResolvedValueOnce(missing()).mockRejectedValueOnce(new TypeError('CORS'))
      .mockResolvedValueOnce(missing());
    vi.stubGlobal('fetch', fetchMock);

    await expect(api.ministryAudio.uploadDirectStem('one', 'take', 'vocals', new Blob(['sample']), new AbortController().signal)).rejects.toThrow();
    expect(fetchMock).toHaveBeenCalledTimes(8);
    expect(fetchMock.mock.calls.filter(([, request]) => request.method === 'PUT')).toHaveLength(2);
  });

  it('reports an opaque direct GET failure as a renewable ApiError with status 0 and keeps aborts distinct', async () => {
    vi.stubGlobal('fetch', vi.fn().mockRejectedValue(new TypeError('CORS')));
    const headers = { 'if-match': '"fixture"' };
    await expect(api.ministryAudio.downloadDirectStem(signedUrl, headers, 2, new AbortController().signal)).rejects.toMatchObject({ statusCode: 0 });
    const aborted = new AbortController();
    aborted.abort();
    await expect(api.ministryAudio.downloadDirectStem(signedUrl, headers, 2, aborted.signal)).rejects.not.toMatchObject({ statusCode: 0 });
  });

  it('requires the configured direct GET origin and forwards only its conditional header', async () => {
    vi.stubEnv('VITE_MINISTRY_AUDIO_R2_ORIGIN', r2Origin);
    localStorage.setItem('praise_auth_token', 'test-session');
    const fetchMock = vi.fn().mockImplementation(async () => new Response(new Uint8Array([1, 2]), { headers: { 'Content-Type': 'audio/wav' } }));
    vi.stubGlobal('fetch', fetchMock);
    const { signal } = new AbortController();
    const headers = { 'if-match': '"fixture"' };
    for (const url of ['https://other.test/stem.wav?sig=x', `${r2Origin}.other.test/stem.wav?sig=x`, signedUrl.replace('https://', 'https://user@'), `${signedUrl}#x`]) {
      await expect(api.ministryAudio.downloadDirectStem(url, headers, 2, signal)).rejects.toThrow();
    }
    await expect(api.ministryAudio.downloadDirectStem(signedUrl, { ...headers, Authorization: 'Bearer injection' }, 2, signal)).rejects.toThrow();
    expect(fetchMock).not.toHaveBeenCalled();
    await expect(api.ministryAudio.downloadDirectStem(signedUrl, headers, 2, signal)).resolves.toEqual(new Uint8Array([1, 2]));
    expect(fetchMock).toHaveBeenCalledOnce();
    expect(fetchMock).toHaveBeenCalledWith(signedUrl, expect.objectContaining({ method: 'GET', credentials: 'omit', redirect: 'error', signal, headers }));
  });
});
