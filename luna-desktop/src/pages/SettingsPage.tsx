import { useState, useEffect, useRef } from "react";
import { invoke } from "@tauri-apps/api/core";
import { useSettingsStore } from "../stores/settingsStore";
import { getSettings, updateSettings, getApiProfiles, addApiProfile, updateApiProfile, deleteApiProfile, setDefaultApiProfile, getTrashChats, recoverChat, emptyTrash } from "../utils/db";
import type { ApiProfile, ApiProviderTemplate } from "../types";
import { API_PROVIDERS } from "../constants/apiProviders";
import { isMascotEnabled, clearMascotCode } from "../components/MascotGate";
import DebugPanel from "../components/DebugPanel";
import ModelsPanel from "../components/ModelsPanel";

type SettingsTab = "general" | "api" | "appearance" | "prompt" | "trash" | "models" | "about";
const DIARY_PRESETS = new Set([100, 200, 300, 400, 500, 1000]);
const NARRATION_PRESETS = new Set([1, 3, 5, 10, 15, 30, 60, 120]);

function ClearAllDataSection() {
  const [step, setStep] = useState(0);
  const [confirmText, setConfirmText] = useState("");
  const [busy, setBusy] = useState(false);
  const [done, setDone] = useState(false);

  const handleClear = async () => {
    setBusy(true);
    try {
      await invoke("clear_all_data");
      // 清除 L2D 邀请码（数据库 + 缓存）
      await clearMascotCode();
      // 清除 localStorage 中的应用设置
      localStorage.removeItem("luna-default-model");
      localStorage.removeItem("luna-theme");
      localStorage.removeItem("luna-diary-length");
      localStorage.removeItem("luna-format-reply");
      localStorage.removeItem("luna-bind-clock");
      localStorage.removeItem("luna-proactive");
      localStorage.removeItem("luna-custom-colors");
      setDone(true);
      setStep(0);
    } catch (e) {
      alert(`清除失败: ${e}`);
    }
    setBusy(false);
  };

  if (done) {
    return (
      <div className="rounded-lg bg-green-900/20 border border-green-900/40 p-4">
        <p className="text-sm text-green-400">✅ 所有数据已清除，请重启应用。</p>
      </div>
    );
  }

  return (
    <div className="space-y-3">
      <div className="flex items-center justify-between">
        <div>
          <p className="text-sm font-medium text-red-400">清除所有数据</p>
          <p className="text-xs text-luna-text-tertiary">删除所有角色、对话、记忆、日记、模型</p>
        </div>
        {step === 0 && (
          <button
            onClick={() => setStep(1)}
            className="px-3 py-1.5 border border-red-900/50 text-red-400 rounded-md text-xs hover:bg-red-900/20"
          >
            清除数据
          </button>
        )}
      </div>

      {step === 1 && (
        <div className="bg-red-900/10 border border-red-900/40 rounded-lg p-4 space-y-3">
          <p className="text-sm text-red-300 font-medium">⚠️ 确认清除（1/3）</p>
          <p className="text-xs text-luna-text-secondary">
            此操作将删除<strong>所有</strong>本地数据，包括角色卡、对话记录、记忆、日记、世界观和已导入的模型。<br/>
            此操作<strong>不可恢复</strong>。
          </p>
          <div className="flex gap-2">
            <button onClick={() => setStep(2)}
              className="px-3 py-1.5 bg-red-600 text-white rounded-md text-xs hover:bg-red-700"
            >
              继续
            </button>
            <button onClick={() => setStep(0)}
              className="px-3 py-1.5 border border-luna-border rounded-md text-xs text-luna-text-secondary hover:bg-luna-bg-tertiary"
            >
              取消
            </button>
          </div>
        </div>
      )}

      {step === 2 && (
        <div className="bg-red-900/10 border border-red-900/40 rounded-lg p-4 space-y-3">
          <p className="text-sm text-red-300 font-medium">⚠️ 最终确认（2/3）</p>
          <p className="text-xs text-luna-text-secondary">
            数据删除后无法找回。确定要继续吗？
          </p>
          <div className="flex gap-2">
            <button onClick={() => setStep(3)}
              className="px-3 py-1.5 bg-red-600 text-white rounded-md text-xs hover:bg-red-700"
            >
              我确定
            </button>
            <button onClick={() => setStep(0)}
              className="px-3 py-1.5 border border-luna-border rounded-md text-xs text-luna-text-secondary hover:bg-luna-bg-tertiary"
            >
              取消
            </button>
          </div>
        </div>
      )}

      {step === 3 && (
        <div className="bg-red-900/10 border border-red-900/40 rounded-lg p-4 space-y-3">
          <p className="text-sm text-red-300 font-medium">⚠️ 输入确认（3/3）</p>
          <p className="text-xs text-luna-text-secondary">
            请输入 <code className="bg-red-900/30 px-1.5 py-0.5 rounded text-red-300">DELETE</code> 以确认清除所有数据
          </p>
          <div className="flex gap-2">
            <input
              type="text"
              value={confirmText}
              onChange={e => setConfirmText(e.target.value)}
              placeholder="输入 DELETE"
              className="flex-1 py-1.5 px-3 bg-luna-bg border border-luna-border rounded-md text-sm text-luna-text outline-none focus:border-red-600"
            />
            <button
              onClick={handleClear}
              disabled={confirmText !== "DELETE" || busy}
              className="px-3 py-1.5 bg-red-600 text-white rounded-md text-xs hover:bg-red-700 disabled:opacity-50 disabled:cursor-not-allowed"
            >
              {busy ? "清除中..." : "确认清除"}
            </button>
            <button onClick={() => { setStep(0); setConfirmText(""); }}
              className="px-3 py-1.5 border border-luna-border rounded-md text-xs text-luna-text-secondary hover:bg-luna-bg-tertiary"
            >
              取消
            </button>
          </div>
        </div>
      )}
    </div>
  );
}

export default function SettingsPage() {
  const { settings, profiles, theme, updateSettings: updateStore, setProfiles, setActiveProfile, setTheme, formatAssistantReply, setFormatAssistantReply, bindSystemClock, setBindSystemClock, diaryMaxLength, setDiaryMaxLength, proactive, setProactive } = useSettingsStore();
  const [activeTab, setActiveTab] = useState<SettingsTab>("general");
  const [form, setForm] = useState(settings);
  const [saving, setSaving] = useState(false);
  const formRef = useRef(form);
  formRef.current = form;

  // ─── API Profile 相关状态 ───
  const [showProfileModal, setShowProfileModal] = useState(false);
  const [editingProfileId, setEditingProfileId] = useState<number | null>(null);
  const [profileForm, setProfileForm] = useState({
    name: "",
    provider: "custom",
    endpoint: "",
    api_key: "",
    model: "",
  });
  const [profileTesting, setProfileTesting] = useState(false);
  const [profileTestResult, setProfileTestResult] = useState<boolean | null>(null);
  const [profileTestError, setProfileTestError] = useState("");
  const [availableModels, setAvailableModels] = useState<string[]>([]);

  // ─── Provider 选择 ───
  const [selectedProviderId, setSelectedProviderId] = useState("custom");

  // ─── 全局禁止词 ───
  const [bannedGlobal, setBannedGlobal] = useState("");
  const [bannedGlobalSaved, setBannedGlobalSaved] = useState(false);

  // ─── 回收站 ───
  const [trashChats, setTrashChats] = useState<{ id: number; title: string; character_id: number | null; created_at: string; updated_at: string; deleted_at: string }[]>([]);
  const [trashLoaded, setTrashLoaded] = useState(false);
  const [trashActionMsg, setTrashActionMsg] = useState("");
  const [trashConfirmAll, setTrashConfirmAll] = useState(false);

  // ─── Prompt 模块排序 ───
  const [promptBlocks, setPromptBlocks] = useState<{ id: string; enabled: boolean }[]>([]);
  const [promptSaved, setPromptSaved] = useState(false);
  const [promptPreview, setPromptPreview] = useState("");
  const [promptLoading, setPromptLoading] = useState(false);
  const [promptPreviewError, setPromptPreviewError] = useState("");

  function getProviderTemplate(id: string): ApiProviderTemplate | undefined {
    return API_PROVIDERS.find((p) => p.id === id);
  }

  function selectProvider(id: string) {
    setSelectedProviderId(id);
    const tpl = getProviderTemplate(id);
    if (tpl) {
      setProfileForm((f) => ({
        ...f,
        provider: id,
        endpoint: tpl.endpoint,
        name: editingProfileId ? f.name : tpl.name,
        api_key: "",
        model: "",
      }));
    }
    setProfileTestResult(null);
    setAvailableModels([]);
  }

  // ─── 加载数据 ───
  useEffect(() => {
    loadSettings();
    loadProfiles();
    loadBannedGlobal();
    loadPromptOrder();
    return () => {
      const f = formRef.current;
      updateSettings({
        endpoint: f.endpoint,
        api_key: f.api_key,
        model: f.model,
        temperature: f.temperature,
        max_tokens: f.max_tokens,
        system_prompt: f.system_prompt,
      });
      updateStore(f);
    };
  }, []);

  // 切换到回收站 tab 时加载
  useEffect(() => {
    if (activeTab === "trash") {
      loadTrashChats();
    }
  }, [activeTab]);

  // 回收站确认弹窗的键盘支持
  useEffect(() => {
    if (!trashConfirmAll) return;
    function onKeyDown(e: KeyboardEvent) {
      if (e.key === "Enter") {
        e.preventDefault();
        setTrashConfirmAll(false);
        handleEmptyTrash();
      } else if (e.key === "Escape") {
        setTrashConfirmAll(false);
      }
    }
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [trashConfirmAll]);

  async function loadSettings() {
    const data = await getSettings();
    if (data) {
      const newSettings = {
        ...settings,
        endpoint: data.endpoint,
        api_key: data.api_key,
        model: data.model,
        temperature: data.temperature,
        max_tokens: data.max_tokens,
        system_prompt: data.system_prompt,
      };
      setForm(newSettings);
      updateStore(newSettings);
    }
  }

  async function loadProfiles() {
    const list = await getApiProfiles();
    setProfiles(list);
    const def = list.find((p) => p.is_default === 1) || list[0] || null;
    setActiveProfile(def);
  }

  async function loadBannedGlobal() {
    try {
      const content = await invoke<string>("get_banned_global_content");
      setBannedGlobal(content);
    } catch (e) {
      console.warn("加载全局禁止词失败:", e);
    }
  }

  async function saveBannedGlobal(content: string) {
    try {
      await invoke("update_banned_global", { content });
      setBannedGlobalSaved(true);
      setTimeout(() => setBannedGlobalSaved(false), 2000);
    } catch (e) {
      console.error("保存禁止词失败:", e);
    }
  }

  // ─── Prompt 模块排序 ───
  const PROMPT_BLOCK_META: Record<string, { label: string; desc: string }> = {
    user_info: { label: "对话对象", desc: "告诉模型正在和谁对话（用户身份信息）" },
    global_system_prompt: { label: "全局指令", desc: "用户自定义的全局系统提示词" },
    character_identity: { label: "角色身份", desc: "角色名、简介和性格设定（仅可在角色卡中修改）" },
    character_soul: { label: "角色指令", desc: "历次对话中用户对角色提出的角色扮演要求（自动追加）" },
    world_info: { label: "世界信息", desc: "角色所处世界的背景描述" },
    character_stats: { label: "当前属性值", desc: "角色八维属性实时数值，影响回复语气" },
    personality_state: { label: "人格状态", desc: "陪伴卡当前人格，按信任/好感度阈值自动切换" },
    memory: { label: "对话记忆", desc: "关于用户的历史记忆和偏好" },
    diary_context: { label: "角色日记", desc: "角色自己写的日记（压缩过的对话历史）" },
    banned_words: { label: "内容限制", desc: "禁止词和内容约束规则" },
    tools: { label: "可用工具", desc: "模型可调用的工具（write_memory 等）" },
    behavior_rules: { label: "行为规则", desc: "回复格式、行为准则等强制约束" },
  };

  async function loadPromptOrder() {
    try {
      const order = await invoke<{ blocks: { id: string; enabled: boolean }[] }>("get_prompt_order");
      setPromptBlocks(order.blocks);
    } catch (e) {
      console.warn("加载 prompt order 失败:", e);
    }
  }

  async function savePromptOrder(blocks: { id: string; enabled: boolean }[]) {
    try {
      await invoke("set_prompt_order", { order: { blocks } });
      setPromptSaved(true);
      setTimeout(() => setPromptSaved(false), 2000);
    } catch (e) {
      console.error("保存 prompt order 失败:", e);
    }
  }

  function moveBlock(idx: number, dir: -1 | 1) {
    const next = [...promptBlocks];
    const target = idx + dir;
    if (target < 0 || target >= next.length) return;
    [next[idx], next[target]] = [next[target], next[idx]];
    setPromptBlocks(next);
    savePromptOrder(next);
  }

  function toggleBlock(idx: number) {
    const next = promptBlocks.map((b, i) =>
      i === idx ? { ...b, enabled: !b.enabled } : b
    );
    setPromptBlocks(next);
    savePromptOrder(next);
  }

  async function handleResetPrompt() {
    try {
      const order = await invoke<{ blocks: { id: string; enabled: boolean }[] }>("reset_prompt_order");
      setPromptBlocks(order.blocks);
      setPromptSaved(true);
      setTimeout(() => setPromptSaved(false), 2000);
    } catch (e) {
      console.error("重置 prompt order 失败:", e);
    }
  }

  // ─── Profile 操作 ───
  // ─── 回收站 ───
  async function loadTrashChats() {
    try {
      const chats = await getTrashChats();
      setTrashChats(chats);
      setTrashLoaded(true);
    } catch (e) {
      console.warn("加载回收站失败:", e);
    }
  }

  async function handleRecoverChat(chatId: number) {
    await recoverChat(chatId);
    setTrashChats((prev) => prev.filter((c) => c.id !== chatId));
    setTrashActionMsg(`已恢复对话`);
    setTimeout(() => setTrashActionMsg(""), 2000);
  }

  async function handleEmptyTrash(chatId?: number) {
    await emptyTrash(chatId);
    if (chatId) {
      setTrashChats((prev) => prev.filter((c) => c.id !== chatId));
      setTrashActionMsg(`已永久删除`);
    } else {
      setTrashChats([]);
      setTrashActionMsg("回收站已清空");
    }
    setTimeout(() => setTrashActionMsg(""), 2000);
  }

  function openAddModal() {
    setEditingProfileId(null);
    setProfileForm({ name: "", provider: "custom", endpoint: "", api_key: "", model: "" });
    setSelectedProviderId("custom");
    setProfileTestResult(null);
    setAvailableModels([]);
    setShowProfileModal(true);
  }

  function openEditModal(p: ApiProfile) {
    setEditingProfileId(p.id);
    setProfileForm({ name: p.name, provider: p.provider, endpoint: p.endpoint, api_key: p.api_key, model: p.model });
    setSelectedProviderId(p.provider);
    setProfileTestResult(null);
    setAvailableModels([]);
    setShowProfileModal(true);
  }

  async function handleProfileTest() {
    setProfileTesting(true);
    setProfileTestResult(null);
    setProfileTestError("");
    setAvailableModels([]);
    try {
      await invoke<boolean>("test_api_connection", {
        endpoint: profileForm.endpoint,
        apiKey: profileForm.api_key,
      });
      setProfileTestResult(true);
      try {
        const models = await invoke<string[]>("list_api_models", {
          endpoint: profileForm.endpoint,
          apiKey: profileForm.api_key,
        });
        setAvailableModels(models);
      } catch (_) {}
    } catch (e: any) {
      setProfileTestResult(false);
      setProfileTestError(typeof e === "string" ? e : e?.message || String(e));
    }
    setProfileTesting(false);
  }

  async function handleProfileSave() {
    if (editingProfileId !== null) {
      await updateApiProfile(editingProfileId, {
        name: profileForm.name,
        provider: profileForm.provider,
        endpoint: profileForm.endpoint,
        api_key: profileForm.api_key,
        model: profileForm.model,
        is_verified: profileTestResult === true ? 1 : undefined,
      });
    } else {
      await addApiProfile({
        name: profileForm.name,
        provider: profileForm.provider,
        endpoint: profileForm.endpoint,
        api_key: profileForm.api_key,
        model: profileForm.model,
        is_verified: profileTestResult === true ? 1 : 0,
      });
    }
    setShowProfileModal(false);
    await loadProfiles();
  }

  async function handleDeleteProfile(id: number) {
    await deleteApiProfile(id);
    await loadProfiles();
  }

  async function handleSetDefault(id: number) {
    await setDefaultApiProfile(id);
    await loadProfiles();
  }

  async function handleSave() {
    setSaving(true);
    await updateSettings({
      endpoint: form.endpoint,
      api_key: form.api_key,
      model: form.model,
      temperature: form.temperature,
      max_tokens: form.max_tokens,
      system_prompt: form.system_prompt,
    });
    updateStore(form);
    setSaving(false);
  }

  const navItems: { id: SettingsTab; label: string }[] = [
    { id: "general", label: "通用设置" },
    { id: "api", label: "API 配置" },
    { id: "appearance", label: "外观" },
    { id: "prompt", label: "Prompt 顺序" },
    { id: "trash", label: "回收站" },
  { id: "models", label: "模型管理" },
    { id: "about", label: "关于" },
  ];

  return (
    <div className="h-full flex overflow-hidden">
      {/* Settings Nav */}
      <nav className="w-52 bg-luna-bg-secondary border-r border-luna-border p-5 px-3 flex-shrink-0">
        {navItems.map((item) => (
          <div
            key={item.id}
            onClick={() => setActiveTab(item.id)}
            className={`px-3 py-2.5 rounded-md text-sm cursor-pointer mb-1 transition-all ${
              activeTab === item.id
                ? "bg-luna-accent-light text-luna-accent font-medium"
                : "text-luna-text-secondary hover:bg-luna-bg hover:text-luna-text"
            }`}
          >
            {item.label}
          </div>
        ))}
      </nav>

      {/* Settings Content */}
      <div className="flex-1 overflow-y-auto p-6 px-8 bg-luna-bg-tertiary">
        {/* General Settings */}
        {activeTab === "general" && (
          <div className="flex flex-col gap-4">
          <div className="bg-luna-bg border border-luna-border rounded-xl p-6">
            <div className="text-base font-semibold text-luna-text mb-5">聊天设置</div>
            <div className="space-y-0">
              {[
                { name: "显示打字指示器", desc: "角色正在输入时显示动画效果", default: true },
                { name: "自动保存聊天", desc: "聊天内容自动保存到本地", default: true },
                { name: "Markdown 渲染", desc: "支持在消息中使用 Markdown 格式", default: true },
              ].map((item) => (
                <div
                  key={item.name}
                  className="flex items-center justify-between py-3 border-b border-luna-border last:border-b-0"
                >
                  <div>
                    <div className="text-sm text-luna-text">{item.name}</div>
                    <div className="text-xs text-luna-text-tertiary mt-0.5">{item.desc}</div>
                  </div>
                  <Toggle defaultOn={item.default} />
                </div>
              ))}
              {/* 格式化角色回复 */}
              <div className="flex items-center justify-between py-3">
                <div>
                  <div className="text-sm text-luna-text">格式化角色回复</div>
                  <div className="text-xs text-luna-text-tertiary mt-0.5">动作使用斜体淡色，话语使用标准正文</div>
                </div>
                <Toggle2 on={formatAssistantReply} setOn={setFormatAssistantReply} />
              </div>
              {/* 绑定系统时钟 */}
              <div className="flex items-center justify-between py-3 border-b border-luna-border">
                <div>
                  <div className="text-sm text-luna-text">绑定系统时钟</div>
                  <div className="text-xs text-luna-text-tertiary mt-0.5">日记和消息使用本地时间，不绑则使用 UTC</div>
                </div>
                <Toggle2 on={bindSystemClock} setOn={setBindSystemClock} />
              </div>
              {/* 日记字数 */}
              <div className="flex items-center justify-between py-3">
                <div>
                  <div className="text-sm text-luna-text">日记字数</div>
                  <div className="text-xs text-luna-text-tertiary mt-0.5">退出时角色写的日记长度</div>
                </div>
                <div className="flex gap-1.5 items-center">
                  <select value={DIARY_PRESETS.has(diaryMaxLength) ? diaryMaxLength : 0}
                    onChange={(e) => {
                      const v = parseInt(e.target.value);
                      setDiaryMaxLength(v);
                    }}
                    className="px-2.5 py-1.5 bg-luna-bg border border-luna-border rounded-md text-sm text-luna-text outline-none focus:border-luna-accent">
                    <option value={100}>100 字</option>
                    <option value={200}>200 字</option>
                    <option value={300}>300 字</option>
                    <option value={400}>400 字</option>
                    <option value={500}>500 字</option>
                    <option value={1000}>1000 字</option>
                    <option value={0}>✏️ 自定义</option>
                  </select>
                  {!DIARY_PRESETS.has(diaryMaxLength) && (
                    <input type="number" min={50} max={5000}
                      value={diaryMaxLength}
                      onChange={(e) => {
                        const v = parseInt(e.target.value);
                        if (!isNaN(v) && v >= 50) setDiaryMaxLength(v);
                      }}
                      className="w-24 py-1.5 px-2 bg-luna-bg border border-luna-border rounded-md text-sm text-luna-text outline-none focus:border-luna-accent" />
                  )}
                </div>
              </div>
            </div>
          </div>

          {/* ─── 旁白 + 主动消息 ─── */}
          <div className="bg-luna-bg border border-luna-border rounded-xl p-6">
            <div className="text-base font-semibold text-luna-text mb-5">主动消息与旁白</div>
            <p className="text-xs text-luna-text-tertiary mb-4 leading-relaxed">
              闲置一段时间后，角色会主动产生动作和对话，让角色感觉一直「活着」。
            </p>
            <div className="space-y-4">
              {/* 开关 */}
              <div className="flex items-center justify-between py-2 border-b border-luna-border last:border-b-0">
                <div>
                  <div className="text-sm text-luna-text">启用</div>
                  <div className="text-xs text-luna-text-tertiary mt-0.5">角色会在你长时间不说话时产生动作和主动说话</div>
                </div>
                <Toggle2 on={proactive.enabled} setOn={(v) => setProactive({ enabled: v })} />
              </div>
              {/* 触发间隔 */}
              <div className="flex items-center justify-between py-2 border-b border-luna-border">
                <div>
                  <div className="text-sm text-luna-text">触发间隔</div>
                  <div className="text-xs text-luna-text-tertiary mt-0.5">闲置多久后触发旁白生成</div>
                </div>
                <div className="flex gap-1.5 items-center">
                  <select
                    value={NARRATION_PRESETS.has(proactive.intervalMinutes) ? proactive.intervalMinutes : 0}
                    onChange={(e) => {
                      const v = parseInt(e.target.value);
                      if (v > 0) setProactive({ intervalMinutes: v });
                    }}
                    className="px-2.5 py-1.5 bg-luna-bg border border-luna-border rounded-md text-sm text-luna-text outline-none focus:border-luna-accent"
                  >
                    <option value={1}>1 分钟</option>
                    <option value={3}>3 分钟</option>
                    <option value={5}>5 分钟</option>
                    <option value={10}>10 分钟</option>
                    <option value={15}>15 分钟</option>
                    <option value={30}>30 分钟</option>
                    <option value={60}>1 小时</option>
                    <option value={120}>2 小时</option>
                    <option value={0}>✏️ 自定义</option>
                  </select>
                  {!NARRATION_PRESETS.has(proactive.intervalMinutes) && (
                    <input
                      type="number"
                      min={1}
                      max={1440}
                      value={proactive.intervalMinutes}
                      onChange={(e) => {
                        const v = parseInt(e.target.value);
                        if (!isNaN(v) && v >= 1) setProactive({ intervalMinutes: v });
                      }}
                      className="w-20 py-1.5 px-2 bg-luna-bg border border-luna-border rounded-md text-sm text-luna-text outline-none focus:border-luna-accent"
                    />
                  )}
                  <span className="text-xs text-luna-text-tertiary">分钟</span>
                </div>
              </div>
              {/* 静默时段 */}
              <div className="flex items-center justify-between py-2">
                <div>
                  <div className="text-sm text-luna-text">静默时段</div>
                  <div className="text-xs text-luna-text-tertiary mt-0.5">此时间段内不生成旁白（可选）</div>
                </div>
                <div className="flex items-center gap-2">
                  <input
                    type="time"
                    value={proactive.silentStart || ""}
                    onChange={(e) => setProactive({ silentStart: e.target.value || "" })}
                    className="py-1.5 px-2 bg-luna-bg border border-luna-border rounded-md text-sm text-luna-text outline-none focus:border-luna-accent"
                  />
                  <span className="text-xs text-luna-text-tertiary">至</span>
                  <input
                    type="time"
                    value={proactive.silentEnd || ""}
                    onChange={(e) => setProactive({ silentEnd: e.target.value || "" })}
                    className="py-1.5 px-2 bg-luna-bg border border-luna-border rounded-md text-sm text-luna-text outline-none focus:border-luna-accent"
                  />
                </div>
              </div>
            </div>
          </div>
          </div>
        )}

        {/* ────────── API 配置 Tab ────────── */}
        {activeTab === "api" && (
          <>
            {/* API Profile 列表 */}
            <div className="mb-5">
              <div className="flex items-center justify-between mb-3">
                <span className="text-base font-semibold text-luna-text">API 配置方案</span>
                <button
                  onClick={openAddModal}
                  className="px-3 py-1.5 bg-luna-accent text-white rounded-md text-xs font-medium hover:bg-[#3C3489] transition-colors"
                >
                  + 添加 API
                </button>
              </div>

              {profiles.length === 0 ? (
                <div className="bg-luna-bg border border-luna-border rounded-xl p-8 text-center text-sm text-luna-text-tertiary">
                  暂无 API 配置，点击「添加 API」开始
                </div>
              ) : (
                <div className="space-y-2">
                  {profiles.map((p) => (
                    <div
                      key={p.id}
                      className={`bg-luna-bg border rounded-xl p-3.5 flex items-center gap-3 group transition-all ${
                        p.is_default ? "border-luna-accent ring-1 ring-luna-accent/20" : "border-luna-border"
                      }`}
                    >
                      {/* 厂商标签 */}
                      <span
                        className={`text-[10px] px-2 py-0.5 rounded font-medium ${
                          p.provider === "custom"
                            ? "bg-luna-bg-secondary text-luna-text-tertiary"
                            : "bg-luna-accent-light text-luna-accent"
                        }`}
                      >
                        {getProviderTemplate(p.provider)?.name || p.provider}
                      </span>

                      {/* 名称 */}
                      <div className="flex-1 min-w-0">
                        <div className="text-sm text-luna-text font-medium truncate">{p.name}</div>
                        <div className="text-[11px] text-luna-text-tertiary truncate">{p.model || "未设置模型"}</div>
                      </div>

                      {/* 验证状态 */}
                      {p.is_verified ? (
                        <span className="text-[10px] text-green-600 bg-green-50 px-2 py-0.5 rounded">已验证</span>
                      ) : (
                        <span className="text-[10px] text-luna-text-tertiary bg-luna-bg-secondary px-2 py-0.5 rounded">未验证</span>
                      )}

                      {/* 默认标记 */}
                      {p.is_default ? (
                        <span className="text-[10px] text-luna-accent font-medium">● 当前使用</span>
                      ) : (
                        <button
                          onClick={() => handleSetDefault(p.id)}
                          className="text-[10px] text-luna-text-tertiary hover:text-luna-accent transition-colors opacity-0 group-hover:opacity-100"
                        >
                          设为默认
                        </button>
                      )}

                      {/* 操作按钮 */}
                      <button
                        onClick={() => openEditModal(p)}
                        className="text-[10px] text-luna-text-tertiary hover:text-luna-accent transition-colors opacity-0 group-hover:opacity-100"
                      >
                        编辑
                      </button>
                      <button
                        onClick={() => handleDeleteProfile(p.id)}
                        className="text-[10px] text-luna-text-tertiary hover:text-luna-red transition-colors opacity-0 group-hover:opacity-100"
                      >
                        删除
                      </button>
                    </div>
                  ))}
                </div>
              )}
            </div>

            {/* 高级参数 */}
            <div className="bg-luna-bg border border-luna-border rounded-xl p-6">
              <div className="text-base font-semibold text-luna-text mb-5">默认聊天参数</div>
              <div className="space-y-4 max-w-lg">
                <div>
                  <label className="text-xs text-luna-text-secondary mb-1 block">System Prompt</label>
                  <textarea
                    value={form.system_prompt}
                    onChange={(e) => setForm({ ...form, system_prompt: e.target.value })}
                    rows={4}
                    className="w-full py-2 px-3 bg-luna-bg border border-luna-border rounded-md text-sm text-luna-text outline-none focus:border-luna-accent resize-none leading-relaxed"
                  />
                </div>
                <div>
                  <label className="text-xs text-luna-text-secondary mb-1 block">
                    全局禁止内容
                  </label>
                  <textarea
                    value={bannedGlobal}
                    onChange={(e) => setBannedGlobal(e.target.value)}
                    onBlur={() => saveBannedGlobal(bannedGlobal)}
                    placeholder="每行一个禁止词或一句话描述。AI 会在回复中避免出现这些内容。&#10;例如：&#10;不要说脏话&#10;不要谈论工作"
                    rows={4}
                    className="w-full py-2 px-3 bg-luna-bg border border-luna-border rounded-md text-sm text-luna-text outline-none focus:border-luna-accent resize-none leading-relaxed"
                  />
                  {bannedGlobalSaved && (
                    <span className="text-xs text-green-600 mt-1">已保存</span>
                  )}
                  <div className="text-xs text-luna-text-tertiary mt-1">
                    全局生效。每条规则都会被注入到所有对话的 system prompt 中
                  </div>
                </div>
                <div className="flex gap-3">
                  <div className="flex-1">
                    <label className="text-xs text-luna-text-secondary mb-1 block">Temperature</label>
                    <input
                      type="number"
                      step="0.1"
                      min="0"
                      max="2"
                      value={form.temperature}
                      onChange={(e) => setForm({ ...form, temperature: parseFloat(e.target.value) })}
                      className="w-full py-2 px-3 bg-luna-bg border border-luna-border rounded-md text-sm text-luna-text outline-none focus:border-luna-accent"
                    />
                  </div>
                  <div className="flex-1">
                    <label className="text-xs text-luna-text-secondary mb-1 block">Max Tokens</label>
                    <input
                      type="number"
                      value={form.max_tokens}
                      onChange={(e) => setForm({ ...form, max_tokens: parseInt(e.target.value) })}
                      className="w-full py-2 px-3 bg-luna-bg border border-luna-border rounded-md text-sm text-luna-text outline-none focus:border-luna-accent"
                    />
                  </div>
                </div>
              </div>
            </div>
          </>
        )}

        {/* Appearance */}

        {/* Prompt 模块排序 */}
        {activeTab === "prompt" && (
          <div className="space-y-4">
            {/* 说明卡片 */}
            <div className="bg-luna-bg border border-luna-border rounded-xl p-5">
              <div className="text-base font-semibold text-luna-text mb-2">System Prompt 模块排序</div>
              <p className="text-sm text-luna-text-secondary leading-relaxed">
                调整 System Prompt 中各个模块的排列顺序和启用状态。
                <strong className="text-luna-text font-medium">排在前面的内容模型会优先阅读</strong>，影响角色对用户和规则的感知优先级。
              </p>
            </div>

            {/* 模块列表 */}
            <div className="bg-luna-bg border border-luna-border rounded-xl">
              {promptBlocks.map((block, idx) => {
                const meta = PROMPT_BLOCK_META[block.id] || { label: block.id, desc: "" };
                const isFirst = idx === 0;
                const isLast = idx === promptBlocks.length - 1;
                return (
                  <div
                    key={block.id}
                    className={`flex items-center gap-4 px-5 py-3 ${
                      idx !== promptBlocks.length - 1 ? "border-b border-luna-border" : ""
                    } ${!block.enabled ? "opacity-50" : ""}`}
                  >
                    {/* 顺序编号 */}
                    <span className={`w-7 h-7 rounded-full flex items-center justify-center text-xs font-bold shrink-0 ${
                      block.enabled
                        ? "bg-luna-accent text-white"
                        : "bg-luna-border-secondary text-luna-text-tertiary"
                    }`}>
                      {idx + 1}
                    </span>

                    {/* 模块信息 */}
                    <div className="flex-1 min-w-0">
                      <div className="text-sm font-medium text-luna-text">{meta.label}</div>
                      <div className="text-xs text-luna-text-tertiary mt-0.5 truncate">{meta.desc}</div>
                    </div>

                    {/* 启用开关 */}
                    <button
                      onClick={() => toggleBlock(idx)}
                      className={`shrink-0 w-9 h-5 rounded-full relative transition-colors cursor-pointer ${
                        block.enabled ? "bg-luna-accent" : "bg-luna-border-secondary"
                      }`}
                      title={block.enabled ? "已启用，点击禁用" : "已禁用，点击启用"}
                    >
                      <div
                        className={`absolute top-0.5 w-4 h-4 bg-white rounded-full shadow transition-transform ${
                          block.enabled ? "translate-x-4" : "left-0.5"
                        }`}
                      />
                    </button>

                    {/* 上移 / 下移 */}
                    <div className="flex flex-col gap-0.5 shrink-0">
                      <button
                        onClick={() => moveBlock(idx, -1)}
                        disabled={isFirst}
                        className="w-6 h-5 flex items-center justify-center rounded text-luna-text-tertiary hover:text-luna-text hover:bg-luna-bg-secondary transition-colors disabled:opacity-25 disabled:cursor-not-allowed"
                        title="上移（优先级提高）"
                      >
                        ▲
                      </button>
                      <button
                        onClick={() => moveBlock(idx, 1)}
                        disabled={isLast}
                        className="w-6 h-5 flex items-center justify-center rounded text-luna-text-tertiary hover:text-luna-text hover:bg-luna-bg-secondary transition-colors disabled:opacity-25 disabled:cursor-not-allowed"
                        title="下移（优先级降低）"
                      >
                        ▼
                      </button>
                    </div>
                  </div>
                );
              })}

              {/* 底部操作栏 — 和列表项等高 */}
              <div className="flex items-center gap-3 px-5 py-3 border-t border-luna-border bg-luna-bg-secondary/40">
                <span className="text-xs text-luna-text-tertiary">操作：</span>
                {promptSaved && (
                  <span className="text-xs text-luna-green font-medium">✓ 已保存</span>
                )}
                <button
                  onClick={handleResetPrompt}
                  className="text-xs px-3 py-1.5 rounded-md border border-luna-border text-luna-text-secondary hover:text-luna-text hover:bg-luna-bg-secondary transition-colors"
                >
                  恢复默认顺序
                </button>
              </div>
            </div>

            {/* ─── 自定义系统提示词 + 完整预览 ─── */}
            <div className="bg-luna-bg border border-luna-border rounded-xl p-5 mt-4">
              <div className="text-base font-semibold text-luna-text mb-2">自定义系统提示词</div>
              <p className="text-xs text-luna-text-tertiary mb-3">
                这段内容会注入到所有对话的 system prompt 中。<strong className="text-luna-text font-medium">不包含角色提示词</strong>（性格设定、世界等来自角色卡片）。
              </p>
              <textarea
                value={form.system_prompt}
                onChange={(e) => {
                  setForm({ ...form, system_prompt: e.target.value });
                }}
                onBlur={() => {
                  updateSettings({ system_prompt: form.system_prompt });
                  updateStore({ system_prompt: form.system_prompt });
                }}
                rows={4}
                placeholder="在这里输入你想让 AI 在每次对话中记住的全局指令..."
                className="w-full py-2 px-3 bg-luna-bg-secondary border border-luna-border rounded-md text-sm text-luna-text outline-none focus:border-luna-accent resize-none leading-relaxed"
              />

              <div className="mt-4 flex items-center gap-3 border-t border-luna-border pt-4">
                <button
                  onClick={async () => {
                    setPromptLoading(true);
                    setPromptPreviewError("");
                    try {
                      const result = await invoke<string>("get_prompt_preview", {
                        systemPrompt: form.system_prompt,
                        userName: settings.user_name || "",
                        userPersona: settings.user_persona || "",
                      });
                      setPromptPreview(result);
                    } catch (e: any) {
                      setPromptPreviewError(typeof e === "string" ? e : e?.message || "加载失败");
                    }
                    setPromptLoading(false);
                  }}
                  disabled={promptLoading}
                  className="px-3 py-1.5 text-xs border border-luna-border rounded-md bg-luna-bg text-luna-text-secondary hover:bg-luna-bg-secondary transition-colors disabled:opacity-40"
                >
                  {promptLoading ? "加载中..." : "加载完整提示词预览"}
                </button>
                {promptPreview && (
                  <span
                    onClick={() => setPromptPreview("")}
                    className="text-xs text-luna-text-tertiary cursor-pointer hover:text-luna-red transition-colors"
                  >
                    清除
                  </span>
                )}
                {promptPreviewError && (
                  <span className="text-xs text-luna-red">{promptPreviewError}</span>
                )}
              </div>

              {promptPreview && (
                <div className="mt-3">
                  <div className="text-xs text-luna-text-tertiary mb-1.5">
                    完整提示词预览（不包含角色特定内容）
                  </div>
                  <pre className="w-full p-3 bg-luna-bg-secondary/70 border border-luna-border rounded-md text-xs text-luna-text-secondary leading-relaxed whitespace-pre-wrap max-h-[400px] overflow-y-auto font-sans">
                    {promptPreview}
                  </pre>
                </div>
              )}
            </div>
          </div>
        )}

        {/* Appearance */}
        {activeTab === "appearance" && (
          <div className="bg-luna-bg border border-luna-border rounded-xl p-6">
            <div className="text-base font-semibold text-luna-text mb-5">主题</div>
            <div className="flex gap-3">
              {([
                { mode: "light" as const, label: "浅色", bg: "bg-white" },
                { mode: "dark" as const, label: "深色", bg: "bg-[#1a1a1e]", textColor: "text-gray-400" },
                { mode: "auto" as const, label: "自动", bg: "bg-gradient-to-br from-white to-[#1a1a2e]", textColor: "text-gray-400" },
              ]).map(({ mode, label, bg, textColor }) => (
                <div
                  key={mode}
                  onClick={() => setTheme(mode)}
                  className={`w-24 h-16 ${bg} rounded-md flex items-center justify-center text-xs cursor-pointer transition-all ${
                    theme === mode
                      ? "border-2 border-luna-accent ring-2 ring-luna-accent/20"
                      : "border-2 border-luna-border"
                  } ${textColor || "text-luna-text-secondary"}`}
                >
                  {label}
                </div>
              ))}
            </div>
          </div>
        )}

        {/* ────────── 回收站 Tab ────────── */}
        {activeTab === "trash" && (
          <div>
            <div className="flex items-center justify-between mb-4">
              <div>
                <div className="text-base font-semibold text-luna-text">回收站</div>
                <p className="text-xs text-luna-text-tertiary mt-1">
                  已删除的对话会暂时保留在这里，你可以恢复或永久删除
                </p>
              </div>
              {trashChats.length > 0 && (
                <button
                  onClick={() => setTrashConfirmAll(true)}
                  className="px-3 py-1.5 text-xs border border-luna-red/30 text-luna-red rounded-md hover:bg-luna-red/5 transition-colors"
                >
                  清空回收站
                </button>
              )}
            </div>

            {trashActionMsg && (
              <div className="text-xs text-green-600 mb-3">{trashActionMsg}</div>
            )}

            {!trashLoaded ? (
              <div className="bg-luna-bg border border-luna-border rounded-xl p-8 text-center text-sm text-luna-text-tertiary">
                加载中...
              </div>
            ) : trashChats.length === 0 ? (
              <div className="bg-luna-bg border border-luna-border rounded-xl p-8 text-center text-sm text-luna-text-tertiary">
                回收站是空的
              </div>
            ) : (
              <div className="space-y-2">
                {trashChats.map((chat) => (
                  <div
                    key={chat.id}
                    className="bg-luna-bg border border-luna-border rounded-xl p-3.5 flex items-center gap-3 group transition-all"
                  >
                    <div className="flex-1 min-w-0">
                      <div className="text-sm text-luna-text font-medium truncate">{chat.title}</div>
                      <div className="text-[11px] text-luna-text-tertiary mt-0.5">
                        删除于 {chat.deleted_at}
                      </div>
                    </div>
                    <button
                      onClick={() => handleRecoverChat(chat.id)}
                      className="px-3 py-1.5 text-xs border border-luna-border rounded-md text-luna-text-secondary hover:text-luna-accent hover:border-luna-accent/50 transition-colors opacity-0 group-hover:opacity-100"
                    >
                      恢复
                    </button>
                    <button
                      onClick={() => handleEmptyTrash(chat.id)}
                      className="px-3 py-1.5 text-xs border border-luna-red/30 text-luna-red rounded-md hover:bg-luna-red/5 transition-colors opacity-0 group-hover:opacity-100"
                    >
                      永久删除
                    </button>
                  </div>
                ))}
              </div>
            )}

            {/* 清空全部确认弹窗 */}
            {trashConfirmAll && (
              <div
                className="fixed inset-0 bg-black/30 flex items-center justify-center z-50"
                onClick={() => setTrashConfirmAll(false)}
              >
                <div
                  className="bg-luna-bg rounded-xl p-5 shadow-lg max-w-xs w-full mx-4"
                  onClick={(e) => e.stopPropagation()}
                >
                  <div className="text-sm font-medium text-luna-text mb-2">清空回收站</div>
                  <div className="text-xs text-luna-text-secondary mb-4">
                    确定要永久删除回收站中的所有对话吗？此操作不可恢复。
                  </div>
                  <div className="text-[11px] text-luna-text-tertiary mb-4">
                    按 Enter 确认 · Esc 取消
                  </div>
                  <div className="flex gap-2 justify-end">
                    <button
                      onClick={() => setTrashConfirmAll(false)}
                      className="px-3 py-1.5 text-xs border border-luna-border rounded-md text-luna-text-secondary hover:bg-luna-bg-secondary transition-colors"
                    >
                      取消
                    </button>
                    <button
                      onClick={() => {
                        setTrashConfirmAll(false);
                        handleEmptyTrash();
                      }}
                      className="px-3 py-1.5 text-xs bg-luna-red text-white rounded-md hover:bg-red-600 transition-colors"
                    >
                      清空
                    </button>
                  </div>
                </div>
              </div>
            )}
          </div>
        )}

        {/* About */}
        {activeTab === "about" && (
          <div className="bg-luna-bg border border-luna-border rounded-xl p-6">
            <div className="text-base font-semibold text-luna-text mb-4">关于 LunA</div>
            <p className="text-sm text-luna-text-secondary leading-relaxed mb-4">
              LunA 是一个简洁优雅的角色扮演聊天应用，让你可以与各种角色进行沉浸式对话。
            </p>
            <p className="text-xs text-luna-text-tertiary">版本 1.1.5 · 作者: Twave</p>

            {/* 清除所有数据 */}
            <div className="mt-6 pt-4 border-t border-luna-border">
              <ClearAllDataSection />
            </div>

            {/* 调试日志 */}
            <div className="mt-6 pt-4 border-t border-luna-border">
              <details open>
                <summary className="text-sm font-medium text-luna-text mb-3 cursor-pointer select-none hover:text-luna-accent transition-colors">
                  调试日志
                </summary>
                <DebugPanel />
              </details>
            </div>
          </div>
        )}
        {/* 模型管理 */}
        {activeTab === "models" && (
          <div className="bg-luna-bg border border-luna-border rounded-xl p-6">
            <div className="text-base font-semibold text-luna-text mb-4">📦 模型管理</div>
            {(() => {
              if (!isMascotEnabled()) {
                return (
                  <p className="text-sm text-luna-text-secondary">
                    ⚠️ 此功能需要通过看板娘邀请码验证后才能使用。
                    <br />
                    请先在其他页面输入邀请码启用看板娘功能。
                  </p>
                );
              }
              return <ModelsPanel />;
            })()}
          </div>
        )}


        {/* 保存按钮 — 关于页不需要 */}
        {activeTab !== "about" && activeTab !== "models" && (
          <div className="sticky bottom-0 mt-5 bg-luna-bg border border-luna-border rounded-xl h-16 px-5 flex items-center gap-3">
          <div className="flex-1" />
          <button
            onClick={handleSave}
            disabled={saving}
            className="px-4 py-2 bg-luna-accent text-white rounded-md text-sm font-medium hover:bg-[#3C3489] transition-colors disabled:opacity-50 min-w-[100px]"
          >
            {saving ? "保存中..." : "保存"}
          </button>
        </div>
      )}
      </div>

      {/* ────────── 添加/编辑 API 弹窗 ────────── */}
      {showProfileModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/30" onClick={() => setShowProfileModal(false)}>
          <div
            className="bg-luna-bg rounded-xl shadow-xl w-[520px] max-h-[80vh] overflow-y-auto"
            onClick={(e) => e.stopPropagation()}
          >
            {/* Header */}
            <div className="px-5 py-4 border-b border-luna-border">
              <span className="text-base font-semibold text-luna-text">
                {editingProfileId ? "编辑 API" : "添加 API"}
              </span>
            </div>

            {/* Body */}
            <div className="px-5 py-4 space-y-4">
              {/* 选择厂商 */}
              <div>
                <label className="text-xs text-luna-text-secondary mb-2 block font-medium">选择厂商</label>
                <div className="grid grid-cols-3 gap-1.5 max-h-48 overflow-y-auto">
                  {API_PROVIDERS.map((tpl) => (
                    <div
                      key={tpl.id}
                      onClick={() => selectProvider(tpl.id)}
                      className={`px-2.5 py-2 rounded-md text-xs cursor-pointer border transition-all text-center ${
                        selectedProviderId === tpl.id
                          ? "border-luna-accent bg-luna-accent-light text-luna-accent"
                          : "border-luna-border text-luna-text-secondary hover:border-luna-accent/50"
                      }`}
                    >
                      <div className="font-medium truncate">{tpl.name}</div>
                      <div className="text-[10px] text-luna-text-tertiary mt-0.5 truncate">{tpl.hint}</div>
                    </div>
                  ))}
                </div>
              </div>

              {/* 配置名称 */}
              <div>
                <label className="text-xs text-luna-text-secondary mb-1 block">配置名称</label>
                <input
                  type="text"
                  value={profileForm.name}
                  onChange={(e) => setProfileForm({ ...profileForm, name: e.target.value })}
                  placeholder="例如：GPT-4o 工作用"
                  className="w-full py-2 px-3 bg-luna-bg border border-luna-border rounded-md text-sm text-luna-text outline-none focus:border-luna-accent"
                />
              </div>

              {/* Endpoint */}
              <div>
                <label className="text-xs text-luna-text-secondary mb-1 block">Endpoint</label>
                <input
                  type="text"
                  value={profileForm.endpoint}
                  onChange={(e) => setProfileForm({ ...profileForm, endpoint: e.target.value })}
                  className="w-full py-2 px-3 bg-luna-bg border border-luna-border rounded-md text-sm text-luna-text outline-none focus:border-luna-accent font-mono"
                />
              </div>

              {/* API Key */}
              <div>
                <label className="text-xs text-luna-text-secondary mb-1 block">API Key</label>
                <input
                  type="password"
                  value={profileForm.api_key}
                  onChange={(e) => setProfileForm({ ...profileForm, api_key: e.target.value })}
                  placeholder="sk-..."
                  className="w-full py-2 px-3 bg-luna-bg border border-luna-border rounded-md text-sm text-luna-text outline-none focus:border-luna-accent"
                />
              </div>

              {/* Model */}
              <div>
                <label className="text-xs text-luna-text-secondary mb-1 block">Model</label>
                {availableModels.length > 0 ? (
                  <select
                    value={profileForm.model}
                    onChange={(e) => setProfileForm({ ...profileForm, model: e.target.value })}
                    className="w-full py-2 px-3 border border-luna-border rounded-md text-sm text-luna-text outline-none focus:border-luna-accent bg-luna-bg"
                  >
                    <option value="">手动输入...</option>
                    {availableModels.map((m) => (
                      <option key={m} value={m}>{m}</option>
                    ))}
                  </select>
                ) : (
                  <input
                    type="text"
                    value={profileForm.model}
                    onChange={(e) => setProfileForm({ ...profileForm, model: e.target.value })}
                    placeholder="例如：gpt-4o"
                    className="w-full py-2 px-3 bg-luna-bg border border-luna-border rounded-md text-sm text-luna-text outline-none focus:border-luna-accent"
                  />
                )}
              </div>

              {/* 测试连接 */}
              <div className="flex items-center gap-3">
                <button
                  onClick={handleProfileTest}
                  disabled={profileTesting || !profileForm.endpoint || !profileForm.api_key}
                  className="px-4 py-2 border border-luna-border rounded-md bg-luna-bg text-sm text-luna-text-secondary hover:bg-luna-bg-secondary transition-colors disabled:opacity-40 disabled:cursor-not-allowed"
                >
                  {profileTesting ? "测试中..." : "测试连接"}
                </button>
                {profileTestResult === true && (
                  <span className="text-sm text-green-600">
                    ✓ 连接成功{availableModels.length > 0 && `（${availableModels.length} 个模型可用）`}
                  </span>
                )}
                {profileTestResult === false && (
                  <span className="text-sm text-red-600">
                    ✗ 连接失败
                    {profileTestError && (
                      <span className="block text-xs text-red-400 mt-0.5 max-w-xs break-all">{profileTestError}</span>
                    )}
                  </span>
                )}
              </div>
            </div>

            {/* Footer */}
            <div className="px-5 py-3 border-t border-luna-border flex justify-end gap-2">
              <button
                onClick={() => setShowProfileModal(false)}
                className="px-4 py-2 border border-luna-border rounded-md text-sm text-luna-text-secondary hover:bg-luna-bg-secondary transition-colors"
              >
                取消
              </button>
              <button
                onClick={handleProfileSave}
                disabled={!profileForm.name || !profileForm.endpoint}
                className="px-4 py-2 bg-luna-accent text-white rounded-md text-sm font-medium hover:bg-[#3C3489] transition-colors disabled:opacity-50"
              >
                保存
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

function Toggle({ defaultOn = false }: { defaultOn?: boolean }) {
  const [on, setOn] = useState(defaultOn);
  return (
    <div
      onClick={() => setOn(!on)}
      className={`w-11 h-6 rounded-full relative cursor-pointer transition-colors ${
        on ? "bg-luna-accent" : "bg-luna-border-secondary"
      }`}
    >
      <div
        className={`absolute top-0.5 w-5 h-5 bg-white rounded-full shadow transition-transform ${
          on ? "translate-x-5" : "left-0.5"
        }`}
      />
    </div>
  );
}

function Toggle2({ on, setOn }: { on: boolean; setOn: (v: boolean) => void }) {
  return (
    <div
      onClick={() => setOn(!on)}
      className={`w-11 h-6 rounded-full relative cursor-pointer transition-colors ${
        on ? "bg-luna-accent" : "bg-luna-border-secondary"
      }`}
    >
      <div
        className={`absolute top-0.5 w-5 h-5 bg-white rounded-full shadow transition-transform ${
          on ? "translate-x-5" : "left-0.5"
        }`}
      />
    </div>
  );
}
