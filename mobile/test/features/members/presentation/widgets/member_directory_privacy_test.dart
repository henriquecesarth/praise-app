import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:louvaio_mobile/features/schedules/domain/ministry_member.dart';
import 'package:louvaio_mobile/features/schedules/domain/ministry_role.dart';
import 'package:louvaio_mobile/features/members/presentation/widgets/member_card.dart';
import 'package:louvaio_mobile/features/members/presentation/widgets/member_detail_sheet.dart';

void main() {
  const rolesMap = {
    'r1': MinistryRole(id: 'r1', name: 'Violão'),
    'r2': MinistryRole(id: 'r2', name: 'Backing Vocal'),
  };

  const memberWithFullData = MinistryMember(
    id: 'mem-1',
    userId: 'user-1',
    name: 'Carlos Oliveira',
    email: 'carlos.oliveira@louvaio.com',
    phone: '+55 11 98888-7777',
    role: 'member',
    roleIds: ['r1', 'r2'],
    joinedAt: '2025-01-15T10:00:00Z',
    birthDate: '1990-05-20',
  );

  const memberWithoutPhone = MinistryMember(
    id: 'mem-2',
    userId: 'user-2',
    name: 'Ana Souza',
    email: 'ana.souza@louvaio.com',
    phone: '',
    role: 'admin',
    roleIds: ['r1'],
  );

  group('TEMPORARY_DATA_MINIMIZATION_POLICY - Ordinary Member Viewer', () {
    testWidgets('MemberCard hides email, phone, and birthDate from ordinary member', (tester) async {
      await tester.pumpWidget(
        MaterialApp(
          home: Scaffold(
            body: MemberCard(
              member: memberWithFullData,
              rolesById: rolesMap,
              isViewerAdmin: false,
              onTap: () {},
            ),
          ),
        ),
      );

      // Permitted fields
      expect(find.text('Carlos Oliveira'), findsOneWidget);
      expect(find.text('MEMBRO'), findsOneWidget);
      expect(find.text('Violão'), findsOneWidget);
      expect(find.text('Backing Vocal'), findsOneWidget);

      // Sensitive fields must NOT be displayed
      expect(find.text('carlos.oliveira@louvaio.com'), findsNothing);
      expect(find.text('+55 11 98888-7777'), findsNothing);
      expect(find.text('1990-05-20'), findsNothing);
      expect(find.text('2025-01-15T10:00:00Z'), findsNothing);
    });

    testWidgets('MemberDetailSheet hides email, phone, birthDate, and joinedAt from ordinary member', (tester) async {
      await tester.pumpWidget(
        const MaterialApp(
          home: Scaffold(
            body: MemberDetailSheet(
              member: memberWithFullData,
              rolesById: rolesMap,
              isViewerAdmin: false,
            ),
          ),
        ),
      );

      // Permitted fields
      expect(find.text('Carlos Oliveira'), findsOneWidget);
      expect(find.text('MEMBRO'), findsOneWidget);
      expect(find.text('Violão'), findsOneWidget);

      // Blocked privacy fields
      expect(find.text('carlos.oliveira@louvaio.com'), findsNothing);
      expect(find.text('+55 11 98888-7777'), findsNothing);
      expect(find.text('1990-05-20'), findsNothing);
      expect(find.text('2025-01-15T10:00:00Z'), findsNothing);
      expect(find.text('E-mail'), findsNothing);
      expect(find.text('Telefone'), findsNothing);
      expect(find.text('Nascimento'), findsNothing);
      expect(find.text('Membro desde'), findsNothing);
    });
  });

  group('TEMPORARY_DATA_MINIMIZATION_POLICY - Admin Viewer', () {
    testWidgets('MemberDetailSheet displays email and authenticated phone to admin', (tester) async {
      await tester.pumpWidget(
        const MaterialApp(
          home: Scaffold(
            body: MemberDetailSheet(
              member: memberWithFullData,
              rolesById: rolesMap,
              isViewerAdmin: true,
            ),
          ),
        ),
      );

      // Admin sees authorized email and real phone
      expect(find.text('Carlos Oliveira'), findsOneWidget);
      expect(find.text('carlos.oliveira@louvaio.com'), findsOneWidget);
      expect(find.text('+55 11 98888-7777'), findsOneWidget);

      // But birthDate remains unexposed under minimization policy
      expect(find.text('1990-05-20'), findsNothing);
      expect(find.text('Nascimento'), findsNothing);
    });

    testWidgets('MemberDetailSheet does not invent phone data when phone is absent', (tester) async {
      await tester.pumpWidget(
        const MaterialApp(
          home: Scaffold(
            body: MemberDetailSheet(
              member: memberWithoutPhone,
              rolesById: rolesMap,
              isViewerAdmin: true,
            ),
          ),
        ),
      );

      expect(find.text('Ana Souza'), findsOneWidget);
      expect(find.text('ana.souza@louvaio.com'), findsOneWidget);

      // No fake phone or empty phone row
      expect(find.text('Telefone'), findsNothing);
      expect(find.text('Não informado'), findsNothing);
    });
  });
}
