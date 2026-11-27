// Setup pages with the remote: a question an add-on asks while the page waits for it keeps the
// focus (typing goes into it, Down reaches its buttons), and PINs work with the number keys.
import 'package:flutter/services.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:korie/addons/korie_ui.dart';
import 'package:korie/screens/setup_page.dart';
import 'package:shared_preferences/shared_preferences.dart';
import 'package:korie/screens/signin.dart';
import 'package:korie/store.dart';
import 'package:korie/ui/ask.dart';
import 'package:material_ui/material_ui.dart';

void main() {
  testWidgets('a text question over a busy setup page keeps the focus', (t) async {
    t.view.physicalSize = const Size(1280, 720);
    t.view.devicePixelRatio = 1;
    final busy = ValueNotifier(false);
    final chosen = <String>[];
    late BuildContext ctx;
    await t.pumpWidget(MaterialApp(
      home: ValueListenableBuilder(
        valueListenable: busy,
        builder: (c, b, _) {
          ctx = c;
          return SetupPage(
            title: 'Connect to Jellyfin',
            rows: const [SetupRow('type', 'Type an Address…'), SetupRow('skip', 'Skip')],
            busy: b,
            onChoose: chosen.add,
          );
        },
      ),
    ));
    await t.pumpAndSettle();
    await t.sendKeyEvent(LogicalKeyboardKey.select);
    await t.pumpAndSettle();
    expect(chosen, ['type']);
    // The add-on works, then asks.
    // In the same frame, as on the TV: the add-on answers before the page is drawn greyed out.
    busy.value = true;
    final answer = askText(ctx, title: 'Server Address');
    await t.pumpAndSettle();
    busy.value = true; // rebuilt while the question is open
    await t.pumpAndSettle();
    expect(FocusManager.instance.primaryFocus?.context?.findAncestorWidgetOfExactType<TextField>(), isNotNull,
        reason: 'focus is on ${FocusManager.instance.primaryFocus}');
    await t.enterText(find.byType(TextField), '10.0.2.2:8096');
    await t.sendKeyEvent(LogicalKeyboardKey.arrowDown);
    await t.pumpAndSettle();
    // Down went to the question's buttons, not to the page behind it.
    final focusedText = find.descendant(of: find.byElementPredicate((e) => e == FocusManager.instance.primaryFocus!.context), matching: find.byType(Text));
    expect(t.widgetList<Text>(focusedText).map((w) => w.data).toList(), anyOf(contains('Save'), contains('Cancel')));
    await t.sendKeyEvent(LogicalKeyboardKey.arrowRight);
    await t.pumpAndSettle();
    await t.sendKeyEvent(LogicalKeyboardKey.select);
    await t.pumpAndSettle();
    expect(await answer, '10.0.2.2:8096');
    expect(chosen, ['type'], reason: 'the page behind got no key');
  });

  testWidgets('an add-on question (korie.ask with input) over a busy setup page keeps the focus', (t) async {
    t.view.physicalSize = const Size(1280, 720);
    t.view.devicePixelRatio = 1;
    SharedPreferences.setMockInitialValues({});
    final store = await Store.open();
    final nav = GlobalKey<NavigatorState>();
    final ui = KorieAddonUi(store, nav);
    final busy = ValueNotifier(false);
    Future<Object?>? answer;
    await t.pumpWidget(MaterialApp(
      navigatorKey: nav,
      home: ValueListenableBuilder(
        valueListenable: busy,
        builder: (c, b, _) => SetupPage(
          title: 'Connect to Jellyfin',
          rows: const [SetupRow('type', 'Type an Address…'), SetupRow('skip', 'Skip')],
          busy: b,
          onChoose: (id) {
            busy.value = true;
            answer = ui.request('jellyfin', 'ask', [
              {'title': 'Server Address', 'message': 'The IP address', 'input': 'text'},
            ]).then((v) => v.first);
          },
        ),
      ),
    ));
    await t.pumpAndSettle();
    await t.sendKeyDownEvent(LogicalKeyboardKey.select);
    await t.pump();
    await t.sendKeyUpEvent(LogicalKeyboardKey.select);
    await t.pumpAndSettle();
    final f = FocusManager.instance.primaryFocus;
    expect(f?.context?.findAncestorWidgetOfExactType<TextField>(), isNotNull, reason: 'focus: ${f?.context?.widget.runtimeType} in ${f?.context == null ? null : ModalRoute.of(f!.context!)}');
    await t.enterText(find.byType(TextField), '10.0.2.2:8096');
    await t.sendKeyEvent(LogicalKeyboardKey.arrowDown);
    await t.pumpAndSettle();
    await t.sendKeyEvent(LogicalKeyboardKey.arrowRight);
    await t.pumpAndSettle();
    await t.sendKeyEvent(LogicalKeyboardKey.select);
    await t.pumpAndSettle();
    expect(await answer, '10.0.2.2:8096');
  });

  testWidgets('PIN pad: number keys and the on-screen keys', (t) async {
    t.view.physicalSize = const Size(1280, 720);
    t.view.devicePixelRatio = 1;
    final p = Profile('p1', 'Anna', 1, pin: '2580');
    late BuildContext ctx;
    await t.pumpWidget(MaterialApp(home: Builder(builder: (c) {
      ctx = c;
      return const SizedBox();
    })));
    final r = Navigator.of(ctx).push<bool>(MaterialPageRoute(builder: (_) => PinPad(profile: p, check: p.pin)));
    await t.pumpAndSettle();
    expect(find.text('Enter Anna’s PIN'), findsOneWidget);
    for (final k in [LogicalKeyboardKey.digit1, LogicalKeyboardKey.digit1, LogicalKeyboardKey.digit1, LogicalKeyboardKey.digit1]) {
      await t.sendKeyEvent(k);
    }
    await t.pumpAndSettle();
    expect(find.text('Wrong PIN'), findsOneWidget);
    // 2 with the remote's arrows: focus starts on 1, Right goes to 2.
    await t.sendKeyEvent(LogicalKeyboardKey.arrowRight);
    await t.pumpAndSettle();
    await t.sendKeyEvent(LogicalKeyboardKey.select);
    for (final k in [LogicalKeyboardKey.digit5, LogicalKeyboardKey.numpad8, LogicalKeyboardKey.digit0]) {
      await t.sendKeyEvent(k);
    }
    await t.pumpAndSettle();
    expect(await r, true);
  });
}
