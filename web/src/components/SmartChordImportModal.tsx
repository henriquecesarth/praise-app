import React, { useState, useEffect, useRef } from 'react';
import { api, SmartChord, SmartChordImportDraft, ImportWarning } from '../api';
import { Song } from '../types';
import { parseSmartChord, hasBarProgression, parseBarProgressionLine } from '../utils/smart_chord';

interface SmartChordImportModalProps {
  isOpen: boolean;
  ministryId?: string;
  currentUserId?: string;
  repertoireSongs?: Song[];
  onClose: () => void;
  onSuccess: (savedChord: SmartChord) => void;
}

const STANDARD_KEYS = [
  'C', 'C#', 'Db', 'D', 'Eb', 'E', 'F', 'F#', 'Gb', 'G', 'Ab', 'A', 'Bb', 'B',
  'Cm', 'C#m', 'Dm', 'D#m', 'Ebm', 'Em', 'Fm', 'F#m', 'Gm', 'G#m', 'Abm', 'Am', 'Bbm', 'Bm',
];

export const SmartChordImportModal: React.FC<SmartChordImportModalProps> = ({
  isOpen,
  ministryId,
  currentUserId,
  repertoireSongs = [],
  onClose,
  onSuccess,
}) => {
  const [step, setStep] = useState<'input' | 'extracting' | 'preview' | 'link_prompt'>('input');
  const [activeTab, setActiveTab] = useState<'pdf' | 'text' | 'url' | 'image'>('pdf');
  const [selectedFile, setSelectedFile] = useState<File | null>(null);
  const [selectedImageFile, setSelectedImageFile] = useState<File | null>(null);
  const [pastedText, setPastedText] = useState('');
  const [inputUrl, setInputUrl] = useState('');
  const [requiresManualPaste, setRequiresManualPaste] = useState(false);
  const [sourceUrl, setSourceUrl] = useState<string | null>(null);
  const [displayedKey, setDisplayedKey] = useState<string | null>(null);
  const [capo, setCapo] = useState<number | null>(null);
  const [previewTab, setPreviewTab] = useState<'edit' | 'rendered'>('edit');
  const imageInputRef = useRef<HTMLInputElement>(null);

  // Draft fields
  const [title, setTitle] = useState('');
  const [artistName, setArtistName] = useState('');
  const [originalKey, setOriginalKey] = useState('');
  const [content, setContent] = useState('');
  const [warnings, setWarnings] = useState<ImportWarning[]>([]);

  // Loading & error states
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [isSaving, setIsSaving] = useState(false);
  const [isNormalizing, setIsNormalizing] = useState(false);

  // Link prompt state
  const [savedChord, setSavedChord] = useState<SmartChord | null>(null);
  const [selectedSongId, setSelectedSongId] = useState('');
  const [isLinking, setIsLinking] = useState(false);
  const [linkError, setLinkError] = useState<string | null>(null);

  const fileInputRef = useRef<HTMLInputElement>(null);
  const generationRef = useRef(0);

  // Include authoritative user identity and the canonical credential in every operation.
  const [, refreshSession] = useState(0);
  const authToken = localStorage.getItem('praise_auth_token');
  const contextRef = useRef({ isOpen, ministryId, currentUserId, authToken });
  contextRef.current = { isOpen, ministryId, currentUserId, authToken };
  const mountedRef = useRef(false);
  const isCurrent = (generation: number) => mountedRef.current &&
    generation === generationRef.current && contextRef.current.isOpen &&
    contextRef.current.ministryId === ministryId &&
    contextRef.current.currentUserId === currentUserId &&
    contextRef.current.authToken === authToken &&
    localStorage.getItem('praise_auth_token') === authToken;

  useEffect(() => {
    mountedRef.current = true;
    const onStorage = (event: StorageEvent) => {
      if (event.key === 'praise_auth_token' || event.key === null) {
        generationRef.current += 1;
        refreshSession(value => value + 1);
      }
    };
    window.addEventListener('storage', onStorage);
    return () => {
      mountedRef.current = false;
      generationRef.current += 1;
      window.removeEventListener('storage', onStorage);
    };
  }, []);

  // Reset state when opening/closing or switching ministry/session
  useEffect(() => {
    generationRef.current += 1;
    if (isOpen) {
      setStep('input');
      setActiveTab('pdf');
      setSelectedFile(null);
      setSelectedImageFile(null);
      setPastedText('');
      setInputUrl('');
      setRequiresManualPaste(false);
      setSourceUrl(null);
      setDisplayedKey(null);
      setCapo(null);
      setPreviewTab('edit');
      setTitle('');
      setArtistName('');
      setOriginalKey('');
      setContent('');
      setWarnings([]);
      setErrorMessage(null);
      setIsSaving(false);
      setIsNormalizing(false);
      setSavedChord(null);
      setSelectedSongId('');
      setIsLinking(false);
      setLinkError(null);
    }
  }, [isOpen, ministryId, currentUserId, authToken]);

  const handleSafeClose = () => {
    generationRef.current += 1;
    onClose();
  };

  // Escape key handler
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape' && isOpen && !isSaving && !isLinking) {
        handleSafeClose();
      }
    };
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [isOpen, isSaving, isLinking, onClose]);

  if (!isOpen) return null;

  const handleTabSwitch = (tab: 'pdf' | 'text' | 'url' | 'image') => {
    generationRef.current += 1;
    setErrorMessage(null);
    setActiveTab(tab);
  };

  const handleFileChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    generationRef.current += 1;
    const file = e.target.files?.[0];
    if (!file) return;

    if (file.size > 3 * 1024 * 1024) {
      setErrorMessage('Arquivo PDF excede o limite máximo permitido de 3 MB.');
      setSelectedFile(null);
      return;
    }

    setErrorMessage(null);
    setSelectedFile(file);
  };

  const handleExtractPdf = async () => {
    if (!selectedFile) {
      setErrorMessage('Selecione um arquivo PDF para importar.');
      return;
    }

    const currentGen = ++generationRef.current;
    setErrorMessage(null);
    setStep('extracting');

    try {
      const draft = await api.importSmartChordPdf(selectedFile);
      if (!isCurrent(currentGen)) return;
      applyDraft(draft);
      setStep('preview');
    } catch (err: any) {
      if (!isCurrent(currentGen)) return;
      console.error('Erro na extração do PDF:', err);
      setErrorMessage(err?.message || 'Falha ao processar o arquivo PDF. Verifique se é um PDF de texto válido.');
      setStep('input');
    }
  };

  const handleExtractText = async () => {
    if (!pastedText.trim()) {
      setErrorMessage('Cole o texto da cifra para importar.');
      return;
    }

    const currentGen = ++generationRef.current;
    setErrorMessage(null);
    setStep('extracting');

    try {
      const draft = await api.importSmartChordText(pastedText);
      if (!isCurrent(currentGen)) return;
      applyDraft(draft);
      setStep('preview');
    } catch (err: any) {
      if (!isCurrent(currentGen)) return;
      console.error('Erro na normalização do texto:', err);
      setErrorMessage(err?.message || 'Falha ao normalizar o texto fornecido.');
      setStep('input');
    }
  };

  const applyDraft = (draft: SmartChordImportDraft) => {
    setTitle(draft.title || 'Nova Cifra');
    setArtistName(draft.artistName || '');
    setOriginalKey(draft.originalKey || '');
    setDisplayedKey(draft.displayedKey ?? null);
    setCapo(draft.capo ?? null);
    setContent(draft.content || '');
    setWarnings(draft.warnings || []);
    setRequiresManualPaste(Boolean(draft.requiresManualPaste));
    setSourceUrl(draft.sourceUrl || null);
  };

  const handleExtractUrl = async () => {
    if (!inputUrl.trim()) {
      setErrorMessage('Informe a URL da cifra para importar.');
      return;
    }

    const currentGen = ++generationRef.current;
    setErrorMessage(null);
    setStep('extracting');

    try {
      const draft = await api.importSmartChordUrl(inputUrl.trim());
      if (!isCurrent(currentGen)) return;
      applyDraft(draft);
      setStep('preview');
    } catch (err: any) {
      if (!isCurrent(currentGen)) return;
      console.error('Erro na extração da URL:', err);
      setErrorMessage(err?.message || 'Falha ao processar o link fornecido.');
      setStep('input');
    }
  };

  const handleImageFileChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    generationRef.current += 1;
    const file = e.target.files?.[0];
    if (!file) return;

    if (file.size > 5 * 1024 * 1024) {
      setErrorMessage('Arquivo de imagem excede o limite máximo permitido de 5 MB.');
      setSelectedImageFile(null);
      return;
    }

    setErrorMessage(null);
    setSelectedImageFile(file);
  };

  const handleExtractImage = async () => {
    if (!selectedImageFile) {
      setErrorMessage('Selecione um arquivo de imagem para importar.');
      return;
    }

    const currentGen = ++generationRef.current;
    setErrorMessage(null);
    setStep('extracting');

    try {
      const draft = await api.importSmartChordImage(selectedImageFile);
      if (!isCurrent(currentGen)) return;
      applyDraft(draft);
      setStep('preview');
    } catch (err: any) {
      if (!isCurrent(currentGen)) return;
      console.error('Erro na extração da imagem:', err);
      setErrorMessage(err?.message || 'Falha ao processar a imagem.');
      setStep('input');
    }
  };

  const handlePasteClipboard = async (target: 'text' | 'url' | 'content') => {
    const currentGen = ++generationRef.current;
    try {
      if (!navigator.clipboard?.readText) {
        setErrorMessage('Cole o texto manualmente no campo. A área de transferência não está disponível.');
        return;
      }
      const text = await navigator.clipboard.readText();
      if (!isCurrent(currentGen)) return;
      if (text.length > (target === 'url' ? 1000 : 100000)) {
        setErrorMessage('O conteúdo da área de transferência excede o limite permitido.');
        return;
      }
      if (target === 'url') setInputUrl(text.trim());
      else if (target === 'content') setContent(text);
      else setPastedText(text);
      setErrorMessage(null);
    } catch (err) {
      if (!isCurrent(currentGen)) return;
      setErrorMessage('Não foi possível ler a área de transferência. Cole o texto manualmente no campo.');
    }
  };

  const handleNormalizeManualContent = async () => {
    if (!content.trim() || isNormalizing) return;
    const currentGen = ++generationRef.current;
    setIsNormalizing(true);
    setErrorMessage(null);
    try {
      const draft = await api.importSmartChordText(content);
      if (!isCurrent(currentGen)) return;
      // Keep the reviewed URL/image metadata and normalize only the pasted body.
      setContent(draft.content);
      setOriginalKey(current => current || draft.originalKey || '');
      setDisplayedKey(draft.displayedKey ?? null);
      setCapo(draft.capo ?? null);
      setWarnings(draft.warnings || []);
      setRequiresManualPaste(false);
    } catch (err: any) {
      if (!isCurrent(currentGen)) return;
      setErrorMessage(err?.message || 'Falha ao normalizar o texto. Tente novamente.');
    } finally {
      if (isCurrent(currentGen)) setIsNormalizing(false);
    }
  };

  const handleSaveChord = async () => {
    if (!isCurrent(generationRef.current) || isSaving || isLinking || isNormalizing || savedChord) return;
    if (requiresManualPaste) {
      setErrorMessage('Cole o conteúdo e normalize o texto antes de salvar.');
      return;
    }
    if (!title.trim()) {
      setErrorMessage('O título da cifra é obrigatório.');
      return;
    }
    if (!content.trim()) {
      setErrorMessage('O conteúdo da cifra não pode ser vazio.');
      return;
    }
    if (!originalKey.trim()) {
      setErrorMessage('Tom não identificado. Selecione o tom original após revisar a fonte.');
      return;
    }

    const currentGen = ++generationRef.current;
    setIsSaving(true);
    setErrorMessage(null);

    try {
      const created = await api.createSmartChord({
        title: title.trim(),
        artistName: artistName.trim() || null,
        originalKey: originalKey.trim(),
        content: content.trim(),
        ...(sourceUrl ? { sourceUrl } : {}),
        ...(displayedKey ? { displayedKey } : {}),
        ...(capo != null ? { capo } : {}),
      });

      if (!isCurrent(currentGen)) return;

      // If active ministry exists with repertoire songs, offer optional linking
      if (ministryId && repertoireSongs.length > 0) {
        setSavedChord(created);
        // Pre-select first song or matching title
        const match = repertoireSongs.find(s => s.title.toLowerCase() === title.trim().toLowerCase());
        setSelectedSongId(match ? match.id : (repertoireSongs[0]?.id || ''));
        setStep('link_prompt');
      } else {
        onSuccess(created);
      }
    } catch (err: any) {
      if (!isCurrent(currentGen)) return;
      console.error('Erro ao salvar cifra:', err);
      setErrorMessage(err?.message || 'Não foi possível salvar a cifra inteligente.');
    } finally {
      if (isCurrent(currentGen)) setIsSaving(false);
    }
  };

  const handleConfirmLink = async () => {
    if (!isCurrent(generationRef.current) || isLinking || !savedChord || !ministryId || !selectedSongId) {
      return;
    }

    const currentGen = ++generationRef.current;
    setIsLinking(true);
    setLinkError(null);

    try {
      await api.setSmartChordRepertoireLink(ministryId, savedChord.id, selectedSongId);
      if (!isCurrent(currentGen)) return;
      onSuccess(savedChord);
    } catch (err: any) {
      if (!isCurrent(currentGen)) return;
      console.error('Erro ao vincular ao repertório:', err);
      // Partial success safety: chord is already saved!
      setLinkError(err?.message || 'Cifra salva, mas ocorreu uma falha ao vincular ao repertório.');
    } finally {
      if (isCurrent(currentGen)) setIsLinking(false);
    }
  };

  const handleSkipLink = () => {
    if (!isCurrent(generationRef.current) || isLinking) return;
    if (savedChord) {
      onSuccess(savedChord);
    } else {
      onClose();
    }
  };

  return (
    <div
      className="modal-backdrop"
      style={{
        position: 'fixed',
        top: 0,
        left: 0,
        right: 0,
        bottom: 0,
        backgroundColor: 'rgba(0,0,0,0.6)',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        zIndex: 1000,
        padding: '16px',
      }}
      onClick={(e) => {
        if (e.target === e.currentTarget && !isSaving && !isLinking) {
          handleSafeClose();
        }
      }}
    >
      <div
        className="glass-panel"
        style={{
          width: '100%',
          maxWidth: step === 'preview' ? '800px' : '550px',
          maxHeight: '90vh',
          display: 'flex',
          flexDirection: 'column',
          borderRadius: '12px',
          overflow: 'hidden',
          backgroundColor: '#1e293b',
          color: '#f8fafc',
          boxShadow: '0 20px 25px -5px rgba(0, 0, 0, 0.5)',
        }}
      >
        {/* Header */}
        <div style={{ padding: '16px 20px', borderBottom: '1px solid rgba(255,255,255,0.1)', display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
          <h3 style={{ margin: 0, fontSize: '1.2rem', fontWeight: 600 }}>
            {step === 'link_prompt' ? 'Vincular ao Repertório' : 'Importar Cifra'}
          </h3>
          <button
            type="button"
            className="btn btn-icon"
            onClick={handleSafeClose}
            disabled={isSaving || isLinking}
            style={{ background: 'none', border: 'none', color: '#94a3b8', cursor: 'pointer', fontSize: '1.2rem' }}
          >
            ✕
          </button>
        </div>

        {/* Content Body */}
        <div style={{ padding: '20px', overflowY: 'auto', flex: 1, display: 'flex', flexDirection: 'column', gap: '16px' }}>
          {errorMessage && (
            <div style={{ padding: '12px', borderRadius: '8px', backgroundColor: 'rgba(239, 68, 68, 0.2)', border: '1px solid #ef4444', color: '#fca5a5', fontSize: '0.9rem' }}>
              {errorMessage}
            </div>
          )}

          {/* STEP 1: INPUT SOURCE (PDF or Plain-Text) */}
          {step === 'input' && (
            <>
              {/* Source Tabs */}
              <div style={{ display: 'flex', borderBottom: '1px solid rgba(255,255,255,0.1)', gap: '8px', overflowX: 'auto' }}>
                <button
                  type="button"
                  style={{
                    padding: '8px 16px',
                    border: 'none',
                    borderBottom: activeTab === 'pdf' ? '2px solid #3b82f6' : '2px solid transparent',
                    background: 'none',
                    color: activeTab === 'pdf' ? '#60a5fa' : '#94a3b8',
                    cursor: 'pointer',
                    fontWeight: 600,
                    whiteSpace: 'nowrap',
                  }}
                  onClick={() => handleTabSwitch('pdf')}
                >
                  Documento PDF
                </button>
                <button
                  type="button"
                  style={{
                    padding: '8px 16px',
                    border: 'none',
                    borderBottom: activeTab === 'text' ? '2px solid #3b82f6' : '2px solid transparent',
                    background: 'none',
                    color: activeTab === 'text' ? '#60a5fa' : '#94a3b8',
                    cursor: 'pointer',
                    fontWeight: 600,
                    whiteSpace: 'nowrap',
                  }}
                  onClick={() => handleTabSwitch('text')}
                >
                  Colar Texto
                </button>
                <button
                  type="button"
                  style={{
                    padding: '8px 16px',
                    border: 'none',
                    borderBottom: activeTab === 'url' ? '2px solid #3b82f6' : '2px solid transparent',
                    background: 'none',
                    color: activeTab === 'url' ? '#60a5fa' : '#94a3b8',
                    cursor: 'pointer',
                    fontWeight: 600,
                    whiteSpace: 'nowrap',
                  }}
                  onClick={() => handleTabSwitch('url')}
                >
                  Link / URL
                </button>
                <button
                  type="button"
                  style={{
                    padding: '8px 16px',
                    border: 'none',
                    borderBottom: activeTab === 'image' ? '2px solid #3b82f6' : '2px solid transparent',
                    background: 'none',
                    color: activeTab === 'image' ? '#60a5fa' : '#94a3b8',
                    cursor: 'pointer',
                    fontWeight: 600,
                    whiteSpace: 'nowrap',
                  }}
                  onClick={() => handleTabSwitch('image')}
                >
                  Imagem / transcrição
                </button>
              </div>

              {activeTab === 'pdf' && (
                <div style={{ display: 'flex', flexDirection: 'column', gap: '16px', alignItems: 'center', padding: '20px 0' }}>
                  <div
                    style={{
                      border: '2px dashed rgba(255,255,255,0.2)',
                      borderRadius: '8px',
                      padding: '32px 20px',
                      width: '100%',
                      textAlign: 'center',
                      cursor: 'pointer',
                      backgroundColor: 'rgba(255,255,255,0.02)',
                    }}
                    onClick={() => fileInputRef.current?.click()}
                  >
                    <input
                      ref={fileInputRef}
                      type="file"
                      accept=".pdf,application/pdf"
                      style={{ display: 'none' }}
                      onChange={handleFileChange}
                    />
                    <div style={{ fontSize: '2rem', marginBottom: '8px' }}>📄</div>
                    {selectedFile ? (
                      <div>
                        <div style={{ fontWeight: 600, color: '#f8fafc' }}>{selectedFile.name}</div>
                        <div style={{ fontSize: '0.8rem', color: '#94a3b8', marginTop: '4px' }}>
                          {(selectedFile.size / 1024).toFixed(1)} KB (Máximo: 3 MB)
                        </div>
                      </div>
                    ) : (
                      <div>
                        <div style={{ fontWeight: 500, color: '#e2e8f0' }}>Clique para selecionar um arquivo PDF</div>
                        <div style={{ fontSize: '0.8rem', color: '#94a3b8', marginTop: '4px' }}>
                          PDF com texto digital de até 3 MB (máx. 10 páginas)
                        </div>
                      </div>
                    )}
                  </div>

                  <button
                    type="button"
                    className="btn btn-primary"
                    disabled={!selectedFile}
                    onClick={handleExtractPdf}
                    style={{ minHeight: '44px', width: '100%' }}
                  >
                    Analisar e Pré-visualizar PDF
                  </button>
                </div>
              )}

              {activeTab === 'text' && (
                <div style={{ display: 'flex', flexDirection: 'column', gap: '12px' }}>
                  <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                    <label style={{ fontSize: '0.9rem', color: '#cbd5e1' }}>
                      Cole o conteúdo da cifra:
                    </label>
                    <button
                      type="button"
                      className="btn btn-secondary"
                      onClick={() => handlePasteClipboard('text')}
                      style={{ fontSize: '0.8rem', padding: '4px 10px' }}
                    >
                      📋 Colar da Área de Transferência
                    </button>
                  </div>
                  <textarea
                    rows={10}
                    className="form-control"
                    placeholder={"G            D/F#        Em\nGraças Te dou pelo Teu amor\n\nIntro:\n||: A9 | A7M/9 | D9 | % :||"}
                    value={pastedText}
                    maxLength={100000}
                    onChange={(e) => { generationRef.current += 1; setPastedText(e.target.value); }}
                    style={{ fontFamily: 'monospace', fontSize: '0.9rem', minHeight: '180px' }}
                  />
                  <button
                    type="button"
                    className="btn btn-primary"
                    disabled={!pastedText.trim()}
                    onClick={handleExtractText}
                    style={{ minHeight: '44px', width: '100%' }}
                  >
                    Analisar e Pré-visualizar Texto
                  </button>
                </div>
              )}

              {activeTab === 'url' && (
                <div style={{ display: 'flex', flexDirection: 'column', gap: '14px', padding: '12px 0' }}>
                  <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                    <label style={{ fontSize: '0.9rem', color: '#cbd5e1' }}>
                      Link do Cifra Club:
                    </label>
                    <button
                      type="button"
                      className="btn btn-secondary"
                      onClick={() => handlePasteClipboard('url')}
                      style={{ fontSize: '0.8rem', padding: '4px 10px' }}
                    >
                      📋 Colar Link
                    </button>
                  </div>
                  <input
                    type="url"
                    className="form-control"
                    placeholder="https://www.cifraclub.com.br/gabriela-rocha/lugar-secreto/"
                    value={inputUrl}
                    maxLength={1000}
                    onChange={(e) => { generationRef.current += 1; setInputUrl(e.target.value); }}
                    style={{ minHeight: '42px', fontSize: '0.9rem' }}
                  />
                  <div style={{ fontSize: '0.8rem', color: '#94a3b8' }}>
                    Preenchemos título e artista a partir do link do Cifra Club. Depois, cole o texto da cifra para normalizar e revisar.
                  </div>
                  <button
                    type="button"
                    className="btn btn-primary"
                    disabled={!inputUrl.trim()}
                    onClick={handleExtractUrl}
                    style={{ minHeight: '44px', width: '100%' }}
                  >
                    Analisar e Pré-visualizar URL
                  </button>
                </div>
              )}

              {activeTab === 'image' && (
                <div style={{ display: 'flex', flexDirection: 'column', gap: '16px', alignItems: 'center', padding: '20px 0' }}>
                  <input
                    ref={imageInputRef}
                    type="file"
                    accept=".png,.jpg,.jpeg,.webp,image/png,image/jpeg,image/webp"
                    style={{ display: 'none' }}
                    onChange={handleImageFileChange}
                  />
                  <div
                    style={{
                      border: '2px dashed rgba(255,255,255,0.2)',
                      borderRadius: '8px',
                      padding: '32px 20px',
                      width: '100%',
                      textAlign: 'center',
                      cursor: 'pointer',
                      backgroundColor: 'rgba(255,255,255,0.02)',
                    }}
                    onClick={() => imageInputRef.current?.click()}
                    role="button"
                    tabIndex={0}
                    aria-label="Selecionar imagem da cifra"
                    onKeyDown={(event) => {
                      if (event.key === 'Enter' || event.key === ' ') {
                        event.preventDefault();
                        imageInputRef.current?.click();
                      }
                    }}
                  >
                    <div style={{ fontSize: '2rem', marginBottom: '8px' }}>🖼️</div>
                    {selectedImageFile ? (
                      <div>
                        <div style={{ fontWeight: 600, color: '#f8fafc' }}>{selectedImageFile.name}</div>
                        <div style={{ fontSize: '0.8rem', color: '#94a3b8', marginTop: '4px' }}>
                          {(selectedImageFile.size / 1024).toFixed(1)} KB (Máximo: 5 MB)
                        </div>
                      </div>
                    ) : (
                      <div>
                        <div style={{ fontWeight: 500, color: '#e2e8f0' }}>Clique para selecionar uma imagem da cifra</div>
                        <div style={{ fontSize: '0.8rem', color: '#94a3b8', marginTop: '4px' }}>
                          Formatos PNG, JPEG ou WEBP de até 5 MB
                        </div>
                      </div>
                    )}
                  </div>

                  <p style={{ color: '#94a3b8', fontSize: '0.85rem' }}>
                    A leitura automática de imagens ainda não está disponível. Transcreva ou cole o texto para revisar antes de salvar.
                  </p>
                  <button
                    type="button"
                    className="btn btn-primary"
                    disabled={!selectedImageFile}
                    onClick={handleExtractImage}
                    style={{ minHeight: '44px', width: '100%' }}
                  >
                    Continuar com transcrição manual
                  </button>
                </div>
              )}
            </>
          )}

          {/* STEP 2: EXTRACTING SPINNER */}
          {step === 'extracting' && (
            <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', padding: '40px 0', gap: '16px' }}>
              <div className="spinner" style={{ width: '40px', height: '40px', border: '3px solid rgba(255,255,255,0.1)', borderTopColor: '#3b82f6', borderRadius: '50%', animation: 'spin 1s linear infinite' }} />
              <div style={{ color: '#cbd5e1', fontSize: '0.95rem' }}>Analisando estrutura harmônica e alinhamento...</div>
              <button
                type="button"
                className="btn btn-secondary"
                onClick={() => {
                  generationRef.current += 1;
                  setStep('input');
                }}
                style={{
                  minHeight: '44px',
                  padding: '8px 16px',
                  borderRadius: '6px',
                  backgroundColor: 'rgba(255, 255, 255, 0.1)',
                  color: '#e2e8f0',
                  border: '1px solid rgba(255, 255, 255, 0.2)',
                  cursor: 'pointer',
                }}
              >
                Cancelar Extração
              </button>
            </div>
          )}

          {/* STEP 3: PREVIEW & EDIT DRAFT */}
          {step === 'preview' && (
            <div style={{ display: 'flex', flexDirection: 'column', gap: '16px' }}>
              {requiresManualPaste && (
                <div style={{ padding: '12px', borderRadius: '8px', backgroundColor: 'rgba(59, 130, 246, 0.15)', border: '1px solid #3b82f6', color: '#93c5fd', fontSize: '0.85rem' }}>
                  <strong>Extração assistida:</strong> {sourceUrl ? 'Revise os metadados sugeridos pelo link (' + sourceUrl + '). ' : 'A leitura automática de imagens ainda não está disponível. '}Cole ou transcreva o texto da cifra no editor e normalize antes de salvar.
                </div>
              )}
              {warnings.length > 0 && (
                <div style={{ padding: '12px', borderRadius: '8px', backgroundColor: 'rgba(234, 179, 8, 0.15)', border: '1px solid #eab308', color: '#fef08a', fontSize: '0.85rem' }}>
                  <div style={{ fontWeight: 600, marginBottom: '4px' }}>Avisos da Importação:</div>
                  <ul style={{ margin: 0, paddingLeft: '18px' }}>
                    {warnings.map((w, idx) => (
                      <li key={idx}>{w.message}</li>
                    ))}
                  </ul>
                </div>
              )}

              {/* Editable Metadata Fields */}
              <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(200px, 1fr))', gap: '12px' }}>
                <div>
                  <label style={{ fontSize: '0.8rem', color: '#94a3b8' }}>Título da Cifra *</label>
                  <input
                    type="text"
                    className="form-control"
                    value={title}
                    disabled={isSaving || isLinking}
                    onChange={(e) => setTitle(e.target.value)}
                    style={{ minHeight: '40px' }}
                  />
                </div>
                <div>
                  <label style={{ fontSize: '0.8rem', color: '#94a3b8' }}>Artista / Banda</label>
                  <input
                    type="text"
                    className="form-control"
                    value={artistName}
                    disabled={isSaving || isLinking}
                    placeholder="Opcional"
                    onChange={(e) => setArtistName(e.target.value)}
                    style={{ minHeight: '40px' }}
                  />
                </div>
                <div>
                  <label style={{ fontSize: '0.8rem', color: '#94a3b8' }}>Tom Original</label>
                  <select
                    className="form-control"
                    value={originalKey}
                    aria-label="Tom Original"
                    disabled={isSaving || isLinking}
                    onChange={(e) => setOriginalKey(e.target.value)}
                    style={{ minHeight: '40px' }}
                  >
                    <option value="">Tom não identificado</option>
                    {STANDARD_KEYS.map((k) => (
                      <option key={k} value={k}>{k}</option>
                    ))}
                  </select>
                </div>
              </div>

              {/* View/Edit Mode Tabs */}
              {!originalKey && <p>Tom não identificado. Selecione o tom original após conferir a fonte.</p>}
              {(displayedKey || capo != null) && <p>
                {displayedKey && `Tom exibido na fonte: ${displayedKey}. `}
                {capo != null && `Capotraste: casa ${capo}.`}
              </p>}
              <div style={{ display: 'flex', borderBottom: '1px solid rgba(255,255,255,0.1)', gap: '8px' }}>
                <button
                  type="button"
                  style={{
                    padding: '6px 14px',
                    border: 'none',
                    borderBottom: previewTab === 'edit' ? '2px solid #3b82f6' : '2px solid transparent',
                    background: 'none',
                    color: previewTab === 'edit' ? '#60a5fa' : '#94a3b8',
                    cursor: 'pointer',
                    fontSize: '0.9rem',
                    fontWeight: 600,
                  }}
                  onClick={() => setPreviewTab('edit')}
                >
                  Editar Texto (Formato Colchetes)
                </button>
                <button
                  type="button"
                  style={{
                    padding: '6px 14px',
                    border: 'none',
                    borderBottom: previewTab === 'rendered' ? '2px solid #3b82f6' : '2px solid transparent',
                    background: 'none',
                    color: previewTab === 'rendered' ? '#60a5fa' : '#94a3b8',
                    cursor: 'pointer',
                    fontSize: '0.9rem',
                    fontWeight: 600,
                  }}
                  onClick={() => setPreviewTab('rendered')}
                >
                  Visualização Alinhada
                </button>
              </div>

              {/* Editor Tab */}
              {requiresManualPaste && (
                <div style={{ display: 'flex', gap: '8px', flexWrap: 'wrap' }}>
                  <button type="button" className="btn btn-secondary" disabled={isNormalizing} onClick={() => handlePasteClipboard('content')}>
                    Colar conteúdo da cifra
                  </button>
                  <button type="button" className="btn btn-primary" disabled={!content.trim() || isNormalizing} onClick={handleNormalizeManualContent}>
                    {isNormalizing ? 'Normalizando...' : 'Normalizar texto colado'}
                  </button>
                </div>
              )}
              {previewTab === 'edit' && (
                <textarea
                  aria-label="Conteúdo da cifra"
                  rows={12}
                  className="form-control"
                  value={content}
                  maxLength={100000}
                  disabled={isNormalizing || isSaving || isLinking}
                  onChange={(e) => {
                    if (isNormalizing || isSaving || isLinking) return;
                    generationRef.current += 1;
                    setContent(e.target.value);
                  }}
                  style={{ fontFamily: 'monospace', fontSize: '0.9rem', minHeight: '220px', lineHeight: 1.4 }}
                />
              )}

              {/* Rendered Preview Tab */}
              {previewTab === 'rendered' && (
                <div
                  style={{
                    padding: '16px',
                    borderRadius: '8px',
                    backgroundColor: '#0f172a',
                    fontFamily: 'monospace',
                    fontSize: '0.9rem',
                    maxHeight: '300px',
                    overflowY: 'auto',
                    whiteSpace: 'pre-wrap',
                    lineHeight: 1.4,
                  }}
                >
                  {content.split('\n').map((lineText, idx) => {
                    if (hasBarProgression(lineText)) {
                      const tokens = parseBarProgressionLine(lineText);
                      return (
                        <div key={idx} data-musical-progression style={{ marginBottom: '8px', color: '#e2e8f0', whiteSpace: 'pre', overflowX: 'auto' }}>
                          {tokens.map((token, tIdx) => {
                            if (token.type === 'bracket_open' || token.type === 'bracket_close') return null;
                            if (token.type === 'chord') {
                              return <span key={tIdx} style={{ color: '#38bdf8', fontWeight: 'bold' }}>{token.value}</span>;
                            }
                            if (token.type === 'delimiter') {
                              return <span key={tIdx} style={{ color: token.value === '%' ? '#38bdf8' : '#94a3b8', fontWeight: 'bold' }}>{token.value}</span>;
                            }
                            if (token.type === 'whitespace') {
                              return <span key={tIdx} style={{ whiteSpace: 'pre' }}>{token.value}</span>;
                            }
                            return <span key={tIdx}>{token.value}</span>;
                          })}
                        </div>
                      );
                    }
                    const parsedLines = parseSmartChord(lineText);
                    const line = parsedLines[0] || { segments: [] };
                    const hasChords = line.segments.some((s) => s.chord);
                    if (!hasChords) {
                      return <div key={idx} style={{ color: '#94a3b8', minHeight: '1.2em' }}>{line.segments.map(s => s.text).join('')}</div>;
                    }
                    return (
                      <div key={idx} style={{ marginBottom: '8px' }}>
                        <div style={{ color: '#38bdf8', fontWeight: 'bold' }}>
                          {line.segments.map((seg, sIdx) => (
                            <span key={sIdx} style={{ display: 'inline-block', marginRight: seg.text.length > 0 ? `${seg.text.length}ch` : '1ch' }}>
                              {seg.chord}
                            </span>
                          ))}
                        </div>
                        <div style={{ color: '#e2e8f0' }}>
                          {line.segments.map(s => s.text).join('')}
                        </div>
                      </div>
                    );
                  })}
                </div>
              )}
            </div>
          )}

          {/* STEP 4: OPTIONAL REPERTOIRE LINK */}
          {step === 'link_prompt' && (
            <div style={{ display: 'flex', flexDirection: 'column', gap: '16px' }}>
              <div style={{ padding: '12px', borderRadius: '8px', backgroundColor: 'rgba(34, 197, 94, 0.15)', border: '1px solid #22c55e', color: '#86efac', fontSize: '0.9rem' }}>
                ✓ Cifra salva com sucesso na sua biblioteca pessoal!
              </div>

              {linkError && (
                <div style={{ padding: '12px', borderRadius: '8px', backgroundColor: 'rgba(239, 68, 68, 0.2)', border: '1px solid #ef4444', color: '#fca5a5', fontSize: '0.9rem' }}>
                  {linkError}
                </div>
              )}

              <p style={{ color: '#cbd5e1', fontSize: '0.95rem', margin: 0 }}>
                Deseja vincular esta cifra a uma música do repertório do ministério atual?
              </p>

              <div>
                <label style={{ fontSize: '0.85rem', color: '#94a3b8' }}>Música do Repertório:</label>
                <select
                  className="form-control"
                  value={selectedSongId}
                  onChange={(e) => setSelectedSongId(e.target.value)}
                  style={{ minHeight: '44px', marginTop: '4px' }}
                >
                  {repertoireSongs.map((song) => (
                    <option key={song.id} value={song.id}>
                      {song.title} {song.artist ? `(${song.artist})` : ''}
                    </option>
                  ))}
                </select>
              </div>

              <div style={{ fontSize: '0.8rem', color: '#94a3b8' }}>
                O vínculo é pessoal e privado. Os demais membros do ministério não terão acesso à sua cifra.
              </div>
            </div>
          )}
        </div>

        {/* Footer Actions */}
        <div style={{ padding: '16px 20px', borderTop: '1px solid rgba(255,255,255,0.1)', display: 'flex', justifyContent: 'flex-end', gap: '12px' }}>
          {step === 'input' && (
            <button type="button" className="btn btn-secondary" onClick={handleSafeClose} style={{ minHeight: '40px' }}>
              Cancelar
            </button>
          )}

          {step === 'preview' && (
            <>
              <button
                type="button"
                className="btn btn-secondary"
                onClick={() => {
                  generationRef.current += 1;
                  setStep('input');
                }}
                disabled={isSaving || isNormalizing}
                style={{ minHeight: '40px' }}
              >
                Voltar
              </button>
              <button
                type="button"
                className="btn btn-primary"
                onClick={handleSaveChord}
                disabled={isSaving || isNormalizing || requiresManualPaste || !originalKey.trim()}
                style={{ minHeight: '40px' }}
              >
                {isSaving ? 'Salvando...' : 'Salvar Cifra Pessoal'}
              </button>
            </>
          )}

          {step === 'link_prompt' && (
            <>
              <button
                type="button"
                className="btn btn-secondary"
                onClick={handleSkipLink}
                disabled={isLinking}
                style={{ minHeight: '40px' }}
              >
                Concluir sem Vincular
              </button>
              <button
                type="button"
                className="btn btn-primary"
                onClick={handleConfirmLink}
                disabled={isLinking || !selectedSongId}
                style={{ minHeight: '40px' }}
              >
                {isLinking ? 'Vinculando...' : 'Vincular ao Repertório'}
              </button>
            </>
          )}
        </div>
      </div>
    </div>
  );
};
