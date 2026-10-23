import { api } from '../api';

export const SUPPORTED_CHORD_FONTS = [
  'monospace',
  'Arial',
  'Times New Roman',
  'Georgia',
  'Verdana',
  'Courier New',
] as const;

export type SupportedChordFont = (typeof SUPPORTED_CHORD_FONTS)[number];

export const CHORD_FONT_CHANGED_EVENT = 'louvaio_chord_font_changed';

export interface PreferenceWriterConfig {
  updateUserPreferences?: (prefs: { chordFontFamily: string }) => Promise<{ preferences: { chordFontFamily?: string } }>;
  onConfirmed?: (font: string, userId: string) => void;
  onError?: (error: unknown, font: string, userId: string) => void;
}

interface SessionState {
  readonly generation: number;
  userId: string | null;
  inFlight: boolean;
  pendingTarget: {
    font: string;
    userId: string;
    resolve: (font: string) => void;
    reject: (err: unknown) => void;
  } | null;
  latestRequestedFont: string | null;
  latestConfirmedFont: string | null;
}

export class PreferenceWriter {
  private sessionGeneration = 1;
  private currentSession: SessionState = this.createSession(1, null);

  constructor(private config: PreferenceWriterConfig = {}) {}

  private createSession(
    generation: number,
    userId: string | null,
    initialFont?: string
  ): SessionState {
    return {
      generation,
      userId,
      inFlight: false,
      pendingTarget: null,
      latestRequestedFont: initialFont || null,
      latestConfirmedFont: initialFont || null,
    };
  }

  public setSession(userId: string | null, initialFont?: string): void {
    if (this.currentSession.userId !== userId) {
      // Account switching invalidates pending local intentions from the old session
      if (this.currentSession.pendingTarget) {
        this.currentSession.pendingTarget.resolve(this.currentSession.pendingTarget.font);
        this.currentSession.pendingTarget = null;
      }
      this.sessionGeneration++;
      this.currentSession = this.createSession(this.sessionGeneration, userId, initialFont);
    } else if (initialFont && !this.currentSession.latestRequestedFont) {
      this.currentSession.latestRequestedFont = initialFont;
      this.currentSession.latestConfirmedFont = initialFont;
    }
  }

  public getActiveUserId(): string | null {
    return this.currentSession.userId;
  }

  public getSessionGeneration(): number {
    return this.currentSession.generation;
  }

  public isInFlight(): boolean {
    return this.currentSession.inFlight;
  }

  public getLatestRequestedFont(): string | null {
    return this.currentSession.latestRequestedFont;
  }

  public getLatestConfirmedFont(): string | null {
    return this.currentSession.latestConfirmedFont;
  }

  public async updateFont(font: string, userId?: string | null): Promise<string> {
    const effectiveFont = SUPPORTED_CHORD_FONTS.includes(font as any) ? font : 'monospace';
    const targetUserId = userId !== undefined ? userId : this.currentSession.userId;

    if (targetUserId !== this.currentSession.userId) {
      this.setSession(targetUserId, effectiveFont);
    }

    const session = this.currentSession;
    session.latestRequestedFont = effectiveFont;

    if (!targetUserId) {
      // Unauthenticated session: save to local cache only
      try {
        localStorage.setItem('louvaio_smart_chord_font_family', effectiveFont);
        window.dispatchEvent(
          new CustomEvent(CHORD_FONT_CHANGED_EVENT, { detail: { font: effectiveFont } })
        );
      } catch {
        // ignore storage errors
      }
      return effectiveFont;
    }

    // Save to user-specific localStorage immediately
    try {
      localStorage.setItem(`louvaio_chord_font_user_${targetUserId}`, effectiveFont);
      localStorage.setItem('louvaio_last_auth_user_id', targetUserId);
      localStorage.setItem('louvaio_smart_chord_font_family', effectiveFont);
      window.dispatchEvent(
        new CustomEvent(CHORD_FONT_CHANGED_EVENT, { detail: { font: effectiveFont, userId: targetUserId } })
      );
    } catch {
      // ignore storage errors
    }

    return new Promise<string>((resolve, reject) => {
      this.enqueue(session, targetUserId, effectiveFont, resolve, reject);
    });
  }

  private enqueue(
    session: SessionState,
    userId: string,
    font: string,
    resolve: (font: string) => void,
    reject: (err: unknown) => void
  ): void {
    // If session was already obsoleted before enqueue, resolve predictably
    if (session.generation !== this.currentSession.generation) {
      resolve(font);
      return;
    }

    if (session.inFlight) {
      // Coalesce! Replace any pending target with the latest choice
      if (session.pendingTarget) {
        session.pendingTarget.resolve(font);
      }
      session.pendingTarget = { font, userId, resolve, reject };
      return;
    }

    this.executeWrite(session, userId, font, resolve, reject);
  }

  private async executeWrite(
    session: SessionState,
    userId: string,
    font: string,
    resolve: (font: string) => void,
    reject: (err: unknown) => void
  ): Promise<void> {
    session.inFlight = true;

    const updater = this.config.updateUserPreferences || api.updateUserPreferences;

    try {
      const res = await updater({ chordFontFamily: font });

      // Verify session has not been obsoleted while write was in flight
      if (session.generation === this.currentSession.generation && session.userId === userId) {
        const confirmedFont = res?.preferences?.chordFontFamily || font;
        if (session.latestRequestedFont === font) {
          session.latestConfirmedFont = confirmedFont;
        }
        this.config.onConfirmed?.(confirmedFont, userId);
      }
      resolve(font);
    } catch (err) {
      // Failed write does not falsely report success
      if (session.generation === this.currentSession.generation && session.userId === userId) {
        this.config.onError?.(err, font, userId);
      }
      reject(err);
    } finally {
      session.inFlight = false;

      // Only drain queued coalesced write if this session is still the active session!
      if (session.generation === this.currentSession.generation) {
        if (session.pendingTarget) {
          const next = session.pendingTarget;
          session.pendingTarget = null;

          if (next.userId === session.userId) {
            this.executeWrite(session, next.userId, next.font, next.resolve, next.reject);
          }
        }
      }
    }
  }

  public reset(): void {
    if (this.currentSession.pendingTarget) {
      this.currentSession.pendingTarget.resolve(this.currentSession.pendingTarget.font);
      this.currentSession.pendingTarget = null;
    }
    this.sessionGeneration++;
    this.currentSession = this.createSession(this.sessionGeneration, null);
  }
}

export const preferenceWriter = new PreferenceWriter();