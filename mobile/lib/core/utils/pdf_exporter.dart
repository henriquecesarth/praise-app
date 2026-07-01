import 'package:pdf/pdf.dart';
import 'package:pdf/widgets.dart' as pw;
import 'package:printing/printing.dart';
import '../../features/repertoire/domain/entities/entities.dart';
import 'smart_chord_utils.dart';

class PdfExporter {
  static Future<void> exportSong(Song song, int semitones) async {
    final pdf = pw.Document();
    
    // Parse smart chord or lyrics
    final originalKey = song.smartChord?.originalKey ?? song.originalKey ?? 'C';
    final transposedKey = SmartChordUtils.transposeChord(originalKey, semitones);
    
    final hasSmartChord = song.smartChord != null;
    final lines = hasSmartChord 
        ? SmartChordUtils.parseSmartChord(song.smartChord!.content)
        : [];

    pdf.addPage(
      pw.MultiPage(
        pageFormat: PdfPageFormat.a4,
        margin: const pw.EdgeInsets.all(36),
        build: (pw.Context context) {
          return [
            // Header
            pw.Header(
              level: 0,
              child: pw.Row(
                mainAxisAlignment: pw.MainAxisAlignment.spaceBetween,
                children: [
                  pw.Column(
                    crossAxisAlignment: pw.CrossAxisAlignment.start,
                    children: [
                      pw.Text(
                        song.title,
                        style: pw.TextStyle(
                          fontSize: 24,
                          fontWeight: pw.FontWeight.bold,
                        ),
                      ),
                      pw.SizedBox(height: 4),
                      pw.Text(
                        song.artistName ?? 'Artista desconhecido',
                        style: const pw.TextStyle(
                          fontSize: 14,
                          color: PdfColors.grey700,
                        ),
                      ),
                    ],
                  ),
                  pw.Column(
                    crossAxisAlignment: pw.CrossAxisAlignment.end,
                    children: [
                      pw.Text('Tom Original: $originalKey'),
                      pw.Text('Tom Atual: $transposedKey'),
                      if (song.bpm != null) pw.Text('BPM: ${song.bpm!.toInt()}'),
                    ],
                  ),
                ],
              ),
            ),
            pw.SizedBox(height: 20),
            
            // Content
            if (hasSmartChord)
              pw.Column(
                crossAxisAlignment: pw.CrossAxisAlignment.start,
                children: lines.map((line) {
                  if (line.segments.isEmpty) {
                    return pw.SizedBox(height: 12);
                  }
                  
                  return pw.Padding(
                    padding: const pw.EdgeInsets.only(bottom: 6),
                    child: pw.Wrap(
                      spacing: 4,
                      runSpacing: 4,
                      children: line.segments.map((seg) {
                        final transposedChord = seg.chord.isNotEmpty
                            ? SmartChordUtils.transposeChord(seg.chord, semitones)
                            : '';
                        return pw.Column(
                          crossAxisAlignment: pw.CrossAxisAlignment.start,
                          children: [
                            pw.Text(
                              transposedChord,
                              style: pw.TextStyle(
                                fontFamily: pw.Font.courierBold().family,
                                fontSize: 10,
                                color: PdfColors.violet800,
                              ),
                            ),
                            pw.Text(
                              seg.text.isEmpty ? ' ' : seg.text,
                              style: pw.TextStyle(
                                fontFamily: pw.Font.courier().family,
                                fontSize: 11,
                              ),
                            ),
                          ],
                        );
                      }).toList(),
                    ),
                  );
                }).toList(),
              )
            else if (song.lyrics != null && song.lyrics!.isNotEmpty)
              pw.Paragraph(
                text: song.lyrics!,
                style: const pw.TextStyle(fontSize: 12, lineHeight: 1.5),
              )
            else
              pw.Paragraph(text: 'Sem letra ou cifra cadastrada.'),
          ];
        },
      ),
    );

    await Printing.layoutPdf(
      onLayout: (PdfPageFormat format) async => pdf.save(),
      name: '${song.title}.pdf',
    );
  }
}
