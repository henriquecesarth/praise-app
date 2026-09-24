import { useState, useEffect, useMemo, useCallback, useRef } from 'react';
import { Layers, AlertCircle, RefreshCw, PlusCircle } from 'lucide-react';
import { api } from '../../api';
import type { WhatsAppConnectionDto } from '../../whatsapp.types';
import { classifyWhatsAppError } from '../../whatsapp-errors';
import { WhatsAppConnectionCard } from './WhatsAppConnectionCard';
import { WhatsAppDisconnectModal } from './WhatsAppDisconnectModal';

export interface WhatsAppConnectionListProps {
  organizationId: string;
  ministryId: string;
  initialConnections?: WhatsAppConnectionDto[];
  initialNextCursor?: string | null;
  canCreateConnection?: boolean;
  canResume?: boolean;
  onOpenConnect?: () => void;
  onResumeConnection?: (connection: WhatsAppConnectionDto) => void;
  onMutationSuccess?: () => void;
  showToast?: (msg: string, type?: 'success' | 'error') => void;
}

function deduplicateConnections(
  existing: WhatsAppConnectionDto[],
  incoming: WhatsAppConnectionDto[]
): WhatsAppConnectionDto[] {
  const seen = new Set(existing.map((c) => c.id));
  const newItems = incoming.filter((c) => {
    if (seen.has(c.id)) {
      return false;
    }
    seen.add(c.id);
    return true;
  });
  return [...existing, ...newItems];
}

export function WhatsAppConnectionList({
  organizationId,
  ministryId,
  initialConnections,
  initialNextCursor = null,
  canCreateConnection = false,
  canResume = false,
  onOpenConnect,
  onResumeConnection,
  onMutationSuccess,
  showToast,
}: WhatsAppConnectionListProps) {
  const [connections, setConnections] = useState<WhatsAppConnectionDto[]>(
    initialConnections || []
  );
  const [loading, setLoading] = useState(initialConnections === undefined);
  const [loadingMore, setLoadingMore] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [nextCursor, setNextCursor] = useState<string | null>(initialNextCursor);

  const [availableMinistries, setAvailableMinistries] = useState<
    Array<{ id: string; name: string }>
  >([]);

  // Disconnect modal state
  const [disconnectCandidate, setDisconnectCandidate] =
    useState<WhatsAppConnectionDto | null>(null);
  const [disconnectSubmitting, setDisconnectSubmitting] = useState(false);
  const [disconnectError, setDisconnectError] = useState<string | null>(null);

  const generationRef = useRef(0);
  const organizationIdRef = useRef(organizationId);
  const ministryIdRef = useRef(ministryId);
  const inFlightCursorRef = useRef<string | null>(null);
  const isMountedRef = useRef(true);

  useEffect(() => {
    isMountedRef.current = true;
    return () => {
      isMountedRef.current = false;
      generationRef.current++;
    };
  }, []);

  // Sync with initialConnections if updated by parent
  useEffect(() => {
    if (initialConnections !== undefined) {
      setConnections(initialConnections);
    }
  }, [initialConnections]);

  useEffect(() => {
    if (initialNextCursor !== undefined) {
      setNextCursor(initialNextCursor);
    }
  }, [initialNextCursor]);

  // Load connections function
  const fetchConnections = useCallback(async () => {
    const currentGen = generationRef.current;
    const currentOrg = organizationId;
    setLoading(true);
    setError(null);
    try {
      const [connsRes, ministriesRes] = await Promise.all([
        api.listWhatsAppConnections(currentOrg, { limit: 10 }),
        api.getMyMinistries().catch(() => []),
      ]);

      if (
        !isMountedRef.current ||
        currentGen !== generationRef.current ||
        currentOrg !== organizationIdRef.current
      ) {
        return;
      }
      setConnections(connsRes.items || []);
      setNextCursor(connsRes.nextCursor);
      if (Array.isArray(ministriesRes)) {
        setAvailableMinistries(ministriesRes.map((m) => ({ id: m.id, name: m.name })));
      }
    } catch (err) {
      if (
        !isMountedRef.current ||
        currentGen !== generationRef.current ||
        currentOrg !== organizationIdRef.current
      ) {
        return;
      }
      setError(classifyWhatsAppError(err).userMessage);
    } finally {
      if (
        isMountedRef.current &&
        currentGen === generationRef.current &&
        currentOrg === organizationIdRef.current
      ) {
        setLoading(false);
      }
    }
  }, [organizationId]);

  const fetchMinistries = useCallback(async () => {
    const currentGen = generationRef.current;
    const currentOrg = organizationId;
    try {
      const mList = await api.getMyMinistries();
      if (
        !isMountedRef.current ||
        currentGen !== generationRef.current ||
        currentOrg !== organizationIdRef.current
      ) {
        return;
      }
      if (Array.isArray(mList)) {
        setAvailableMinistries(mList.map((m) => ({ id: m.id, name: m.name })));
      }
    } catch {
      // Ignored
    }
  }, [organizationId]);

  // Initial fetch and tenant isolation
  useEffect(() => {
    generationRef.current++;
    organizationIdRef.current = organizationId;
    ministryIdRef.current = ministryId;
    inFlightCursorRef.current = null;
    setLoadingMore(false);
    setDisconnectCandidate(null);
    setDisconnectSubmitting(false);
    setDisconnectError(null);
    setError(null);

    if (initialConnections === undefined) {
      setConnections([]);
      setNextCursor(null);
      fetchConnections();
    } else {
      setConnections(initialConnections);
      setNextCursor(initialNextCursor ?? null);
      fetchMinistries();
    }

    return () => {
      setDisconnectCandidate(null);
    };
  }, [organizationId, ministryId]);

  // Handle Load More (Pagination)
  const handleLoadMore = async () => {
    if (!nextCursor || loadingMore || inFlightCursorRef.current === nextCursor) {
      return;
    }

    const currentCursor = nextCursor;
    const currentGen = generationRef.current;
    const currentOrg = organizationId;

    inFlightCursorRef.current = currentCursor;
    setLoadingMore(true);

    try {
      const res = await api.listWhatsAppConnections(currentOrg, {
        limit: 10,
        cursor: currentCursor,
      });

      if (
        !isMountedRef.current ||
        currentGen !== generationRef.current ||
        currentOrg !== organizationIdRef.current
      ) {
        return;
      }

      setConnections((prev) => deduplicateConnections(prev, res.items || []));
      setNextCursor(res.nextCursor);
    } catch (err) {
      if (
        !isMountedRef.current ||
        currentGen !== generationRef.current ||
        currentOrg !== organizationIdRef.current
      ) {
        return;
      }
      showToast?.(classifyWhatsAppError(err).userMessage, 'error');
    } finally {
      if (
        isMountedRef.current &&
        currentGen === generationRef.current &&
        currentOrg === organizationIdRef.current
      ) {
        inFlightCursorRef.current = null;
        setLoadingMore(false);
      }
    }
  };

  // Handle Connection Updated (Inline edit, Default, Assignment)
  const handleConnectionUpdated = (updated: WhatsAppConnectionDto) => {
    if (!isMountedRef.current) return;
    setConnections((prev) =>
      prev.map((c) => {
        if (c.id === updated.id) {
          return updated;
        }
        // If this update set a new default, clear default on other connections
        if (updated.isOrganizationDefault && c.isOrganizationDefault) {
          return { ...c, isOrganizationDefault: false };
        }
        return c;
      })
    );
    onMutationSuccess?.();
  };

  // Handle Disconnect Confirm
  const handleConfirmDisconnect = async () => {
    if (!disconnectCandidate || disconnectSubmitting) return;

    const currentGen = generationRef.current;
    const currentOrg = organizationId;
    const candidateId = disconnectCandidate.id;

    setDisconnectSubmitting(true);
    setDisconnectError(null);

    try {
      await api.disconnectWhatsAppConnection(currentOrg, candidateId);

      if (
        !isMountedRef.current ||
        currentGen !== generationRef.current ||
        currentOrg !== organizationIdRef.current
      ) {
        return;
      }

      showToast?.('Conexão desconectada com sucesso.', 'success');
      setDisconnectCandidate(null);
      setDisconnectSubmitting(false);

      // Trigger authoritative refetch of connections, capacity, and ministry status
      onMutationSuccess?.();
    } catch (err) {
      if (
        !isMountedRef.current ||
        currentGen !== generationRef.current ||
        currentOrg !== organizationIdRef.current
      ) {
        return;
      }
      setDisconnectError(classifyWhatsAppError(err).userMessage);
      setDisconnectSubmitting(false);
    }
  };

  // Build complete list of ministries for assignment (ensures current ministryId is included)
  const effectiveMinistries = useMemo(() => {
    const map = new Map<string, string>();
    if (ministryId) {
      map.set(ministryId, 'Ministério Atual');
    }
    for (const m of availableMinistries) {
      map.set(m.id, m.name);
    }
    return Array.from(map.entries()).map(([id, name]) => ({ id, name }));
  }, [ministryId, availableMinistries]);

  return (
    <div
      className="whatsapp-connection-list"
      data-testid="whatsapp-connection-list"
      style={{ marginTop: '24px' }}
    >
      {/* Header */}
      <div
        style={{
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'space-between',
          marginBottom: '16px',
          flexWrap: 'wrap',
          gap: '10px',
        }}
      >
        <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
          <Layers size={20} style={{ color: 'var(--primary-color)' }} />
          <h2 style={{ fontSize: '1.15rem', fontWeight: 700, margin: 0, color: 'var(--text-primary)' }}>
            Conexões da Organização {!loading && `(${connections.length})`}
          </h2>
        </div>

        {onOpenConnect && (
          <button
            type="button"
            className="btn btn-primary min-h-[44px]"
            data-testid="add-connection-btn"
            disabled={!canCreateConnection || loading}
            onClick={onOpenConnect}
            style={{
              minHeight: '44px',
              display: 'inline-flex',
              alignItems: 'center',
              gap: '6px',
              padding: '8px 16px',
              fontSize: '0.9rem',
              fontWeight: 600,
            }}
          >
            <PlusCircle size={16} />
            <span>Nova Conexão</span>
          </button>
        )}
      </div>

      {/* Loading state */}
      {loading && (
        <div
          role="status"
          aria-live="polite"
          data-testid="connections-loading"
          style={{
            padding: '30px 20px',
            textAlign: 'center',
            background: 'var(--surface-color)',
            borderRadius: '12px',
            border: '1px solid var(--border-color)',
          }}
        >
          <div
            className="shimmer loading-spinner"
            style={{
              width: '36px',
              height: '36px',
              borderRadius: '50%',
              margin: '0 auto 12px',
              border: '3px solid var(--primary-color)',
              borderTopColor: 'transparent',
              animation: 'spin 1s linear infinite',
            }}
          />
          <p style={{ color: 'var(--text-secondary)', margin: 0 }}>Carregando conexões…</p>
        </div>
      )}

      {/* Error state */}
      {error && !loading && (
        <div
          role="alert"
          data-testid="connections-error"
          style={{
            padding: '24px 20px',
            textAlign: 'center',
            background: 'var(--surface-color)',
            borderRadius: '12px',
            border: '1px solid var(--border-color)',
          }}
        >
          <AlertCircle size={36} style={{ color: 'var(--error-color, #ef4444)', margin: '0 auto 10px' }} />
          <h4 style={{ margin: '0 0 6px', color: 'var(--text-primary)' }}>Erro ao carregar conexões</h4>
          <p style={{ color: 'var(--text-secondary)', marginBottom: '14px' }}>{error}</p>
          <button
            type="button"
            className="btn btn-primary min-h-[44px]"
            data-testid="retry-connections-btn"
            onClick={() => fetchConnections()}
            style={{
              minHeight: '44px',
              display: 'inline-flex',
              alignItems: 'center',
              gap: '8px',
              padding: '8px 18px',
            }}
          >
            <RefreshCw size={15} />
            <span>Tentar novamente</span>
          </button>
        </div>
      )}

      {/* Empty state */}
      {!loading && !error && connections.length === 0 && (
        <div
          data-testid="connections-empty"
          style={{
            padding: '36px 20px',
            textAlign: 'center',
            background: 'var(--surface-color)',
            borderRadius: '12px',
            border: '1px solid var(--border-color)',
          }}
        >
          <p style={{ color: 'var(--text-secondary)', fontSize: '0.94rem', margin: '0 0 12px' }}>
            Nenhuma conexão do WhatsApp configurada para esta organização.
          </p>
          {onOpenConnect && (
            <button
              type="button"
              className="btn btn-primary min-h-[44px]"
              data-testid="empty-connect-btn"
              disabled={!canCreateConnection}
              onClick={onOpenConnect}
              style={{
                minHeight: '44px',
                display: 'inline-flex',
                alignItems: 'center',
                gap: '8px',
                padding: '10px 18px',
                fontWeight: 600,
              }}
            >
              <PlusCircle size={16} />
              <span>Conectar primeiro número</span>
            </button>
          )}
        </div>
      )}

      {/* Connection cards */}
      {!loading && !error && connections.length > 0 && (
        <div style={{ display: 'flex', flexDirection: 'column' }}>
          {connections.map((conn) => (
            <WhatsAppConnectionCard
              key={conn.id}
              connection={conn}
              organizationId={organizationId}
              availableMinistries={effectiveMinistries}
              onConnectionUpdated={handleConnectionUpdated}
              onRequestDisconnect={(c) => {
                setDisconnectCandidate(c);
                setDisconnectError(null);
              }}
              onResume={onResumeConnection}
              canResume={canResume}
            />
          ))}

          {/* Pagination: Load More */}
          {nextCursor && (
            <div style={{ textAlign: 'center', marginTop: '10px' }}>
              <button
                type="button"
                className="btn btn-secondary min-h-[44px]"
                data-testid="load-more-connections-btn"
                onClick={handleLoadMore}
                disabled={loadingMore}
                style={{
                  minHeight: '44px',
                  display: 'inline-flex',
                  alignItems: 'center',
                  gap: '8px',
                  padding: '10px 24px',
                  fontWeight: 600,
                }}
              >
                {loadingMore ? (
                  <>
                    <RefreshCw size={16} className="spin" />
                    <span>Carregando…</span>
                  </>
                ) : (
                  <span>Carregar mais conexões</span>
                )}
              </button>
            </div>
          )}
        </div>
      )}

      {/* Disconnect Confirmation Modal */}
      {disconnectCandidate && (
        <WhatsAppDisconnectModal
          isOpen={Boolean(disconnectCandidate)}
          onClose={() => {
            if (!disconnectSubmitting) {
              setDisconnectCandidate(null);
              setDisconnectError(null);
            }
          }}
          connection={disconnectCandidate}
          onConfirm={handleConfirmDisconnect}
          submitting={disconnectSubmitting}
          error={disconnectError}
        />
      )}
    </div>
  );
}
