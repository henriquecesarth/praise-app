import { describe, it, expect } from 'vitest';
import { validateConnectionTransition } from './whatsapp-transition.validator';
import { WhatsAppConnectionRecord } from './whatsapp.types';

function createMockConnection(overrides: Partial<WhatsAppConnectionRecord> = {}): WhatsAppConnectionRecord {
  return {
    id: 'wac-test-1',
    organization_id: 'org-test-1',
    display_name: 'Atendimento Geral',
    phone_number: '+5511999998888',
    provider: 'meta_cloud_api',
    provider_waba_id: 'waba-12345',
    provider_phone_number_id: 'phone-12345',
    status: 'connected',
    status_reason: null,
    assigned_ministry_id: null,
    created_by_user_id: 'user-1',
    pending_expires_at: null,
    last_connected_at: '2026-09-11T12:00:00.000Z',
    last_health_check_at: null,
    created_at: '2026-09-11T11:00:00.000Z',
    updated_at: '2026-09-11T12:00:00.000Z',
    ...overrides,
  };
}

describe('WhatsApp Connection State Machine & Transitions Suite (Phase 7C)', () => {
  it('1. pending -> connecting (ALLOWED)', () => {
    const conn = createMockConnection({
      status: 'pending',
      phone_number: null,
      provider_waba_id: null,
      provider_phone_number_id: null,
      last_connected_at: null,
    });
    expect(() => validateConnectionTransition(conn, 'connecting')).not.toThrow();
  });

  it('2. pending -> disconnected (ALLOWED: user cancels onboarding or TTL expires)', () => {
    const conn = createMockConnection({
      status: 'pending',
      phone_number: null,
      provider_waba_id: null,
      provider_phone_number_id: null,
      last_connected_at: null,
    });
    expect(() => validateConnectionTransition(conn, 'disconnected')).not.toThrow();
  });

  it('3. pending -> connected (FORBIDDEN: must pass through connecting)', () => {
    const conn = createMockConnection({
      status: 'pending',
      phone_number: null,
      provider_waba_id: null,
      provider_phone_number_id: null,
      last_connected_at: null,
    });
    expect(() => validateConnectionTransition(conn, 'connected')).toThrow(
      /INVALID_WHATSAPP_CONNECTION_TRANSITION/
    );
  });

  it('4. pending -> error (FORBIDDEN: token errors route via connecting or expire)', () => {
    const conn = createMockConnection({
      status: 'pending',
      phone_number: null,
      provider_waba_id: null,
      provider_phone_number_id: null,
      last_connected_at: null,
    });
    expect(() => validateConnectionTransition(conn, 'error')).toThrow(
      /INVALID_WHATSAPP_CONNECTION_TRANSITION/
    );
  });

  it('5. pending -> disabled_by_user (FORBIDDEN: cannot pause incomplete signup)', () => {
    const conn = createMockConnection({
      status: 'pending',
      phone_number: null,
      provider_waba_id: null,
      provider_phone_number_id: null,
      last_connected_at: null,
    });
    expect(() => validateConnectionTransition(conn, 'disabled_by_user')).toThrow(
      /INVALID_WHATSAPP_CONNECTION_TRANSITION/
    );
  });

  it('6. connecting -> connected requires materialization (ALLOWED when materialized)', () => {
    const conn = createMockConnection({ status: 'connecting' });
    expect(() => validateConnectionTransition(conn, 'connected')).not.toThrow();
  });

  it('7. connecting -> connected fails with CONNECTION_NOT_MATERIALIZED if unmaterialized', () => {
    const conn = createMockConnection({
      status: 'connecting',
      phone_number: null,
      provider_waba_id: null,
      provider_phone_number_id: null,
    });
    expect(() => validateConnectionTransition(conn, 'connected')).toThrow(
      /CONNECTION_NOT_MATERIALIZED/
    );
  });

  it('8. connecting -> error (ALLOWED: token exchange failed or rejected)', () => {
    const conn = createMockConnection({
      status: 'connecting',
      phone_number: null,
      provider_waba_id: null,
      provider_phone_number_id: null,
      last_connected_at: null,
    });
    expect(() => validateConnectionTransition(conn, 'error')).not.toThrow();
  });

  it('9. connecting -> disconnected (ALLOWED: abort onboarding)', () => {
    const conn = createMockConnection({ status: 'connecting' });
    expect(() => validateConnectionTransition(conn, 'disconnected')).not.toThrow();
  });

  it('10. connecting -> disabled_by_user (FORBIDDEN: cannot pause mid-handshake)', () => {
    const conn = createMockConnection({ status: 'connecting' });
    expect(() => validateConnectionTransition(conn, 'disabled_by_user')).toThrow(
      /INVALID_WHATSAPP_CONNECTION_TRANSITION/
    );
  });

  it('11. connected -> error (ALLOWED: health check failure or token revoked)', () => {
    const conn = createMockConnection({ status: 'connected' });
    expect(() => validateConnectionTransition(conn, 'error')).not.toThrow();
  });

  it('12. connected -> disabled_by_user (ALLOWED: org admin pauses line)', () => {
    const conn = createMockConnection({ status: 'connected' });
    expect(() => validateConnectionTransition(conn, 'disabled_by_user')).not.toThrow();
  });

  it('13. connected -> disconnected (ALLOWED: org admin disconnects line)', () => {
    const conn = createMockConnection({ status: 'connected' });
    expect(() => validateConnectionTransition(conn, 'disconnected')).not.toThrow();
  });

  it('14. connected -> connecting (FORBIDDEN: active line does not restart handshake)', () => {
    const conn = createMockConnection({ status: 'connected' });
    expect(() => validateConnectionTransition(conn, 'connecting')).toThrow(
      /INVALID_WHATSAPP_CONNECTION_TRANSITION/
    );
  });

  it('15. error -> connecting (ALLOWED: re-auth or token refresh initiated)', () => {
    const conn = createMockConnection({ status: 'error' });
    expect(() => validateConnectionTransition(conn, 'connecting')).not.toThrow();
  });

  it('16. error -> connected (ALLOWED when materialized)', () => {
    const conn = createMockConnection({ status: 'error' });
    expect(() => validateConnectionTransition(conn, 'connected')).not.toThrow();
  });

  it('17. error -> connected fails with CONNECTION_NOT_MATERIALIZED if unmaterialized', () => {
    const conn = createMockConnection({
      status: 'error',
      phone_number: null,
      provider_waba_id: null,
      provider_phone_number_id: null,
    });
    expect(() => validateConnectionTransition(conn, 'connected')).toThrow(
      /CONNECTION_NOT_MATERIALIZED/
    );
  });

  it('18. error -> disabled_by_user strictly FORBIDDEN if last_connected_at === null (DEC-7C-04 / DEC-7C-15)', () => {
    const conn = createMockConnection({
      status: 'error',
      last_connected_at: null, // Never previously connected!
    });
    expect(() => validateConnectionTransition(conn, 'disabled_by_user')).toThrow(
      /INVALID_WHATSAPP_CONNECTION_TRANSITION/
    );
  });

  it('19. error -> disabled_by_user strictly FORBIDDEN if unmaterialized', () => {
    const conn = createMockConnection({
      status: 'error',
      phone_number: null,
      provider_waba_id: null,
      provider_phone_number_id: null,
      last_connected_at: '2026-09-11T10:00:00Z',
    });
    expect(() => validateConnectionTransition(conn, 'disabled_by_user')).toThrow(
      /INVALID_WHATSAPP_CONNECTION_TRANSITION/
    );
  });

  it('20. error -> disabled_by_user ALLOWED if previously connected and materialized', () => {
    const conn = createMockConnection({
      status: 'error',
      last_connected_at: '2026-09-11T10:00:00Z',
    });
    expect(() => validateConnectionTransition(conn, 'disabled_by_user')).not.toThrow();
  });

  it('21. error -> disconnected (ALLOWED: admin unlinks problematic line)', () => {
    const conn = createMockConnection({ status: 'error' });
    expect(() => validateConnectionTransition(conn, 'disconnected')).not.toThrow();
  });

  it('22. disabled_by_user -> connected (ALLOWED: org admin resumes line)', () => {
    const conn = createMockConnection({ status: 'disabled_by_user' });
    expect(() => validateConnectionTransition(conn, 'connected')).not.toThrow();
  });

  it('23. disabled_by_user -> disconnected (ALLOWED: org admin disconnects line)', () => {
    const conn = createMockConnection({ status: 'disabled_by_user' });
    expect(() => validateConnectionTransition(conn, 'disconnected')).not.toThrow();
  });

  it('24. disabled_by_user -> error (FORBIDDEN: paused line is not health-checked)', () => {
    const conn = createMockConnection({ status: 'disabled_by_user' });
    expect(() => validateConnectionTransition(conn, 'error')).toThrow(
      /INVALID_WHATSAPP_CONNECTION_TRANSITION/
    );
  });

  it('25. disabled_by_user -> connecting (FORBIDDEN)', () => {
    const conn = createMockConnection({ status: 'disabled_by_user' });
    expect(() => validateConnectionTransition(conn, 'connecting')).toThrow(
      /INVALID_WHATSAPP_CONNECTION_TRANSITION/
    );
  });

  it('26. disconnected is strictly TERMINAL (all outbound transitions fail closed)', () => {
    const conn = createMockConnection({ status: 'disconnected' });
    const targets = ['pending', 'connecting', 'connected', 'error', 'disabled_by_user'] as const;

    for (const target of targets) {
      expect(() => validateConnectionTransition(conn, target)).toThrow(
        /INVALID_WHATSAPP_CONNECTION_TRANSITION/
      );
    }
  });

  it('27. Same status transition is a safe no-op', () => {
    const conn = createMockConnection({ status: 'connected' });
    expect(() => validateConnectionTransition(conn, 'connected')).not.toThrow();
  });
});
