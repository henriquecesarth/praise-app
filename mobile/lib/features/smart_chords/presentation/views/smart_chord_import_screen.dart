import 'dart:typed_data';
import 'package:file_picker/file_picker.dart';
import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import '../../../../app/providers.dart';
import '../../domain/smart_chord_parser.dart';
import '../controllers/smart_chord_import_controller.dart';
import '../widgets/song_link_picker_modal.dart';

class SmartChordImportScreen extends ConsumerStatefulWidget {
  const SmartChordImportScreen({super.key});

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

  @override
  void initState() {
    super.initState();
    _tabController = TabController(length: 2, vsync: this);
  }

  @override
  void dispose() {
    _tabController.dispose();
    _textController.dispose();
    _titleController.dispose();
    _artistController.dispose();
    _contentController.dispose();
    super.dispose();
  }

  Future<void> _pickPdfFile() async {
    setState(() {
      _fileError = null;
    });

    try {
      final result = await FilePicker.pickFiles(
        type: FileType.custom,
        allowedExtensions: ['pdf'],
      );

      if (result.isEmpty) return;

      final file = result.first;
      final bytes = await file.readAsBytes();
      final size = await file.length() ?? bytes.length;

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
    } catch (e) {
      setState(() {
        _fileError = 'Não foi possível selecionar o arquivo: $e';
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

    final notifier = ref.read(smartChordImportNotifierProvider.notifier);
    await notifier.importPdf(_pdfBytes!, _pdfFileName!);
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

    final notifier = ref.read(smartChordImportNotifierProvider.notifier);
    await notifier.importText(text);
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
    final notifier = ref.read(smartChordImportNotifierProvider.notifier);
    notifier.updateDraft(
      title: _titleController.text,
      artistName: _artistController.text,
      originalKey: _originalKey,
      content: _contentController.text,
    );

    final created = await notifier.saveChord();
    if (created == null || !mounted) return;

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

      if (shouldLink == true && mounted) {
        await SongLinkPickerModal.show(
          context,
          ministryId: ministry.id,
          chordId: created.id,
          chordTitle: created.title,
        );
      }
    }

    if (mounted) {
      Navigator.of(context).pop(created);
    }
  }

  @override
  Widget build(BuildContext context) {
    final state = ref.watch(smartChordImportNotifierProvider);

    return Scaffold(
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
        child: state.status == ImportStatus.extracting
            ? _buildExtractingIndicator()
            : state.draft != null
                ? _buildPreviewEditor(state)
                : _buildInputTabs(),
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
                    ref.read(smartChordImportNotifierProvider.notifier).reset();
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
