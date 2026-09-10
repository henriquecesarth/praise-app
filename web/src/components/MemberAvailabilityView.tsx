import React, { useState, useEffect, useCallback } from 'react';
import { api } from '../api';
import { MemberUnavailability } from '../types';
import {
  ChevronLeft, Plus, Edit2, Trash2, CalendarOff, Clock,
  Calendar, Check, AlertCircle, RefreshCw, X, Info
} from 'lucide-react';

interface Props {
  ministryId: string;
  onBack: () => void;
  showToast: (msg: string, type?: 'success' | 'error') => void;
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

function getTodayStr(): string {
  const now = new Date();
  const y = now.getFullYear();
  const m = String(now.getMonth() + 1).padStart(2, '0');
  const d = String(now.getDate()).padStart(2, '0');
  return `${y}-${m}-${d}`;
}

export function MemberAvailabilityView({ ministryId, onBack, showToast }: Props) {
  const [items, setItems] = useState<MemberUnavailability[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [nextCursor, setNextCursor] = useState<string | null>(null);
  const [loadingMore, setLoadingMore] = useState(false);

  // Modal State
  const [showModal, setShowModal] = useState(false);
  const [modalMode, setModalMode] = useState<'create' | 'edit'>('create');
  const [editingItem, setEditingItem] = useState<MemberUnavailability | null>(null);

  // Form State
  const [startDate, setStartDate] = useState(getTodayStr());
  const [endDate, setEndDate] = useState(getTodayStr());
  const [allDay, setAllDay] = useState(true);
  const [startTime, setStartTime] = useState('19:00');
  const [endTime, setEndTime] = useState('22:00');
  const [reason, setReason] = useState('');
  const [saving, setSaving] = useState(false);
  const [formError, setFormError] = useState<string | null>(null);

  // Delete State
  const [deletingItem, setDeletingItem] = useState<MemberUnavailability | null>(null);
  const [deleting, setDeleting] = useState(false);

  // Tenant-switch safety: reset modals if ministry changes
  useEffect(() => {
    setShowModal(false);
    setDeletingItem(null);
  }, [ministryId]);

  // Load items with race protection
  const loadItems = useCallback(() => {
    let active = true;
    setLoading(true);
    setError(null);

    api.getMyUnavailabilities(ministryId)
      .then((res) => {
        if (active) {
          setItems(res.data || []);
          setNextCursor(res.nextCursor);
          setLoading(false);
        }
      })
      .catch((err: any) => {
        if (active) {
          setError(err.message || 'Erro ao carregar indisponibilidades.');
          setLoading(false);
        }
      });

    return () => {
      active = false;
    };
  }, [ministryId]);

  useEffect(() => {
    const cleanup = loadItems();
    return cleanup;
  }, [loadItems]);

  // Load more pagination
  const handleLoadMore = async () => {
    if (!nextCursor || loadingMore) return;
    setLoadingMore(true);
    try {
      const res = await api.getMyUnavailabilities(ministryId, 50, nextCursor);
      setItems((prev) => [...prev, ...(res.data || [])]);
      setNextCursor(res.nextCursor);
    } catch (err: any) {
      showToast(err.message || 'Erro ao carregar mais períodos.', 'error');
    } finally {
      setLoadingMore(false);
    }
  };

  // Open Create Modal
  const handleOpenCreate = () => {
    const today = getTodayStr();
    setModalMode('create');
    setEditingItem(null);
    setStartDate(today);
    setEndDate(today);
    setAllDay(true);
    setStartTime('19:00');
    setEndTime('22:00');
    setReason('');
    setFormError(null);
    setShowModal(true);
  };

  // Open Edit Modal
  const handleOpenEdit = (item: MemberUnavailability) => {
    setModalMode('edit');
    setEditingItem(item);
    setStartDate(item.startDate);
    setEndDate(item.endDate);
    setAllDay(item.allDay);
    setStartTime(item.startTime || '19:00');
    setEndTime(item.endTime || '22:00');
    setReason(item.reason || '');
    setFormError(null);
    setShowModal(true);
  };

  // Close Modal on Escape
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        if (showModal && !saving) setShowModal(false);
        if (deletingItem && !deleting) setDeletingItem(null);
      }
    };
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [showModal, saving, deletingItem, deleting]);

  // Validate form client-side before sending
  const validateClientForm = (): string | null => {
    if (!startDate || !endDate) {
      return 'Data inicial e final são obrigatórias.';
    }
    if (endDate < startDate) {
      return 'A data final não pode ser anterior à data inicial.';
    }
    if (!allDay) {
      if (!startTime || !endTime) {
        return 'Horário inicial e final são obrigatórios quando não for dia inteiro.';
      }
      if (startDate === endDate && endTime <= startTime) {
        return 'O horário de término deve ser posterior ao horário de início.';
      }
    }
    return null;
  };

  // Save (Create or Update)
  const handleSave = async (e: React.FormEvent) => {
    e.preventDefault();
    const err = validateClientForm();
    if (err) {
      setFormError(err);
      return;
    }

    setSaving(true);
    setFormError(null);

    try {
      if (modalMode === 'create') {
        const created = await api.createMyUnavailability(ministryId, {
          startDate,
          endDate,
          allDay,
          startTime: allDay ? null : startTime,
          endTime: allDay ? null : endTime,
          reason: reason.trim() ? reason.trim() : null,
        });
        setItems((prev) => [created, ...prev]);
        showToast('Período de indisponibilidade cadastrado com sucesso!', 'success');
      } else if (editingItem) {
        const updated = await api.updateMyUnavailability(ministryId, editingItem.id, {
          startDate,
          endDate,
          allDay,
          startTime: allDay ? null : startTime,
          endTime: allDay ? null : endTime,
          reason: reason.trim() ? reason.trim() : null,
        });
        setItems((prev) => prev.map((item) => (item.id === updated.id ? updated : item)));
        showToast('Indisponibilidade atualizada com sucesso!', 'success');
      }
      setShowModal(false);
    } catch (err: any) {
      setFormError(err.message || 'Erro ao salvar período de indisponibilidade.');
    } finally {
      setSaving(false);
    }
  };

  // Delete
  const handleDeleteConfirm = async () => {
    if (!deletingItem) return;
    setDeleting(true);
    try {
      await api.deleteMyUnavailability(ministryId, deletingItem.id);
      setItems((prev) => prev.filter((item) => item.id !== deletingItem.id));
      showToast('Período de indisponibilidade removido.', 'success');
      setDeletingItem(null);
    } catch (err: any) {
      showToast(err.message || 'Erro ao remover indisponibilidade.', 'error');
    } finally {
      setDeleting(false);
    }
  };

  return (
    <div className="availability-page" style={{ padding: '16px', maxWidth: '800px', margin: '0 auto' }}>
      {/* Top Bar with Back Button */}
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: '20px' }}>
        <button
          type="button"
          onClick={onBack}
          className="btn-back"
          style={{
            display: 'inline-flex',
            alignItems: 'center',
            gap: '6px',
            minHeight: '44px',
            minWidth: '44px',
            padding: '8px 12px',
            background: 'var(--surface-variant)',
            border: '1px solid var(--border-color)',
            borderRadius: '10px',
            color: 'var(--text-primary)',
            cursor: 'pointer',
            fontSize: '0.95rem',
            fontWeight: 600,
          }}
        >
          <ChevronLeft size={18} />
          Voltar
        </button>

        <button
          type="button"
          onClick={handleOpenCreate}
          data-testid="add-availability-button"
          style={{
            display: 'inline-flex',
            alignItems: 'center',
            gap: '8px',
            minHeight: '44px',
            padding: '10px 18px',
            background: 'var(--primary-color, #0F2A1F)',
            color: '#fff',
            border: 'none',
            borderRadius: '10px',
            fontWeight: 600,
            fontSize: '0.95rem',
            cursor: 'pointer',
          }}
        >
          <Plus size={18} />
          Informar Indisponibilidade
        </button>
      </div>

      {/* Header Info */}
      <div style={{ marginBottom: '20px' }}>
        <h1 style={{ fontSize: '1.5rem', fontWeight: 700, margin: '0 0 6px 0', color: 'var(--text-primary)' }}>
          Minha Disponibilidade
        </h1>
        <p style={{ margin: 0, fontSize: '0.95rem', color: 'var(--text-secondary)' }}>
          Gerencie os períodos em que você estará ausente ou impedido de participar das escalas.
        </p>
      </div>

      {/* Default Available Notice Banner */}
      <div
        data-testid="availability-notice"
        style={{
          display: 'flex',
          alignItems: 'flex-start',
          gap: '12px',
          padding: '14px 16px',
          background: 'rgba(15, 42, 31, 0.06)',
          border: '1px solid rgba(15, 42, 31, 0.15)',
          borderRadius: '12px',
          marginBottom: '24px',
        }}
      >
        <Info size={20} style={{ color: 'var(--primary-color, #0F2A1F)', flexShrink: 0, marginTop: '2px' }} />
        <div style={{ fontSize: '0.9rem', lineHeight: '1.45', color: 'var(--text-primary)' }}>
          <strong>Você está disponível por padrão.</strong> Cadastre aqui apenas os períodos em que não poderá participar.
          Os líderes da equipe visualizarão seus bloqueios ao organizar as próximas escalas.
        </div>
      </div>

      {/* Loading State */}
      {loading && (
        <div
          data-testid="availability-loading"
          style={{
            display: 'flex',
            flexDirection: 'column',
            alignItems: 'center',
            justifyContent: 'center',
            padding: '48px 16px',
            color: 'var(--text-secondary)',
          }}
        >
          <RefreshCw size={28} className="animate-spin" style={{ marginBottom: '12px', color: 'var(--primary-color)' }} />
          <span>Carregando disponibilidades...</span>
        </div>
      )}

      {/* Error State with Retry */}
      {!loading && error && (
        <div
          data-testid="availability-error"
          style={{
            padding: '24px',
            borderRadius: '12px',
            background: 'rgba(239, 68, 68, 0.08)',
            border: '1px solid rgba(239, 68, 68, 0.25)',
            textAlign: 'center',
            marginBottom: '20px',
          }}
        >
          <AlertCircle size={32} style={{ color: '#ef4444', margin: '0 auto 10px auto' }} />
          <h3 style={{ margin: '0 0 8px 0', fontSize: '1.05rem', color: '#ef4444' }}>Erro ao carregar dados</h3>
          <p style={{ margin: '0 0 16px 0', fontSize: '0.9rem', color: 'var(--text-secondary)' }}>{error}</p>
          <button
            type="button"
            onClick={loadItems}
            style={{
              display: 'inline-flex',
              alignItems: 'center',
              gap: '8px',
              minHeight: '44px',
              padding: '10px 20px',
              background: '#ef4444',
              color: '#fff',
              border: 'none',
              borderRadius: '8px',
              fontWeight: 600,
              cursor: 'pointer',
            }}
          >
            <RefreshCw size={16} />
            Tentar novamente
          </button>
        </div>
      )}

      {/* Empty State */}
      {!loading && !error && items.length === 0 && (
        <div
          data-testid="availability-empty"
          style={{
            padding: '48px 20px',
            borderRadius: '16px',
            background: 'var(--surface-variant)',
            border: '1px dashed var(--border-color)',
            textAlign: 'center',
          }}
        >
          <CalendarOff size={40} style={{ color: 'var(--text-muted)', margin: '0 auto 12px auto' }} />
          <h3 style={{ margin: '0 0 8px 0', fontSize: '1.1rem', color: 'var(--text-primary)' }}>
            Nenhum período de indisponibilidade cadastrado
          </h3>
          <p style={{ margin: '0 0 20px 0', fontSize: '0.9rem', color: 'var(--text-secondary)', maxWidth: '440px', marginLeft: 'auto', marginRight: 'auto' }}>
            Você está livre e disponível para todas as escalas deste ministério. Se tiver algum compromisso futuro, informe abaixo.
          </p>
          <button
            type="button"
            onClick={handleOpenCreate}
            style={{
              display: 'inline-flex',
              alignItems: 'center',
              gap: '8px',
              minHeight: '44px',
              padding: '10px 20px',
              background: 'var(--primary-color, #0F2A1F)',
              color: '#fff',
              border: 'none',
              borderRadius: '10px',
              fontWeight: 600,
              cursor: 'pointer',
            }}
          >
            <Plus size={18} />
            Adicionar Indisponibilidade
          </button>
        </div>
      )}

      {/* List of Items */}
      {!loading && !error && items.length > 0 && (
        <div data-testid="availability-list" style={{ display: 'flex', flexDirection: 'column', gap: '12px' }}>
          {items.map((item) => {
            const isSingleDay = item.startDate === item.endDate;
            return (
              <div
                key={item.id}
                data-testid={`availability-item-${item.id}`}
                style={{
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'space-between',
                  padding: '16px',
                  borderRadius: '14px',
                  background: 'var(--surface-color)',
                  border: '1px solid var(--border-color)',
                  boxShadow: '0 1px 3px rgba(0,0,0,0.03)',
                  gap: '12px',
                }}
              >
                {/* Left info */}
                <div style={{ flex: 1, minWidth: 0 }}>
                  <div style={{ display: 'flex', alignItems: 'center', gap: '8px', flexWrap: 'wrap', marginBottom: '6px' }}>
                    <span style={{ fontWeight: 700, fontSize: '1.05rem', color: 'var(--text-primary)' }}>
                      {isSingleDay
                        ? formatDateBR(item.startDate)
                        : `${formatDateBR(item.startDate)} até ${formatDateBR(item.endDate)}`}
                    </span>

                    {item.allDay ? (
                      <span
                        style={{
                          display: 'inline-flex',
                          alignItems: 'center',
                          gap: '4px',
                          padding: '2px 8px',
                          borderRadius: '6px',
                          fontSize: '0.78rem',
                          fontWeight: 600,
                          background: 'rgba(15, 42, 31, 0.1)',
                          color: 'var(--primary-color, #0F2A1F)',
                        }}
                      >
                        <Calendar size={12} />
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
                          fontSize: '0.78rem',
                          fontWeight: 600,
                          background: 'rgba(184, 90, 60, 0.12)',
                          color: '#B85A3C',
                        }}
                      >
                        <Clock size={12} />
                        {item.startTime} às {item.endTime}
                      </span>
                    )}
                  </div>

                  {item.reason && (
                    <div
                      style={{
                        fontSize: '0.88rem',
                        color: 'var(--text-secondary)',
                        overflow: 'hidden',
                        textOverflow: 'ellipsis',
                        whiteSpace: 'nowrap',
                      }}
                    >
                      {item.reason}
                    </div>
                  )}
                </div>

                {/* Actions */}
                <div style={{ display: 'flex', alignItems: 'center', gap: '6px', flexShrink: 0 }}>
                  <button
                    type="button"
                    onClick={() => handleOpenEdit(item)}
                    aria-label={`Editar indisponibilidade de ${formatDateBR(item.startDate)}`}
                    style={{
                      display: 'inline-flex',
                      alignItems: 'center',
                      justifyContent: 'center',
                      minHeight: '44px',
                      minWidth: '44px',
                      padding: '8px',
                      background: 'transparent',
                      border: '1px solid var(--border-color)',
                      borderRadius: '8px',
                      color: 'var(--text-primary)',
                      cursor: 'pointer',
                    }}
                  >
                    <Edit2 size={16} />
                  </button>

                  <button
                    type="button"
                    onClick={() => setDeletingItem(item)}
                    aria-label={`Excluir indisponibilidade de ${formatDateBR(item.startDate)}`}
                    style={{
                      display: 'inline-flex',
                      alignItems: 'center',
                      justifyContent: 'center',
                      minHeight: '44px',
                      minWidth: '44px',
                      padding: '8px',
                      background: 'transparent',
                      border: '1px solid rgba(239, 68, 68, 0.3)',
                      borderRadius: '8px',
                      color: '#ef4444',
                      cursor: 'pointer',
                    }}
                  >
                    <Trash2 size={16} />
                  </button>
                </div>
              </div>
            );
          })}

          {/* Load More Button */}
          {nextCursor && (
            <div style={{ textAlign: 'center', marginTop: '16px' }}>
              <button
                type="button"
                onClick={handleLoadMore}
                disabled={loadingMore}
                style={{
                  minHeight: '44px',
                  padding: '10px 24px',
                  background: 'var(--surface-variant)',
                  border: '1px solid var(--border-color)',
                  borderRadius: '10px',
                  color: 'var(--text-primary)',
                  fontWeight: 600,
                  cursor: loadingMore ? 'not-allowed' : 'pointer',
                }}
              >
                {loadingMore ? 'Carregando mais...' : 'Carregar períodos anteriores'}
              </button>
            </div>
          )}
        </div>
      )}

      {/* Modal: Create / Edit Form */}
      {showModal && (
        <div
          role="dialog"
          aria-modal="true"
          aria-labelledby="modal-availability-title"
          style={{
            position: 'fixed',
            inset: 0,
            background: 'rgba(0,0,0,0.55)',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            padding: '16px',
            zIndex: 1000,
          }}
          onClick={(e) => {
            if (e.target === e.currentTarget && !saving) setShowModal(false);
          }}
        >
          <div
            style={{
              background: 'var(--surface-color, #fff)',
              borderRadius: '16px',
              maxWidth: '480px',
              width: '100%',
              padding: '24px',
              boxShadow: '0 20px 25px -5px rgba(0,0,0,0.1)',
              maxHeight: '90vh',
              overflowY: 'auto',
            }}
          >
            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: '16px' }}>
              <h2 id="modal-availability-title" style={{ margin: 0, fontSize: '1.25rem', fontWeight: 700, color: 'var(--text-primary)' }}>
                {modalMode === 'create' ? 'Nova Indisponibilidade' : 'Editar Indisponibilidade'}
              </h2>
              <button
                type="button"
                onClick={() => !saving && setShowModal(false)}
                disabled={saving}
                aria-label="Fechar"
                style={{
                  minHeight: '44px',
                  minWidth: '44px',
                  background: 'transparent',
                  border: 'none',
                  cursor: 'pointer',
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'center',
                  color: 'var(--text-secondary)',
                }}
              >
                <X size={20} />
              </button>
            </div>

            {formError && (
              <div
                style={{
                  padding: '10px 14px',
                  background: 'rgba(239, 68, 68, 0.08)',
                  border: '1px solid rgba(239, 68, 68, 0.25)',
                  borderRadius: '8px',
                  color: '#ef4444',
                  fontSize: '0.88rem',
                  marginBottom: '16px',
                }}
              >
                {formError}
              </div>
            )}

            <form onSubmit={handleSave}>
              {/* Data Inicial */}
              <div style={{ marginBottom: '14px' }}>
                <label htmlFor="avail-start-date" style={{ display: 'block', fontSize: '0.85rem', fontWeight: 600, marginBottom: '6px', color: 'var(--text-primary)' }}>
                  Data Inicial *
                </label>
                <input
                  id="avail-start-date"
                  type="date"
                  value={startDate}
                  onChange={(e) => setStartDate(e.target.value)}
                  disabled={saving}
                  required
                  style={{
                    width: '100%',
                    boxSizing: 'border-box',
                    minHeight: '44px',
                    padding: '8px 12px',
                    borderRadius: '8px',
                    border: '1px solid var(--border-color)',
                    background: 'var(--surface-variant)',
                    color: 'var(--text-primary)',
                    fontSize: '0.95rem',
                  }}
                />
              </div>

              {/* Data Final */}
              <div style={{ marginBottom: '14px' }}>
                <label htmlFor="avail-end-date" style={{ display: 'block', fontSize: '0.85rem', fontWeight: 600, marginBottom: '6px', color: 'var(--text-primary)' }}>
                  Data Final * (inclusive)
                </label>
                <input
                  id="avail-end-date"
                  type="date"
                  value={endDate}
                  onChange={(e) => setEndDate(e.target.value)}
                  disabled={saving}
                  required
                  style={{
                    width: '100%',
                    boxSizing: 'border-box',
                    minHeight: '44px',
                    padding: '8px 12px',
                    borderRadius: '8px',
                    border: '1px solid var(--border-color)',
                    background: 'var(--surface-variant)',
                    color: 'var(--text-primary)',
                    fontSize: '0.95rem',
                  }}
                />
              </div>

              {/* Checkbox Dia Inteiro */}
              <div style={{ marginBottom: '16px' }}>
                <label
                  htmlFor="avail-all-day"
                  style={{
                    display: 'inline-flex',
                    alignItems: 'center',
                    gap: '10px',
                    minHeight: '44px',
                    cursor: saving ? 'not-allowed' : 'pointer',
                    fontSize: '0.95rem',
                    color: 'var(--text-primary)',
                  }}
                >
                  <input
                    id="avail-all-day"
                    type="checkbox"
                    checked={allDay}
                    onChange={(e) => setAllDay(e.target.checked)}
                    disabled={saving}
                    style={{ width: '18px', height: '18px', cursor: 'pointer' }}
                  />
                  <span>Dia inteiro (o dia todo)</span>
                </label>
              </div>

              {/* Horários quando não for Dia Inteiro */}
              {!allDay && (
                <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '12px', marginBottom: '16px' }}>
                  <div>
                    <label htmlFor="avail-start-time" style={{ display: 'block', fontSize: '0.85rem', fontWeight: 600, marginBottom: '6px', color: 'var(--text-primary)' }}>
                      Hora Início *
                    </label>
                    <input
                      id="avail-start-time"
                      type="time"
                      value={startTime}
                      onChange={(e) => setStartTime(e.target.value)}
                      disabled={saving}
                      required={!allDay}
                      style={{
                        width: '100%',
                        boxSizing: 'border-box',
                        minHeight: '44px',
                        padding: '8px 12px',
                        borderRadius: '8px',
                        border: '1px solid var(--border-color)',
                        background: 'var(--surface-variant)',
                        color: 'var(--text-primary)',
                        fontSize: '0.95rem',
                      }}
                    />
                  </div>
                  <div>
                    <label htmlFor="avail-end-time" style={{ display: 'block', fontSize: '0.85rem', fontWeight: 600, marginBottom: '6px', color: 'var(--text-primary)' }}>
                      Hora Término *
                    </label>
                    <input
                      id="avail-end-time"
                      type="time"
                      value={endTime}
                      onChange={(e) => setEndTime(e.target.value)}
                      disabled={saving}
                      required={!allDay}
                      style={{
                        width: '100%',
                        boxSizing: 'border-box',
                        minHeight: '44px',
                        padding: '8px 12px',
                        borderRadius: '8px',
                        border: '1px solid var(--border-color)',
                        background: 'var(--surface-variant)',
                        color: 'var(--text-primary)',
                        fontSize: '0.95rem',
                      }}
                    />
                  </div>
                </div>
              )}

              {/* Motivo Opcional */}
              <div style={{ marginBottom: '20px' }}>
                <label htmlFor="avail-reason" style={{ display: 'block', fontSize: '0.85rem', fontWeight: 600, marginBottom: '6px', color: 'var(--text-primary)' }}>
                  Motivo (Opcional)
                </label>
                <input
                  id="avail-reason"
                  type="text"
                  placeholder="Ex: Viagem de férias, consulta, compromisso..."
                  value={reason}
                  onChange={(e) => setReason(e.target.value)}
                  disabled={saving}
                  maxLength={255}
                  style={{
                    width: '100%',
                    boxSizing: 'border-box',
                    minHeight: '44px',
                    padding: '8px 12px',
                    borderRadius: '8px',
                    border: '1px solid var(--border-color)',
                    background: 'var(--surface-variant)',
                    color: 'var(--text-primary)',
                    fontSize: '0.95rem',
                  }}
                />
              </div>

              {/* Footer Buttons */}
              <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'flex-end', gap: '10px' }}>
                <button
                  type="button"
                  onClick={() => !saving && setShowModal(false)}
                  disabled={saving}
                  style={{
                    minHeight: '44px',
                    padding: '10px 18px',
                    background: 'transparent',
                    border: '1px solid var(--border-color)',
                    borderRadius: '8px',
                    color: 'var(--text-primary)',
                    cursor: saving ? 'not-allowed' : 'pointer',
                    fontWeight: 600,
                  }}
                >
                  Cancelar
                </button>
                <button
                  type="submit"
                  disabled={saving}
                  style={{
                    display: 'inline-flex',
                    alignItems: 'center',
                    gap: '8px',
                    minHeight: '44px',
                    padding: '10px 22px',
                    background: 'var(--primary-color, #0F2A1F)',
                    color: '#fff',
                    border: 'none',
                    borderRadius: '8px',
                    cursor: saving ? 'not-allowed' : 'pointer',
                    fontWeight: 600,
                  }}
                >
                  {saving ? (
                    <>
                      <RefreshCw size={16} className="animate-spin" />
                      Salvando...
                    </>
                  ) : (
                    <>
                      <Check size={16} />
                      {modalMode === 'create' ? 'Cadastrar' : 'Salvar Alterações'}
                    </>
                  )}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* Modal: Delete Confirmation */}
      {deletingItem && (
        <div
          role="dialog"
          aria-modal="true"
          style={{
            position: 'fixed',
            inset: 0,
            background: 'rgba(0,0,0,0.55)',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            padding: '16px',
            zIndex: 1000,
          }}
          onClick={(e) => {
            if (e.target === e.currentTarget && !deleting) setDeletingItem(null);
          }}
        >
          <div
            style={{
              background: 'var(--surface-color, #fff)',
              borderRadius: '16px',
              maxWidth: '420px',
              width: '100%',
              padding: '24px',
              boxShadow: '0 20px 25px -5px rgba(0,0,0,0.1)',
            }}
          >
            <h3 style={{ margin: '0 0 10px 0', fontSize: '1.2rem', color: 'var(--text-primary)' }}>
              Remover Indisponibilidade?
            </h3>
            <p style={{ margin: '0 0 20px 0', fontSize: '0.9rem', color: 'var(--text-secondary)', lineHeight: '1.45' }}>
              Deseja remover o período de <strong>{formatDateBR(deletingItem.startDate)}</strong>
              {deletingItem.startDate !== deletingItem.endDate && ` até ${formatDateBR(deletingItem.endDate)}`}?
              Você voltará a constar como disponível para escalas nessas datas.
            </p>
            <div style={{ display: 'flex', justifyContent: 'flex-end', gap: '10px' }}>
              <button
                type="button"
                onClick={() => !deleting && setDeletingItem(null)}
                disabled={deleting}
                style={{
                  minHeight: '44px',
                  padding: '10px 18px',
                  background: 'transparent',
                  border: '1px solid var(--border-color)',
                  borderRadius: '8px',
                  color: 'var(--text-primary)',
                  cursor: deleting ? 'not-allowed' : 'pointer',
                  fontWeight: 600,
                }}
              >
                Cancelar
              </button>
              <button
                type="button"
                onClick={handleDeleteConfirm}
                disabled={deleting}
                style={{
                  display: 'inline-flex',
                  alignItems: 'center',
                  gap: '8px',
                  minHeight: '44px',
                  padding: '10px 20px',
                  background: '#ef4444',
                  color: '#fff',
                  border: 'none',
                  borderRadius: '8px',
                  cursor: deleting ? 'not-allowed' : 'pointer',
                  fontWeight: 600,
                }}
              >
                {deleting ? 'Removendo...' : 'Sim, Remover'}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
