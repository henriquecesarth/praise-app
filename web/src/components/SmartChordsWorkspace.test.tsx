import { render, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { SmartChordsWorkspace } from './SmartChordsWorkspace';

const { getArtists, getSongs, getSmartChords } = vi.hoisted(() => ({
  getArtists: vi.fn(),
  getSongs: vi.fn(),
  getSmartChords: vi.fn(),
}));

vi.mock('../api', () => ({
  api: {
    getArtists,
    getSongs,
    getSmartChords,
  },
}));

describe('SmartChordsWorkspace ministry loading', () => {
  beforeEach(() => {
    getArtists.mockResolvedValue([]);
    getSongs.mockResolvedValue({ songs: [], totalCount: 0 });
    getSmartChords.mockResolvedValue([]);
  });

  it('loads relations for the selected ministry and aborts the previous selection', async () => {
    const { rerender } = render(<SmartChordsWorkspace ministryId="ministry-a" />);

    await waitFor(() => expect(getSongs).toHaveBeenCalledWith('ministry-a', undefined, expect.any(AbortSignal)));
    const firstSignal = getSongs.mock.calls[0][2] as AbortSignal;

    rerender(<SmartChordsWorkspace ministryId="ministry-b" />);

    await waitFor(() => expect(getSongs).toHaveBeenCalledWith('ministry-b', undefined, expect.any(AbortSignal)));
    expect(firstSignal.aborted).toBe(true);
    expect(getArtists).toHaveBeenCalledWith('ministry-b', undefined, expect.any(AbortSignal));
    expect(getSmartChords).toHaveBeenCalledWith('ministry-b', undefined, expect.any(AbortSignal));
  });
});
