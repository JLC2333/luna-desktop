import { useState, useEffect } from "react";
import { listen } from "@tauri-apps/api/event";
import { invoke } from "@tauri-apps/api/core";
import ChatPage from "./pages/ChatPage";
import CharactersPage from "./pages/CharactersPage";
import WorldsPage from "./pages/WorldsPage";
import SettingsPage from "./pages/SettingsPage";
import UserProfilePage from "./pages/UserProfilePage";
import MemoriesPage from "./pages/MemoriesPage";
import Live2DWidget from "./components/Live2DWidget";
import MascotGate, { isMascotEnabled, loadMascotCode } from "./components/MascotGate";
import { useSettingsStore } from "./stores/settingsStore";
import type { ThemeMode } from "./stores/settingsStore";
import { getSettings } from "./utils/db";
import { generateDiary } from "./utils/diary";

type Page = "chat" | "characters" | "memories" | "worlds" | "user" | "settings";

/** 根据 theme 模式判断是否应用 dark class */
function applyThemeClass(theme: ThemeMode) {
  const root = document.documentElement;
  if (theme === "dark") {
    root.classList.add("dark");
  } else if (theme === "light") {
    root.classList.remove("dark");
  } else {
    const prefersDark = window.matchMedia("(prefers-color-scheme: dark)").matches;
    root.classList.toggle("dark", prefersDark);
  }
}

function App() {
  const [currentPage, setCurrentPage] = useState<Page>("chat");
  const { theme, settings, activeProfile, updateSettings, setProfiles, setActiveProfile, setReady, diaryMaxLength, bindSystemClock } = useSettingsStore();
  const [quitDialog, setQuitDialog] = useState<"confirm" | "writing" | "done" | null>(null);
  const [diaryStatus, setDiaryStatus] = useState("");
  const [mascotVisible, setMascotVisible] = useState(false);
  const [showMascotGate, setShowMascotGate] = useState(false);

  // 启动时加载设置 + API 配置 + 应用主题 + 监听退出事件

  // 自动注册已安装的 Live2D 模型
  useEffect(() => {
    if (!isMascotEnabled()) return;
    invoke("list_installed_models").then((list: any) => {
      if (list && list.length > 0) {
        const l2d = (window as any).LunaL2D;
        if (l2d && l2d.registerModel) {
          list.forEach((m: any) => {
            l2d.registerModel(m.dir_name, m.dir_name + '.model3.json', m.dir_name);
          });
        }
      }
    }).catch(() => {});
  }, []);
  // 安全安装调试日志拦截器（延迟到组件挂载后执行，避免模块层报错白屏）
  useEffect(() => {
    import("./utils/logger").then(({ installInterceptors }) => {
      try { installInterceptors(); } catch (e) { console.warn("[logger] installInterceptors failed:", e); }
    }).catch((e) => console.warn("[logger] dynamic import failed:", e));
  }, []);
  useEffect(() => {
    async function init() {
      const data = await getSettings();
      if (data) updateSettings(data);
      try {
        const { getApiProfiles } = await import("./utils/db");
        const profiles = await getApiProfiles();
        setProfiles(profiles);
        const def = profiles.find((p: any) => p.is_default) || profiles[0] || null;
        if (def) setActiveProfile(def);
      } catch (e) {
        console.error("加载 API 配置失败:", e);
      }
      setReady();
      // 从数据库加载邀请码
      loadMascotCode().catch(() => {});
    }
    init();
    applyThemeClass(theme);

    // 监听系统主题变化
    const mq = window.matchMedia("(prefers-color-scheme: dark)");
    function onSystemThemeChange() {
      const current = useSettingsStore.getState().theme;
      if (current === "auto") document.documentElement.classList.toggle("dark", mq.matches);
    }
    mq.addEventListener("change", onSystemThemeChange);

    // 监听托盘「退出」事件
    const unlisten = listen("quit-requested", () => {
      // 防抖：对话框已显示时忽略重复退出请求
      setQuitDialog((prev) => prev === null ? "confirm" : prev);
    });

    return () => {
      mq.removeEventListener("change", onSystemThemeChange);
      unlisten.then((fn) => fn());
    };
  }, []);

  // theme 状态变化时同步 DOM
  useEffect(() => { applyThemeClass(theme); }, [theme]);

  // 确认退出 → 写日记 → 退出
  async function handleConfirmQuit() {
    const apiSettings = {
      endpoint: activeProfile?.endpoint || settings.endpoint,
      api_key: activeProfile?.api_key || settings.api_key,
      model: activeProfile?.model || settings.model,
      temperature: activeProfile?.temperature ?? settings.temperature,
      max_tokens: activeProfile?.max_tokens ?? settings.max_tokens,
      user_name: settings.user_name || "",
      user_persona: settings.user_persona || "",
      system_prompt: activeProfile?.system_prompt || settings.system_prompt,
    };

    // 没有配置 API 时跳过日记生成，直接退出
    if (!apiSettings.model || !apiSettings.endpoint) {
      await invoke("exit_app");
      return;
    }

    setQuitDialog("writing");
    setDiaryStatus("正在整理今日对话...");

    // 最多等 15 秒，超时自动退出（避免 API 不可用时卡住）
    const timeout = new Promise((resolve) => setTimeout(() => resolve({ message: "超时，跳过日记" }), 15000));
    const result: any = await Promise.race([generateDiary({
      bindSystemClock,
      diaryMaxLength,
      settings: apiSettings,
      onStatus: (msg) => setDiaryStatus(msg),
    }), timeout]);

    setDiaryStatus(result.message);
    await invoke("exit_app");
  }

  const tabs: { id: Page; label: string }[] = [
    { id: "chat", label: "聊天" },
    { id: "characters", label: "角色" },
    { id: "memories", label: "记忆" },
    { id: "worlds", label: "世界" },
    { id: "user", label: "我的" },
    { id: "settings", label: "设置" },
  ];

  return (
    <div className="h-screen w-screen flex flex-col overflow-hidden">
      {/* Topbar */}
      <header className="h-12 bg-luna-bg/95 border-b border-luna-border flex items-center px-5 sticky top-0 z-50 backdrop-blur-xl">
        <div className="flex items-center gap-2.5 flex-shrink-0 mr-8">
          <div className="w-7 h-7 rounded-full bg-gradient-to-br from-[#667eea] to-[#764ba2] flex items-center justify-center text-white text-base">
            <svg viewBox="0 0 24 24" width="16" height="16" fill="white"><path d="M21 12.79A9 9 0 1 1 11.21 3 7 7 0 0 0 21 12.79z"/></svg>
          </div>
          <span className="text-base font-semibold text-luna-text tracking-tight">LunA</span>
        </div>
        <nav className="flex gap-1">
          {tabs.map((tab) => (
            <button
              key={tab.id}
              onClick={() => setCurrentPage(tab.id)}
              className={`px-4 py-1.5 rounded-md text-sm transition-all ${
                currentPage === tab.id
                  ? "bg-luna-accent-light text-luna-accent font-medium"
                  : "text-luna-text-secondary hover:bg-luna-bg-tertiary hover:text-luna-text"
              }`}
            >
              {tab.label}
            </button>
          ))}
        </nav>
        {/* 看板娘按钮 */}
        <div className="ml-auto flex items-center gap-3">
          <button
            onClick={async () => {
              if (isMascotEnabled()) {
                try {
                  const v = await invoke<boolean>("toggle_mascot");
                  setMascotVisible(v);
                } catch (e) { console.error("看板娘窗口失败:", e); }
              } else {
                setShowMascotGate(true);
              }
            }}
            className={`w-7 h-7 rounded-full flex items-center justify-center text-sm transition-all ${
              mascotVisible
                ? "bg-luna-accent/20 text-luna-accent"
                : "bg-luna-bg-tertiary text-luna-text-tertiary hover:bg-luna-accent/10 hover:text-luna-accent"
            }`}
            title={mascotVisible ? "关闭看板娘" : "看板娘"}
          >
            🎀
          </button>
          <span className="text-sm text-luna-text-tertiary">v1.1.5 Beta</span>
        </div>
      </header>

      {/* Page Content */}
      <main className="flex-1 overflow-hidden">
        {currentPage === "chat" && <ChatPage />}
        {currentPage === "characters" && <CharactersPage />}
        {currentPage === "memories" && <MemoriesPage />}
        {currentPage === "worlds" && <WorldsPage />}
        {currentPage === "user" && <UserProfilePage />}
        {currentPage === "settings" && <SettingsPage />}
      </main>

      {/* 退出确认弹窗 */}
      {quitDialog === "confirm" && (
        <div className="fixed inset-0 bg-black/40 flex items-center justify-center z-[9999]">
          <div className="bg-luna-bg border border-luna-border rounded-xl p-6 max-w-sm w-full mx-4 shadow-xl" onClick={(e) => e.stopPropagation()}>
            <div className="text-base font-semibold text-luna-text mb-2">退出 LunA</div>
            <p className="text-sm text-luna-text-secondary mb-4">
              角色会先写好今天的日记再退出，请稍等片刻。请不要强行关闭，否则可能导致记忆混乱。
            </p>
            <div className="flex gap-2.5 justify-end">
              <button onClick={() => setQuitDialog(null)}
                className="px-4 py-2 border border-luna-border rounded-md bg-luna-bg text-sm text-luna-text-secondary hover:bg-luna-bg-secondary transition-colors">
                取消
              </button>
              <button onClick={handleConfirmQuit}
                className="px-4 py-2 bg-luna-accent text-white rounded-md text-sm font-medium hover:bg-[#3C3489] transition-colors">
                确认退出
              </button>
            </div>
          </div>
        </div>
      )}

      {/* 看板娘改为独立窗口，旧的内嵌 Widget 废弃 */}
      <Live2DWidget visible={false} />

      {/* 邀请码门禁 */}
      {showMascotGate && (
        <MascotGate onClose={() => {
          setShowMascotGate(false);
          if (isMascotEnabled()) setMascotVisible(true);
        }} />
      )}

      {/* 写日记中弹窗 */}
      {quitDialog === "writing" && (
        <div className="fixed inset-0 bg-black/40 flex items-center justify-center z-[9999]">
          <div className="bg-luna-bg border border-luna-border rounded-xl p-6 max-w-sm w-full mx-4 shadow-xl text-center">
            <div className="text-3xl mb-3">📖</div>
            <div className="text-sm font-semibold text-luna-text mb-1">角色正在写日记...</div>
            <p className="text-xs text-luna-text-tertiary mb-3">{diaryStatus}</p>
            <div className="flex justify-center gap-1 py-2">
              <span className="w-2 h-2 rounded-full bg-luna-accent animate-bounce" />
              <span className="w-2 h-2 rounded-full bg-luna-accent animate-bounce [animation-delay:0.15s]" />
              <span className="w-2 h-2 rounded-full bg-luna-accent animate-bounce [animation-delay:0.3s]" />
            </div>
            <p className="text-[11px] text-luna-text-tertiary mb-3">请勿强行关闭，以免记忆混乱</p>
            <button onClick={() => invoke("exit_app")}
              className="px-4 py-1.5 border border-luna-border rounded-md bg-luna-bg text-sm text-luna-text-secondary hover:bg-luna-bg-secondary transition-colors">
              跳过日记，直接退出
            </button>
          </div>
        </div>
      )}
    </div>
  );
}

export default App;
