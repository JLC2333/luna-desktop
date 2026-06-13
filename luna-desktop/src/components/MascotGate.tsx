import { useState, useEffect, useCallback } from "react";
import { getAppConfig, setAppConfig } from "../utils/db";

const STORAGE_KEY = "luna-mascot-code";

// 预置的邀请码（后期可以改成服务端验证）
const VALID_CODES: Record<string, string> = {
  TEST123: "测试邀请码",
  LUNA2026: "内测邀请码",
};

// 内存中的验证状态（isMascotEnabled 是同步的，所以用全局变量缓存）
let _cachedCode: string | null = null;
let _cacheLoaded = false;

/** 从数据库加载并缓存邀请码 */
export async function loadMascotCode(): Promise<string | null> {
  try {
    const code = await getAppConfig(STORAGE_KEY);
    _cachedCode = code;
    _cacheLoaded = true;
    // 同步到 localStorage 作为备份
    if (code) {
      localStorage.setItem(STORAGE_KEY, code);
    } else {
      localStorage.removeItem(STORAGE_KEY);
    }
    return code;
  } catch {
    // 兜底：读 localStorage
    _cachedCode = localStorage.getItem(STORAGE_KEY);
    _cacheLoaded = true;
    return _cachedCode;
  }
}

/** 获取已保存的邀请码（同步，从缓存读取） */
export function getMascotCode(): string | null {
  if (_cacheLoaded) return _cachedCode;
  // 缓存未加载时从 localStorage 兜底
  _cachedCode = localStorage.getItem(STORAGE_KEY);
  _cacheLoaded = true;
  return _cachedCode;
}

/** 检查邀请码是否有效 */
export function isMascotEnabled(): boolean {
  const code = getMascotCode();
  return code !== null && code in VALID_CODES;
}

/** 清除邀请码（数据和缓存） */
export async function clearMascotCode(): Promise<void> {
  const { deleteAppConfig } = await import("../utils/db");
  try {
    await deleteAppConfig(STORAGE_KEY);
  } catch {}
  _cachedCode = null;
  localStorage.removeItem(STORAGE_KEY);
}

interface MascotGateProps {
  onClose: () => void;
}

/** 邀请码输入弹窗 */
export default function MascotGate({ onClose }: MascotGateProps) {
  const [input, setInput] = useState("");
  const [error, setError] = useState("");

  const handleSubmit = useCallback(async () => {
    const code = input.trim().toUpperCase();
    if (!code) {
      setError("请输入邀请码");
      return;
    }
    if (code in VALID_CODES) {
      localStorage.setItem(STORAGE_KEY, code);
      _cachedCode = code;
      try {
        await setAppConfig(STORAGE_KEY, code);
      } catch {}
      onClose();
    } else {
      setError("邀请码无效，请重试");
    }
  }, [input, onClose]);

  // Enter 提交
  useEffect(() => {
    function onKeyDown(e: KeyboardEvent) {
      if (e.key === "Enter") handleSubmit();
      if (e.key === "Escape") onClose();
    }
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [handleSubmit, onClose]);

  return (
    <div className="fixed inset-0 bg-black/40 flex items-center justify-center z-[9999]">
      <div
        className="bg-luna-bg border border-luna-border rounded-xl p-6 max-w-sm w-full mx-4 shadow-xl"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="text-base font-semibold text-luna-text mb-2">
          🎀 看板娘功能
        </div>
        <p className="text-sm text-luna-text-secondary mb-4">
          此功能为邀请制。请输入你的邀请码以开启看板娘。
        </p>
        <input
          type="text"
          value={input}
          onChange={(e) => { setInput(e.target.value); setError(""); }}
          placeholder="请输入邀请码"
          className="w-full py-2 px-3 bg-luna-bg border border-luna-border rounded-md text-sm text-luna-text outline-none focus:border-luna-accent mb-2"
          autoFocus
        />
        {error && (
          <p className="text-xs text-luna-red mb-2">{error}</p>
        )}
        <div className="flex gap-2.5 justify-end mt-3">
          <button
            onClick={onClose}
            className="px-4 py-2 border border-luna-border rounded-md bg-luna-bg text-sm text-luna-text-secondary hover:bg-luna-bg-secondary transition-colors"
          >
            取消
          </button>
          <button
            onClick={handleSubmit}
            className="px-4 py-2 bg-luna-accent text-white rounded-md text-sm font-medium hover:bg-[#3C3489] transition-colors"
          >
            提交
          </button>
        </div>
      </div>
    </div>
  );
}
