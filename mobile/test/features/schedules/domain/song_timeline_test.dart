import 'package:flutter_test/flutter_test.dart';
import 'package:louvaio_mobile/features/schedules/domain/schedule.dart';
import 'package:louvaio_mobile/features/schedules/domain/song_timeline.dart';
import '../presentation/controllers/schedule_controllers_test.dart' show FakeScheduleRepository;
import 'package:louvaio_mobile/features/schedules/presentation/controllers/schedule_form_controller.dart';

const songs = [
  ScheduleSong(id: 'a', title: 'Oceanos'),
  ScheduleSong(id: 'b', title: 'Ao Teu Rosto Vir'),
  ScheduleSong(id: 'c', title: 'Até que Ele Venha'),
];
const template = ScheduleTemplate(id: 'tpl', name: 'Culto', items: [
  ScheduleTemplateItem(id: '1', title: 'Música 1', type: 'song'),
  ScheduleTemplateItem(id: '2', title: 'Oferta', type: 'event', icon: 'Oferta', durationSeconds: 300),
  ScheduleTemplateItem(id: '3', title: 'Música 2', type: 'song'),
  ScheduleTemplateItem(id: '4', title: 'Música 3', type: 'song'),
]);

void main() {
  for (final templateFirst in [true, false]) {
    test('template before songs: $templateFirst; add/remove/reorder and save/reopen', () async {
      final repo = FakeScheduleRepository()..detailToReturn = const ScheduleDetail(
        id: 'saved', ministryId: 'min', title: 'Culto', date: '2099-01-01');
      final form = ScheduleFormNotifier(repository: repo);
      addTearDown(form.dispose);
      form.init(ministryId: 'min');
      if (templateFirst) form.applyTemplate(template, replace: true);
      for (final song in songs) { form.addSong(song); }
      if (!templateFirst) form.applyTemplate(template, replace: true);
      expect(form.state.timeline.map((t) => t.title),
        ['Oceanos', 'Oferta', 'Ao Teu Rosto Vir', 'Até que Ele Venha']);
      expect(form.state.timeline[1].time, '5min');
      final event = form.state.timeline[1];
      form.reorderSongs(2, 0);
      expect(form.state.timeline.map((t) => t.title),
        ['Até que Ele Venha', 'Oferta', 'Oceanos', 'Ao Teu Rosto Vir']);
      form.removeSong(1);
      expect(form.state.timeline.map((t) => t.title),
        ['Até que Ele Venha', 'Oferta', 'Ao Teu Rosto Vir', 'Música 3']);
      expect(form.state.timeline[1], event);
      await form.submit();
      final payload = repo.lastCreatedData!;
      final reopened = ScheduleDetail.fromJson({...payload, 'id': 'saved', 'ministry_id': 'min'});
      expect(reopened.timeline.map((t) => t.title), form.state.timeline.map((t) => t.title));
      expect(resolveTimelineSong(reopened.timeline[2], 1, reopened.songs)?.id, 'b');
      expect((payload['timeline'] as List).every((item) =>
        (item as Map).keys.every((key) => ['id', 'title', 'time', 'type'].contains(key))), isTrue);
    });
  }

  test('legacy resolution is read-only; custom, mismatched and duplicate identities do not link', () {
    const slot = ScheduleTimelineItem(id: 's', title: 'Música 1', type: 'Música');
    expect(resolveTimelineSong(slot, 0, songs)?.id, 'a');
    expect(slot.title, 'Música 1');
    final custom = slot.copyWith(title: 'Medley especial', time: '8min');
    expect(resolveTimelineSong(custom, 0, songs), isNull);
    expect(syncSongTimeline([custom], songs, songs).first, custom);
    expect(resolveTimelineSong(slot.copyWith(title: 'Ao Teu Rosto Vir'), 0, songs), isNull);
    expect(resolveTimelineSong(slot, 0, [songs[0], songs[0]]), isNull);
    expect(resolveTimelineSong(slot.copyWith(title: 'Oceanos'), 0,
      [songs[0], const ScheduleSong(id: 'other', title: 'Oceanos')]), isNull);
    expect(resolveTimelineSong(slot.copyWith(type: 'worship'), 0, songs), isNull);
  });

  test('append preserves original metadata and does not restart song mapping', () {
    final form = ScheduleFormNotifier(repository: FakeScheduleRepository());
    addTearDown(form.dispose);
    form.init(ministryId: 'min');
    form.addSong(songs[0]);
    final original = form.state.timeline.first;
    form.applyTemplate(template, replace: false);
    expect(form.state.timeline.first, original);
    expect(form.state.timeline[1].title, 'Música 2');
    expect(form.state.timeline[2].title, 'Oferta');
    form.addSong(songs[1]);
    expect(form.state.timeline[1].title, 'Ao Teu Rosto Vir');
    expect(form.state.timeline[2].time, '5min');
  });
}
