import { describe, it, expect, beforeEach } from 'vitest';
import { PreferenceWriter } from './preferenceWriter';

describe('PreferenceWriter Session Queue Isolation', () => {
  beforeEach(() => {
    localStorage.clear();
  });

  it('reproduces defect: A pending -> logout -> B selects Arial -> B selects Verdana -> A completes -> two concurrent B PATCHes and reversed completion', async () => {
    let concurrentPatchesForB = 0;
    let maxConcurrentPatchesForB = 0;
    const patchHistory: { userId: string; font: string }[] = [];

    let resolveA!: (val: any) => void;
    let resolveBArial!: (val: any) => void;
    let resolveBVerdana!: (val: any) => void;

    const writer = new PreferenceWriter({
      updateUserPreferences: async ({ chordFontFamily }) => {
        const uid = writer.getActiveUserId() || '';
        patchHistory.push({ userId: uid, font: chordFontFamily });

        if (uid === 'user-b') {
          concurrentPatchesForB++;
          if (concurrentPatchesForB > maxConcurrentPatchesForB) {
            maxConcurrentPatchesForB = concurrentPatchesForB;
          }
        }

        if (uid === 'user-a' && chordFontFamily === 'Georgia') {
          return new Promise((resolve) => { resolveA = resolve; });
        }
        if (uid === 'user-b' && chordFontFamily === 'Arial') {
          return new Promise((resolve) => { resolveBArial = resolve; });
        }
        if (uid === 'user-b' && chordFontFamily === 'Verdana') {
          return new Promise((resolve) => { resolveBVerdana = resolve; });
        }
        return { preferences: { chordFontFamily } };
      },
    });

    // 1. Account A starts a PATCH that remains pending
    writer.setSession('user-a', 'monospace');
    const pA = writer.updateFont('Georgia');
    expect(patchHistory).toEqual([{ userId: 'user-a', font: 'Georgia' }]);

    // 2. Logout calls PreferenceWriter.reset()
    writer.reset();

    // 3. Account B starts a new session
    writer.setSession('user-b', 'monospace');

    // 4. B selects Arial, then Verdana
    const pBArial = writer.updateFont('Arial');
    const pBVerdana = writer.updateFont('Verdana');

    // Arial is in-flight for B, Verdana must be queued waiting for Arial
    expect(patchHistory).toEqual([
      { userId: 'user-a', font: 'Georgia' },
      { userId: 'user-b', font: 'Arial' },
    ]);
    expect(concurrentPatchesForB).toBe(1);

    // 5. A's old PATCH completes!
    resolveA({ preferences: { chordFontFamily: 'Georgia' } });
    await pA;

    // In unfixed code: A's finally block prematurely drained B's queue,
    // firing B's Verdana while B's Arial is still in flight!
    // B must NEVER have more than 1 concurrent PATCH!
    expect(patchHistory.filter((p) => p.userId === 'user-b')).toHaveLength(1);
    expect(maxConcurrentPatchesForB).toBe(1);

    // 6. Complete B's Arial
    concurrentPatchesForB--;
    resolveBArial({ preferences: { chordFontFamily: 'Arial' } });
    await pBArial;

    // Now B's Verdana should be dispatched
    expect(patchHistory.filter((p) => p.userId === 'user-b')).toHaveLength(2);

    // 7. Complete B's Verdana
    concurrentPatchesForB--;
    resolveBVerdana({ preferences: { chordFontFamily: 'Verdana' } });
    await pBVerdana;

    // Persisted font must be Verdana
    expect(writer.getLatestConfirmedFont()).toBe('Verdana');
  });

  it('same-UID reauthentication does not reactivate obsolete callbacks or drain new session queue', async () => {
    let concurrentPatches = 0;
    let maxConcurrentPatches = 0;
    const patchHistory: { generation: number; font: string }[] = [];

    let resolveSession1!: (val: any) => void;
    let resolveSession3Arial!: (val: any) => void;
    let resolveSession3Verdana!: (val: any) => void;

    const writer = new PreferenceWriter({
      updateUserPreferences: async ({ chordFontFamily }) => {
        const gen = writer.getSessionGeneration();
        patchHistory.push({ generation: gen, font: chordFontFamily });

        if (gen === 4) {
          concurrentPatches++;
          if (concurrentPatches > maxConcurrentPatches) {
            maxConcurrentPatches = concurrentPatches;
          }
        }

        if (gen === 2 && chordFontFamily === 'Georgia') {
          return new Promise((resolve) => { resolveSession1 = resolve; });
        }
        if (gen === 4 && chordFontFamily === 'Arial') {
          return new Promise((resolve) => { resolveSession3Arial = resolve; });
        }
        if (gen === 4 && chordFontFamily === 'Verdana') {
          return new Promise((resolve) => { resolveSession3Verdana = resolve; });
        }
        return { preferences: { chordFontFamily } };
      },
    });

    // 1. Session 1 for user-a: starts Georgia (pending)
    writer.setSession('user-a', 'monospace');
    expect(writer.getSessionGeneration()).toBe(2); // Initial 1 -> setSession user-a => 2
    const p1 = writer.updateFont('Georgia');

    // 2. Logout
    writer.reset();
    expect(writer.getSessionGeneration()).toBe(3);

    // 3. User A logs in AGAIN with the same UID: establishes session generation 4
    writer.setSession('user-a', 'monospace');
    expect(writer.getSessionGeneration()).toBe(4);

    // 4. In session 4, selects Arial, then Verdana
    const pArial = writer.updateFont('Arial');
    const pVerdana = writer.updateFont('Verdana');

    // Arial is dispatched, Verdana is queued for session 4
    expect(writer.isInFlight()).toBe(true);

    // 5. Session 2 (the first session with user-a) completes late!
    resolveSession1({ preferences: { chordFontFamily: 'Georgia' } });
    await p1;

    // Session 2's finally MUST NOT drain Session 4's queue
    // Session 4 must still have only 1 in-flight write (Arial)
    expect(writer.getLatestConfirmedFont()).toBe('monospace');

    // 6. Complete Arial in Session 4
    resolveSession3Arial({ preferences: { chordFontFamily: 'Arial' } });
    await pArial;

    // 7. Complete Verdana in Session 4
    resolveSession3Verdana({ preferences: { chordFontFamily: 'Verdana' } });
    await pVerdana;

    expect(writer.getLatestConfirmedFont()).toBe('Verdana');
  });

  it('discarded pending updates and their promises settle predictably without hanging', async () => {
    let resolveFirst!: (val: any) => void;

    const writer = new PreferenceWriter({
      updateUserPreferences: async ({ chordFontFamily }) => {
        if (chordFontFamily === 'Arial') {
          return new Promise((resolve) => { resolveFirst = resolve; });
        }
        return { preferences: { chordFontFamily } };
      },
    });

    writer.setSession('user-a', 'monospace');

    // Arial in-flight
    const pArial = writer.updateFont('Arial');
    // Georgia queued
    const pGeorgia = writer.updateFont('Georgia');

    // User logs out while Georgia is queued
    writer.reset();

    // The queued promise pGeorgia must settle predictably (not hang forever)
    const georgiaResult = await pGeorgia;
    expect(georgiaResult).toBe('Georgia');

    // When Arial finally finishes, it also settles
    resolveFirst({ preferences: { chordFontFamily: 'Arial' } });
    const arialResult = await pArial;
    expect(arialResult).toBe('Arial');
  });

  it('earlier failed writes do not block newer valid writes (failure recovery)', async () => {
    const executed: string[] = [];

    const writer = new PreferenceWriter({
      updateUserPreferences: async ({ chordFontFamily }) => {
        executed.push(chordFontFamily);
        if (chordFontFamily === 'Arial') {
          throw new Error('Network timeout');
        }
        return { preferences: { chordFontFamily } };
      },
    });

    writer.setSession('user-a', 'monospace');

    // First write fails
    await expect(writer.updateFont('Arial')).rejects.toThrow('Network timeout');
    expect(executed).toEqual(['Arial']);
    expect(writer.isInFlight()).toBe(false);

    // Subsequent write succeeds
    const confirmed = await writer.updateFont('Georgia');
    expect(confirmed).toBe('Georgia');
    expect(executed).toEqual(['Arial', 'Georgia']);
    expect(writer.getLatestConfirmedFont()).toBe('Georgia');
  });
});
