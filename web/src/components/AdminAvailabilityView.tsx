import { useState, useEffect, useCallback, useRef } from 'react';
import { api } from '../api';
import { ConsolidatedAvailabilityItem } from '../types';
import {
  ChevronLeft, CalendarDays, Clock,
  Check, AlertCircle, RefreshCw
} from 'lucide-react';

interface Props {
  ministryId: string;
  onBack: () => void;
  showToast?: (msg: string, type?: 'success' | 'error') => void;
}

type PresetKey = '7d' | '15d' | '30d' | 'this_month' | 'custom';

function pad2(n: number): string {
  return String(n).padStart(2, '0');
}

function formatDateISO(d: Date): string {
  return `${d.getFullYear()}-${pad2(d.getMonth() + 1)}-${pad2(d.getDate())}`;
}

function addDaysToDate(dateStr: string, days: number): string {
  const [y, m, d] = dateStr.split('-').map(Number);
  const date = new Date(y, m - 1, d + days);
  return formatDateISO(date);
}

function getPresetDates(preset: '7d' | '15d' | '30d' | 'this_month'): { from: string; to: string } {
  const now = new Date();
  const todayStr = formatDateISO(now);
  if (preset === '7d') {
    return { from: todayStr, to: addDaysToDate(todayStr, 6) };
  }
  if (preset === '15d') {
    return { from: todayStr, to: addDaysToDate(todayStr, 14) };
  }
  if (preset === '30d') {
    return { from: todayStr, to: addDaysToDate(todayStr, 29) };
  }
  // this_month
  const firstDay = `${now.getFullYear()}-${pad2(now.getMonth() + 1)}-01`;
  const nextMonthFirst = new Date(now.getFullYear(), now.getMonth() + 1, 1);
  const lastDayDate = new Date(nextMonthFirst.getTime() - 24 * 60 * 60 * 1000);
  const lastDay = formatDateISO(lastDayDate);
  return { from: firstDay, to: lastDay };
}

function formatDateBR(dateStr?: string | null): string {
  if (!dateStr) return '';
  const cleanStr = dateStr.split('T')[0];
  const parts = cleanStr.split('-');
  if (parts.length === 3) {
    const [year, month, day] = parts;
    return `${day.padStart(2, '0')}/${month.padStart(2, '0')}/${year}`;
  }
  return dateStr;
}

function calculateInclusiveDays(fromStr: string, toStr: string): number {
  if (!fromStr || !toStr) return 0;
  const [y1, m1, d1] = fromStr.split('-').map(Number);
  const [y2, m2, d2] = toStr.split('-').map(Number);
  const t1 = Date.UTC(y1, m1 - 1, d1);
  const t2 = Date.UTC(y2, m2 - 1, d2);
  if (t2 < t1) return -1;
  return Math.round((t2 - t1) / (24 * 60 * 60 * 1000)) + 1;
}

export function AdminAvailabilityView({ ministryId, onBack, showToast: _showToast }: Props) {
  const [items, setItems] = useState<ConsolidatedAvailabilityItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [isQueryTooLarge, setIsQueryTooLarge] = useState(false);
  const [nextCursor, setNextCursor] = useState<string | null>(null);
  const [loadingMore, setLoadingMore] = useState(false);

  // Filter & Range State
  const [selectedPreset, setSelectedPreset] = useState<PresetKey>('30d');
  const initialDates = getPresetDates('30d');
  const [fromDate, setFromDate] = useState(initialDates.from);
  const [toDate, setToDate] = useState(initialDates.to);
  const [selectedMemberId, setSelectedMemberId] = useState<string>('');

  // Members list for dropdown
  const [members, setMembers] = useState<Array<{ id: string; name: string }>>([]);

  // Race condition protection token
  const requestIdRef = useRef(0);

  // Synchronously reset tenant-scoped state during render on ministry switch (FINDING-6D1-002)
  const [prevMinistryId, setPrevMinistryId] = useState(ministryId);
  if (ministryId !== prevMinistryId) {
    setPrevMinistryId(ministryId);
    setSelectedMemberId('');
    setMembers([]);
    setItems([]);
    setNextCursor(null);
    setError(null);
    setIsQueryTooLarge(false);
    setLoading(true);
  }

  // Load ministry members for dropdown filter
  useEffect(() => {
    let active = true;
    api.getMinistryMembers(ministryId)
      .then((data) => {
        if (active) {
          setMembers((data || []).map((m) => ({ id: m.id, name: m.name })));
        }
      })
      .catch((err) => {
        console.warn('Erro ao carregar integrantes para filtro:', err);
      });
    return () => {
      active = false;
    };
  }, [ministryId]);

  // Load consolidated availability
  const loadAvailability = useCallback(
    async (cursorToUse?: string) => {
      const isInitial = !cursorToUse;
      if (isInitial) {
        setLoading(true);
        setError(null);
        setIsQueryTooLarge(false);
      } else {
        setLoadingMore(true);
      }

      // Validação do intervalo
      const inclusiveDays = calculateInclusiveDays(fromDate, toDate);
      if (inclusiveDays < 0) {
        setLoading(false);
        setError('A data final não pode ser anterior à data inicial.');
        return;
      }
      if (inclusiveDays > 90) {
        setLoading(false);
        setError(`O período de consulta não pode exceder 90 dias civis (selecionado: ${inclusiveDays} dias).`);
        return;
      }

      const reqId = ++requestIdRef.current;

      try {
        const response = await api.getConsolidatedAvailability(ministryId, {
          from: fromDate,
          to: toDate,
          memberId: selectedMemberId || undefined,
          limit: 50,
          cursor: cursorToUse,
        });

        if (reqId !== requestIdRef.current) return;

        if (isInitial) {
          setItems(response.data || []);
        } else {
          setItems((prev) => [...prev, ...(response.data || [])]);
        }
        setNextCursor(response.nextCursor);
        setError(null);
        setIsQueryTooLarge(false);
      } catch (err: any) {
        if (reqId !== requestIdRef.current) return;
        const msg = err?.message || 'Erro ao carregar disponibilidades da equipe.';
        const errCode = err?.code || err?.details?.code;
        if (errCode === 'AVAILABILITY_QUERY_TOO_LARGE' || msg.includes('excedeu o limite máximo')) {
          setIsQueryTooLarge(true);
        }
        setError(msg);
      } finally {
        if (reqId === requestIdRef.current) {
          setLoading(false);
          setLoadingMore(false);
        }
      }
    },
    [ministryId, fromDate, toDate, selectedMemberId]
  );

  // Trigger load when range or member filter changes
  useEffect(() => {
    loadAvailability();
  }, [loadAvailability]);

  // Handle Preset Select
  const handleSelectPreset = (preset: PresetKey) => {
    setSelectedPreset(preset);
    if (preset !== 'custom') {
      const dates = getPresetDates(preset);
      setFromDate(dates.from);
      setToDate(dates.to);
    }
  };

  const handleCustomDateChange = (type: 'from' | 'to', value: string) => {
    setSelectedPreset('custom');
    if (type === 'from') {
      setFromDate(value);
    } else {
      setToDate(value);
    }
  };

  return (
    <div
      className="admin-availability-page"
      style={{
        paddingTop: 'max(16px, var(--safe-area-top))',
        paddingBottom: 'max(32px, var(--safe-area-bottom))',
      }}
    >
      {/* Header com Touch Target >= 44px */}
      <div
        className="admin-availability-header"
        style={{
          display: 'flex',
          alignItems: 'center',
          gap: '12px',
          marginBottom: '20px',
        }}
      >
        <button
          type="button"
          onClick={onBack}
          aria-label="Voltar para configurações do ministério"
          style={{
            minWidth: '44px',
            minHeight: '44px',
            background: 'var(--surface-color)',
            border: '1px solid var(--border-color)',
            borderRadius: '12px',
            color: 'var(--text-primary)',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            cursor: 'pointer',
          }}
        >
          <ChevronLeft size={22} />
        </button>
        <div>
          <h1
            style={{
              fontSize: '1.25rem',
              fontWeight: 700,
              color: 'var(--text-primary)',
              margin: 0,
            }}
          >
            Disponibilidade da Equipe
          </h1>
          <p
            style={{
              fontSize: '0.85rem',
              color: 'var(--text-secondary)',
              margin: '2px 0 0',
            }}
          >
            Consulte períodos de ausência dos integrantes para planejamento de escalas.
          </p>
        </div>
      </div>

      {/* Seletor de Presets de Período (Touch Targets >= 44px) */}
      <div
        className="admin-availability-presets"
        style={{
          display: 'flex',
          gap: '8px',
          overflowX: 'auto',
          paddingBottom: '8px',
          marginBottom: '16px',
        }}
        role="group"
        aria-label="Filtros rápidos de período"
      >
        <button
          type="button"
          onClick={() => handleSelectPreset('7d')}
          className={`preset-btn ${selectedPreset === '7d' ? 'active' : ''}`}
          style={{
            minHeight: '44px',
            padding: '8px 14px',
            borderRadius: '10px',
            border: selectedPreset === '7d' ? '1px solid var(--primary-light)' : '1px solid var(--border-color)',
            background: selectedPreset === '7d' ? 'rgba(34, 197, 94, 0.15)' : 'var(--surface-color)',
            color: selectedPreset === '7d' ? 'var(--primary-light)' : 'var(--text-primary)',
            fontSize: '0.85rem',
            fontWeight: 600,
            cursor: 'pointer',
            whiteSpace: 'nowrap',
          }}
        >
          Próximos 7 dias
        </button>
        <button
          type="button"
          onClick={() => handleSelectPreset('15d')}
          className={`preset-btn ${selectedPreset === '15d' ? 'active' : ''}`}
          style={{
            minHeight: '44px',
            padding: '8px 14px',
            borderRadius: '10px',
            border: selectedPreset === '15d' ? '1px solid var(--primary-light)' : '1px solid var(--border-color)',
            background: selectedPreset === '15d' ? 'rgba(34, 197, 94, 0.15)' : 'var(--surface-color)',
            color: selectedPreset === '15d' ? 'var(--primary-light)' : 'var(--text-primary)',
            fontSize: '0.85rem',
            fontWeight: 600,
            cursor: 'pointer',
            whiteSpace: 'nowrap',
          }}
        >
          Próximos 15 dias
        </button>
        <button
          type="button"
          onClick={() => handleSelectPreset('30d')}
          className={`preset-btn ${selectedPreset === '30d' ? 'active' : ''}`}
          style={{
            minHeight: '44px',
            padding: '8px 14px',
            borderRadius: '10px',
            border: selectedPreset === '30d' ? '1px solid var(--primary-light)' : '1px solid var(--border-color)',
            background: selectedPreset === '30d' ? 'rgba(34, 197, 94, 0.15)' : 'var(--surface-color)',
            color: selectedPreset === '30d' ? 'var(--primary-light)' : 'var(--text-primary)',
            fontSize: '0.85rem',
            fontWeight: 600,
            cursor: 'pointer',
            whiteSpace: 'nowrap',
          }}
        >
          Próximos 30 dias
        </button>
        <button
          type="button"
          onClick={() => handleSelectPreset('this_month')}
          className={`preset-btn ${selectedPreset === 'this_month' ? 'active' : ''}`}
          style={{
            minHeight: '44px',
            padding: '8px 14px',
            borderRadius: '10px',
            border: selectedPreset === 'this_month' ? '1px solid var(--primary-light)' : '1px solid var(--border-color)',
            background: selectedPreset === 'this_month' ? 'rgba(34, 197, 94, 0.15)' : 'var(--surface-color)',
            color: selectedPreset === 'this_month' ? 'var(--primary-light)' : 'var(--text-primary)',
            fontSize: '0.85rem',
            fontWeight: 600,
            cursor: 'pointer',
            whiteSpace: 'nowrap',
          }}
        >
          Este mês
        </button>
      </div>

      {/* Intervalo Personalizado & Filtro por Integrante */}
      <div
        className="admin-availability-filters"
        style={{
          background: 'var(--surface-color)',
          border: '1px solid var(--border-color)',
          borderRadius: '12px',
          padding: '16px',
          marginBottom: '20px',
          display: 'grid',
          gridTemplateColumns: 'repeat(auto-fit, minmax(200px, 1fr))',
          gap: '12px',
        }}
      >
        <div>
          <label
            htmlFor="filter-from-date"
            style={{
              display: 'block',
              fontSize: '0.8rem',
              fontWeight: 600,
              color: 'var(--text-secondary)',
              marginBottom: '6px',
            }}
          >
            Data Inicial
          </label>
          <input
            id="filter-from-date"
            type="date"
            value={fromDate}
            onChange={(e) => handleCustomDateChange('from', e.target.value)}
            style={{
              width: '100%',
              minHeight: '44px',
              padding: '8px 12px',
              borderRadius: '8px',
              border: '1px solid var(--border-color)',
              background: 'var(--surface-variant)',
              color: 'var(--text-primary)',
              fontSize: '0.9rem',
              boxSizing: 'border-box',
            }}
          />
        </div>

        <div>
          <label
            htmlFor="filter-to-date"
            style={{
              display: 'block',
              fontSize: '0.8rem',
              fontWeight: 600,
              color: 'var(--text-secondary)',
              marginBottom: '6px',
            }}
          >
            Data Final
          </label>
          <input
            id="filter-to-date"
            type="date"
            value={toDate}
            onChange={(e) => handleCustomDateChange('to', e.target.value)}
            style={{
              width: '100%',
              minHeight: '44px',
              padding: '8px 12px',
              borderRadius: '8px',
              border: '1px solid var(--border-color)',
              background: 'var(--surface-variant)',
              color: 'var(--text-primary)',
              fontSize: '0.9rem',
              boxSizing: 'border-box',
            }}
          />
        </div>

        <div>
          <label
            htmlFor="filter-member-select"
            style={{
              display: 'block',
              fontSize: '0.8rem',
              fontWeight: 600,
              color: 'var(--text-secondary)',
              marginBottom: '6px',
            }}
          >
            Filtrar por Integrante
          </label>
          <div style={{ position: 'relative' }}>
            <select
              id="filter-member-select"
              value={selectedMemberId}
              onChange={(e) => setSelectedMemberId(e.target.value)}
              style={{
                width: '100%',
                minHeight: '44px',
                padding: '8px 12px',
                borderRadius: '8px',
                border: '1px solid var(--border-color)',
                background: 'var(--surface-variant)',
                color: 'var(--text-primary)',
                fontSize: '0.9rem',
                boxSizing: 'border-box',
                cursor: 'pointer',
              }}
            >
              <option value="">Todos os integrantes</option>
              {members.map((m) => (
                <option key={m.id} value={m.id}>
                  {m.name}
                </option>
              ))}
            </select>
          </div>
        </div>
      </div>

      {/* Feedback de Erro com Ação de Tentar Novamente */}
      {error && (
        <div
          role="alert"
          style={{
            padding: '16px',
            borderRadius: '12px',
            background: 'rgba(239, 68, 68, 0.1)',
            border: '1px solid rgba(239, 68, 68, 0.3)',
            color: '#ef4444',
            display: 'flex',
            flexDirection: 'column',
            gap: '8px',
            marginBottom: '20px',
          }}
        >
          <div style={{ display: 'flex', alignItems: 'center', gap: '8px', fontWeight: 600 }}>
            <AlertCircle size={20} />
            <span>{isQueryTooLarge ? 'Consulta muito ampla' : 'Erro ao carregar indisponibilidades'}</span>
          </div>
          <p style={{ fontSize: '0.85rem', margin: 0, color: 'var(--text-primary)' }}>
            {isQueryTooLarge
              ? 'A quantidade de registros para o período solicitado excedeu o limite seguro de visualização. Por favor, restrinja o intervalo de datas ou selecione um integrante específico.'
              : error}
          </p>
          {!isQueryTooLarge && (
            <button
              type="button"
              onClick={() => loadAvailability()}
              style={{
                alignSelf: 'flex-start',
                minHeight: '44px',
                padding: '8px 16px',
                borderRadius: '8px',
                border: 'none',
                background: '#ef4444',
                color: '#fff',
                fontSize: '0.85rem',
                fontWeight: 600,
                cursor: 'pointer',
                display: 'inline-flex',
                alignItems: 'center',
                gap: '6px',
                marginTop: '4px',
              }}
            >
              <RefreshCw size={16} />
              Tentar novamente
            </button>
          )}
        </div>
      )}

      {/* Estado: Carregando (Skeleton) */}
      {loading && (
        <div
          data-testid="availability-loading"
          style={{
            display: 'flex',
            flexDirection: 'column',
            gap: '12px',
          }}
        >
          {[1, 2, 3].map((n) => (
            <div
              key={n}
              style={{
                minHeight: '80px',
                borderRadius: '12px',
                background: 'var(--surface-color)',
                border: '1px solid var(--border-color)',
                padding: '16px',
                opacity: 0.6,
                display: 'flex',
                flexDirection: 'column',
                gap: '8px',
              }}
            >
              <div
                style={{
                  width: '40%',
                  height: '18px',
                  borderRadius: '4px',
                  background: 'var(--border-color)',
                }}
              />
              <div
                style={{
                  width: '60%',
                  height: '14px',
                  borderRadius: '4px',
                  background: 'var(--border-color)',
                }}
              />
            </div>
          ))}
        </div>
      )}

      {/* Estado: Vazio (Query completada sem nenhum registro) */}
      {!loading && !error && items.length === 0 && (
        <div
          data-testid="availability-empty"
          style={{
            textAlign: 'center',
            padding: '48px 16px',
            background: 'var(--surface-color)',
            border: '1px dashed var(--border-color)',
            borderRadius: '16px',
            margin: '20px 0',
          }}
        >
          <div
            style={{
              width: '56px',
              height: '56px',
              borderRadius: '50%',
              background: 'rgba(34, 197, 94, 0.1)',
              color: 'var(--primary-light)',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              margin: '0 auto 16px',
            }}
          >
            <Check size={28} />
          </div>
          <h3
            style={{
              fontSize: '1rem',
              fontWeight: 600,
              color: 'var(--text-primary)',
              margin: '0 0 6px',
            }}
          >
            Nenhum integrante com indisponibilidade
          </h3>
          <p
            style={{
              fontSize: '0.85rem',
              color: 'var(--text-secondary)',
              margin: 0,
              maxWidth: '360px',
              marginLeft: 'auto',
              marginRight: 'auto',
            }}
          >
            Todos os integrantes estão disponíveis para escalas no período de {formatDateBR(fromDate)} a {formatDateBR(toDate)}.
          </p>
        </div>
      )}

      {/* Estado: Lista de Ausências */}
      {!loading && !error && items.length > 0 && (
        <div
          className="admin-availability-list"
          data-testid="availability-list"
          style={{
            display: 'flex',
            flexDirection: 'column',
            gap: '10px',
          }}
        >
          <div
            style={{
              fontSize: '0.85rem',
              fontWeight: 600,
              color: 'var(--text-secondary)',
              marginBottom: '4px',
            }}
          >
            {items.length} período{items.length !== 1 ? 's' : ''} de indisponibilidade registrado{items.length !== 1 ? 's' : ''}:
          </div>

          {items.map((item) => {
            const isSingleDay = item.startDate === item.endDate;
            const periodLabel = isSingleDay
              ? formatDateBR(item.startDate)
              : `${formatDateBR(item.startDate)} até ${formatDateBR(item.endDate)}`;

            return (
              <div
                key={item.id}
                data-testid={`availability-item-${item.id}`}
                style={{
                  background: 'var(--surface-color)',
                  border: '1px solid var(--border-color)',
                  borderRadius: '12px',
                  padding: '16px',
                  display: 'flex',
                  alignItems: 'flex-start',
                  justifyContent: 'space-between',
                  gap: '12px',
                }}
              >
                <div style={{ flex: 1 }}>
                  {/* Nome do Integrante */}
                  <div
                    style={{
                      display: 'flex',
                      alignItems: 'center',
                      gap: '8px',
                      marginBottom: '6px',
                    }}
                  >
                    <span
                      style={{
                        width: '28px',
                        height: '28px',
                        borderRadius: '50%',
                        background: 'rgba(34, 197, 94, 0.1)',
                        color: 'var(--primary-light)',
                        display: 'flex',
                        alignItems: 'center',
                        justifyContent: 'center',
                        fontSize: '0.75rem',
                        fontWeight: 700,
                        flexShrink: 0,
                      }}
                    >
                      {item.memberName.charAt(0).toUpperCase()}
                    </span>
                    <strong
                      style={{
                        fontSize: '0.95rem',
                        color: 'var(--text-primary)',
                      }}
                    >
                      {item.memberName}
                    </strong>
                  </div>

                  {/* Período e Horário */}
                  <div
                    style={{
                      display: 'flex',
                      flexWrap: 'wrap',
                      alignItems: 'center',
                      gap: '8px',
                      fontSize: '0.85rem',
                      color: 'var(--text-secondary)',
                    }}
                  >
                    <span
                      style={{
                        display: 'inline-flex',
                        alignItems: 'center',
                        gap: '4px',
                      }}
                    >
                      <CalendarDays size={15} />
                      {periodLabel}
                    </span>

                    {item.allDay ? (
                      <span
                        style={{
                          display: 'inline-flex',
                          alignItems: 'center',
                          padding: '2px 8px',
                          borderRadius: '6px',
                          background: 'rgba(234, 179, 8, 0.1)',
                          color: '#eab308',
                          fontSize: '0.75rem',
                          fontWeight: 600,
                        }}
                      >
                        Dia inteiro
                      </span>
                    ) : (
                      <span
                        style={{
                          display: 'inline-flex',
                          alignItems: 'center',
                          gap: '4px',
                          padding: '2px 8px',
                          borderRadius: '6px',
                          background: 'rgba(59, 130, 246, 0.1)',
                          color: '#3b82f6',
                          fontSize: '0.75rem',
                          fontWeight: 600,
                        }}
                      >
                        <Clock size={13} />
                        {item.startTime} às {item.endTime}
                      </span>
                    )}
                  </div>
                </div>
              </div>
            );
          })}

          {/* Botão Carregar Mais (Touch Target >= 44px) */}
          {nextCursor && (
            <div style={{ textAlign: 'center', marginTop: '16px' }}>
              <button
                type="button"
                onClick={() => loadAvailability(nextCursor)}
                disabled={loadingMore}
                data-testid="load-more-btn"
                style={{
                  minHeight: '44px',
                  padding: '10px 24px',
                  borderRadius: '10px',
                  border: '1px solid var(--border-color)',
                  background: 'var(--surface-color)',
                  color: 'var(--text-primary)',
                  fontSize: '0.85rem',
                  fontWeight: 600,
                  cursor: loadingMore ? 'not-allowed' : 'pointer',
                  display: 'inline-flex',
                  alignItems: 'center',
                  gap: '8px',
                }}
              >
                {loadingMore ? (
                  <>
                    <RefreshCw size={16} className="animate-spin" />
                    Carregando mais...
                  </>
                ) : (
                  'Carregar mais'
                )}
              </button>
            </div>
          )}
        </div>
      )}
    </div>
  );
}
