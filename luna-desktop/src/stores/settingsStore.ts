import { create } from "zustand";
import { ApiSettings, ApiProfile, ProactiveSettings, DEFAULT_PROACTIVE } from "../types";

export type ThemeMode = "light" | "dark" | "auto";

export type LunaCustomColors = {
  bg: string;
  "bg-secondary": string;
  "bg-tertiary": string;
  text: string;
  "text-secondary": string;
  accent: string;
};

const CUSTOM_COLORS_KEY = "luna-custom-colors";

export function loadCustomColors(): LunaCustomColors | null {
  try {
    const raw = localStorage.getItem(CUSTOM_COLORS_KEY);
    return raw ? JSON.parse(raw) : null;
  } catch {
    return null;
  }
}

export function saveCustomColors(colors: LunaCustomColors) {
  localStorage.setItem(CUSTOM_COLORS_KEY, JSON.stringify(colors));
}

export function applyCustomColors(colors: LunaCustomColors) {
  const root = document.querySelector(".dark") as HTMLElement | null;
  if (!root) return;
  root.style.setProperty("--luna-bg", colors.bg);
  root.style.setProperty("--luna-bg-secondary", colors["bg-secondary"]);
  root.style.setProperty("--luna-bg-tertiary", colors["bg-tertiary"]);
  root.style.setProperty("--luna-text", colors.text);
  root.style.setProperty("--luna-text-secondary", colors["text-secondary"]);
  root.style.setProperty("--luna-accent", colors.accent);
}

export function resetCustomColors() {
  localStorage.removeItem(CUSTOM_COLORS_KEY);
  const root = document.querySelector(".dark") as HTMLElement | null;
  if (!root) return;
  root.style.removeProperty("--luna-bg");
  root.style.removeProperty("--luna-bg-secondary");
  root.style.removeProperty("--luna-bg-tertiary");
  root.style.removeProperty("--luna-text");
  root.style.removeProperty("--luna-text-secondary");
  root.style.removeProperty("--luna-accent");
}

interface SettingsState {
  settings: ApiSettings;
  profiles: ApiProfile[];
  activeProfile: ApiProfile | null;
  theme: ThemeMode;
  ready: boolean;
  formatAssistantReply: boolean;
  bindSystemClock: boolean;
  diaryMaxLength: number;
  proactive: ProactiveSettings;
  updateSettings: (settings: Partial<ApiSettings>) => void;
  setProfiles: (profiles: ApiProfile[]) => void;
  setActiveProfile: (profile: ApiProfile | null) => void;
  setTheme: (theme: ThemeMode) => void;
  setReady: () => void;
  setFormatAssistantReply: (value: boolean) => void;
  setBindSystemClock: (value: boolean) => void;
  setDiaryMaxLength: (value: number) => void;
  setProactive: (value: Partial<ProactiveSettings>) => void;
}

const defaultSettings: ApiSettings = {
  id: 1,
  endpoint: "http://127.0.0.1:1234/v1",
  api_key: "lm-studio",
  model: "",
  temperature: 0.7,
  max_tokens: 2000,
  system_prompt: "",
  user_name: "",
  user_persona: "",
};

function loadProactive(): ProactiveSettings {
  try {
    const raw = localStorage.getItem("luna-proactive");
    if (raw) {
      const parsed = JSON.parse(raw);
      // 兼容旧版 null 值 → 空字符串
      if (parsed.silentStart === null) parsed.silentStart = "";
      if (parsed.silentEnd === null) parsed.silentEnd = "";
      return { ...DEFAULT_PROACTIVE, ...parsed };
    }
  } catch {}
  return DEFAULT_PROACTIVE;
}

export const useSettingsStore = create<SettingsState>((set) => ({
  settings: defaultSettings,
  profiles: [],
  activeProfile: null,
  ready: false,
  formatAssistantReply: localStorage.getItem("luna-format-reply") !== "false",
  bindSystemClock: localStorage.getItem("luna-bind-clock") !== "false",
  diaryMaxLength: parseInt(localStorage.getItem("luna-diary-length") || "200", 10),
  theme: (localStorage.getItem("luna-theme") as ThemeMode) || "light",
  proactive: loadProactive(),
  updateSettings: (newSettings) =>
    set((state) => ({
      settings: { ...state.settings, ...newSettings },
    })),
  setProfiles: (profiles) => set({ profiles }),
  setActiveProfile: (activeProfile) => set({ activeProfile }),
  setTheme: (theme) => {
    localStorage.setItem("luna-theme", theme);
    set({ theme });
  },
  setReady: () => set({ ready: true }),
  setDiaryMaxLength: (value) => {
    localStorage.setItem("luna-diary-length", value.toString());
    set({ diaryMaxLength: value });
  },
  setFormatAssistantReply: (value) => {
    localStorage.setItem("luna-format-reply", value ? "true" : "false");
    set({ formatAssistantReply: value });
  },
  setBindSystemClock: (value) => {
    localStorage.setItem("luna-bind-clock", value ? "true" : "false");
    set({ bindSystemClock: value });
  },
  setProactive: (value) => {
    set((state) => {
      const next = { ...state.proactive, ...value };
      localStorage.setItem("luna-proactive", JSON.stringify(next));
      return { proactive: next };
    });
  },
}));
