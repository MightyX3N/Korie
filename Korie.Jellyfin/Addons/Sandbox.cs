using System.Diagnostics;
using System.Text.Json;
using System.Text.Json.Nodes;
using MoonSharp.Interpreter;

namespace Korie.Jellyfin.Addons;

/// <summary>
/// One add-on's Lua, in MoonSharp. Add-ons get the basic functions, string, table, math and bit32:
/// no files, no os, no loading code. Each call has a time limit, so a broken or hostile add-on
/// stops itself, never Jellyfin. One call at a time per add-on (Lua isn't thread-safe).
/// </summary>
public sealed class Sandbox
{
    private const int CallMs = 3000;
    private const int MaxString = 16 * 1024 * 1024;

    private readonly Script _script;
    private readonly Table _module;
    private readonly SemaphoreSlim _lock = new(1, 1);

    private Sandbox(Script script, Table module)
    {
        _script = script;
        _module = module;
    }

    public static Sandbox Load(string id, string code, Action<string> log)
    {
        var modules = CoreModules.Basic | CoreModules.GlobalConsts | CoreModules.TableIterators | CoreModules.Metatables
            | CoreModules.String | CoreModules.Table | CoreModules.Math | CoreModules.Bit32 | CoreModules.ErrorHandling;
        var script = new Script(modules);
        script.Options.DebugPrint = s => log(s);
        // no way back to the real world, and no giant strings
        script.Globals["collectgarbage"] = DynValue.Nil;
        var rep = script.Globals.Get("string").Table.Get("rep");
        script.Globals.Get("string").Table["rep"] = DynValue.NewCallback((ctx, args) =>
        {
            var s = args.AsType(0, "rep", DataType.String, false).String;
            var n = args.AsType(1, "rep", DataType.Number, false).Number;
            var sep = args.Count > 2 && args[2].Type == DataType.String ? args[2].String : "";
            if (n * (s.Length + sep.Length) > MaxString)
            {
                throw new ScriptRuntimeException("string.rep: result would be too large");
            }

            return ctx.GetScript().Call(rep, args.GetArray());
        });
        var mod = Run(script, script.LoadString(code, null, id), []);
        if (mod.Type != DataType.Table)
        {
            throw new InvalidOperationException(id + ": main.lua must return a table of functions");
        }

        return new Sandbox(script, mod.Table);
    }

    public bool Has(string fn) => _module.Get(fn).Type == DataType.Function;

    /// <summary>Calls module.fn(args...) and returns its answer as JSON (null for nil).</summary>
    public async Task<JsonNode?> Call(string fn, params JsonNode?[] args)
    {
        var f = _module.Get(fn);
        if (f.Type != DataType.Function)
        {
            throw new AddonException("has no " + fn + "()");
        }

        await _lock.WaitAsync().ConfigureAwait(false);
        try
        {
            var lua = args.Select(a => LuaJson.ToLua(_script, a, true)).ToArray();
            return LuaJson.ToJson(Run(_script, f, lua));
        }
        catch (InterpreterException e)
        {
            throw new AddonException(e.DecoratedMessage ?? e.Message);
        }
        finally
        {
            _lock.Release();
        }
    }

    /// <summary>Runs a function as a coroutine that yields every so often, to check the time limit.</summary>
    private static DynValue Run(Script script, DynValue fn, DynValue[] args)
    {
        var co = script.CreateCoroutine(fn);
        co.Coroutine.AutoYieldCounter = 20000;
        var clock = Stopwatch.StartNew();
        var r = co.Coroutine.Resume(args);
        while (r.Type == DataType.YieldRequest)
        {
            if (clock.ElapsedMilliseconds > CallMs)
            {
                throw new AddonException("the add-on took too long");
            }

            r = co.Coroutine.Resume();
        }

        return r;
    }
}

public class AddonException(string message) : Exception(message);

/// <summary>Plain data between JSON and Lua. Lua has no null: in a list it becomes false, in a table it's left out.</summary>
internal static class LuaJson
{
    /// <summary>A number from JSON, whether it arrived as a whole number or not.</summary>
    public static double? Num(JsonNode? v)
    {
        if (v is not JsonValue jv)
        {
            return null;
        }

        if (jv.TryGetValue<double>(out var d))
        {
            return d;
        }

        if (jv.TryGetValue<long>(out var l))
        {
            return l;
        }

        if (jv.TryGetValue<int>(out var i))
        {
            return i;
        }

        if (jv.TryGetValue<JsonElement>(out var e) && e.ValueKind == JsonValueKind.Number)
        {
            return e.GetDouble();
        }

        return null;
    }

    public static DynValue ToLua(Script s, JsonNode? v, bool inList)
    {
        switch (v)
        {
            case null:
                return inList ? DynValue.False : DynValue.Nil;
            case JsonArray a:
            {
                var t = new Table(s);
                for (var i = 0; i < a.Count; i++)
                {
                    t[i + 1] = ToLua(s, a[i], true);
                }

                return DynValue.NewTable(t);
            }

            case JsonObject o:
            {
                var t = new Table(s);
                foreach (var (k, x) in o)
                {
                    var lv = ToLua(s, x, false);
                    if (!lv.IsNil())
                    {
                        t[k] = lv;
                    }
                }

                return DynValue.NewTable(t);
            }

            case JsonValue jv when jv.TryGetValue<bool>(out var b):
                return DynValue.NewBoolean(b);
            case JsonValue jv when jv.TryGetValue<double>(out var d):
                return DynValue.NewNumber(d);
            case JsonValue jv when jv.TryGetValue<long>(out var l):
                return DynValue.NewNumber(l);
            default:
                return DynValue.NewString(v.ToString());
        }
    }

    public static JsonNode? ToJson(DynValue v, int depth = 0)
    {
        if (depth > 40)
        {
            return null;
        }

        switch (v.Type)
        {
            case DataType.Boolean:
                return JsonValue.Create(v.Boolean);
            case DataType.Number:
                var n = v.Number;
                return Math.Abs(n % 1) < double.Epsilon && Math.Abs(n) < 9e15 ? JsonValue.Create((long)n) : JsonValue.Create(n);
            case DataType.String:
                return JsonValue.Create(v.String);
            case DataType.Tuple:
                return v.Tuple.Length > 0 ? ToJson(v.Tuple[0], depth) : null;
            case DataType.Table:
                var t = v.Table;
                var len = t.Length;
                // a list (1..n) or an empty table is an array, anything else an object
                if (len > 0 || !t.Pairs.Any())
                {
                    var a = new JsonArray();
                    for (var i = 1; i <= len; i++)
                    {
                        a.Add(ToJson(t.Get(i), depth + 1));
                    }

                    return a;
                }

                var o = new JsonObject();
                foreach (var p in t.Pairs)
                {
                    var key = p.Key.Type == DataType.String ? p.Key.String : p.Key.Type == DataType.Number ? p.Key.Number.ToString(System.Globalization.CultureInfo.InvariantCulture) : null;
                    if (key is null || p.Value.Type is DataType.Function or DataType.ClrFunction)
                    {
                        continue;
                    }

                    o[key] = ToJson(p.Value, depth + 1);
                }

                return o;
            default:
                return null;
        }
    }
}
