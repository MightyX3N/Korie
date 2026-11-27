import 'package:lua_dart/lua_dart.dart';

/// Lua values <-> plain Dart values: null, bool, int, double, String, List and Map.
/// These are the only kinds that travel between an add-on's worker and Korie.
///
/// A table with keys 1..n becomes a List; any other table a Map whose integer keys stay ints,
/// so an item table comes back to the add-on exactly as it was given.

void pushValue(LuaState ls, Object? v, [int depth = 0]) {
  if (depth > 40) return ls.pushNil();
  if (v == null) {
    ls.pushNil();
  } else if (v is bool) {
    ls.pushBoolean(v);
  } else if (v is int) {
    ls.pushInteger(v);
  } else if (v is num) {
    ls.pushNumber(v.toDouble());
  } else if (v is String) {
    ls.pushString(v);
  } else if (v is List) {
    ls.createTable(v.length, 0);
    for (var i = 0; i < v.length; i++) {
      pushValue(ls, v[i], depth + 1);
      ls.rawSetI(-2, i + 1);
    }
  } else if (v is Map) {
    ls.createTable(0, v.length);
    v.forEach((k, val) {
      if (k is int) {
        pushValue(ls, val, depth + 1);
        ls.rawSetI(-2, k);
      } else {
        ls.pushString(k.toString());
        pushValue(ls, val, depth + 1);
        ls.rawSet(-3);
      }
    });
  } else {
    ls.pushString(v.toString());
  }
}

Object? readValue(LuaState ls, int idx, [int depth = 0]) {
  switch (ls.type(idx)) {
    case LuaType.luaBoolean:
      return ls.toBoolean(idx);
    case LuaType.luaNumber:
      return ls.isInteger(idx) ? ls.toInteger(idx) : ls.toNumber(idx);
    case LuaType.luaString:
      return ls.toStr(idx);
    case LuaType.luaTable:
      if (depth > 40) return null;
      final abs = ls.absIndex(idx);
      final map = <Object, Object?>{};
      var maxInt = 0;
      var allInts = true;
      ls.pushNil();
      while (ls.next(abs)) {
        Object key;
        if (ls.type(-2) == LuaType.luaNumber && ls.isInteger(-2)) {
          final k = ls.toInteger(-2);
          key = k;
          if (k > maxInt) maxInt = k;
          if (k < 1) allInts = false;
        } else if (ls.type(-2) == LuaType.luaString) {
          key = ls.toStr(-2)!;
          allInts = false;
        } else {
          ls.pop(1); // functions, tables or booleans as keys do not travel
          continue;
        }
        final v = readValue(ls, -1, depth + 1);
        if (v != null) map[key] = v;
        ls.pop(1);
      }
      if (map.isEmpty) return <String, Object?>{};
      if (allInts && maxInt == map.length) {
        return [for (var i = 1; i <= maxInt; i++) map[i]];
      }
      if (map.keys.every((k) => k is String)) return map.cast<String, Object?>();
      return map;
    default:
      return null; // nil, functions, threads, userdata
  }
}

/// The same value with every Map key as text, for jsonEncode.
Object? jsonable(Object? v) {
  if (v is List) return [for (final x in v) jsonable(x)];
  if (v is Map) return {for (final e in v.entries) '${e.key}': jsonable(e.value)};
  return v;
}
