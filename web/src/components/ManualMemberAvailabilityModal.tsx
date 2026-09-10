import React, { useState, useEffect, useCallback } from 'react';
import { api } from '../api';
import { MemberUnavailability } from '../types';
import {
  X, Plus, Edit2, Trash2, CalendarOff, Clock,
  AlertCircle, RefreshCw, AlertTriangle
} from 'lucide-react';

export interface ManualMemberAvailabilityModalProps {
  ministryId: string;
  member: {
    id: string;
    name: string;
    isManual?: boolean;
  };
  onClose: () => void;
  showToast?: (msg: string, type?: 'success' | 'error') => void;
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

export function ManualMemberAvailabilityModal({
  ministryId,
  member,
  onClose,
  showToast,
}: ManualMemberAvailabilityModalProps) {
  const isManual = member.isManual !== false;

  const [items, setItems] = useState<MemberUnavailability[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  // Form mode: null | 'create' | 'edit'
  const [formMode, setFormMode] = useState<'create' | 'edit' | null>(null);
  const [editingItem, setEditingItem] = useState<MemberUnavailability | null>(null);

  // Form fields
  const [startDate, setStartDate] = useState(getTodayStr());
  const [endDate, setEndDate] = useState(getTodayStr());
  const [allDay, setAllDay] = useState(true);
  const [startTime, setStartTime] = useState('19:00');
  const [endTime, setEndTime] = useState('22:00');
  const [reason, setReason] = useState('');
  const [saving, setSaving] = useState(false);
  const [formError, setFormError] = useState<string | null>(null);

  // Delete state
  const [deletingItem, setDeletingItem] = useState<MemberUnavailability | null>(null);
  const [deleting, setDeleting] = useState(false);

  // Tenant / member switch safety: reset modal internal states
  useEffect(() => {
    setFormMode(null);
    setEditingItem(null);
    setDeletingItem(null);
    setFormError(null);
  }, [ministryId, member.id]);

  // Load items with race condition cancellation
  const loadItems = useCallback(() => {
    if (!isManual) {
      setLoading(false);
      return () => {};
    }

    let active = true;
    setLoading(true);
    setError(null);

    api.getManualMemberUnavailabilities(ministryId, member.id)
      .then((res) => {
        if (active) {
          setItems(res.data || []);
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
  }, [ministryId, member.id, isManual]);

  useEffect(() => {
    const cleanup = loadItems();
    return cleanup;
  }, [loadItems]);

  // Escape key handler
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        if (deletingItem) {
          setDeletingItem(null);
        } else if (formMode) {
          setFormMode(null);
          setFormError(null);
        } else {
          onClose();
        }
      }
    };
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [deletingItem, formMode, onClose]);

  const handleOpenCreate = () => {
    const today = getTodayStr();
    setStartDate(today);
    setEndDate(today);
    setAllDay(true);
    setStartTime('19:00');
    setEndTime('22:00');
    setReason('');
    setFormError(null);
    setEditingItem(null);
    setFormMode('create');
  };

  const handleOpenEdit = (item: MemberUnavailability) => {
    setStartDate(item.startDate);
    setEndDate(item.endDate);
    setAllDay(item.allDay);
    setStartTime(item.startTime || '19:00');
    setEndTime(item.endTime || '22:00');
    setReason(item.reason || '');
    setFormError(null);
    setEditingItem(item);
    setFormMode('edit');
  };

  const handleCancelForm = () => {
    if (saving) return;
    setFormMode(null);
    setEditingItem(null);
    setFormError(null);
  };

  const handleSaveForm = async (e: React.FormEvent) => {
    e.preventDefault();
    setFormError(null);

    if (!startDate || !endDate) {
      setFormError('Data inicial e data final são obrigatórias.');
      return;
    }

    if (startDate > endDate) {
      setFormError('A data inicial não pode ser posterior à data final.');
      return;
    }

    if (!allDay) {
      if (!startTime || !endTime) {
        setFormError('Horário inicial e horário final são obrigatórios quando não for dia inteiro.');
        return;
      }
      if (startDate === endDate && startTime >= endTime) {
        setFormError('O horário inicial deve ser anterior ao horário final.');
        return;
      }
    }

    setSaving(true);
    try {
      if (formMode === 'create') {
        await api.createManualMemberUnavailability(ministryId, member.id, {
          startDate,
          endDate,
          allDay,
          startTime: allDay ? null : startTime,
          endTime: allDay ? null : endTime,
          reason: reason.trim() ? reason.trim() : null,
        });
        showToast?.('Indisponibilidade registrada com sucesso!', 'success');
      } else if (formMode === 'edit' && editingItem) {
        await api.updateManualMemberUnavailability(ministryId, member.id, editingItem.id, {
          startDate,
          endDate,
          allDay,
          startTime: allDay ? null : startTime,
          endTime: allDay ? null : endTime,
          reason: reason.trim() ? reason.trim() : null,
        });
        showToast?.('Indisponibilidade atualizada com sucesso!', 'success');
      }
      setFormMode(null);
      setEditingItem(null);
      loadItems();
    } catch (err: any) {
      setFormError(err.message || 'Erro ao salvar indisponibilidade.');
    } finally {
      setSaving(false);
    }
  };

  const handleConfirmDelete = async () => {
    if (!deletingItem) return;
    setDeleting(true);
    try {
      await api.deleteManualMemberUnavailability(ministryId, member.id, deletingItem.id);
      showToast?.('Indisponibilidade excluída com sucesso!', 'success');
      setDeletingItem(null);
      loadItems();
    } catch (err: any) {
      showToast?.(err.message || 'Erro ao excluir indisponibilidade.', 'error');
    } finally {
      setDeleting(false);
    }
  };

  return (
    <div
      className="modal-overlay"
      role="dialog"
      aria-modal="true"
      aria-labelledby="manual-availability-title"
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
        if (e.target === e.currentTarget && !saving && !deleting) {
          onClose();
        }
      }}
    >
      <div
        className="modal-content"
        style={{
          background: 'var(--surface-color, #fff)',
          borderRadius: '16px',
          maxWidth: '560px',
          width: '100%',
          padding: '24px',
          boxShadow: '0 20px 25px -5px rgba(0,0,0,0.1)',
          maxHeight: '90vh',
          display: 'flex',
          flexDirection: 'column',
          overflow: 'hidden',
        }}
        onClick={(e) => e.stopPropagation()}
      >
        {/* Header */}
        <div
          style={{
            display: 'flex',
            alignItems: 'flex-start',
            justifyContent: 'space-between',
            marginBottom: '16px',
            gap: '12px',
          }}
        >
          <div>
            <div style={{ display: 'flex', alignItems: 'center', gap: '8px', flexWrap: 'wrap' }}>
              <h2
                id="manual-availability-title"
                style={{
                  margin: 0,
                  fontSize: '1.2rem',
                  fontWeight: 700,
                  color: 'var(--text-primary)',
                  display: 'flex',
                  alignItems: 'center',
                  gap: '8px',
                }}
              >
                <CalendarOff size={20} style={{ color: 'var(--primary-color)' }} />
                <span>Indisponibilidade de {member.name}</span>
              </h2>
              {isManual ? (
                <span
                  style={{
                    fontSize: '0.72rem',
                    fontWeight: 600,
                    padding: '2px 8px',
                    borderRadius: '6px',
                    background: 'var(--surface-variant)',
                    color: 'var(--text-secondary)',
                  }}
                >
                  Membro manual
                </span>
              ) : (
                <span
                  style={{
                    fontSize: '0.72rem',
                    fontWeight: 600,
                    padding: '2px 8px',
                    borderRadius: '6px',
                    background: 'rgba(245, 158, 11, 0.15)',
                    color: '#d97706',
                  }}
                >
                  Membro com conta
                </span>
              )}
            </div>
            <p style={{ margin: '4px 0 0 0', fontSize: '0.84rem', color: 'var(--text-secondary)' }}>
              Gestão delegada de ausências para escalas
            </p>
          </div>

          <button
            type="button"
            onClick={onClose}
            disabled={saving || deleting}
            aria-label="Fechar"
            style={{
              minHeight: '44px',
              minWidth: '44px',
              background: 'transparent',
              border: 'none',
              cursor: saving || deleting ? 'not-allowed' : 'pointer',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              color: 'var(--text-secondary)',
              borderRadius: '8px',
              flexShrink: 0,
            }}
          >
            <X size={20} />
          </button>
        </div>

        {/* Ineligible warning if member is not manual */}
        {!isManual && (
          <div
            style={{
              display: 'flex',
              alignItems: 'flex-start',
              gap: '12px',
              padding: '16px',
              background: 'rgba(245, 158, 11, 0.1)',
              border: '1px solid rgba(245, 158, 11, 0.3)',
              borderRadius: '10px',
              color: 'var(--text-primary)',
              fontSize: '0.9rem',
              lineHeight: 1.5,
              marginBottom: '16px',
            }}
          >
            <AlertTriangle size={20} style={{ color: '#d97706', flexShrink: 0, marginTop: '2px' }} />
            <div>
              <strong style={{ display: 'block', color: '#d97706', marginBottom: '4px' }}>
                Gestão restrita
              </strong>
              Indisponibilidade de membros com conta deve ser gerenciada pelo próprio integrante.
            </div>
          </div>
        )}

        {/* Main Content Area */}
        {isManual && (
          <div style={{ flex: 1, overflowY: 'auto', paddingRight: '4px' }}>
            {/* Subheader / Action bar when list is showing */}
            {!formMode && !deletingItem && (
              <div
                style={{
                  display: 'flex',
                  justifyContent: 'space-between',
                  alignItems: 'center',
                  marginBottom: '16px',
                }}
              >
                <span style={{ fontSize: '0.88rem', fontWeight: 600, color: 'var(--text-secondary)' }}>
                  Períodos cadastrados ({items.length})
                </span>
                <button
                  type="button"
                  onClick={handleOpenCreate}
                  style={{
                    display: 'inline-flex',
                    alignItems: 'center',
                    gap: '6px',
                    minHeight: '44px',
                    padding: '8px 16px',
                    background: 'var(--primary-color)',
                    color: '#fff',
                    border: 'none',
                    borderRadius: '8px',
                    fontSize: '0.88rem',
                    fontWeight: 600,
                    cursor: 'pointer',
                  }}
                >
                  <Plus size={16} />
                  <span>Nova Indisponibilidade</span>
                </button>
              </div>
            )}

            {/* Form Mode (Create or Edit) */}
            {formMode && (
              <div
                style={{
                  background: 'var(--surface-variant)',
                  border: '1px solid var(--border-color)',
                  borderRadius: '12px',
                  padding: '16px',
                  marginBottom: '16px',
                }}
              >
                <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: '14px' }}>
                  <h3 style={{ margin: 0, fontSize: '1rem', fontWeight: 700, color: 'var(--text-primary)' }}>
                    {formMode === 'create' ? 'Adicionar Indisponibilidade' : 'Editar Indisponibilidade'}
                  </h3>
                </div>

                {formError && (
                  <div
                    style={{
                      padding: '10px 14px',
                      background: 'rgba(239, 68, 68, 0.08)',
                      border: '1px solid rgba(239, 68, 68, 0.25)',
                      borderRadius: '8px',
                      color: '#ef4444',
                      fontSize: '0.85rem',
                      marginBottom: '14px',
                    }}
                  >
                    {formError}
                  </div>
                )}

                <form onSubmit={handleSaveForm}>
                  <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(200px, 1fr))', gap: '12px', marginBottom: '12px' }}>
                    <div>
                      <label
                        htmlFor="manual-avail-start"
                        style={{ display: 'block', fontSize: '0.82rem', fontWeight: 600, marginBottom: '4px', color: 'var(--text-primary)' }}
                      >
                        Data Inicial *
                      </label>
                      <input
                        id="manual-avail-start"
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
                          background: 'var(--surface-color)',
                          color: 'var(--text-primary)',
                          fontSize: '0.9rem',
                        }}
                      />
                    </div>

                    <div>
                      <label
                        htmlFor="manual-avail-end"
                        style={{ display: 'block', fontSize: '0.82rem', fontWeight: 600, marginBottom: '4px', color: 'var(--text-primary)' }}
                      >
                        Data Final *
                      </label>
                      <input
                        id="manual-avail-end"
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
                          background: 'var(--surface-color)',
                          color: 'var(--text-primary)',
                          fontSize: '0.9rem',
                        }}
                      />
                    </div>
                  </div>

                  <div style={{ marginBottom: '12px' }}>
                    <label
                      htmlFor="manual-avail-allday"
                      style={{
                        display: 'inline-flex',
                        alignItems: 'center',
                        gap: '8px',
                        minHeight: '44px',
                        cursor: saving ? 'not-allowed' : 'pointer',
                        fontSize: '0.9rem',
                        color: 'var(--text-primary)',
                      }}
                    >
                      <input
                        id="manual-avail-allday"
                        type="checkbox"
                        checked={allDay}
                        onChange={(e) => setAllDay(e.target.checked)}
                        disabled={saving}
                        style={{ width: '18px', height: '18px', cursor: 'pointer' }}
                      />
                      <span>Dia inteiro</span>
                    </label>
                  </div>

                  {!allDay && (
                    <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(180px, 1fr))', gap: '12px', marginBottom: '12px' }}>
                      <div>
                        <label
                          htmlFor="manual-avail-start-time"
                          style={{ display: 'block', fontSize: '0.82rem', fontWeight: 600, marginBottom: '4px', color: 'var(--text-primary)' }}
                        >
                          Horário Inicial *
                        </label>
                        <input
                          id="manual-avail-start-time"
                          type="time"
                          value={startTime}
                          onChange={(e) => setStartTime(e.target.value)}
                          disabled={saving}
                          required
                          style={{
                            width: '100%',
                            boxSizing: 'border-box',
                            minHeight: '44px',
                            padding: '8px 12px',
                            borderRadius: '8px',
                            border: '1px solid var(--border-color)',
                            background: 'var(--surface-color)',
                            color: 'var(--text-primary)',
                            fontSize: '0.9rem',
                          }}
                        />
                      </div>

                      <div>
                        <label
                          htmlFor="manual-avail-end-time"
                          style={{ display: 'block', fontSize: '0.82rem', fontWeight: 600, marginBottom: '4px', color: 'var(--text-primary)' }}
                        >
                          Horário Final *
                        </label>
                        <input
                          id="manual-avail-end-time"
                          type="time"
                          value={endTime}
                          onChange={(e) => setEndTime(e.target.value)}
                          disabled={saving}
                          required
                          style={{
                            width: '100%',
                            boxSizing: 'border-box',
                            minHeight: '44px',
                            padding: '8px 12px',
                            borderRadius: '8px',
                            border: '1px solid var(--border-color)',
                            background: 'var(--surface-color)',
                            color: 'var(--text-primary)',
                            fontSize: '0.9rem',
                          }}
                        />
                      </div>
                    </div>
                  )}

                  <div style={{ marginBottom: '16px' }}>
                    <label
                      htmlFor="manual-avail-reason"
                      style={{ display: 'block', fontSize: '0.82rem', fontWeight: 600, marginBottom: '4px', color: 'var(--text-primary)' }}
                    >
                      Motivo (opcional)
                    </label>
                    <input
                      id="manual-avail-reason"
                      type="text"
                      maxLength={200}
                      value={reason}
                      onChange={(e) => setReason(e.target.value)}
                      disabled={saving}
                      placeholder="Ex: Viagem de trabalho, compromisso familiar..."
                      style={{
                        width: '100%',
                        boxSizing: 'border-box',
                        minHeight: '44px',
                        padding: '8px 12px',
                        borderRadius: '8px',
                        border: '1px solid var(--border-color)',
                        background: 'var(--surface-color)',
                        color: 'var(--text-primary)',
                        fontSize: '0.9rem',
                      }}
                    />
                  </div>

                  <div style={{ display: 'flex', justifyContent: 'flex-end', gap: '10px' }}>
                    <button
                      type="button"
                      onClick={handleCancelForm}
                      disabled={saving}
                      style={{
                        minHeight: '44px',
                        padding: '8px 16px',
                        background: 'transparent',
                        border: '1px solid var(--border-color)',
                        borderRadius: '8px',
                        color: 'var(--text-primary)',
                        fontWeight: 600,
                        cursor: saving ? 'not-allowed' : 'pointer',
                      }}
                    >
                      Cancelar
                    </button>
                    <button
                      type="submit"
                      disabled={saving}
                      style={{
                        minHeight: '44px',
                        padding: '8px 20px',
                        background: 'var(--primary-color)',
                        color: '#fff',
                        border: 'none',
                        borderRadius: '8px',
                        fontWeight: 600,
                        cursor: saving ? 'not-allowed' : 'pointer',
                        display: 'inline-flex',
                        alignItems: 'center',
                        gap: '6px',
                      }}
                    >
                      {saving && <RefreshCw size={14} className="spin" />}
                      <span>{saving ? 'Salvando...' : 'Salvar'}</span>
                    </button>
                  </div>
                </form>
              </div>
            )}

            {/* Delete Confirmation Box */}
            {deletingItem && (
              <div
                style={{
                  background: 'rgba(239, 68, 68, 0.06)',
                  border: '1px solid rgba(239, 68, 68, 0.25)',
                  borderRadius: '12px',
                  padding: '16px',
                  marginBottom: '16px',
                }}
              >
                <div style={{ display: 'flex', alignItems: 'center', gap: '8px', color: '#ef4444', marginBottom: '8px' }}>
                  <AlertCircle size={18} />
                  <strong style={{ fontSize: '0.95rem' }}>Excluir Indisponibilidade</strong>
                </div>
                <p style={{ margin: '0 0 14px 0', fontSize: '0.88rem', color: 'var(--text-primary)', lineHeight: 1.5 }}>
                  Confirma a exclusão da indisponibilidade referente a{' '}
                  <strong>{formatDateBR(deletingItem.startDate)}</strong>?
                </p>
                <div style={{ display: 'flex', justifyContent: 'flex-end', gap: '10px' }}>
                  <button
                    type="button"
                    onClick={() => setDeletingItem(null)}
                    disabled={deleting}
                    style={{
                      minHeight: '44px',
                      padding: '8px 16px',
                      background: 'transparent',
                      border: '1px solid var(--border-color)',
                      borderRadius: '8px',
                      color: 'var(--text-primary)',
                      fontWeight: 600,
                      cursor: deleting ? 'not-allowed' : 'pointer',
                    }}
                  >
                    Cancelar
                  </button>
                  <button
                    type="button"
                    onClick={handleConfirmDelete}
                    disabled={deleting}
                    style={{
                      minHeight: '44px',
                      padding: '8px 20px',
                      background: '#ef4444',
                      color: '#fff',
                      border: 'none',
                      borderRadius: '8px',
                      fontWeight: 600,
                      cursor: deleting ? 'not-allowed' : 'pointer',
                      display: 'inline-flex',
                      alignItems: 'center',
                      gap: '6px',
                    }}
                  >
                    {deleting && <RefreshCw size={14} className="spin" />}
                    <span>{deleting ? 'Excluindo...' : 'Excluir'}</span>
                  </button>
                </div>
              </div>
            )}

            {/* Loading state */}
            {loading && (
              <div style={{ display: 'flex', flexDirection: 'column', gap: '10px', padding: '16px 0' }}>
                <div className="shimmer" style={{ height: '60px', borderRadius: '10px' }} />
                <div className="shimmer" style={{ height: '60px', borderRadius: '10px' }} />
              </div>
            )}

            {/* Error state */}
            {!loading && error && (
              <div
                style={{
                  display: 'flex',
                  flexDirection: 'column',
                  alignItems: 'center',
                  gap: '12px',
                  padding: '24px 16px',
                  textAlign: 'center',
                  background: 'rgba(239, 68, 68, 0.05)',
                  border: '1px solid rgba(239, 68, 68, 0.2)',
                  borderRadius: '12px',
                }}
              >
                <div style={{ color: '#ef4444', fontSize: '0.9rem' }}>{error}</div>
                <button
                  type="button"
                  onClick={loadItems}
                  style={{
                    display: 'inline-flex',
                    alignItems: 'center',
                    gap: '6px',
                    minHeight: '44px',
                    padding: '8px 16px',
                    background: 'var(--surface-color)',
                    border: '1px solid var(--border-color)',
                    borderRadius: '8px',
                    color: 'var(--text-primary)',
                    fontWeight: 600,
                    cursor: 'pointer',
                  }}
                >
                  <RefreshCw size={14} />
                  <span>Tentar novamente</span>
                </button>
              </div>
            )}

            {/* Empty state */}
            {!loading && !error && items.length === 0 && !formMode && (
              <div
                style={{
                  textAlign: 'center',
                  padding: '36px 16px',
                  color: 'var(--text-secondary)',
                  background: 'var(--surface-variant)',
                  borderRadius: '12px',
                }}
              >
                <CalendarOff size={36} style={{ margin: '0 auto 10px', opacity: 0.4 }} />
                <p style={{ margin: 0, fontSize: '0.95rem', fontWeight: 600, color: 'var(--text-primary)' }}>
                  Nenhuma indisponibilidade registrada
                </p>
                <p style={{ margin: '4px 0 0 0', fontSize: '0.85rem' }}>
                  Este integrante está disponível para todas as escalas.
                </p>
              </div>
            )}

            {/* Items list */}
            {!loading && !error && items.length > 0 && (
              <div style={{ display: 'flex', flexDirection: 'column', gap: '10px' }}>
                {items.map((item) => {
                  const dateDisplay =
                    item.startDate === item.endDate
                      ? formatDateBR(item.startDate)
                      : `${formatDateBR(item.startDate)} até ${formatDateBR(item.endDate)}`;

                  const periodDisplay = item.allDay
                    ? 'Dia inteiro'
                    : `${item.startTime || ''} - ${item.endTime || ''}`;

                  return (
                    <div
                      key={item.id}
                      style={{
                        display: 'flex',
                        alignItems: 'center',
                        justifyContent: 'space-between',
                        padding: '12px 16px',
                        background: 'var(--surface-variant)',
                        border: '1px solid var(--border-color)',
                        borderRadius: '10px',
                        gap: '12px',
                      }}
                    >
                      <div style={{ flex: 1, minWidth: 0 }}>
                        <div style={{ display: 'flex', alignItems: 'center', gap: '8px', flexWrap: 'wrap' }}>
                          <span style={{ fontWeight: 600, fontSize: '0.92rem', color: 'var(--text-primary)' }}>
                            {dateDisplay}
                          </span>
                          <span
                            style={{
                              fontSize: '0.75rem',
                              padding: '2px 8px',
                              borderRadius: '6px',
                              background: item.allDay
                                ? 'rgba(59, 130, 246, 0.12)'
                                : 'rgba(168, 85, 247, 0.12)',
                              color: item.allDay ? '#2563eb' : '#9333ea',
                              fontWeight: 600,
                              display: 'inline-flex',
                              alignItems: 'center',
                              gap: '4px',
                            }}
                          >
                            <Clock size={12} />
                            <span>{periodDisplay}</span>
                          </span>
                        </div>

                        {item.reason && (
                          <p
                            style={{
                              margin: '4px 0 0 0',
                              fontSize: '0.82rem',
                              color: 'var(--text-secondary)',
                              wordBreak: 'break-word',
                            }}
                          >
                            Motivo: {item.reason}
                          </p>
                        )}
                      </div>

                      <div style={{ display: 'flex', alignItems: 'center', gap: '6px', flexShrink: 0 }}>
                        <button
                          type="button"
                          onClick={() => handleOpenEdit(item)}
                          disabled={Boolean(formMode) || Boolean(deletingItem)}
                          aria-label={`Editar indisponibilidade de ${dateDisplay}`}
                          style={{
                            minHeight: '44px',
                            minWidth: '44px',
                            padding: '8px',
                            background: 'transparent',
                            border: '1px solid var(--border-color)',
                            borderRadius: '8px',
                            color: 'var(--text-primary)',
                            cursor: formMode || deletingItem ? 'not-allowed' : 'pointer',
                            display: 'inline-flex',
                            alignItems: 'center',
                            justifyContent: 'center',
                          }}
                        >
                          <Edit2 size={16} />
                        </button>
                        <button
                          type="button"
                          onClick={() => setDeletingItem(item)}
                          disabled={Boolean(formMode) || Boolean(deletingItem)}
                          aria-label={`Excluir indisponibilidade de ${dateDisplay}`}
                          style={{
                            minHeight: '44px',
                            minWidth: '44px',
                            padding: '8px',
                            background: 'transparent',
                            border: '1px solid rgba(239, 68, 68, 0.3)',
                            borderRadius: '8px',
                            color: '#ef4444',
                            cursor: formMode || deletingItem ? 'not-allowed' : 'pointer',
                            display: 'inline-flex',
                            alignItems: 'center',
                            justifyContent: 'center',
                          }}
                        >
                          <Trash2 size={16} />
                        </button>
                      </div>
                    </div>
                  );
                })}
              </div>
            )}
          </div>
        )}

        {/* Footer */}
        <div
          style={{
            marginTop: '16px',
            paddingTop: '12px',
            borderTop: '1px solid var(--border-color)',
            display: 'flex',
            justifyContent: 'flex-end',
          }}
        >
          <button
            type="button"
            onClick={onClose}
            disabled={saving || deleting}
            style={{
              minHeight: '44px',
              padding: '8px 20px',
              background: 'var(--surface-variant)',
              border: '1px solid var(--border-color)',
              borderRadius: '8px',
              color: 'var(--text-primary)',
              fontWeight: 600,
              cursor: saving || deleting ? 'not-allowed' : 'pointer',
            }}
          >
            Fechar
          </button>
        </div>
      </div>
    </div>
  );
}