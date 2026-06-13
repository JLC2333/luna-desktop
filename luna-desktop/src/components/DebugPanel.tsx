import { useState, useEffect, useRef } from "react";
import { subscribe, getLogs, clearLogs, type LogEntry, type LogLevel } from "../utils/logger";

const LEVEL_COLORS: Record<LogLevel, string> = {
  log: "#888",
  info: "#4fc3f7",
  warn: "#ffa726",
  error: "#ef5350",
  ipc: "#81c784",
  fetch: "#ce93d8",
  event: "#ffd54f",
  l2d: "#f48fb1",
};

const LEVEL_LABELS: Record<LogLevel, string> = {
  log: "LOG",
  info: "INF",
  warn: "WRN",
  error: "ERR",
  ipc: "IPC",
  fetch: "FET",
  event: "EVT",
  l2d: "L2D",
};

export default function DebugPanel() {
  const [logs, setLogs] = useState<LogEntry[]>([]);
  const [filter, setFilter] = useState<LogLevel | "all">("all");
  const [autoScroll, setAutoScroll] = useState(true);
  const bottomRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    setLogs(getLogs());
    return subscribe(() => {
      setLogs(getLogs());
    });
  }, []);

  useEffect(() => {
    if (autoScroll) {
      bottomRef.current?.scrollIntoView({ behavior: "smooth" });
    }
  }, [logs, autoScroll]);

  const filtered = filter === "all" ? logs : logs.filter((l) => l.level === filter);

  const levels: { key: LogLevel | "all"; label: string }[] = [
    { key: "all", label: "全部" },
    { key: "error", label: "错误" },
    { key: "ipc", label: "IPC" },
    { key: "fetch", label: "加载" },
    { key: "l2d", label: "L2D" },
    { key: "warn", label: "警告" },
    { key: "log", label: "日志" },
  ];

  return (
    <div className="border border-luna-border rounded-lg overflow-hidden font-mono text-xs">
      {/* 工具栏 */}
      <div className="flex items-center gap-1.5 px-3 py-2 bg-luna-bg-secondary border-b border-luna-border flex-wrap">
        <span className="text-luna-text-tertiary text-[10px] mr-1">🔍</span>
        {levels.map((lv) => (
          <button
            key={lv.key}
            onClick={() => setFilter(lv.key)}
            className={`px-2 py-0.5 rounded text-[10px] transition-colors ${
              filter === lv.key
                ? "bg-luna-accent text-white"
                : "text-luna-text-secondary hover:bg-luna-bg-tertiary"
            }`}
          >
            {lv.label}
          </button>
        ))}
        <div className="flex-1" />
        <label className="flex items-center gap-1 text-[10px] text-luna-text-tertiary cursor-pointer">
          <input type="checkbox" checked={autoScroll} onChange={(e) => setAutoScroll(e.target.checked)} />
          自动滚动
        </label>
        <button
          onClick={clearLogs}
          className="px-2 py-0.5 rounded text-[10px] text-luna-text-tertiary hover:text-luna-red hover:bg-red-900/10 transition-colors"
        >
          清空
        </button>
      </div>

      {/* 日志列表 */}
      <div
        className="h-[400px] overflow-y-auto p-2 bg-black/40"
        style={{ scrollBehavior: "auto" }}
      >
        {filtered.length === 0 ? (
          <div className="text-center text-luna-text-tertiary py-8 text-[11px]">
            {logs.length === 0 ? "等待日志..." : "无匹配条目"}
          </div>
        ) : (
          filtered.map((entry) => (
            <div key={entry.id} className="flex gap-2 leading-[18px] hover:bg-white/5 px-1 rounded">
              <span className="text-luna-text-tertiary shrink-0 w-[70px] text-[10px]">{entry.ts}</span>
              <span
                className="shrink-0 w-[26px] text-center rounded text-[9px] font-bold"
                style={{ color: LEVEL_COLORS[entry.level], backgroundColor: LEVEL_COLORS[entry.level] + "20" }}
              >
                {LEVEL_LABELS[entry.level]}
              </span>
              <span className="text-luna-text-secondary break-all flex-1" style={{ color: LEVEL_COLORS[entry.level] }}>
                {entry.msg}
              </span>
              {entry.detail && (
                <span className="text-luna-text-tertiary text-[10px] truncate max-w-[200px] shrink-0" title={entry.detail}>
                  {entry.detail}
                </span>
              )}
            </div>
          ))
        )}
        <div ref={bottomRef} />
      </div>
    </div>
  );
}
