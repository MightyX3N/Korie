// Remote-control tests: the keys a TV remote sends, including a held OK (many repeats).
import 'package:flutter/services.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:korie/geo.dart';
import 'package:korie/ui/menu.dart';
import 'package:korie/ui/tile.dart';
import 'package:material_ui/material_ui.dart';

void main() {
  final g = Geo(1280, 720);

  Future<void> holdOk(WidgetTester t, {int repeats = 15}) async {
    await t.sendKeyDownEvent(LogicalKeyboardKey.select);
    await t.pump(const Duration(milliseconds: 400));
    for (var i = 0; i < repeats; i++) {
      await t.sendKeyRepeatEvent(LogicalKeyboardKey.select);
      await t.pump(const Duration(milliseconds: 50));
    }
    await t.sendKeyUpEvent(LogicalKeyboardKey.select);
    await t.pumpAndSettle();
  }

  testWidgets('holding OK on an app opens the menu and nothing else', (t) async {
    var opened = 0, menuOpen = 0;
    late BuildContext ctx;
    await t.pumpWidget(MaterialApp(
      home: Scaffold(
        body: Builder(builder: (c) {
          ctx = c;
          return Center(
            child: AppCard(
              look: const CardLook(label: 'Test App'),
              geo: g,
              onOpen: () => opened++,
              onHold: () => showOptions(ctx, geo: g, anchor: const Rect.fromLTWH(300, 400, 160, 96), title: 'Test App', items: [
                MenuItem('Open', () => menuOpen++),
                MenuItem('Move', () {}),
              ]),
            ),
          );
        }),
      ),
    ));
    await t.sendKeyEvent(LogicalKeyboardKey.tab); // give the card the focus
    await t.pump();
    expect(find.text('Move'), findsNothing);

    await holdOk(t);
    expect(find.text('Move'), findsOneWidget, reason: 'the menu is open');
    expect(opened, 0, reason: 'the app did not open');
    expect(menuOpen, 0, reason: 'the held OK did not press Open in the menu');

    // A new press on Open does open it.
    await t.sendKeyEvent(LogicalKeyboardKey.select);
    await t.pumpAndSettle();
    expect(menuOpen, 1);
    expect(find.text('Move'), findsNothing);
  });

  testWidgets('a short OK on an app opens it', (t) async {
    var opened = 0, held = 0;
    await t.pumpWidget(MaterialApp(
      home: Scaffold(body: Center(child: AppCard(look: const CardLook(label: 'A'), geo: g, onOpen: () => opened++, onHold: () => held++))),
    ));
    await t.sendKeyEvent(LogicalKeyboardKey.tab);
    await t.pump();
    await t.sendKeyEvent(LogicalKeyboardKey.select);
    await t.pump();
    expect(opened, 1);
    expect(held, 0);
  });

  testWidgets('Down from the name field reaches Save with the remote', (t) async {
    String? result = 'not closed';
    late BuildContext ctx;
    await t.pumpWidget(MaterialApp(home: Scaffold(body: Builder(builder: (c) {
      ctx = c;
      return const SizedBox.expand();
    }))));
    final f = askName(ctx, g, title: 'New Profile');
    f.then((v) => result = v);
    await t.pumpAndSettle();
    await t.enterText(find.byType(TextField), 'Anna');
    await t.pump();
    await t.sendKeyEvent(LogicalKeyboardKey.arrowDown); // to Cancel or Save
    await t.pump();
    await t.sendKeyEvent(LogicalKeyboardKey.arrowRight); // to Save (no-op if already there)
    await t.pump();
    await t.sendKeyEvent(LogicalKeyboardKey.select);
    await t.pumpAndSettle();
    expect(result, 'Anna');
  });
}
