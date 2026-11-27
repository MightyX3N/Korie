import 'dart:async';
import 'dart:convert';
import 'dart:io';
import 'dart:isolate';

import 'package:lua_dart/lua_dart.dart';

import 'lua_values.dart';

/// Everything a worker needs to start one add-on, sent to its isolate.
class WorkerStart {
  WorkerStart({
    required this.toHost,
    required this.dir,
    required this.dataDir,
    required this.addon,
    required this.uses,
    required this.settings,
    required this.device,
    this.caFile,
  });
  final SendPort toHost;
  final String dir, dataDir;
  final Map<String, Object?> addon; // {id, name, version, dir}
  final List<String> uses;
  final Map<String, Object?> settings; // current values, defaults filled in
  final Map<String, Object?> device;
  final String? caFile; // tests only: extra certificate authorities
}

/// The Korie API as the add-on sees it. Every call that waits (the internet, a question on
/// screen, the player) yields the add-on's coroutine with a request; the worker does it and
/// resumes the coroutine with the answer, so add-ons write plain sequential code.
const _prelude = r'''
local SENT = "\0korie"
local co_yield, co_resume, co_create, co_status = coroutine.yield, coroutine.resume, coroutine.create, coroutine.status
local pack, unpack = table.pack, table.unpack

local function req(op, ...) return co_yield(SENT, op, ...) end

-- An add-on's own coroutines pass Korie's requests on to the worker.
local function pass(co, r)
  while r[1] and r[2] == SENT and co_status(co) == "suspended" do
    r = pack(co_resume(co, co_yield(unpack(r, 2, r.n))))
  end
  return r
end
function coroutine.resume(co, ...) local r = pass(co, pack(co_resume(co, ...))) return unpack(r, 1, r.n) end
function coroutine.wrap(f)
  local co = co_create(f)
  return function(...)
    local r = pass(co, pack(co_resume(co, ...)))
    if not r[1] then error(r[2], 2) end
    return unpack(r, 2, r.n)
  end
end

local handlers, timers, next_timer = {}, {}, 0
local addon, device, j = __addon, __device, json
__addon, __device = nil, nil

local function copy(t) local c = {} for k, v in pairs(t) do c[k] = v end return c end

korie = {
  addon = addon,
  on = function(name, fn) handlers[name] = fn; __handles_changed() end,
  http = {
    get = function(url, o) o = o or {} return req("http", { url = url, method = "GET", headers = o.headers, timeout = o.timeout }) end,
    post = function(url, body, o) o = o or {} return req("http", { url = url, method = "POST", body = body, headers = o.headers, timeout = o.timeout }) end,
    request = function(t) return req("http", t) end,
  },
  json = {
    decode = function(s) return j.decode(s) end,
    encode = function(v) return j.encode(v) end,
  },
  store = {
    get = function(k, d) local v = __store_get(k) if v == nil then return d end return v end,
    set = function(k, v) __store_set(k, v) end,
    remove = function(k) __store_set(k, nil) end,
  },
  setting = function(k) return __setting(k) end,
  set_setting = function(k, v) __set_setting(k, v) return req("set_setting", k, v) end,
  refresh = function() return req("refresh") end,
  play = function(t) return req("play", t) end,
  stop = function() return req("stop") end,
  open = function(t) return req("open", t) end,
  browse = function(t) if type(t) == "string" then t = { url = t } end return req("browse", t) end,
  apps = {
    list = function() return req("apps.list") end,
    open = function(pkg) return req("apps.open", pkg) end,
  },
  ask = function(t) return req("ask", t) end,
  net = { broadcast = function(port, msg, secs) return req("broadcast", port, msg, secs) end },
  profile = function() return req("profile") end,
  profiles = {
    list = function() return req("profiles.list") end,
    add = function(name, extra) return req("profiles.add", name, extra) end,
  },
  -- New in Korie 2: tell Korie something changed, so it asks again (island, home, setup, ...).
  update = function(what, value) return req("update", what, value) end,
  toast = function(text) return req("toast", tostring(text)) end,
  log = function(...)
    local t = pack(...)
    for i = 1, t.n do t[i] = tostring(t[i]) end
    __log(table.concat(t, " ", 1, t.n))
  end,
  timer = function(seconds, fn, rep)
    next_timer = next_timer + 1
    timers[next_timer] = { fn = fn, rep = rep and true or false }
    __timer_start(next_timer, seconds, rep and true or false)
    return next_timer
  end,
  cancel = function(id) timers[id] = nil; __timer_cancel(id) end,
  device = function() return copy(device) end,
}
print = korie.log

-- require: only files from the add-on's own folder.
local loaded = {}
function require(name)
  if loaded[name] ~= nil then return loaded[name] end
  local src = __module(name)
  if not src then error("module '" .. tostring(name) .. "' not found in the add-on", 2) end
  local fn, err = load(src, "@" .. name:gsub("%.", "/") .. ".lua", "t")
  if not fn then error(err, 2) end
  local v = fn(name)
  if v == nil then v = true end
  loaded[name] = v
  return v
end

function __korie_start(kind, key, n, args)
  local fn
  if kind == "event" then
    fn = handlers[key]
  elseif kind == "timer" then
    local t = timers[key]
    if t then fn = t.fn if not t.rep then timers[key] = nil end end
  end
  if not fn then return nil end
  return co_create(function() return fn(unpack(args, 1, n)) end)
end

function __korie_handles()
  local t = {}
  for k in pairs(handlers) do t[#t + 1] = k end
  table.sort(t)
  return t
end
''';

const _sentinel = '\u0000korie';

/// Runs one add-on. Started with [Isolate.spawn]; talks to the host with plain messages:
///
/// host → worker: ['call', id, kind, name, args] · ['answer', id, values] · ['settings', map]
/// worker → host: ['ready', handles] · ['handles', list] · ['result', id, value, error]
///                ['req', id, op, args] · ['busy'] · ['idle'] · ['log', text] · ['failed', why]
Future<void> addonWorkerMain(WorkerStart s) async {
  final inbox = ReceivePort();
  final host = s.toHost;
  host.send(['port', inbox.sendPort]);
  final w = _Worker(s);
  // Listen first: main.lua may already wait for Korie's answers while it loads.
  inbox.listen((m) {
    if (m is! List || m.isEmpty) return;
    switch (m[0]) {
      case 'call':
        w.call(m[1] as int, m[2] as String, m[3] as String, (m[4] as List?) ?? const []);
      case 'answer':
        w.answer(m[1] as int, (m[2] as List?) ?? const [null]);
      case 'settings':
        w.settings
          ..clear()
          ..addAll((m[1] as Map).cast<String, Object?>());
      case 'stop':
        w.dispose();
        inbox.close();
    }
  });
  try {
    await w.start();
  } catch (e) {
    host.send(['failed', '$e']);
    inbox.close();
  }
}

class _Worker {
  _Worker(this.s) : settings = Map.of(s.settings);
  final WorkerStart s;
  final Map<String, Object?> settings;
  late final LuaState ls;
  late final Map<String, Object?> store;
  late final HttpClient http;
  final timers = <int, Timer>{};
  final waiting = <int, Completer<List<Object?>>>{};
  var nextReq = 1;
  List<String> lastHandles = const [];

  SendPort get host => s.toHost;

  void log(String text) => host.send(['log', text]);

  Future<void> start() async {
    await LuaState.loadRuntime();
    ls = LuaState.newState(memoryLimit: 96 << 20);
    ls.openLibs(sandbox: true);

    final ctx = SecurityContext(withTrustedRoots: true);
    if (s.caFile != null) ctx.setTrustedCertificates(s.caFile!);
    http = HttpClient(context: ctx)
      ..findProxy = HttpClient.findProxyFromEnvironment
      ..connectionTimeout = const Duration(seconds: 10)
      ..userAgent = 'Korie/2 (${s.addon['id']})';

    final storeFile = File('${s.dataDir}/store.json');
    try {
      store = storeFile.existsSync()
          ? (jsonDecode(storeFile.readAsStringSync()) as Map).cast<String, Object?>()
          : <String, Object?>{};
    } catch (_) {
      store = <String, Object?>{};
    }

    pushValue(ls, s.addon);
    ls.setGlobal('__addon');
    pushValue(ls, s.device);
    ls.setGlobal('__device');
    ls.register('__store_get', (l) {
      pushValue(l, store[l.checkString(1)]);
      return 1;
    });
    ls.register('__store_set', (l) {
      final k = l.checkString(1);
      final v = readValue(l, 2);
      if (v == null) {
        store.remove(k);
      } else {
        store[k] = v;
      }
      saveStore(); // at once: a stuck add-on is stopped without warning
      return 0;
    });
    ls.register('__setting', (l) {
      pushValue(l, settings[l.checkString(1)]);
      return 1;
    });
    ls.register('__set_setting', (l) {
      settings[l.checkString(1)] = readValue(l, 2);
      return 0;
    });
    ls.register('__log', (l) {
      log(l.toStr(1) ?? '');
      return 0;
    });
    ls.register('__handles_changed', (l) {
      scheduleMicrotask(sendHandles);
      return 0;
    });
    ls.register('__timer_start', (l) {
      final id = l.checkInteger(1);
      final secs = l.toNumber(2);
      final rep = l.toBoolean(3);
      final d = Duration(milliseconds: (secs * 1000).clamp(10, 864000000).round());
      timers[id]?.cancel();
      timers[id] = rep
          ? Timer.periodic(d, (_) => run('timer', id, const [], null))
          : Timer(d, () {
              timers.remove(id);
              run('timer', id, const [], null);
            });
      return 0;
    });
    ls.register('__timer_cancel', (l) {
      timers.remove(l.checkInteger(1))?.cancel();
      return 0;
    });
    ls.register('__module', (l) {
      final name = l.checkString(1);
      if (!RegExp(r'^[A-Za-z0-9_]+(\.[A-Za-z0-9_]+)*$').hasMatch(name)) {
        l.pushNil();
        return 1;
      }
      final f = File('${s.dir}/${name.replaceAll('.', '/')}.lua');
      l.pushString(f.existsSync() ? f.readAsStringSync() : null);
      return 1;
    });

    if (!ls.doString(_prelude, chunkName: '=korie')) {
      throw StateError('prelude: ${ls.toStr(-1)}');
    }

    // main.lua runs as a coroutine too, so it may already ask for things while loading.
    final main = File('${s.dir}/main.lua');
    if (ls.loadString(main.readAsStringSync(), chunkName: '@${s.addon['id']}/main.lua') !=
        ThreadStatus.luaOk) {
      throw StateError(ls.toStr(-1) ?? 'main.lua does not compile');
    }
    final th = ls.newThread();
    ls.insert(-2); // thread below the function
    ls.xmove(th, 1); // the function onto the thread
    final ref = ls.ref(luaRegistryIndex); // keeps the thread alive
    final (ok, _, err) = await drive(th, 0);
    ls.unRef(luaRegistryIndex, ref);
    if (!ok) throw StateError(err ?? 'main.lua failed');
    host.send(['ready', handles()]);
    lastHandles = handles();
  }

  List<String> handles() {
    ls.getGlobal('__korie_handles');
    if (ls.pCall(0, 1, 0) != ThreadStatus.luaOk) {
      ls.pop(1);
      return const [];
    }
    final v = readValue(ls, -1);
    ls.pop(1);
    return v is List ? v.cast<String>() : const [];
  }

  void sendHandles() {
    final h = handles();
    if (h.join(',') == lastHandles.join(',')) return;
    lastHandles = h;
    host.send(['handles', h]);
  }

  /// Runs a handler or timer as a new coroutine; [callId] null for timers.
  Future<void> run(String kind, Object key, List args, int? callId) async {
    ls.getGlobal('__korie_start');
    ls.pushString(kind);
    if (key is int) {
      ls.pushInteger(key);
    } else {
      ls.pushString('$key');
    }
    ls.pushInteger(args.length);
    pushValue(ls, args);
    if (ls.pCall(4, 1, 0) != ThreadStatus.luaOk || ls.isNil(-1)) {
      final err = ls.isNil(-1) ? null : ls.toStr(-1);
      ls.pop(1);
      if (callId != null) host.send(['result', callId, null, err ?? 'no-handler']);
      return;
    }
    final th = ls.toThread(-1)!;
    final ref = ls.ref(luaRegistryIndex);
    final (ok, value, err) = await drive(th, 0);
    ls.unRef(luaRegistryIndex, ref);
    if (!ok) log('$kind $key failed: $err');
    if (callId != null) host.send(['result', callId, value, ok ? null : err]);
  }

  void call(int id, String kind, String name, List args) => run(kind, name, args, id);

  /// Resumes [th] until it finishes, doing each request it yields.
  Future<(bool, Object?, String?)> drive(LuaState th, int nArgs) async {
    while (true) {
      host.send(const ['busy']);
      final (st, n) = th.resume(nArgs);
      host.send(const ['idle']);
      if (st == ThreadStatus.luaOk) {
        final v = n > 0 ? readValue(th, -n) : null;
        th.setTop(0);
        return (true, v, null);
      }
      if (st != ThreadStatus.luaYield) {
        final err = th.toStr(-1) ?? st.name;
        th.setTop(0);
        return (false, null, err);
      }
      if (n < 2 || th.toStr(-n) != _sentinel) {
        th.setTop(0);
        return (false, null, 'coroutine.yield outside a coroutine of the add-on');
      }
      final op = th.toStr(-n + 1)!;
      final args = [for (var i = n - 2; i >= 1; i--) readValue(th, -i)];
      th.setTop(0);
      List<Object?> answer;
      try {
        answer = await perform(op, args);
      } catch (e) {
        answer = [null, '$e'];
      }
      for (final a in answer) {
        pushValue(th, a);
      }
      nArgs = answer.length;
    }
  }

  bool allowed(String use) => s.uses.contains(use);

  Future<List<Object?>> perform(String op, List<Object?> a) async {
    switch (op) {
      case 'http':
        if (!allowed('internet')) return [null, 'add "internet" to uses in addon.json'];
        return httpRequest(a.isNotEmpty && a[0] is Map ? (a[0] as Map) : const {});
      case 'broadcast':
        if (!allowed('internet')) return [null, 'add "internet" to uses in addon.json'];
        return [await broadcast(a[0] as int, '${a[1]}', ((a.length > 2 ? a[2] : null) as num? ?? 2).toDouble())];
      case 'open' || 'apps.list' || 'apps.open':
        if (!allowed('apps')) return [null, 'add "apps" to uses in addon.json'];
        return askHost(op, a);
      default:
        return askHost(op, a);
    }
  }

  Future<List<Object?>> askHost(String op, List<Object?> args) {
    final id = nextReq++;
    final c = Completer<List<Object?>>();
    waiting[id] = c;
    host.send(['req', id, op, args]);
    return c.future;
  }

  void answer(int id, List values) => waiting.remove(id)?.complete(values.cast<Object?>());

  Future<List<Object?>> httpRequest(Map t) async {
    final url = '${t['url'] ?? ''}';
    final uri = Uri.tryParse(url);
    if (uri == null || !(uri.isScheme('http') || uri.isScheme('https'))) {
      return [null, 'not a web address: $url'];
    }
    final timeout = Duration(milliseconds: (((t['timeout'] as num?) ?? 20) * 1000).round());
    try {
      final rq = await http
          .openUrl('${t['method'] ?? 'GET'}'.toUpperCase(), uri)
          .timeout(timeout);
      final headers = t['headers'];
      if (headers is Map) {
        headers.forEach((k, v) => rq.headers.set('$k', '$v'));
      }
      final body = t['body'];
      if (body != null) {
        final text = body is String ? body : jsonEncode(jsonable(body));
        if (body is! String && rq.headers.contentType == null) {
          rq.headers.contentType = ContentType.json;
        }
        final bytes = utf8.encode(text);
        rq.contentLength = bytes.length;
        rq.add(bytes);
      }
      final rs = await rq.close().timeout(timeout);
      final bytes = await rs.fold<List<int>>(<int>[], (b, c) => b..addAll(c)).timeout(timeout);
      final h = <String, Object?>{};
      rs.headers.forEach((k, v) => h[k.toLowerCase()] = v.join(', '));
      return [
        {
          'status': rs.statusCode,
          'ok': rs.statusCode >= 200 && rs.statusCode < 300,
          'body': utf8.decode(bytes, allowMalformed: true),
          'headers': h,
        },
      ];
    } on TimeoutException {
      return [null, 'timed out'];
    } catch (e) {
      return [null, e is SocketException ? 'no connection (${e.message})' : '$e'];
    }
  }

  Future<List<Object?>> broadcast(int port, String message, double seconds) async {
    final out = <Object?>[];
    RawDatagramSocket? sock;
    try {
      sock = await RawDatagramSocket.bind(InternetAddress.anyIPv4, 0);
      sock.broadcastEnabled = true;
      final done = Completer<void>();
      sock.listen((e) {
        if (e != RawSocketEvent.read) return;
        final d = sock!.receive();
        if (d == null) return;
        out.add({'address': d.address.address, 'text': utf8.decode(d.data, allowMalformed: true)});
      });
      sock.send(utf8.encode(message), InternetAddress('255.255.255.255'), port);
      Timer(Duration(milliseconds: (seconds.clamp(0.2, 10) * 1000).round()), done.complete);
      await done.future;
    } catch (e) {
      log('broadcast: $e');
    } finally {
      sock?.close();
    }
    return out;
  }

  void saveStore() {
    try {
      Directory(s.dataDir).createSync(recursive: true);
      final f = File('${s.dataDir}/store.json.tmp');
      f.writeAsStringSync(jsonEncode(jsonable(store)));
      f.renameSync('${s.dataDir}/store.json');
    } catch (e) {
      log('store: $e');
    }
  }

  void dispose() {
    for (final t in timers.values) {
      t.cancel();
    }
    http.close(force: true);
  }
}
