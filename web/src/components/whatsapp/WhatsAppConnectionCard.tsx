import { useState, useEffect } from 'react';
import {
  Edit2,
  Check,
  X,
  Phone,
  Star,
  Building,
  AlertCircle,
  RefreshCw,
  Trash2,
} from 'lucide-react';
import { api } from '../../api';
import type { WhatsAppConnectionDto } from '../../whatsapp.types';
import { classifyWhatsAppError } from '../../whatsapp-errors';

export interface WhatsAppConnectionCardProps {
  connection: WhatsAppConnectionDto;
  organizationId: string;
  availableMinistries?: Array<{ id: string; name: string }>;
  onConnectionUpdated: (updated: WhatsAppConnectionDto) => void;
  onRequestDisconnect: (connection: WhatsAppConnectionDto) => void;
  onResume?: (connection: WhatsAppConnectionDto) => void;
  canResume?: boolean;
}

export function WhatsAppConnectionCard({
  connection,
  organizationId,
  availableMinistries = [],
  onConnectionUpdated,
  onRequestDisconnect,
  onResume,
  canResume = false,
}: WhatsAppConnectionCardProps) {
  const [isEditingName, setIsEditingName] = useState(false);
  const [nameInput, setNameInput] = useState(connection.displayName);
  const [nameError, setNameError] = useState<string | null>(null);
  const [savingName, setSavingName] = useState(false);

  const [savingDefault, setSavingDefault] = useState(false);
  const [savingAssignment, setSavingAssignment] = useState(false);
  const [selectedMinistryId, setSelectedMinistryId] = useState<string>(
    connection.assignedMinistryId || ''
  );
  const [cardError, setCardError] = useState<string | null>(null);

  // Sync state if props change externally
  useEffect(() => {
    setNameInput(connection.displayName);
    setSelectedMinistryId(connection.assignedMinistryId || '');
  }, [connection.displayName, connection.assignedMinistryId]);

  const isDisconnected = connection.status === 'disconnected';
  const isConnected = connection.status === 'connected';
  const isResumable =
    canResume && (connection.status === 'pending' || connection.status === 'connecting');

  // Status badge config
  const statusConfig = {
    connected: { label: 'Conectado', bg: 'rgba(16, 185, 129, 0.15)', color: 'var(--success-color, #10b981)' },
    connecting: { label: 'Conectando', bg: 'rgba(59, 130, 246, 0.15)', color: '#3b82f6' },
    pending: { label: 'Pendente', bg: 'rgba(245, 158, 11, 0.15)', color: '#f59e0b' },
    error: { label: 'Erro', bg: 'rgba(239, 68, 68, 0.15)', color: 'var(--error-color, #ef4444)' },
    disabled_by_user: { label: 'Desativado', bg: 'rgba(148, 163, 184, 0.15)', color: '#94a3b8' },
    disconnected: { label: 'Desconectado', bg: 'rgba(100, 116, 139, 0.15)', color: '#64748b' },
  }[connection.status] || {
    label: connection.status,
    bg: 'rgba(148, 163, 184, 0.15)',
    color: '#94a3b8',
  };

  const providerLabel = connection.provider === 'meta_cloud_api' ? 'Meta Cloud API' : 'Zernio';

  const assignedMinistryName = connection.assignedMinistryId
    ? availableMinistries.find((m) => m.id === connection.assignedMinistryId)?.name ||
      connection.assignedMinistryId
    : null;

  // Handle Save Display Name
  const handleSaveDisplayName = async () => {
    const trimmed = nameInput.trim();
    if (!trimmed) {
      setNameError('O nome de exibição não pode ficar vazio.');
      return;
    }
    if (trimmed.length > 100) {
      setNameError('O nome de exibição deve ter no máximo 100 caracteres.');
      return;
    }

    setSavingName(true);
    setNameError(null);
    setCardError(null);

    try {
      const updated = await api.updateWhatsAppConnection(organizationId, connection.id, {
        displayName: trimmed,
      });
      setIsEditingName(false);
      onConnectionUpdated(updated);
    } catch (err) {
      const msg = classifyWhatsAppError(err).userMessage;
      setNameError(msg);
    } finally {
      setSavingName(false);
    }
  };

  // Handle Toggle Organization Default
  const handleToggleDefault = async (makeDefault: boolean) => {
    setSavingDefault(true);
    setCardError(null);

    try {
      const updated = await api.updateWhatsAppConnection(organizationId, connection.id, {
        isOrganizationDefault: makeDefault,
      });
      onConnectionUpdated(updated);
    } catch (err) {
      setCardError(classifyWhatsAppError(err).userMessage);
    } finally {
      setSavingDefault(false);
    }
  };

  // Handle Save Ministry Assignment
  const handleSaveAssignment = async () => {
    setSavingAssignment(true);
    setCardError(null);

    try {
      const updated = await api.updateWhatsAppConnection(organizationId, connection.id, {
        assignedMinistryId: selectedMinistryId ? selectedMinistryId : null,
      });
      onConnectionUpdated(updated);
    } catch (err) {
      setCardError(classifyWhatsAppError(err).userMessage);
    } finally {
      setSavingAssignment(false);
    }
  };

  return (
    <div
      className="card whatsapp-connection-card"
      data-testid={`whatsapp-connection-card-${connection.id}`}
      style={{
        padding: '20px',
        borderRadius: '12px',
        background: 'var(--surface-color)',
        border: '1px solid var(--border-color)',
        marginBottom: '16px',
        opacity: isDisconnected ? 0.75 : 1,
      }}
    >
      {/* Top Header: Title, Edit, and Status */}
      <div
        style={{
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'space-between',
          flexWrap: 'wrap',
          gap: '12px',
          marginBottom: '12px',
        }}
      >
        <div style={{ display: 'flex', alignItems: 'center', gap: '8px', flex: 1, minWidth: '240px' }}>
          {!isEditingName ? (
            <>
              <h3
                style={{
                  fontSize: '1.05rem',
                  fontWeight: 700,
                  margin: 0,
                  color: 'var(--text-primary)',
                }}
              >
                {connection.displayName}
              </h3>
              {!isDisconnected && (
                <button
                  type="button"
                  className="btn btn-icon min-h-[44px]"
                  data-testid={`edit-display-name-btn-${connection.id}`}
                  onClick={() => {
                    setNameInput(connection.displayName);
                    setNameError(null);
                    setIsEditingName(true);
                  }}
                  title="Editar nome de exibição"
                  aria-label="Editar nome de exibição"
                  style={{
                    minHeight: '44px',
                    minWidth: '44px',
                    padding: '8px',
                    background: 'transparent',
                    border: 'none',
                    color: 'var(--text-secondary)',
                    cursor: 'pointer',
                    display: 'inline-flex',
                    alignItems: 'center',
                    justifyContent: 'center',
                  }}
                >
                  <Edit2 size={16} />
                </button>
              )}
            </>
          ) : (
            <div style={{ display: 'flex', flexDirection: 'column', gap: '6px', width: '100%', maxWidth: '400px' }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: '6px' }}>
                <input
                  type="text"
                  value={nameInput}
                  onChange={(e) => {
                    setNameInput(e.target.value);
                    if (nameError) setNameError(null);
                  }}
                  maxLength={100}
                  data-testid={`display-name-input-${connection.id}`}
                  className="input-field"
                  placeholder="Nome de exibição"
                  disabled={savingName}
                  style={{
                    flex: 1,
                    padding: '8px 12px',
                    borderRadius: '8px',
                    border: nameError ? '1px solid var(--error-color, #ef4444)' : '1px solid var(--border-color)',
                    background: 'var(--surface-variant)',
                    color: 'var(--text-primary)',
                    minHeight: '44px',
                  }}
                />
                <button
                  type="button"
                  className="btn btn-primary min-h-[44px]"
                  data-testid={`save-display-name-btn-${connection.id}`}
                  onClick={handleSaveDisplayName}
                  disabled={savingName || !nameInput.trim() || nameInput.trim().length > 100}
                  aria-label="Salvar nome"
                  style={{
                    minHeight: '44px',
                    minWidth: '44px',
                    padding: '8px 12px',
                    display: 'inline-flex',
                    alignItems: 'center',
                    justifyContent: 'center',
                  }}
                >
                  <Check size={16} />
                </button>
                <button
                  type="button"
                  className="btn btn-secondary min-h-[44px]"
                  data-testid={`cancel-display-name-btn-${connection.id}`}
                  onClick={() => {
                    setIsEditingName(false);
                    setNameInput(connection.displayName);
                    setNameError(null);
                  }}
                  disabled={savingName}
                  aria-label="Cancelar edição"
                  style={{
                    minHeight: '44px',
                    minWidth: '44px',
                    padding: '8px 12px',
                    display: 'inline-flex',
                    alignItems: 'center',
                    justifyContent: 'center',
                  }}
                >
                  <X size={16} />
                </button>
              </div>
              {nameError && (
                <span
                  data-testid={`display-name-error-${connection.id}`}
                  style={{ color: 'var(--error-color, #ef4444)', fontSize: '0.82rem' }}
                >
                  {nameError}
                </span>
              )}
            </div>
          )}
        </div>

        {/* Badges: Provider & Status */}
        <div style={{ display: 'flex', alignItems: 'center', gap: '8px', flexWrap: 'wrap' }}>
          <span
            data-testid={`connection-provider-badge-${connection.id}`}
            style={{
              fontSize: '0.8rem',
              padding: '4px 10px',
              borderRadius: '12px',
              fontWeight: 600,
              background: 'rgba(59, 130, 246, 0.1)',
              color: '#3b82f6',
              border: '1px solid rgba(59, 130, 246, 0.2)',
            }}
          >
            {providerLabel}
          </span>
          <span
            data-testid={`connection-status-badge-${connection.id}`}
            style={{
              fontSize: '0.8rem',
              padding: '4px 10px',
              borderRadius: '12px',
              fontWeight: 600,
              background: statusConfig.bg,
              color: statusConfig.color,
            }}
          >
            {statusConfig.label}
          </span>
        </div>
      </div>

      {/* Details Row: Phone and Routing Badges */}
      <div style={{ display: 'flex', alignItems: 'center', gap: '16px', flexWrap: 'wrap', marginBottom: '12px' }}>
        <div
          data-testid={`connection-phone-${connection.id}`}
          style={{
            display: 'flex',
            alignItems: 'center',
            gap: '6px',
            color: 'var(--text-secondary)',
            fontSize: '0.9rem',
          }}
        >
          <Phone size={15} style={{ color: 'var(--text-tertiary)' }} />
          <span>{connection.phoneNumber || 'Telefone não registrado'}</span>
        </div>

        {/* Organization Default Badge */}
        {connection.isOrganizationDefault && (
          <span
            data-testid={`connection-default-badge-${connection.id}`}
            style={{
              display: 'inline-flex',
              alignItems: 'center',
              gap: '4px',
              fontSize: '0.78rem',
              padding: '3px 8px',
              borderRadius: '6px',
              fontWeight: 600,
              background: 'rgba(16, 185, 129, 0.12)',
              color: 'var(--success-color, #10b981)',
              border: '1px solid rgba(16, 185, 129, 0.25)',
            }}
          >
            <Star size={12} />
            <span>Padrão da Organização</span>
          </span>
        )}

        {/* Ministry Assignment Badge */}
        {connection.assignedMinistryId && (
          <span
            data-testid={`connection-assigned-badge-${connection.id}`}
            style={{
              display: 'inline-flex',
              alignItems: 'center',
              gap: '4px',
              fontSize: '0.78rem',
              padding: '3px 8px',
              borderRadius: '6px',
              fontWeight: 600,
              background: 'rgba(168, 85, 247, 0.12)',
              color: '#a855f7',
              border: '1px solid rgba(168, 85, 247, 0.25)',
            }}
          >
            <Building size={12} />
            <span>Atribuído ao ministério: {assignedMinistryName}</span>
          </span>
        )}
      </div>

      {/* Status Reason / Warning */}
      {connection.statusReason && (
        <div
          data-testid={`connection-status-reason-${connection.id}`}
          style={{
            padding: '8px 12px',
            borderRadius: '8px',
            background: 'rgba(239, 68, 68, 0.1)',
            border: '1px solid rgba(239, 68, 68, 0.2)',
            color: 'var(--error-color, #ef4444)',
            fontSize: '0.84rem',
            marginBottom: '14px',
          }}
        >
          {connection.statusReason}
        </div>
      )}

      {/* Card Error Alert (if any configuration action failed) */}
      {cardError && (
        <div
          role="alert"
          data-testid={`card-error-${connection.id}`}
          style={{
            padding: '8px 12px',
            borderRadius: '8px',
            background: 'rgba(239, 68, 68, 0.12)',
            border: '1px solid var(--error-color, #ef4444)',
            color: 'var(--error-color, #ef4444)',
            fontSize: '0.85rem',
            marginBottom: '14px',
            display: 'flex',
            alignItems: 'center',
            gap: '8px',
          }}
        >
          <AlertCircle size={16} style={{ flexShrink: 0 }} />
          <span>{cardError}</span>
        </div>
      )}

      {/* Resume CTA (if pending/connecting and authorized) */}
      {isResumable && onResume && (
        <div style={{ marginBottom: '14px' }}>
          <button
            type="button"
            className="btn btn-secondary min-h-[44px]"
            data-testid={`resume-connection-btn-${connection.id}`}
            onClick={() => onResume(connection)}
            style={{
              minHeight: '44px',
              display: 'inline-flex',
              alignItems: 'center',
              gap: '8px',
              padding: '8px 16px',
              fontWeight: 600,
            }}
          >
            <RefreshCw size={16} />
            <span>Retomar configuração</span>
          </button>
        </div>
      )}

      {/* Configuration Controls (Default, Assignment, Disconnect) */}
      {!isDisconnected && (
        <div
          style={{
            borderTop: '1px solid var(--border-color)',
            paddingTop: '14px',
            marginTop: '10px',
            display: 'flex',
            flexDirection: 'column',
            gap: '12px',
          }}
        >
          {/* Row: Default and Ministry Assignment */}
          <div
            style={{
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'space-between',
              flexWrap: 'wrap',
              gap: '14px',
            }}
          >
            {/* Organization Default Button */}
            <div>
              {connection.isOrganizationDefault ? (
                <button
                  type="button"
                  className="btn btn-secondary min-h-[44px]"
                  data-testid={`remove-default-btn-${connection.id}`}
                  onClick={() => handleToggleDefault(false)}
                  disabled={savingDefault}
                  style={{
                    minHeight: '44px',
                    display: 'inline-flex',
                    alignItems: 'center',
                    gap: '6px',
                    padding: '8px 14px',
                    fontSize: '0.88rem',
                  }}
                >
                  <Star size={15} />
                  <span>Remover como padrão</span>
                </button>
              ) : (
                <button
                  type="button"
                  className="btn btn-secondary min-h-[44px]"
                  data-testid={`set-default-btn-${connection.id}`}
                  onClick={() => handleToggleDefault(true)}
                  disabled={
                    savingDefault ||
                    !isConnected ||
                    connection.assignedMinistryId !== null
                  }
                  title={
                    connection.assignedMinistryId !== null
                      ? 'Uma conexão atribuída a um ministério não pode ser definida como padrão.'
                      : !isConnected
                      ? 'Apenas conexões ativas podem ser configuradas como padrão.'
                      : 'Definir como conexão padrão da organização'
                  }
                  style={{
                    minHeight: '44px',
                    display: 'inline-flex',
                    alignItems: 'center',
                    gap: '6px',
                    padding: '8px 14px',
                    fontSize: '0.88rem',
                  }}
                >
                  <Star size={15} />
                  <span>Definir como padrão</span>
                </button>
              )}
            </div>

            {/* Ministry Assignment Control */}
            <div style={{ display: 'flex', alignItems: 'center', gap: '8px', flexWrap: 'wrap' }}>
              <label
                htmlFor={`assign-select-${connection.id}`}
                style={{ fontSize: '0.86rem', color: 'var(--text-secondary)' }}
              >
                Ministério:
              </label>
              <select
                id={`assign-select-${connection.id}`}
                data-testid={`assign-ministry-select-${connection.id}`}
                value={selectedMinistryId}
                onChange={(e) => setSelectedMinistryId(e.target.value)}
                disabled={
                  savingAssignment ||
                  !isConnected ||
                  connection.isOrganizationDefault
                }
                title={
                  connection.isOrganizationDefault
                    ? 'A conexão padrão não pode ser atribuída exclusivamente.'
                    : !isConnected
                    ? 'Apenas conexões ativas podem ser atribuídas exclusivamente.'
                    : 'Selecione o ministério para atribuição exclusiva'
                }
                className="input-field"
                style={{
                  minHeight: '44px',
                  padding: '8px 12px',
                  borderRadius: '8px',
                  border: '1px solid var(--border-color)',
                  background: 'var(--surface-variant)',
                  color: 'var(--text-primary)',
                  fontSize: '0.88rem',
                }}
              >
                <option value="">Nenhum (Disponível para a organização)</option>
                {availableMinistries.map((m) => (
                  <option key={m.id} value={m.id}>
                    {m.name}
                  </option>
                ))}
              </select>

              <button
                type="button"
                className="btn btn-secondary min-h-[44px]"
                data-testid={`save-assignment-btn-${connection.id}`}
                onClick={handleSaveAssignment}
                disabled={
                  savingAssignment ||
                  !isConnected ||
                  connection.isOrganizationDefault ||
                  selectedMinistryId === (connection.assignedMinistryId || '')
                }
                style={{
                  minHeight: '44px',
                  padding: '8px 14px',
                  fontSize: '0.88rem',
                }}
              >
                {savingAssignment ? 'Salvando…' : 'Salvar atribuição'}
              </button>
            </div>

            {/* Disconnect Action */}
            <div style={{ marginLeft: 'auto' }}>
              <button
                type="button"
                className="btn min-h-[44px]"
                data-testid={`disconnect-connection-btn-${connection.id}`}
                onClick={() => onRequestDisconnect(connection)}
                style={{
                  minHeight: '44px',
                  display: 'inline-flex',
                  alignItems: 'center',
                  gap: '6px',
                  padding: '8px 14px',
                  fontSize: '0.88rem',
                  color: 'var(--error-color, #ef4444)',
                  background: 'transparent',
                  border: '1px solid rgba(239, 68, 68, 0.4)',
                  borderRadius: '8px',
                  cursor: 'pointer',
                }}
              >
                <Trash2 size={15} />
                <span>Desconectar</span>
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
