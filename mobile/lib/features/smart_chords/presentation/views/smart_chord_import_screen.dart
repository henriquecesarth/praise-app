import '../widgets/musical_progression_line.dart';
import 'dart:typed_data';
import 'package:file_picker/file_picker.dart';
import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import '../../../../app/providers.dart';
import '../../domain/shared_import_payload.dart';
import '../../domain/smart_chord_parser.dart';
import '../controllers/smart_chord_import_controller.dart';
import '../widgets/song_link_picker_modal.dart';

class SmartChordImportScreen extends ConsumerStatefulWidget {
  final SharedImportPayload? initialPayload;

  const SmartChordImportScreen({
    super.key,
    this.initialPayload,
  });

  @override
  ConsumerState<SmartChordImportScreen> createState() => _SmartChordImportScreenState();
}

class _SmartChordImportScreenState extends ConsumerState<SmartChordImportScreen>
    with SingleTickerProviderStateMixin {
  late TabController _tabController;

  // PDF Tab state
  Uint8List? _pdfBytes;
  String? _pdfFileName;
  int? _pdfSize;
  String? _fileError;

  // Text Tab state
  final _textController = TextEditingController();

  // Preview Form controllers
  final _titleController = TextEditingController();
  final _artistController = TextEditingController();
  final _contentController = TextEditingController();
  String _originalKey = 'C';
  int _previewMode = 0; // 0 = raw/edit, 1 = rendered
  late SmartChordImportNotifier _notifier;
  String? _boundUserId;
  String? _boundMinistryId;
  bool _ready = false;
  bool _abandoned = false;
  int _operation = 0;

  bool _isCurrent(int operation) => mounted && !_abandoned &&
      operation == _operation &&
      ref.read(authNotifierProvider).user?.id == _boundUserId &&
      ref.read(ministryContextNotifierProvider).selectedMinistry?.id == _boundMinistryId;

  void _clearWorkflow() {
    _operation++;
    _notifier.reset();
    _pdfBytes = null;
    _pdfFileName = null;
    _pdfSize = null;
    _fileError = null;
    _textController.clear();
    _titleController.clear();
    _artistController.clear();
    _contentController.clear();
    _originalKey = 'C';
    _previewMode = 0;
  }

  void _discardContext() {
    if (_abandoned) return;
    _abandoned = true;
    _clearWorkflow();
    final importRoute = ModalRoute.of(context);
    WidgetsBinding.instance.addPostFrameCallback((_) {
      if (!mounted || importRoute?.isActive != true) return;
      final navigator = Navigator.of(context);
      navigator.popUntil((route) => route == importRoute);
      if (navigator.canPop()) navigator.pop();
    });
  }

  @override
  void initState() {
    super.initState();
    _tabController = TabController(length: 2, vsync: this);
    _notifier = ref.read(smartChordImportNotifierProvider.notifier);
    _boundUserId = ref.read(authNotifierProvider).user?.id;
    _boundMinistryId = ref.read(ministryContextNotifierProvider).selectedMinistry?.id;
    WidgetsBinding.instance.addPostFrameCallback((_) {
      if (!mounted || _abandoned) return;
      _clearWorkflow();
      setState(() => _ready = true);
      _handleInitialPayload();
    });
  }

  Future<void> _handleInitialPayload() async {
    final payload = widget.initialPayload;
    if (payload == null || !mounted || _abandoned) return;

    if (payload.hasError) {
      final msg = payload.errorMessage ?? 'Não foi possível processar o item compartilhado.';
      setState(() {
        _fileError = msg;
      });
      if (mounted) {
        ScaffoldMessenger.of(context).showSnackBar(
          SnackBar(
            content: Text(msg),
            backgroundColor: Colors.red.shade800,
          ),
        );
      }
      return;
    }

    if (payload.isText) {
      final text = payload.text?.trim() ?? '';
      if (text.isEmpty) {
        setState(() {
          _fileError = 'O texto compartilhado está vazio.';
        });
        return;
      }
      _tabController.index = 1;
      _textController.text = text;
      await _extractText();
    } else if (payload.isPdf) {
      final bytes = payload.pdfBytes;
      if (bytes == null || bytes.isEmpty) {
        setState(() {
          _fileError = 'Arquivo PDF vazio ou inválido.';
        });
        return;
      }
      final size = bytes.length;
      if (size > 3 * 1024 * 1024) {
        setState(() {
          _fileError = 'Arquivo PDF excede o limite máximo permitido de 3 MB.';
          _pdfBytes = null;
          _pdfFileName = null;
          _pdfSize = null;
        });
        return;
      }
      _tabController.index = 0;
      setState(() {
        _pdfBytes = bytes;
        _pdfFileName = payload.pdfFileName ?? 'cifra_compartilhada.pdf';
        _pdfSize = size;
        _fileError = null;
      });
      await _extractPdf();
    }
  }

  @override
  void dispose() {
    _abandoned = true;
    _operation++;
    // autoDispose releases the notifier; pending operations also check mounted.
    _tabController.dispose();
    _textController.dispose();
    _titleController.dispose();
    _artistController.dispose();
    _contentController.dispose();
    super.dispose();
  }

  Future<void> _pickPdfFile() async {
    final operation = ++_operation;
    setState(() {
      _fileError = null;
    });

    try {
      final result = await FilePicker.pickFiles(
        type: FileType.custom,
        allowedExtensions: ['pdf'],
      );

      if (!_isCurrent(operation) || result.isEmpty) return;

      final file = result.first;
      final declaredSize = await file.length();
      if (!_isCurrent(operation)) return;
      if (declaredSize != null && declaredSize > 3 * 1024 * 1024) {
        setState(() {
          _fileError = 'Arquivo PDF excede o limite máximo permitido de 3 MB.';
          _pdfBytes = null;
          _pdfFileName = null;
          _pdfSize = null;
        });
        return;
      }
      final bytes = await file.readAsBytes();
      if (!_isCurrent(operation)) return;
      final size = bytes.length;

      if (size > 3 * 1024 * 1024) {
        setState(() {
          _fileError = 'Arquivo PDF excede o limite máximo permitido de 3 MB.';
          _pdfBytes = null;
          _pdfFileName = null;
          _pdfSize = null;
        });
        return;
      }

      setState(() {
        _pdfBytes = bytes;
        _pdfFileName = file.name;
        _pdfSize = size;
        _fileError = null;
      });
    } catch (_) {
      if (!_isCurrent(operation)) return;
      setState(() {
        _fileError = 'Não foi possível selecionar o arquivo. Tente novamente.';
      });
    }
  }

  Future<void> _extractPdf() async {
    if (_pdfBytes == null || _pdfFileName == null) {
      setState(() {
        _fileError = 'Selecione um arquivo PDF válido.';
      });
      return;
    }

    final operation = ++_operation;
    await _notifier.importPdf(_pdfBytes!, _pdfFileName!);
    if (!_isCurrent(operation)) return;
    _syncDraftToControllers();
  }

  Future<void> _extractText() async {
    final text = _textController.text.trim();
    if (text.isEmpty) {
      ScaffoldMessenger.of(context).showSnackBar(
        const SnackBar(content: Text('Cole o texto da cifra antes de continuar.')),
      );
      return;
    }

    final operation = ++_operation;
    await _notifier.importText(text);
    if (!_isCurrent(operation)) return;
    _syncDraftToControllers();
  }

  void _syncDraftToControllers() {
    final draft = ref.read(smartChordImportNotifierProvider).draft;
    if (draft != null) {
      _titleController.text = draft.title;
      _artistController.text = draft.artistName ?? '';
      _originalKey = draft.originalKey ?? 'C';
      _contentController.text = draft.content;
    }
  }

  Future<void> _saveChord() async {
    if (!_isCurrent(_operation)) return;
    final state = ref.read(smartChordImportNotifierProvider);
    if (state.status == ImportStatus.saving || state.status == ImportStatus.linking || state.savedChord != null) return;
    final operation = ++_operation;
    final notifier = _notifier;
    notifier.updateDraft(
      title: _titleController.text,
      artistName: _artistController.text,
      originalKey: _originalKey,
      content: _contentController.text,
    );

    final created = await notifier.saveChord();
    if (!mounted || created == null || !_isCurrent(operation)) return;

    final ministry = ref.read(ministryContextNotifierProvider).selectedMinistry;

    if (ministry != null) {
      final shouldLink = await showDialog<bool>(
        context: context,
        barrierDismissible: false,
        builder: (dialogCtx) => AlertDialog(
          title: const Text('Cifra Salva!'),
          content: const Text(
            'Cifra salva com sucesso na sua biblioteca pessoal!\n\n'
            'Deseja vinculá-la a uma música do repertório deste ministério? '
            '(O vínculo é privado e não expõe sua cifra a outros integrantes).',
          ),
          actions: [
            TextButton(
              onPressed: () => Navigator.of(dialogCtx).pop(false),
              child: const Text('Agora não'),
            ),
            ElevatedButton(
              onPressed: () => Navigator.of(dialogCtx).pop(true),
              child: const Text('Vincular'),
            ),
          ],
        ),
      );

      if (!mounted || !_isCurrent(operation)) return;
      if (shouldLink == true) {
        await SongLinkPickerModal.show(
          context,
          ministryId: ministry.id,
          chordId: created.id,
          chordTitle: created.title,
        );
      }
    }

    if (mounted && _isCurrent(operation)) {
      Navigator.of(context).pop(created);
    }
  }

  @override
  Widget build(BuildContext context) {
    ref.listen(authNotifierProvider, (previous, next) {
      if (next.user?.id != _boundUserId) _discardContext();
    });
    ref.listen(ministryContextNotifierProvider, (previous, next) {
      if (next.selectedMinistry?.id != _boundMinistryId) _discardContext();
    });
    final state = ref.watch(smartChordImportNotifierProvider);

    return PopScope(
      onPopInvokedWithResult: (didPop, result) {
        if (didPop && !_abandoned) {
          _abandoned = true;
          _operation++;
          _notifier.reset();
        }
      },
      child: Scaffold(
        appBar: AppBar(
          title: const Text('Importar Cifra'),
          bottom: state.draft == null && state.status != ImportStatus.extracting
              ? TabBar(
                  controller: _tabController,
                  tabs: const [
                    Tab(icon: Icon(Icons.picture_as_pdf), text: 'Documento PDF'),
                    Tab(icon: Icon(Icons.text_fields), text: 'Colar Texto'),
                  ],
                )
              : null,
        ),
        body: SafeArea(
          child: !_ready || _abandoned ? const SizedBox.shrink() : state.status == ImportStatus.extracting
              ? _buildExtractingIndicator()
              : state.draft != null
                  ? _buildPreviewEditor(state)
                  : Column(children: [
                      if (state.errorMessage != null)
                        Padding(
                          padding: const EdgeInsets.all(16),
                          child: Text(state.errorMessage!, style: TextStyle(color: Theme.of(context).colorScheme.error)),
                        ),
                      Expanded(child: _buildInputTabs()),
                    ]),
        ),
      ),
    );
  }

  Widget _buildExtractingIndicator() {
    return const Center(
      child: Column(
        mainAxisSize: MainAxisSize.min,
        children: [
          CircularProgressIndicator(),
          SizedBox(height: 16),
          Text(
            'Analisando estrutura harmônica e alinhamento...',
            style: TextStyle(fontWeight: FontWeight.w500),
          ),
        ],
      ),
    );
  }

  Widget _buildInputTabs() {
    return TabBarView(
      controller: _tabController,
      children: [
        _buildPdfInputTab(),
        _buildTextInputTab(),
      ],
    );
  }

  Widget _buildPdfInputTab() {
    return SingleChildScrollView(
      padding: const EdgeInsets.all(16),
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.stretch,
        children: [
          InkWell(
            onTap: _pickPdfFile,
            borderRadius: BorderRadius.circular(12),
            child: Container(
              padding: const EdgeInsets.all(24),
              decoration: BoxDecoration(
                border: Border.all(
                  color: _fileError != null ? Colors.red : Colors.grey.withValues(alpha: 0.4),
                  width: 2,
                ),
                borderRadius: BorderRadius.circular(12),
                color: Colors.grey.withValues(alpha: 0.05),
              ),
              child: Column(
                children: [
                  const Icon(Icons.upload_file, size: 54, color: Colors.blueAccent),
                  const SizedBox(height: 12),
                  if (_pdfFileName != null) ...[
                    Text(
                      _pdfFileName!,
                      style: const TextStyle(fontWeight: FontWeight.bold, fontSize: 16),
                      textAlign: TextAlign.center,
                    ),
                    const SizedBox(height: 4),
                    Text(
                      '${((_pdfSize ?? 0) / 1024).toStringAsFixed(1)} KB (Máximo 3 MB)',
                      style: TextStyle(color: Colors.grey.shade600, fontSize: 12),
                    ),
                  ] else ...[
                    const Text(
                      'Toque para selecionar um arquivo PDF',
                      style: TextStyle(fontWeight: FontWeight.w600, fontSize: 15),
                      textAlign: TextAlign.center,
                    ),
                    const SizedBox(height: 4),
                    Text(
                      'PDF de texto digital de até 3 MB (máx. 10 páginas)',
                      style: TextStyle(color: Colors.grey.shade600, fontSize: 12),
                      textAlign: TextAlign.center,
                    ),
                  ],
                ],
              ),
            ),
          ),
          if (_fileError != null) ...[
            const SizedBox(height: 8),
            Text(
              _fileError!,
              style: const TextStyle(color: Colors.red, fontSize: 13),
              textAlign: TextAlign.center,
            ),
          ],
          const SizedBox(height: 20),
          SizedBox(
            height: 48,
            child: ElevatedButton.icon(
              onPressed: _pdfBytes != null ? _extractPdf : null,
              icon: const Icon(Icons.search),
              label: const Text('Analisar e Pré-visualizar PDF'),
            ),
          ),
        ],
      ),
    );
  }

  Widget _buildTextInputTab() {
    return SingleChildScrollView(
      padding: const EdgeInsets.all(16),
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.stretch,
        children: [
          const Text(
            'Cole a cifra (acordes acima da letra ou em colchetes):',
            style: TextStyle(fontWeight: FontWeight.w500, fontSize: 14),
          ),
          const SizedBox(height: 8),
          TextField(
            controller: _textController,
            maxLines: 10,
            style: const TextStyle(fontFamily: 'monospace', fontSize: 13),
            decoration: const InputDecoration(
              hintText: 'G            D/F#        Em\nGraças Te dou pelo Teu amor\n\nIntro:\n||: A9 | A7M/9 | D9 | % :||',
              border: OutlineInputBorder(),
            ),
          ),
          const SizedBox(height: 16),
          SizedBox(
            height: 48,
            child: ElevatedButton.icon(
              onPressed: _extractText,
              icon: const Icon(Icons.search),
              label: const Text('Analisar e Pré-visualizar Texto'),
            ),
          ),
        ],
      ),
    );
  }

  Widget _buildPreviewEditor(SmartChordImportState state) {
    final draft = state.draft!;

    return SingleChildScrollView(
      padding: const EdgeInsets.all(16),
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.stretch,
        children: [
          if (draft.warnings.isNotEmpty) ...[
            Container(
              padding: const EdgeInsets.all(12),
              decoration: BoxDecoration(
                color: Colors.amber.withValues(alpha: 0.15),
                border: Border.all(color: Colors.amber.shade700),
                borderRadius: BorderRadius.circular(8),
              ),
              child: Column(
                crossAxisAlignment: CrossAxisAlignment.start,
                children: [
                  Row(
                    children: [
                      Icon(Icons.warning_amber_rounded, color: Colors.amber.shade800, size: 20),
                      const SizedBox(width: 8),
                      Text(
                        'Avisos da Importação (${draft.warnings.length}):',
                        style: TextStyle(
                          color: Colors.amber.shade900,
                          fontWeight: FontWeight.bold,
                        ),
                      ),
                    ],
                  ),
                  const SizedBox(height: 6),
                  ...draft.warnings.map(
                    (w) => Padding(
                      padding: const EdgeInsets.only(left: 28, top: 2),
                      child: Text('• ${w.message}', style: const TextStyle(fontSize: 12)),
                    ),
                  ),
                ],
              ),
            ),
            const SizedBox(height: 16),
          ],
          if (state.errorMessage != null) ...[
            Container(
              padding: const EdgeInsets.all(12),
              decoration: BoxDecoration(
                color: Colors.red.withValues(alpha: 0.15),
                border: Border.all(color: Colors.red),
                borderRadius: BorderRadius.circular(8),
              ),
              child: Text(
                state.errorMessage!,
                style: const TextStyle(color: Colors.red, fontWeight: FontWeight.w500),
              ),
            ),
            const SizedBox(height: 16),
          ],
          TextField(
            controller: _titleController,
            decoration: const InputDecoration(
              labelText: 'Título da Cifra *',
              border: OutlineInputBorder(),
            ),
          ),
          const SizedBox(height: 12),
          Row(
            children: [
              Expanded(
                flex: 2,
                child: TextField(
                  controller: _artistController,
                  decoration: const InputDecoration(
                    labelText: 'Artista / Banda',
                    hintText: 'Opcional',
                    border: OutlineInputBorder(),
                  ),
                ),
              ),
              const SizedBox(width: 12),
              Expanded(
                child: DropdownButtonFormField<String>(
                  initialValue: SmartChordParser.standardKeys.contains(_originalKey) ? _originalKey : 'C',
                  decoration: const InputDecoration(
                    labelText: 'Tom',
                    border: OutlineInputBorder(),
                  ),
                  items: SmartChordParser.standardKeys.map((k) {
                    return DropdownMenuItem(value: k, child: Text(k));
                  }).toList(),
                  onChanged: (val) {
                    if (val != null) setState(() => _originalKey = val);
                  },
                ),
              ),
            ],
          ),
          const SizedBox(height: 16),
          SegmentedButton<int>(
            segments: const [
              ButtonSegment(value: 0, label: Text('Editar (Colchetes)')),
              ButtonSegment(value: 1, label: Text('Pré-visualização')),
            ],
            selected: {_previewMode},
            onSelectionChanged: (set) {
              setState(() => _previewMode = set.first);
            },
          ),
          const SizedBox(height: 12),
          if (_previewMode == 0)
            TextField(
              controller: _contentController,
              maxLines: 12,
              style: const TextStyle(fontFamily: 'monospace', fontSize: 13),
              decoration: const InputDecoration(
                border: OutlineInputBorder(),
                hintText: '[G]Graças Te [D]dou...',
              ),
            )
          else
            Container(
              padding: const EdgeInsets.all(12),
              decoration: BoxDecoration(
                border: Border.all(color: Colors.grey.withValues(alpha: 0.3)),
                borderRadius: BorderRadius.circular(8),
                color: Colors.grey.withValues(alpha: 0.05),
              ),
              constraints: const BoxConstraints(maxHeight: 300),
              child: SingleChildScrollView(
                child: Column(
                  crossAxisAlignment: CrossAxisAlignment.start,
                  children: _contentController.text.split('\n').map((rawLine) {
                    if (SmartChordParser.progressionTokens(rawLine) != null) {
                      return MusicalProgressionLine(line: rawLine, fontSize: 13);
                    }
                    final transposed = SmartChordParser.renderLine(rawLine, 0);
                    if (transposed.hasChords) {
                      return Padding(
                        padding: const EdgeInsets.only(bottom: 6),
                        child: Column(
                          crossAxisAlignment: CrossAxisAlignment.start,
                          children: [
                            Text(
                              transposed.chordLine,
                              style: const TextStyle(
                                fontFamily: 'monospace',
                                color: Colors.blueAccent,
                                fontWeight: FontWeight.bold,
                                fontSize: 13,
                              ),
                            ),
                            Text(
                              transposed.lyricsLine,
                              style: const TextStyle(
                                fontFamily: 'monospace',
                                fontSize: 13,
                              ),
                            ),
                          ],
                        ),
                      );
                    }
                    return Text(
                      rawLine,
                      style: const TextStyle(fontFamily: 'monospace', fontSize: 13),
                    );
                  }).toList(),
                ),
              ),
            ),
          const SizedBox(height: 24),
          Row(
            children: [
              Expanded(
                child: OutlinedButton(
                  onPressed: () {
                    setState(_clearWorkflow);
                  },
                  child: const Text('Voltar / Novo'),
                ),
              ),
              const SizedBox(width: 12),
              Expanded(
                flex: 2,
                child: SizedBox(
                  height: 48,
                  child: ElevatedButton(
                    onPressed: state.status == ImportStatus.saving ? null : _saveChord,
                    child: state.status == ImportStatus.saving
                        ? const CircularProgressIndicator()
                        : const Text('Salvar Cifra Pessoal'),
                  ),
                ),
              ),
            ],
          ),
        ],
      ),
    );
  }
}
