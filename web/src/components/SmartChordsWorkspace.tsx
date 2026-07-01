import React, { useState, useEffect } from 'react';
import { api, SmartChord } from '../api';
import { Artist, Song } from '../types';
import { transposeChord, rawToVisual, visualToRaw } from '../utils/smart_chord';

function getHarmonicFieldChords(originalKey: string): string[] {
  let key = originalKey;
  const isMinor = key.endsWith('m');
  if (isMinor) {
    key = key.substring(0, key.length - 1);
  }

  const majorFields: Record<string, string[]> = {
    'C': ['C', 'Dm', 'Em', 'F', 'G', 'Am', 'Bdim'],
    'C#': ['C#', 'D#m', 'E#m', 'F#', 'G#', 'A#m', 'B#dim'],
    'Db': ['Db', 'Ebm', 'Fm', 'Gb', 'Ab', 'Bbm', 'Cdim'],
    'D': ['D', 'Em', 'F#m', 'G', 'A', 'Bm', 'C#dim'],
    'Eb': ['Eb', 'Fm', 'Gm', 'Ab', 'Bb', 'Cm', 'Ddim'],
    'E': ['E', 'F#m', 'G#m', 'A', 'B', 'C#m', 'D#dim'],
    'F': ['F', 'Gm', 'Am', 'Bb', 'C', 'Dm', 'Edim'],
    'F#': ['F#', 'G#m', 'A#m', 'B', 'C#', 'D#m', 'E#dim'],
    'Gb': ['Gb', 'Abm', 'Bbm', 'Cb', 'Db', 'Ebm', 'Fdim'],
    'G': ['G', 'Am', 'Bm', 'C', 'D', 'Em', 'F#dim'],
    'Ab': ['Ab', 'Bbm', 'Cm', 'Db', 'Eb', 'Fm', 'Gdim'],
    'A': ['A', 'Bm', 'C#m', 'D', 'E', 'F#m', 'G#dim'],
    'Bb': ['Bb', 'Cm', 'Dm', 'Eb', 'F', 'Gm', 'Adim'],
    'B': ['B', 'C#m', 'D#m', 'E', 'F#', 'G#m', 'A#dim'],
  };

  const field = majorFields[key] || ['C', 'Dm', 'Em', 'F', 'G', 'Am', 'Bdim'];

  if (isMinor) {
    return [
      field[5], // VIm
      field[6], // VIIdim
      field[0], // I
      field[1], // IIm
      field[2], // IIIm
      field[3], // IV
      field[4], // V
    ];
  }
  return field;
}

const getSuggestions = (query: string, originalKey: string): string[] => {
  const trimmed = query.trim();
  if (!trimmed) {
    return getHarmonicFieldChords(originalKey);
  }
  
  const match = /^([A-G][#b]?)(.*)$/i.exec(trimmed);
  if (!match) return [];
  
  const root = match[1].toUpperCase();
  const extensions = ['', 'm', '7', 'm7', 'maj7', '9', 'sus4', 'dim', 'm7(b5)'];
  
  return extensions
    .map(ext => root + ext)
    .filter(s => s.toLowerCase().startsWith(trimmed.toLowerCase()) && s !== trimmed);
};

export const SmartChordsWorkspace: React.FC = () => {
  const [smartChords, setSmartChords] = useState<SmartChord[]>([]);
  const [selectedChord, setSelectedChord] = useState<SmartChord | null>(null);
  const [search, setSearch] = useState('');
  const [isLoading, setIsLoading] = useState(false);

  // Repertoire Relations
  const [artists, setArtists] = useState<Artist[]>([]);
  const [repertoireSongs, setRepertoireSongs] = useState<Song[]>([]);

  // Form State
  const [title, setTitle] = useState('');
  const [artistId, setArtistId] = useState('');
  const [songId, setSongId] = useState('');
  const [originalKey, setOriginalKey] = useState('C');
  const [content, setContent] = useState('');
  const [semitones, setSemitones] = useState(0);
  const [printFontSize, setPrintFontSize] = useState(13);
  const [isPrintModalOpen, setIsPrintModalOpen] = useState(false);

  // New Song Link options
  const [newSongTitle, setNewSongTitle] = useState('');
  const [autoCreateSong, setAutoCreateSong] = useState(true);
  const [userModifiedNewSongTitle, setUserModifiedNewSongTitle] = useState(false);

  // Gemini Importer states
  const [isImporting, setIsImporting] = useState(false);
  const [importUrl, setImportUrl] = useState('');
  const [importFileName, setImportFileName] = useState('');
  const [importError, setImportError] = useState('');

  // Load relation data
  const loadRelations = async () => {
    try {
      const artistData = await api.getArtists();
      setArtists(artistData);
      
      const songResult = await api.getSongs();
      setRepertoireSongs(songResult.songs || []);
    } catch (err) {
      console.error('Erro ao carregar artistas/músicas:', err);
    }
  };

  // Load chords list
  const loadChordsList = async (searchQuery?: string) => {
    try {
      setIsLoading(true);
      const data = await api.getSmartChords(searchQuery);
      setSmartChords(data);
    } catch (err) {
      alert('Erro ao carregar lista de cifras.');
    } finally {
      setIsLoading(false);
    }
  };

  useEffect(() => {
    loadChordsList();
    loadRelations();
  }, []);

  const handleSearchChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    setSearch(e.target.value);
    loadChordsList(e.target.value);
  };

  const handleSelectChord = (chord: SmartChord) => {
    setSelectedChord(chord);
    setTitle(chord.title);
    setArtistId(chord.artistId || '');
    setSongId(chord.songId || '');
    setNewSongTitle(chord.title);
    setAutoCreateSong(true);
    setUserModifiedNewSongTitle(false);
    setOriginalKey(chord.originalKey);
    setContent(chord.content);
    setSemitones(0);
  };

  const handleCreateNew = () => {
    setSelectedChord({
      id: '',
      userId: '',
      title: 'Nova Cifra',
      artistId: '',
      songId: '',
      originalKey: 'C',
      content: '[C]Insira a letra e [G]acordes aqui.',
      createdAt: '',
      updatedAt: '',
    });
    setTitle('Nova Cifra');
    setArtistId('');
    setSongId('');
    setNewSongTitle('Nova Cifra');
    setAutoCreateSong(true);
    setUserModifiedNewSongTitle(false);
    setOriginalKey('C');
    setContent('[C]Insira a letra e [G]acordes aqui.');
    setSemitones(0);
  };

  const handleTitleChange = (val: string) => {
    setTitle(val);
    if (!userModifiedNewSongTitle) {
      setNewSongTitle(val);
    }
  };

  const handlePdfImport = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;

    setImportFileName(file.name);
    setImportError('');
    setIsImporting(true);

    try {
      const reader = new FileReader();
      reader.onload = async () => {
        try {
          const result = reader.result as string;
          const base64 = result.split(',')[1];
          
          const imported = await api.importSmartChord({
            type: 'pdf',
            fileBase64: base64
          });

          setTitle(imported.title);
          setContent(imported.content);
          
          if (imported.key) {
            setOriginalKey(imported.key);
          }

          if (imported.artist) {
            const foundArtist = artists.find(a => 
              a.name.toLowerCase().includes(imported.artist.toLowerCase()) ||
              imported.artist.toLowerCase().includes(a.name.toLowerCase())
            );
            if (foundArtist) {
              setArtistId(foundArtist.id);
            }
          }
        } catch (err: any) {
          setImportError(err.message || 'Erro ao importar cifra do PDF.');
        } finally {
          setIsImporting(false);
        }
      };
      reader.onerror = () => {
        setImportError('Erro ao ler arquivo local.');
        setIsImporting(false);
      };
      reader.readAsDataURL(file);
    } catch (err: any) {
      setImportError(err.message || 'Erro ao carregar PDF.');
      setIsImporting(false);
    }
  };

  const handleUrlImport = async () => {
    if (!importUrl.trim()) return;

    setImportError('');
    setIsImporting(true);

    try {
      const imported = await api.importSmartChord({
        type: 'url',
        url: importUrl.trim()
      });

      setTitle(imported.title);
      setContent(imported.content);
      
      if (imported.key) {
        setOriginalKey(imported.key);
      }

      if (imported.artist) {
        const foundArtist = artists.find(a => 
          a.name.toLowerCase().includes(imported.artist.toLowerCase()) ||
          imported.artist.toLowerCase().includes(a.name.toLowerCase())
        );
        if (foundArtist) {
          setArtistId(foundArtist.id);
        }
      }
      
      setImportUrl('');
    } catch (err: any) {
      setImportError(err.message || 'Erro ao importar link.');
    } finally {
      setIsImporting(false);
    }
  };

  const handleSave = async () => {
    if (!title.trim()) {
      alert('O título é obrigatório.');
      return;
    }
    if (!originalKey) {
      alert('O tom original é obrigatório.');
      return;
    }
    if (!content.trim()) {
      alert('O conteúdo da cifra é obrigatório.');
      return;
    }

    try {
      setIsLoading(true);

      let finalSongId = songId;

      // Auto-create song in Repertoire if "new" is selected and checked
      if (songId === 'new' && autoCreateSong) {
        if (!newSongTitle.trim()) {
          alert('Por favor, informe o título da nova música.');
          setIsLoading(false);
          return;
        }
        const createdSong = await api.createSong({
          title: newSongTitle.trim(),
          artistId: artistId || undefined,
          originalKey: originalKey,
        });
        finalSongId = createdSong.id;
      }

      const payload: Partial<SmartChord> = {
        title: title.trim(),
        artistId: artistId || undefined,
        songId: finalSongId && finalSongId !== 'new' ? finalSongId : undefined,
        originalKey,
        content: content.trim(),
      };

      if (selectedChord && selectedChord.id) {
        // Update
        const updated = await api.updateSmartChord(selectedChord.id, payload);
        setSelectedChord(updated);
        alert('Cifra salva com sucesso!');
      } else {
        // Create
        const created = await api.createSmartChord(payload);
        setSelectedChord(created);
        alert('Cifra criada com sucesso!');
      }

      // Reload list and songs dropdown list to include any newly created song
      loadChordsList(search);
      const songResult = await api.getSongs();
      setRepertoireSongs(songResult.songs || []);
      
      // Update form state with the newly created or selected song ID
      if (songId === 'new' && autoCreateSong) {
        setSongId(finalSongId);
      }
    } catch (err: any) {
      alert(err.message || 'Erro ao salvar cifra.');
    } finally {
      setIsLoading(false);
    }
  };

  const handleDelete = async () => {
    if (!selectedChord || !selectedChord.id) return;
    if (!window.confirm('Tem certeza de que deseja excluir esta cifra?')) return;

    try {
      setIsLoading(true);
      await api.deleteSmartChord(selectedChord.id);
      setSelectedChord(null);
      alert('Cifra excluída com sucesso.');
      loadChordsList(search);
    } catch (err: any) {
      alert(err.message || 'Erro ao excluir cifra.');
    } finally {
      setIsLoading(false);
    }
  };

  const handlePrint = () => {
    setIsPrintModalOpen(true);
  };

  const generatePDF = () => {
    const element = document.getElementById('printable-sheet-pdf');
    if (!element) return;

    const artistName = selectedArtistName && selectedArtistName !== 'Desconhecido' ? selectedArtistName : 'Artista Desconhecido';
    const keyText = currentKeyTransposed || originalKey || 'C';
    const songTitle = title || 'Cifra';
    const filename = `${songTitle} - ${artistName} - ${keyText}.pdf`;

    const opt = {
      margin: 10,
      filename: filename,
      image: { type: 'jpeg', quality: 0.98 },
      html2canvas: { scale: 2, useCORS: true },
      jsPDF: { unit: 'mm', format: 'a4', orientation: 'portrait' }
    };

    (window as any).html2pdf().set(opt).from(element).save();
  };

  // State for inline chord editor
  const [editingCell, setEditingCell] = useState<{ lineIdx: number; charIdx: number } | null>(null);
  const [editingChordValue, setEditingChordValue] = useState('');

  const saveInlineChord = (lineIdx: number, charIdx: number, value: string) => {
    const lines = content.split('\n');
    const lineText = lines[lineIdx] || '';
    const visual = rawToVisual(lineText);

    const trimmed = value.trim();
    if (trimmed) {
      visual.chords[charIdx] = trimmed;
    } else {
      delete visual.chords[charIdx];
    }

    lines[lineIdx] = visualToRaw(visual);
    setContent(lines.join('\n'));
    setEditingCell(null);
  };

  const renderInlineEditor = (lineIdx: number, charIdx: number) => {
    const suggestions = getSuggestions(editingChordValue, originalKey);

    return (
      <div 
        style={{
          position: 'absolute',
          bottom: '100%',
          left: '50%',
          transform: 'translateX(-50%)',
          display: 'flex',
          flexDirection: 'column',
          alignItems: 'center',
          zIndex: 100
        }}
      >
        {/* Suggestion list */}
        {suggestions.length > 0 && (
          <div 
            style={{
              display: 'flex',
              gap: '4px',
              backgroundColor: 'var(--surface-elevated)',
              border: '1px solid var(--border-color)',
              borderRadius: '6px',
              padding: '4px',
              marginBottom: '6px',
              boxShadow: '0 4px 12px rgba(0,0,0,0.5)',
              maxWidth: '260px',
              overflowX: 'auto',
              whiteSpace: 'nowrap'
            }}
          >
            {suggestions.map((chordSug) => (
              <button
                key={chordSug}
                type="button"
                onMouseDown={(e) => {
                  e.preventDefault();
                  saveInlineChord(lineIdx, charIdx, chordSug);
                }}
                style={{
                  padding: '2px 6px',
                  fontSize: '11px',
                  backgroundColor: 'var(--surface-color)',
                  border: '1px solid var(--border-color)',
                  borderRadius: '4px',
                  color: 'var(--primary-light)',
                  cursor: 'pointer',
                  fontWeight: 'bold'
                }}
              >
                {chordSug}
              </button>
            ))}
          </div>
        )}

        <input
          type="text"
          name={`chord-input-${Math.random()}`}
          value={editingChordValue}
          autoFocus
          autoComplete="off"
          data-autocomplete="off"
          spellCheck={false}
          onChange={(e) => setEditingChordValue(e.target.value)}
          onBlur={() => saveInlineChord(lineIdx, charIdx, editingChordValue)}
          onKeyDown={(e) => {
            if (e.key === 'Enter') {
              saveInlineChord(lineIdx, charIdx, editingChordValue);
            } else if (e.key === 'Escape') {
              setEditingCell(null);
            }
          }}
          onClick={(e) => e.stopPropagation()} // Prevent bubble
          style={{
            width: '50px',
            height: '20px',
            fontSize: '11px',
            textAlign: 'center',
            backgroundColor: 'var(--surface-variant)',
            border: '1px solid var(--primary-light)',
            borderRadius: '4px',
            color: 'var(--text-primary)',
            outline: 'none',
            fontFamily: 'monospace'
          }}
        />
      </div>
    );
  };

  // Parsing & pitch shifting preview
  const rawLines = content ? content.split('\n') : [];
  const currentKeyTransposed = transposeChord(originalKey, semitones);
  const selectedArtistName = artists.find(a => a.id === artistId)?.name || 'Desconhecido';

  const keysList = [
    'C', 'Cm', 'C#', 'C#m', 'D', 'Dm', 'Eb', 'Ebm', 'E', 'Em', 'F', 'Fm',
    'F#', 'F#m', 'G', 'Gm', 'G#', 'G#m', 'A', 'Am', 'Bb', 'Bbm', 'B', 'Bm'
  ];

  return (
    <div className="features-container" style={{ display: 'flex', gap: '20px', height: 'calc(100vh - 120px)', color: 'var(--text-primary)' }}>
      {/* ─── Stylesheet for Print Mode (Guarantees no blank pages) ─── */}
      <style>{`
        @media print {
          body {
            background: white !important;
            color: black !important;
          }
          #root {
            background: white !important;
            color: black !important;
          }
          /* Hide all outer components with no-print class */
          .no-print {
            display: none !important;
          }
          /* Ensure wrapper matches printable document layout */
          .features-container {
            display: block !important;
            height: auto !important;
            padding: 0 !important;
            margin: 0 !important;
            background: white !important;
            color: black !important;
          }
          /* Ensure printable container uses full page and fits print layout */
          .printable-area-container {
            display: block !important;
            width: 100% !important;
            height: auto !important;
            padding: 0 !important;
            margin: 0 !important;
            background: white !important;
            color: black !important;
            border: none !important;
            box-shadow: none !important;
          }
          .print-sheet-box {
            background: white !important;
            color: black !important;
            border: none !important;
            padding: 0 !important;
            margin: 0 !important;
            overflow: visible !important;
            width: 100% !important;
          }
          .print-sheet-box * {
            color: black !important;
          }
          .print-chord-span {
            color: black !important;
            font-weight: bold !important;
          }
          .has-chord {
            text-decoration: underline 2px solid black !important;
            text-decoration-color: black !important;
          }
        }
      `}</style>

      {/* ─── Web Sidebar: Saved SmartChords List ─── */}
      <div className="glass-panel no-print" style={{ width: '320px', padding: '16px', display: 'flex', flexDirection: 'column', gap: '16px', flexShrink: 0 }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
          <h2 style={{ fontSize: '1.25rem', fontWeight: 600 }}>Minhas Cifras</h2>
          <button className="btn btn-primary" style={{ padding: '8px 12px', fontSize: '0.85rem' }} onClick={handleCreateNew}>
            + Nova
          </button>
        </div>

        <input
          type="text"
          className="form-control"
          placeholder="Buscar cifra..."
          value={search}
          onChange={handleSearchChange}
        />

        <div style={{ flex: 1, overflowY: 'auto', display: 'flex', flexDirection: 'column', gap: '8px' }}>
          {isLoading && smartChords.length === 0 ? (
            <p style={{ textAlign: 'center', opacity: 0.5 }}>Carregando...</p>
          ) : smartChords.length === 0 ? (
            <p style={{ textAlign: 'center', opacity: 0.5 }}>Nenhuma cifra encontrada.</p>
          ) : (
            smartChords.map(sc => {
              const artistName = artists.find(a => a.id === sc.artistId)?.name || 'Artista desconhecido';
              return (
                <div
                  key={sc.id}
                  onClick={() => handleSelectChord(sc)}
                  style={{
                    padding: '12px',
                    borderRadius: '10px',
                    cursor: 'pointer',
                    backgroundColor: selectedChord?.id === sc.id ? 'var(--primary-surface)' : 'rgba(255, 255, 255, 0.03)',
                    border: `1px solid ${selectedChord?.id === sc.id ? 'var(--primary)' : 'transparent'}`,
                    transition: 'all 0.2s',
                  }}
                  className="hover-scale"
                >
                  <div style={{ fontWeight: 600, fontSize: '0.95rem' }}>{sc.title}</div>
                  <div style={{ fontSize: '0.75rem', opacity: 0.7, marginTop: '2px', display: 'flex', justifyContent: 'space-between' }}>
                    <span>{artistName}</span>
                    <span style={{ color: 'var(--primary-light)' }}>{sc.originalKey}</span>
                  </div>
                </div>
              );
            })
          )}
        </div>
      </div>

      {/* ─── Web Workspace Panel ─── */}
      <div style={{ flex: 1, display: 'flex', flexDirection: 'column', minWidth: 0 }}>
        {!selectedChord ? (
          <div className="glass-panel no-print" style={{ flex: 1, display: 'flex', justifyContent: 'center', alignItems: 'center', opacity: 0.6 }}>
            <div style={{ textAlign: 'center' }}>
              <span style={{ fontSize: '3rem' }}>🎵</span>
              <h3 style={{ marginTop: '16px', fontWeight: 600 }}>Cifrador Autônomo SmartChord</h3>
              <p style={{ fontSize: '0.9rem', maxWidth: '350px', margin: '8px auto 0' }}>
                Selecione uma cifra na barra lateral ou crie uma nova para começar a editar e transpor.
              </p>
            </div>
          </div>
        ) : (
          <div style={{ display: 'flex', gap: '20px', flex: 1, minHeight: 0 }}>
            {/* Editor form (left workspace column) */}
            <div className="glass-panel no-print" style={{ flex: 1, padding: '20px', display: 'flex', flexDirection: 'column', gap: '16px', overflowY: 'auto' }}>
              <h3 style={{ fontSize: '1.1rem', fontWeight: 600 }}>Editar Informações</h3>
              
              <div className="form-group">
                <label className="form-label">Título *</label>
                <input
                  type="text"
                  className="form-control"
                  value={title}
                  onChange={e => handleTitleChange(e.target.value)}
                  placeholder="Ex: Hosana"
                />
              </div>

              <div style={{ display: 'flex', gap: '12px', flexWrap: 'wrap' }}>
                <div className="form-group" style={{ flex: 1, minWidth: '150px' }}>
                  <label className="form-label">Artista (Lista)</label>
                  <select
                    className="form-control"
                    value={artistId}
                    onChange={e => setArtistId(e.target.value)}
                  >
                    <option value="">Nenhum artista cadastrado</option>
                    {artists.map(a => (
                      <option key={a.id} value={a.id}>{a.name}</option>
                    ))}
                  </select>
                </div>

                <div className="form-group" style={{ width: '120px' }}>
                  <label className="form-label">Tom Original *</label>
                  <select
                    className="form-control"
                    value={originalKey}
                    onChange={e => setOriginalKey(e.target.value)}
                  >
                    {keysList.map(key => (
                      <option key={key} value={key}>{key}</option>
                    ))}
                  </select>
                </div>
              </div>

              {/* Importador Inteligente */}
              <div style={{ borderTop: '1px solid var(--border)', paddingTop: '12px', marginTop: '4px' }}>
                <label className="form-label" style={{ fontWeight: 600, color: 'var(--primary-light)' }}>
                  📥 Importar Cifra Automática (Gemini AI)
                </label>
                <div style={{ display: 'flex', flexDirection: 'column', gap: '8px', marginTop: '6px' }}>
                  {/* Option 1: PDF File */}
                  <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                    <button 
                      className="btn btn-secondary" 
                      onClick={() => document.getElementById('pdf-import-input')?.click()}
                      style={{ fontSize: '0.8rem', padding: '6px 12px', display: 'flex', alignItems: 'center', gap: '6px' }}
                      disabled={isImporting}
                    >
                      📄 Selecionar PDF
                    </button>
                    <input 
                      type="file" 
                      id="pdf-import-input" 
                      accept=".pdf" 
                      onChange={handlePdfImport}
                      style={{ display: 'none' }}
                    />
                    <span style={{ fontSize: '0.75rem', opacity: 0.6, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', maxWidth: '200px' }}>
                      {importFileName || 'Nenhum arquivo selecionado'}
                    </span>
                  </div>

                  {/* Option 2: Link URL */}
                  <div style={{ display: 'flex', gap: '8px' }}>
                    <input 
                      type="text" 
                      className="form-control" 
                      placeholder="Cole o link do Cifra Club ou outro site..." 
                      style={{ fontSize: '0.8rem', padding: '6px 10px', flex: 1 }}
                      value={importUrl}
                      onChange={e => setImportUrl(e.target.value)}
                      disabled={isImporting}
                    />
                    <button 
                      className="btn btn-primary" 
                      onClick={handleUrlImport}
                      style={{ fontSize: '0.8rem', padding: '6px 12px' }}
                      disabled={isImporting || !importUrl.trim()}
                    >
                      Importar
                    </button>
                  </div>

                  {isImporting && (
                    <div style={{ fontSize: '0.75rem', color: 'var(--secondary-light)', display: 'flex', alignItems: 'center', gap: '6px', marginTop: '4px' }}>
                      <span className="spinner-border spinner-border-sm" role="status" aria-hidden="true" style={{ width: '12px', height: '12px', borderWidth: '1.5px', display: 'inline-block', borderRadius: '50%', border: '1.5px solid var(--secondary-light)', borderTopColor: 'transparent', animation: 'spin 1s linear infinite' }}></span>
                      <span>Analisando cifra com IA...</span>
                    </div>
                  )}

                  {importError && (
                    <div style={{ fontSize: '0.75rem', color: 'var(--danger-light)', marginTop: '4px' }}>
                      ⚠️ {importError}
                    </div>
                  )}
                </div>
              </div>

              {/* Vínculo com Música do Repertório */}
              <div className="form-group" style={{ borderTop: '1px solid var(--border)', paddingTop: '12px' }}>
                <label className="form-label">Vincular a uma Música do Repertório</label>
                <select
                  className="form-control"
                  value={songId}
                  onChange={e => setSongId(e.target.value)}
                >
                  <option value="">Nenhuma música vinculada</option>
                  <option value="new" style={{ color: 'var(--primary-light)', fontWeight: 'bold' }}>+ Nova Música (Auto-Criar)...</option>
                  {repertoireSongs.map(s => (
                    <option key={s.id} value={s.id}>{s.title}</option>
                  ))}
                </select>

                {/* If "new" option is selected, render input text and checkbox */}
                {songId === 'new' && (
                  <div style={{ marginTop: '12px', padding: '12px', borderRadius: '8px', border: '1px solid var(--border)', backgroundColor: 'rgba(255, 255, 255, 0.02)' }}>
                    <div className="form-group">
                      <label className="form-label">Nome da Nova Música no Repertório *</label>
                      <input
                        type="text"
                        className="form-control"
                        value={newSongTitle}
                        onChange={e => {
                          setNewSongTitle(e.target.value);
                          setUserModifiedNewSongTitle(true);
                        }}
                        placeholder="Nome da música..."
                      />
                    </div>
                    
                    <div className="form-group" style={{ display: 'flex', alignItems: 'center', gap: '8px', marginTop: '8px' }}>
                      <input
                        type="checkbox"
                        id="auto-create-checkbox"
                        checked={autoCreateSong}
                        onChange={e => setAutoCreateSong(e.target.checked)}
                        style={{ width: '16px', height: '16px', cursor: 'pointer' }}
                      />
                      <label htmlFor="auto-create-checkbox" className="form-label" style={{ margin: 0, cursor: 'pointer', fontSize: '0.85rem' }}>
                        Criar automaticamente no Repertório ao salvar a cifra
                      </label>
                    </div>
                  </div>
                )}
              </div>

              <div className="form-group" style={{ flex: 1, display: 'flex', flexDirection: 'column' }}>
                <label className="form-label">Conteúdo da Cifra (Formato Bracket) *</label>
                <textarea
                  className="form-control"
                  style={{ flex: 1, fontFamily: 'monospace', fontSize: '0.85rem', resize: 'none', minHeight: '200px' }}
                  value={content}
                  onChange={e => setContent(e.target.value)}
                  placeholder="Ex: [C]Amanhã [G]será outro [Am]dia..."
                />
              </div>

              <div style={{ display: 'flex', gap: '12px', justifyContent: 'flex-end', marginTop: '8px' }}>
                {selectedChord.id && (
                  <button className="btn btn-danger" style={{ padding: '10px 16px' }} onClick={handleDelete}>
                    Excluir
                  </button>
                )}
                <button className="btn btn-success" style={{ padding: '10px 16px' }} onClick={handleSave}>
                  {selectedChord.id ? 'Salvar Cifra' : 'Criar Cifra'}
                </button>
              </div>
            </div>

            {/* Preview & Transposition (printable right workspace column) */}
            <div className="glass-panel printable-area-container" style={{ flex: 1.2, padding: '20px', display: 'flex', flexDirection: 'column', gap: '16px', overflowY: 'auto' }}>
              <div className="no-print" style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', borderBottom: '1px solid var(--border)', paddingBottom: '12px' }}>
                <h3 style={{ fontSize: '1.1rem', fontWeight: 600 }}>Visualização Reativa</h3>

                {/* Print button */}
                <button className="btn btn-secondary" style={{ display: 'flex', alignItems: 'center', gap: '6px', padding: '6px 12px', fontSize: '0.85rem' }} onClick={handlePrint}>
                  🖨️ Exportar PDF
                </button>
              </div>

              {/* Pitch shifter & Font Size control panel */}
              <div className="no-print" style={{ display: 'flex', flexWrap: 'wrap', gap: '16px', justifyContent: 'space-between', alignItems: 'center', padding: '12px', borderRadius: '10px', backgroundColor: 'rgba(255, 255, 255, 0.03)', border: '1px solid var(--border)' }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: '12px' }}>
                  <div style={{ display: 'flex', alignItems: 'center', gap: '6px' }}>
                    <span style={{ fontSize: '0.85rem', opacity: 0.7 }}>Tom Original:</span>
                    <strong style={{ color: 'var(--primary-light)', fontSize: '0.95rem' }}>{originalKey}</strong>
                    <span style={{ fontSize: '0.85rem', opacity: 0.7, marginLeft: '12px' }}>Tom Atual:</span>
                    <strong style={{ color: 'var(--secondary-light)', fontSize: '0.95rem' }}>{currentKeyTransposed}</strong>
                  </div>

                  <div style={{ display: 'flex', alignItems: 'center', gap: '8px', marginLeft: '8px' }}>
                    <button className="btn btn-secondary" style={{ width: '24px', height: '24px', padding: 0, display: 'flex', justifyContent: 'center', alignItems: 'center', fontSize: '0.85rem' }} onClick={() => setSemitones(prev => prev - 1)}>
                      -
                    </button>
                    <span style={{ fontSize: '0.85rem', width: '28px', textAlign: 'center' }}>
                      {semitones > 0 ? `+${semitones}` : semitones}
                    </span>
                    <button className="btn btn-secondary" style={{ width: '24px', height: '24px', padding: 0, display: 'flex', justifyContent: 'center', alignItems: 'center', fontSize: '0.85rem' }} onClick={() => setSemitones(prev => prev + 1)}>
                      +
                    </button>
                    {semitones !== 0 && (
                      <button className="btn btn-link" style={{ fontSize: '0.7rem', color: 'var(--text-secondary)', padding: '0 4px' }} onClick={() => setSemitones(0)}>
                        Reset
                      </button>
                    )}
                  </div>
                </div>

                <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                  <span style={{ fontSize: '0.85rem', opacity: 0.7 }}>Tamanho da Fonte:</span>
                  <button className="btn btn-secondary" style={{ width: '24px', height: '24px', padding: 0, display: 'flex', justifyContent: 'center', alignItems: 'center', fontSize: '0.85rem' }} onClick={() => setPrintFontSize(prev => Math.max(10, prev - 1))}>
                    -
                  </button>
                  <span style={{ fontSize: '0.85rem', width: '36px', textAlign: 'center', fontWeight: 'bold' }}>
                    {printFontSize}px
                  </span>
                  <button className="btn btn-secondary" style={{ width: '24px', height: '24px', padding: 0, display: 'flex', justifyContent: 'center', alignItems: 'center', fontSize: '0.85rem' }} onClick={() => setPrintFontSize(prev => Math.min(24, prev + 1))}>
                    +
                  </button>
                </div>
              </div>

              {/* Rendered sheet box (will be fully printable and contain header) */}
              <div className="print-sheet-box" style={{ flex: 1, padding: '20px', borderRadius: '12px', backgroundColor: 'var(--surface-variant)', border: '1px solid var(--border)', overflowX: 'auto', fontFamily: 'monospace' }}>
                
                {/* Print/Visual header inside the sheet container */}
                <div style={{ borderBottom: '1px solid var(--border-color)', paddingBottom: '12px', marginBottom: '20px' }}>
                  <h2 style={{ fontSize: '1.5rem', fontWeight: 700, margin: '0 0 4px 0' }}>{title || 'Nova Cifra'}</h2>
                  <div style={{ fontSize: '0.85rem', opacity: 0.7, display: 'flex', gap: '20px', flexWrap: 'wrap' }}>
                    <span><strong>Artista:</strong> {selectedArtistName}</span>
                    <span><strong>Tom Original:</strong> {originalKey}</span>
                    <span><strong>Tom Atual:</strong> {currentKeyTransposed}</span>
                  </div>
                </div>

                {/* Sheet segments */}
                <div style={{ display: 'flex', flexDirection: 'column', gap: '8px' }}>
                  {rawLines.map((lineText, lineIdx) => {
                    const visual = rawToVisual(lineText);
                    const text = visual.cleanText;

                    if (!text && Object.keys(visual.chords).length === 0) {
                      const isEditingEmpty = editingCell && editingCell.lineIdx === lineIdx && editingCell.charIdx === 0;
                      return (
                        <div 
                          key={lineIdx} 
                          onClick={() => {
                            if (!isEditingEmpty) {
                              setEditingCell({ lineIdx, charIdx: 0 });
                              setEditingChordValue('');
                            }
                          }}
                          style={{ 
                            height: '36px', 
                            margin: '4px 0', 
                            borderRadius: '6px', 
                            backgroundColor: 'rgba(255, 255, 255, 0.05)', 
                            border: '1px dashed var(--border)',
                            display: 'flex',
                            alignItems: 'center',
                            justifyContent: 'center',
                            cursor: 'pointer',
                            fontSize: '0.75rem',
                            opacity: 0.5,
                            position: 'relative'
                          }}
                        >
                          {isEditingEmpty ? (
                            renderInlineEditor(lineIdx, 0)
                          ) : (
                            'Linha vazia — toque para inserir acorde'
                          )}
                        </div>
                      );
                    }

                    return (
                      <div 
                        key={lineIdx} 
                        style={{ 
                          display: 'flex', 
                          flexWrap: 'wrap', 
                          rowGap: `${printFontSize + 7}px`, 
                          fontFamily: 'monospace', 
                          fontSize: `${printFontSize}px`, 
                          lineHeight: '1.4',
                          paddingTop: `${printFontSize + 3}px` // Space for absolute chords
                        }}
                      >
                        {text.split('').map((char, charIdx) => {
                          const isEditing = editingCell && editingCell.lineIdx === lineIdx && editingCell.charIdx === charIdx;
                          const hasChord = visual.chords[charIdx] !== undefined;
                          const chord = visual.chords[charIdx] || '';
                          const transposedChord = hasChord ? transposeChord(chord, semitones) : '';

                          return (
                            <div 
                              key={charIdx} 
                              onClick={() => {
                                if (!isEditing) {
                                  setEditingCell({ lineIdx, charIdx });
                                  setEditingChordValue(chord);
                                }
                              }}
                              style={{ 
                                display: 'flex', 
                                flexDirection: 'column', 
                                position: 'relative', 
                                cursor: 'pointer',
                                userSelect: 'none'
                              }}
                            >
                              {/* Inline Input Editor */}
                              {isEditing ? (
                                renderInlineEditor(lineIdx, charIdx)
                              ) : (
                                /* Chord absolute positioned */
                                hasChord && (
                                  <span 
                                    className="print-chord-span"
                                    style={{ 
                                      position: 'absolute', 
                                      bottom: '100%', 
                                      left: 0, 
                                      color: 'var(--primary-light)', 
                                      fontWeight: 'bold', 
                                      fontSize: `${Math.round(printFontSize * 0.9)}px`,
                                      whiteSpace: 'nowrap',
                                      padding: '0 1px'
                                    }}
                                  >
                                    {transposedChord}
                                  </span>
                                )
                              )}
                              {/* Character */}
                              <span 
                                className={hasChord ? 'has-chord' : ''}
                                style={{ 
                                  textDecoration: hasChord ? 'underline 2px solid var(--primary-light)' : 'none',
                                  color: 'var(--text-primary)'
                                }}
                              >
                                {char === ' ' ? '\u00A0' : char}
                              </span>
                            </div>
                          );
                        })}

                        {/* Extra cell tap "+" at the end */}
                        {(() => {
                          const isEditingExtra = editingCell && editingCell.lineIdx === lineIdx && editingCell.charIdx === text.length;
                          const hasExtraChord = visual.chords[text.length] !== undefined;
                          const extraChord = visual.chords[text.length] || '';

                          return (
                            <div 
                              onClick={() => {
                                if (!isEditingExtra) {
                                  setEditingCell({ lineIdx, charIdx: text.length });
                                  setEditingChordValue(extraChord);
                                }
                              }}
                              style={{ 
                                display: 'flex', 
                                flexDirection: 'column', 
                                position: 'relative', 
                                cursor: 'pointer',
                                userSelect: 'none',
                                marginLeft: '4px'
                              }}
                            >
                              {isEditingExtra ? (
                                renderInlineEditor(lineIdx, text.length)
                              ) : (
                                hasExtraChord && (
                                  <span 
                                    className="print-chord-span"
                                    style={{ 
                                      position: 'absolute', 
                                      bottom: '100%', 
                                      left: 0, 
                                      color: 'var(--primary-light)', 
                                      fontWeight: 'bold', 
                                      fontSize: `${Math.round(printFontSize * 0.9)}px`,
                                      whiteSpace: 'nowrap',
                                      padding: '0 1px'
                                    }}
                                  >
                                    {transposeChord(extraChord, semitones)}
                                  </span>
                                )
                              )}
                              <span style={{ fontSize: `${Math.round(printFontSize * 0.8)}px`, color: 'var(--text-tertiary)', opacity: 0.6 }}>
                                ➕
                              </span>
                            </div>
                          );
                        })()}
                      </div>
                    );
                  })}
                </div>
              </div>
            </div>
          </div>
        )}
      </div>

      {/* ─── Print Preview Modal ─── */}
      {isPrintModalOpen && (
        <div style={{
          position: 'fixed',
          top: 0,
          left: 0,
          right: 0,
          bottom: 0,
          backgroundColor: 'rgba(0, 0, 0, 0.8)',
          display: 'flex',
          justifyContent: 'center',
          alignItems: 'center',
          zIndex: 1000,
          padding: '20px'
        }}>
          <div className="glass-panel" style={{
            width: '100%',
            maxWidth: '850px',
            maxHeight: '90vh',
            display: 'flex',
            flexDirection: 'column',
            gap: '16px',
            padding: '24px',
            backgroundColor: 'var(--surface-color)',
            border: '1px solid var(--border-color)',
            borderRadius: '12px',
            overflow: 'hidden'
          }}>
            {/* Modal Header */}
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', borderBottom: '1px solid var(--border-color)', paddingBottom: '12px' }}>
              <h3 style={{ fontSize: '1.2rem', fontWeight: 600, color: 'var(--text-primary)' }}>Pré-visualização do PDF</h3>
              
              <div style={{ display: 'flex', alignItems: 'center', gap: '16px' }}>
                {/* Font Size controls inside Modal */}
                <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                  <span style={{ fontSize: '0.85rem', opacity: 0.7 }}>Tamanho da Letra:</span>
                  <button className="btn btn-secondary" style={{ width: '28px', height: '28px', padding: 0, display: 'flex', justifyContent: 'center', alignItems: 'center' }} onClick={() => setPrintFontSize(prev => Math.max(10, prev - 1))}>
                    -
                  </button>
                  <span style={{ fontSize: '0.85rem', width: '36px', textAlign: 'center', fontWeight: 'bold' }}>
                    {printFontSize}px
                  </span>
                  <button className="btn btn-secondary" style={{ width: '28px', height: '28px', padding: 0, display: 'flex', justifyContent: 'center', alignItems: 'center' }} onClick={() => setPrintFontSize(prev => Math.min(24, prev + 1))}>
                    +
                  </button>
                </div>

                <button className="btn btn-success" onClick={generatePDF} style={{ padding: '8px 16px', fontSize: '0.9rem' }}>
                  📥 Baixar PDF
                </button>
                <button className="btn btn-secondary" onClick={() => setIsPrintModalOpen(false)} style={{ padding: '8px 16px', fontSize: '0.9rem' }}>
                  Fechar
                </button>
              </div>
            </div>

            {/* Modal Body: Scrollable Sheet Preview */}
            <div style={{ flex: 1, overflowY: 'auto', padding: '10px', backgroundColor: '#111', borderRadius: '8px' }}>
              {/* This is the box that is sent to html2pdf generator */}
              <div 
                id="printable-sheet-pdf" 
                style={{ 
                  background: 'white', 
                  color: 'black', 
                  padding: '30px', 
                  fontFamily: 'monospace',
                  borderRadius: '4px',
                  boxShadow: '0 4px 8px rgba(0,0,0,0.2)',
                  minHeight: '297mm', // A4 aspect ratio height placeholder
                  width: '100%',
                  boxSizing: 'border-box'
                }}
              >
                {/* PDF document styles for PDF generation */}
                <style>{`
                  #printable-sheet-pdf * {
                    color: black !important;
                  }
                  #printable-sheet-pdf .print-chord-span {
                    color: black !important;
                    font-weight: bold !important;
                  }
                  #printable-sheet-pdf .has-chord {
                    text-decoration: underline 1px solid black !important;
                    text-decoration-color: black !important;
                  }
                `}</style>

                {/* Document Header */}
                <div style={{ borderBottom: '2px solid #ccc', paddingBottom: '12px', marginBottom: '20px' }}>
                  <h2 style={{ fontSize: '24px', fontWeight: 700, margin: '0 0 6px 0', color: 'black' }}>
                    {title || 'Sem Título'}
                  </h2>
                  <div style={{ fontSize: '13px', display: 'flex', gap: '20px', flexWrap: 'wrap', color: '#555' }}>
                    <span><strong>Artista:</strong> {selectedArtistName}</span>
                    <span><strong>Tom Original:</strong> {originalKey}</span>
                    <span><strong>Tom Atual:</strong> {currentKeyTransposed}</span>
                  </div>
                </div>

                {/* Sheet lines */}
                <div style={{ display: 'flex', flexDirection: 'column', gap: '8px' }}>
                  {rawLines.map((lineText, lineIdx) => {
                    const visual = rawToVisual(lineText);
                    const text = visual.cleanText;

                    if (!text && Object.keys(visual.chords).length === 0) {
                      return <div key={lineIdx} style={{ height: '1.2em' }} />;
                    }

                    return (
                      <div 
                        key={lineIdx} 
                        style={{ 
                          display: 'flex', 
                          flexWrap: 'wrap', 
                          rowGap: `${printFontSize + 7}px`, 
                          fontFamily: 'monospace', 
                          fontSize: `${printFontSize}px`, 
                          lineHeight: '1.4',
                          paddingTop: `${printFontSize + 3}px`,
                          position: 'relative'
                        }}
                      >
                        {text.split('').map((char, charIdx) => {
                          const hasChord = visual.chords[charIdx] !== undefined;
                          const chord = visual.chords[charIdx] || '';
                          const transposedChord = hasChord ? transposeChord(chord, semitones) : '';

                          return (
                            <div 
                              key={charIdx} 
                              style={{ 
                                display: 'flex', 
                                flexDirection: 'column', 
                                position: 'relative'
                              }}
                            >
                              {hasChord && (
                                <span 
                                  className="print-chord-span"
                                  style={{ 
                                    position: 'absolute', 
                                    bottom: '100%', 
                                    left: 0, 
                                    color: 'black', 
                                    fontWeight: 'bold', 
                                    fontSize: `${Math.round(printFontSize * 0.9)}px`,
                                    whiteSpace: 'nowrap',
                                    padding: '0 1px'
                                  }}
                                >
                                  {transposedChord}
                                </span>
                              )}
                              <span 
                                className={hasChord ? 'has-chord' : ''}
                                style={{ 
                                  textDecoration: hasChord ? 'underline 1px solid black' : 'none',
                                  color: 'black'
                                }}
                              >
                                {char === ' ' ? '\u00A0' : char}
                              </span>
                            </div>
                          );
                        })}

                        {/* Extra cell chord at the end */}
                        {(() => {
                          const hasExtraChord = visual.chords[text.length] !== undefined;
                          const extraChord = visual.chords[text.length] || '';

                          return hasExtraChord ? (
                            <div 
                              style={{ 
                                display: 'flex', 
                                flexDirection: 'column', 
                                position: 'relative',
                                marginLeft: '4px'
                              }}
                            >
                              <span 
                                className="print-chord-span"
                                style={{ 
                                  position: 'absolute', 
                                  bottom: '100%', 
                                  left: 0, 
                                  color: 'black', 
                                  fontWeight: 'bold', 
                                  fontSize: `${Math.round(printFontSize * 0.9)}px`,
                                  whiteSpace: 'nowrap',
                                  padding: '0 1px'
                                }}
                              >
                                {transposeChord(extraChord, semitones)}
                              </span>
                              <span style={{ visibility: 'hidden' }}>➕</span>
                            </div>
                          ) : null;
                        })()}
                      </div>
                    );
                  })}
                </div>
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};
