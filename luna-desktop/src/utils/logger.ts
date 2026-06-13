/**
 * 调试日志系统 — 拦截 console / IPC / fetch / 事件，环形缓冲区存储
 */

export type LogLevel = "log" | "info" | "warn" | "error" | "ipc" | "fetch" | "event" | "l2d";

export interface LogEntry {
  id: number;
  ts: string;
  level: LogLevel;
  msg: string;
  detail?: string;
}

const MAX_LOGS = 2000;
let _logs: LogEntry[] = [];
let _id = 0;
let _listeners: Array<() => void> = [];
let _originalConsole: Record<string, (...args: any[]) => void> = {};
let _originalInvoke: any = null;
let _originalFetch: any = null;
let _originalImageSrc: any = null;

function now() {
  const d = new Date();
  return d.toLocaleTimeString("zh-CN", { hour12: false }) + "." + String(d.getMilliseconds()).padStart(3, "0");
}

function push(level: LogLevel, msg: string, detail?: string) {
  _logs.push({ id: _id++, ts: now(), level, msg, detail: detail || undefined });
  if (_logs.length > MAX_LOGS) _logs.splice(0, _logs.length - MAX_LOGS);
  _listeners.forEach((fn) => fn());
}

/** 订阅日志更新 */
export function subscribe(fn: () => void) {
  _listeners.push(fn);
  return () => { _listeners = _listeners.filter((f) => f !== fn); };
}

/** 获取当前日志快照 */
export function getLogs(): LogEntry[] {
  return _logs.slice();
}

/** 清空日志 */
export function clearLogs() {
  _logs = [];
  _id = 0;
  _listeners.forEach((fn) => fn());
}

/** 手动写一条日志 */
export function log(level: LogLevel, msg: string, detail?: string) {
  push(level, msg, detail);
}

// ─── 拦截器安装 ───

export function installInterceptors() {
  // 1. 拦截 console（每个方法单独 try-catch，避免一个失败导致全部不工作）
  const levels: LogLevel[] = ["log", "info", "warn", "error"];
  levels.forEach((level) => {
    try {
      const orig = (console as any)[level];
      if (typeof orig !== "function") return;
      _originalConsole[level] = orig.bind(console);
      (console as any)[level] = function (...args: any[]) {
        try {
          const msg = args.map((a: any) => (typeof a === "object" ? safeStringify(a) : String(a))).join(" ");
          push(level, msg);
        } catch (_) {}
        try { _originalConsole[level](...args); } catch (_) {}
      };
    } catch (e) {
      // 单独跳过失败的 console 层级
    }
  });

  // 2. 拦截 Tauri IPC
  try {
    if (typeof window !== "undefined" && (window as any).__TAURI__?.core?.invoke) {
      const core = (window as any).__TAURI__.core;
      _originalInvoke = core.invoke.bind(core);
      core.invoke = async function (cmd: string, args?: any) {
        try { push("ipc", `→ ${cmd}`, args ? safeStringify(args).slice(0, 500) : undefined); } catch (_) {}
        const start = performance.now();
        try {
          const result = await _originalInvoke(cmd, args);
          const elapsed = (performance.now() - start).toFixed(0);
          try { push("ipc", `← ${cmd} (${elapsed}ms)`, result !== undefined ? safeStringify(result).slice(0, 300) : undefined); } catch (_) {}
          return result;
        } catch (e: any) {
          const elapsed = (performance.now() - start).toFixed(0);
          try { push("error", `✗ ${cmd} (${elapsed}ms)`, String(e).slice(0, 500)); } catch (_) {}
          throw e;
        }
      };
    }
  } catch (e) {
    console.warn("[logger] IPC interceptor failed:", e);
  }

  // 3. 拦截 fetch（捕获 luna-model:// 请求）
  try {
    if (typeof window !== "undefined") {
      _originalFetch = window.fetch.bind(window);
      window.fetch = async function (input: RequestInfo | URL, init?: RequestInit) {
        try {
          const url = typeof input === "string" ? input : input instanceof Request ? input.url : String(input);
          if (url.includes("luna-model://") || url.includes("/live2d/model/")) {
            try { push("fetch", url.slice(0, 200)); } catch (_) {}
            try {
              const resp = await _originalFetch(input, init);
              try { push("fetch", `✓ ${resp.status} ${url.slice(0, 150)}`, resp.ok ? undefined : `status: ${resp.status}`); } catch (_) {}
              return resp;
            } catch (e: any) {
              try { push("error", `✗ fetch ${url.slice(0, 150)}`, String(e).slice(0, 300)); } catch (_) {}
              throw e;
            }
          }
          return _originalFetch(input, init);
        } catch (e) {
          // 如果包装器本身出错，回退到原始 fetch
          return _originalFetch(input, init);
        }
      };
    }
  } catch (e) {
    console.warn("[logger] fetch interceptor failed:", e);
  }

  // 4. 拦截点击事件（记录按钮/元素点击）
  try {
    if (typeof document !== "undefined") {
      document.addEventListener("click", function (e: MouseEvent) {
        try {
          const target = e.target as HTMLElement;
          let text = "";
          if (target) {
            text = target.textContent?.trim()?.slice(0, 60) || "";
            const id = target.id || "";
            const cls = Array.from(target.classList).join(".");
            const tag = target.tagName?.toLowerCase() || "";
            const detail = [tag, id ? `#${id}` : "", cls ? `.${cls}` : "", text ? `"${text}"` : ""].filter(Boolean).join(" ");
            push("event", `🖱 ${detail.slice(0, 120)}`);
          }
        } catch (_) {}
      }, true);
    }
  } catch (e) {
    console.warn("[logger] click interceptor failed:", e);
  }

  // 5. 监听看板娘窗口转发的日志事件
  try {
    if (typeof window !== "undefined" && (window as any).__TAURI__?.event?.listen) {
      (window as any).__TAURI__.event.listen("luna:log", (e: any) => {
        try {
          const p = e.payload;
          const level = (p.level === "error" ? "error" : p.level === "warn" ? "warn" : "l2d") as LogLevel;
          push(level, `[L2D] ${p.msg}`, p.detail || undefined);
        } catch (_) {}
      });
    }
  } catch (e) {
    console.warn("[logger] luna:log listener failed:", e);
  }
}

function safeStringify(obj: any): string {
  try {
    return JSON.stringify(obj, (key, val) => {
      if (typeof val === "string" && val.length > 200) return val.slice(0, 200) + "...";
      return val;
    }, 2);
  } catch {
    return String(obj);
  }
}
