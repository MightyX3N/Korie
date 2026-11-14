// A Lua 5.4 state for one add-on (wasmoon: real Lua compiled to WebAssembly).
// Add-ons get base, string, table, math and utf8 only: no files, no os, no
// loading code. Each call has a time limit and the state a memory limit, so a
// broken or hostile add-on stops itself, never Korie.
import { LuaFactory, type LuaEngine } from "wasmoon";

const factory = new LuaFactory();
const CALL_MS = 3000;
const MEMORY = 64 * 1024 * 1024;

const SETUP = `
local error, type, rawget, setmetatable = error, type, rawget, setmetatable
local srep = string.rep
local MAX_STRING = 16 * 1024 * 1024
dofile, loadfile, load, loadstring, require, collectgarbage = nil, nil, nil, nil, nil, nil
io, os, package, debug, coroutine = nil, nil, nil, nil, coroutine
string.dump = nil
_G.setmetatable = function(t, mt)
  if type(mt) == "table" and (rawget(mt, "__gc") ~= nil or rawget(mt, "__close") ~= nil) then
    error("__gc and __close are not available to add-ons", 2)
  end
  return setmetatable(t, mt)
end
string.rep = function(s, n, sep)
  local len = #tostring(s) + (sep and #tostring(sep) or 0)
  if type(n) == "number" and n * len > MAX_STRING then error("string.rep: result would be too large", 2) end
  return srep(s, n, sep)
end
`;

export class Sandbox {
  private engine: LuaEngine;
  private module: Record<string, unknown>;

  private constructor(engine: LuaEngine, module: Record<string, unknown>) {
    this.engine = engine;
    this.module = module;
  }

  static async load(id: string, code: string, log: (msg: string) => void): Promise<Sandbox> {
    const engine = await factory.createEngine({ openStandardLibs: true, injectObjects: false, enableProxy: false, traceAllocations: true, functionTimeout: CALL_MS });
    engine.global.setMemoryMax(MEMORY);
    await engine.doString(SETUP);
    engine.global.set("print", (...args: unknown[]) => log(args.map((a) => (typeof a === "object" ? JSON.stringify(a) : String(a))).join(" ")));
    engine.global.setTimeout(Date.now() + CALL_MS);
    let mod: unknown;
    try {
      mod = await engine.doString(code);
    } finally {
      engine.global.setTimeout(undefined);
    }
    if (!mod || typeof mod !== "object") {
      engine.global.close();
      throw new Error(`${id}: main.lua must return a table of functions`);
    }
    // keep the add-on's table in Lua; JS only names the functions
    engine.global.set("__korie_mod", mod);
    return new Sandbox(engine, mod as Record<string, unknown>);
  }

  has(fn: string): boolean {
    return typeof this.module[fn] === "function";
  }

  functions(): string[] {
    return Object.keys(this.module).filter((k) => typeof this.module[k] === "function");
  }

  /** Calls module.fn(...args); throws with the add-on's error text. */
  async call(fn: string, args: unknown[]): Promise<unknown> {
    const f = this.module[fn];
    if (typeof f !== "function") throw new Error(`has no ${fn}()`);
    this.engine.global.setTimeout(Date.now() + CALL_MS);
    try {
      return await (f as (...a: unknown[]) => unknown)(...args.map(plain));
    } finally {
      this.engine.global.setTimeout(undefined);
    }
  }

  close(): void {
    try {
      this.engine.global.close();
    } catch {
      /* already closed */
    }
  }
}

/** Only plain data goes into Lua. Lua has no null: a missing answer in a list
 *  becomes false (so `if a then` and `type(a) == "table"` both skip it), and
 *  a null field is left out. */
function plain(v: unknown): unknown {
  const clean = (x: unknown, inList: boolean): unknown => {
    if (x === null || x === undefined) return inList ? false : undefined;
    if (Array.isArray(x)) return x.map((y) => clean(y, true));
    if (typeof x === "object") {
      const o: Record<string, unknown> = {};
      for (const [k, y] of Object.entries(x)) {
        const c = clean(y, false);
        if (c !== undefined) o[k] = c;
      }
      return o;
    }
    return x;
  };
  return clean(JSON.parse(JSON.stringify(v ?? null)), true);
}
