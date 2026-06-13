import { useEffect, useRef, useState } from "react";
import { invoke } from "@tauri-apps/api/core";
import { emit } from "@tauri-apps/api/event";
import { useChatStore } from "../stores/chatStore";
import { useSettingsStore } from "../stores/settingsStore";
import {
  getMessages,
  saveMessage,
  deleteMessage,
  getChats,
  createChat,
  deleteChat,
  updateChatTitle,
  updateChatCharacter,
  getCharacters,
  getCharacterWithWorld,
  getPersonalityStates,
  detectPersonalityState,
  deleteMessagesAfter,
  deleteMessagesFrom,
  branchChat,
  togglePinChat,
  applyEmotionDelta,
  syncCharacterStatsFromChat,
  applySubCardPersonality,
  ensureChatStats,
  getMessageById,
  getMascotBind,
  type Character,
} from "../utils/db";
import type { Message, AgentResponse, CharacterInfo, ChatMessage, ChatStats, NarrationItem } from "../types";
import StatsPanel from "../components/StatsPanel";


// ─── SVG 简笔画图标 ───
const IconQuote = () => (
  <svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" xmlns="http://www.w3.org/2000/svg">
    <path d="M15.9998 22.3195C15.6598 22.3195 15.3298 22.2195 15.0398 22.0295L10.7798 19.1895H8.88977C8.65977 19.1895 8.43974 19.0795 8.29974 18.8995C8.15974 18.7095 8.10977 18.4694 8.16977 18.2495C8.22977 18.0095 8.25977 17.7695 8.25977 17.5095C8.25977 16.7095 7.95977 15.9395 7.41977 15.3395C6.80977 14.6495 5.93977 14.2595 5.00977 14.2595C4.11977 14.2595 3.28975 14.6094 2.67975 15.2394C2.48975 15.4394 2.19976 15.5195 1.93976 15.4395C1.67976 15.3595 1.46976 15.1495 1.40976 14.8795C1.30976 14.4395 1.25977 13.9595 1.25977 13.4395V7.43945C1.25977 3.99945 3.56977 1.68945 7.00977 1.68945H17.0098C20.4498 1.68945 22.7598 3.99945 22.7598 7.43945V13.4395C22.7598 15.1095 22.2098 16.5494 21.1598 17.5994C20.2798 18.4794 19.1098 19.0095 17.7598 19.1495V20.5695C17.7598 21.2195 17.3997 21.8094 16.8297 22.1194C16.5597 22.2494 16.2798 22.3195 15.9998 22.3195Z" strokeWidth="1.5"/>
    <circle cx="5" cy="17.5" r="4" strokeWidth="1.5"/>
    <path d="M3 17.5h4" strokeWidth="1.5"/>
    <path d="M5 15.5v4" strokeWidth="1.5"/>
    <path d="M8.5 10.5H15.5" strokeWidth="1.5"/>
  </svg>
);

const IconBranch = () => (
  <svg viewBox="0 0 24 24" width="14" height="14" fill="currentColor" xmlns="http://www.w3.org/2000/svg">
    <path d="M5 16.75C4.59 16.75 4.25 16.41 4.25 16V9C4.25 8.59 4.59 8.25 5 8.25C5.41 8.25 5.75 8.59 5.75 9V16C5.75 16.41 5.41 16.75 5 16.75Z" fill="currentColor"/>
    <path d="M5.25 9.25C3.04 9.25 1.25 7.46 1.25 5.25C1.25 3.04 3.04 1.25 5.25 1.25C7.46 1.25 9.25 3.04 9.25 5.25C9.25 7.46 7.46 9.25 5.25 9.25ZM5.25 2.75C3.87 2.75 2.75 3.87 2.75 5.25C2.75 6.63 3.87 7.75 5.25 7.75C6.63 7.75 7.75 6.63 7.75 5.25C7.75 3.87 6.63 2.75 5.25 2.75Z" fill="currentColor"/>
    <path d="M5 22.75C2.93 22.75 1.25 21.07 1.25 19C1.25 16.93 2.93 15.25 5 15.25C7.07 15.25 8.75 16.93 8.75 19C8.75 21.07 7.07 22.75 5 22.75ZM5 16.75C3.76 16.75 2.75 17.76 2.75 19C2.75 20.24 3.76 21.25 5 21.25C6.24 21.25 7.25 20.24 7.25 19C7.25 17.76 6.24 16.75 5 16.75Z" fill="currentColor"/>
    <path d="M19 22.75C16.93 22.75 15.25 21.07 15.25 19C15.25 16.93 16.93 15.25 19 15.25C21.07 15.25 22.75 16.93 22.75 19C22.75 21.07 21.07 22.75 19 22.75ZM19 16.75C17.76 16.75 16.75 17.76 16.75 19C16.75 20.24 17.76 21.25 19 21.25C20.24 21.25 21.25 20.24 21.25 19C21.25 17.76 20.24 16.75 19 16.75Z" fill="currentColor"/>
    <path d="M18.1701 16.7905C17.8601 16.7905 17.5701 16.6005 17.4601 16.2905C16.7301 14.1905 14.7501 12.7805 12.5201 12.7805C12.5101 12.7805 12.5101 12.7805 12.5001 12.7805L9.07011 12.7905C9.06011 12.7905 9.06011 12.7905 9.05011 12.7905C6.86011 12.7905 4.95011 11.3105 4.40011 9.19048C4.30011 8.79048 4.54011 8.38048 4.94011 8.28048C5.34011 8.18048 5.75011 8.42049 5.85011 8.82049C6.23011 10.2805 7.54011 11.3005 9.05011 11.3005H9.06011L12.4901 11.2905C12.5001 11.2905 12.5101 11.2905 12.5201 11.2905C15.3801 11.2905 17.9301 13.1005 18.8701 15.8105C19.0101 16.2005 18.8001 16.6305 18.4101 16.7605C18.3301 16.7705 18.2501 16.7905 18.1701 16.7905Z" fill="currentColor"/>
  </svg>
);

const IconEdit = () => (
  <svg viewBox="0 0 16 16" width="12" height="12" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
    <path d="M11 2l3 3-9 9H2v-3l9-9z"/>
  </svg>
);

const IconRefresh = () => (
  <svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" strokeWidth="1.5" strokeMiterlimit="10" strokeLinecap="round" strokeLinejoin="round" xmlns="http://www.w3.org/2000/svg">
    <path d="M3.58008 5.16016H17.4201C19.0801 5.16016 20.4201 6.50016 20.4201 8.16016V11.4802"/>
    <path d="M6.74008 2L3.58008 5.15997L6.74008 8.32001"/>
    <path d="M20.4201 18.8395H6.58008C4.92008 18.8395 3.58008 17.4995 3.58008 15.8395V12.5195"/>
    <path d="M17.2603 21.9997L20.4203 18.8397L17.2603 15.6797"/>
  </svg>
);

const IconTrash = () => (
  <svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" xmlns="http://www.w3.org/2000/svg">
    <path d="M21 5.98047C17.67 5.65047 14.32 5.48047 10.98 5.48047C9 5.48047 7.02 5.58047 5.04 5.78047L3 5.98047"/>
    <path d="M8.5 4.97L8.72 3.66C8.88 2.71 9 2 10.69 2H13.31C15 2 15.13 2.75 15.28 3.67L15.5 4.97"/>
    <path d="M18.85 9.14062L18.2 19.2106C18.09 20.7806 18 22.0006 15.21 22.0006H8.79002C6.00002 22.0006 5.91002 20.7806 5.80002 19.2106L5.15002 9.14062"/>
    <path d="M10.33 16.5H13.66"/>
    <path d="M9.5 12.5H14.5"/>
  </svg>
);

const IconContinue = () => (
  <svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" xmlns="http://www.w3.org/2000/svg">
    <path d="M2 8.34043V15.6604C2 17.1604 3.62999 18.1004 4.92999 17.3504L8.10001 15.5304L11.27 13.7004C11.47 13.5804 11.63 13.4504 11.76 13.2904V10.7304C11.63 10.5704 11.47 10.4404 11.27 10.3204L8.10001 8.49042L4.92999 6.67044C3.62999 5.90044 2 6.84043 2 8.34043Z"/>
    <path d="M11.76 8.34043V15.6604C11.76 17.1604 13.39 18.1004 14.69 17.3504L17.86 15.5304L21.03 13.7004C22.33 12.9504 22.33 11.0804 21.03 10.3204L17.86 8.49042L14.69 6.67044C13.39 5.90044 11.76 6.84043 11.76 8.34043Z"/>
  </svg>
);

const IconBookmark = () => (
  <svg viewBox="0 0 16 16" width="12" height="12" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
    <path d="M3 2h10v12l-5-3-5 3V2z"/>
  </svg>
);

// ─── 属性条颜色映射 ───
const INLINE_STAT_HEX: Record<string, string> = {
  stat_happy: '#22c55e',
  stat_discomfort: '#ef4444',
  stat_trust: '#3b82f6',
  stat_energy: '#eab308',
  stat_affection: '#ec4899',
  stat_curiosity: '#a855f7',
  stat_relax: '#14b8a6',
  stat_depression: '#78716c',
};

const INLINE_STAT_EMOJI: Record<string, string> = {
  stat_happy: '😊',
  stat_discomfort: '😖',
  stat_trust: '🤝',
  stat_energy: '⚡',
  stat_affection: '💕',
  stat_curiosity: '🤔',
  stat_relax: '😌',
  stat_depression: '😞',
};

const INLINE_STAT_KEYS = ['stat_happy', 'stat_discomfort', 'stat_trust', 'stat_energy', 'stat_affection', 'stat_curiosity', 'stat_relax', 'stat_depression'];

/** SQLite (UTC) → 本地时间 Date（受 bindSystemClock 控制） */
function toLocal(ts: string | null | undefined): Date {
  const raw = (ts || '').trim();
  // bindSystemClock 通过 Zustand 同步，这里直接读 localStorage 确保函数级正确
  const bound = localStorage.getItem("luna-bind-clock") !== "false";
  return new Date(raw + (bound ? 'Z' : ''));
}

/** 解析 *动作* 并渲染为斜体淡色（支持半角*、全角＊、未闭合*） */
function renderFormattedReply(text: string) {
  // 统一全角＊为半角*
  const normalized = text.replace(/＊/g, '*');
  // 先试精确匹配 *...*
  const parts = normalized.split(/(\*[^*]+\*)/g);
  return parts.map((part, i) => {
    const trimmed = part.trim();
    // 精确匹配 *内容*
    if (part.startsWith('*') && part.endsWith('*') && part.length > 2) {
      return <i key={i} className="text-luna-text-tertiary">{part.slice(1, -1)}</i>;
    }
    // 兜底：以 * 开头的段落（LLM 偶尔忘闭合）
    if (trimmed.startsWith('*') && trimmed.length > 2 && !trimmed.includes('*', 1)) {
      return <i key={i} className="text-luna-text-tertiary">{trimmed.slice(1).trim()}</i>;
    }
    return <span key={i}>{part}</span>;
  });
}

/** 去掉 * 号标记，恢复纯文本 */
function stripStarMarkers(text: string) {
  return text.replace(/＊/g, '*').replace(/\*([^*]+)\*/g, '$1');
}

export default function ChatPage() {
  const {
    chats,
    currentChatId,
    messages,
    isLoading,
    currentCharacterId,
    setChats,
    setCurrentChat,
    setMessages,
    setIsLoading,
    setCurrentCharacter,
  } = useChatStore();
  const { settings, activeProfile, ready, formatAssistantReply, proactive } = useSettingsStore();
  // 当前使用的 API 配置：优先 activeProfile，回退 settings
  const getApiSettings = () => ({
    endpoint: activeProfile?.endpoint || settings.endpoint,
    api_key: activeProfile?.api_key || settings.api_key,
    model: activeProfile?.model || settings.model,
    temperature: activeProfile?.temperature ?? settings.temperature,
    max_tokens: activeProfile?.max_tokens ?? settings.max_tokens,
    user_name: settings.user_name || "",
    user_persona: settings.user_persona || "",
    system_prompt: activeProfile?.system_prompt || settings.system_prompt,
  });
  const [input, setInput] = useState("");
  const [showTyping, setShowTyping] = useState(false);
  const [characters, setCharacters] = useState<Character[]>([]);
  const [currentCharacter, setCurrentCharacterData] = useState<(Character & { world_description?: string }) | null>(null);
  const [editingTitle, setEditingTitle] = useState(false);
  const [titleInput, setTitleInput] = useState("");
  const [editingChatId, setEditingChatId] = useState<number | null>(null);
  const [editChatTitle, setEditChatTitle] = useState("");
  const [deleteConfirmId, setDeleteConfirmId] = useState<number | null>(null);
  const [sidebarContextMenu, setSidebarContextMenu] = useState<{ chatId: number; x: number; y: number } | null>(null);
  const [isGenerating, setIsGenerating] = useState(false);
  const [showStatsPanel, setShowStatsPanel] = useState(false);
  const [inlineStats, setInlineStats] = useState<ChatStats | null>(null);
  const [personalityStates, setPersonalityStates] = useState<any[]>([]);
  const [personalityStateName, setPersonalityStateName] = useState("");     // UI标签
  const [personalityStateText, setPersonalityStateText] = useState("");     // prompt注入文本
  const [statsRefreshKey, setStatsRefreshKey] = useState(0);
  const [sidebarSearch, setSidebarSearch] = useState("");
  const [sidebarFilterCharacter, setSidebarFilterCharacter] = useState<number | null>(null);
  const [showContextPanel, setShowContextPanel] = useState(false);
  const [soulContent, setSoulContent] = useState("");
  const [memoryContent, setMemoryContent] = useState("");
  const [editingSoul, setEditingSoul] = useState(false);
  const [editingSoulText, setEditingSoulText] = useState("");
  const [editingMemory, setEditingMemory] = useState(false);
  const [editingMemoryText, setEditingMemoryText] = useState("");
  const [quotedMessage, setQuotedMessage] = useState<{ id: number; content: string; role: string } | null>(null);
  const [deleteConfirmMsgId, setDeleteConfirmMsgId] = useState<number | null>(null);
  const [showScrollToBottom, setShowScrollToBottom] = useState(false);
  const [savedMsgId, setSavedMsgId] = useState<number | null>(null);
  const [quotedMessagesMap, setQuotedMessagesMap] = useState<Record<number, { id: number; role: string; content: string }>>({});
  const [mascotBound, setMascotBound] = useState(false);
  const [mascotBoundName, setMascotBoundName] = useState("");
  const [narrationBound, setNarrationBound] = useState(false);
  const [narrationBoundName, setNarrationBoundName] = useState("");

  // ─── 旁白 + 主动消息 ───
  const lastUserMsgTimeRef = useRef(Date.now());
  const narrationIdleTimerRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const narrationPollTimerRef = useRef<ReturnType<typeof setInterval> | null>(null);

  // 删除确认键盘监听（Enter=确认，Escape=取消）
  useEffect(() => {
    if (deleteConfirmId === null && deleteConfirmMsgId === null) return;
    function onKeyDown(e: KeyboardEvent) {
      if (e.key === "Enter") {
        e.preventDefault();
        if (deleteConfirmId !== null) confirmDeleteChat();
        else if (deleteConfirmMsgId !== null) handleDeleteMessage(deleteConfirmMsgId);
      } else if (e.key === "Escape") {
        setDeleteConfirmId(null);
        setDeleteConfirmMsgId(null);
      }
    }
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [deleteConfirmId, deleteConfirmMsgId]);

  const messagesEndRef = useRef<HTMLDivElement>(null);
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const messageContainerRef = useRef<HTMLDivElement>(null);
  const isComposingRef = useRef(false);
  const titleInputRef = useRef<HTMLInputElement>(null);
  const sidebarEditRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    loadChats();
    loadCharacters();
  }, []);

  useEffect(() => {
    if (currentChatId) {
      loadMessages();
      // 切换对话时，自动切换到该对话绑定的角色
      const chat = chats.find((c) => c.id === currentChatId);
      if (chat && chat.character_id !== undefined) {
        setCurrentCharacter(chat.character_id);
      }
    }
  }, [currentChatId]);

  // 加载看板娘绑定状态
  useEffect(() => {
    async function loadBinds() {
      try {
        const mBind = await invoke<any>("get_mascot_bind");
        if (mBind && mBind.chatId === currentChatId) {
          setMascotBound(true);
          setMascotBoundName(mBind.characterName || mBind.title);
        } else {
          setMascotBound(false);
          setMascotBoundName("");
        }
      } catch {
        setMascotBound(false);
        setMascotBoundName("");
      }
      try {
        const nBind = await invoke<any>("get_narration_bind");
        if (nBind && nBind.chatId === currentChatId) {
          setNarrationBound(true);
          setNarrationBoundName(nBind.characterName || nBind.title);
        } else {
          setNarrationBound(false);
          setNarrationBoundName("");
        }
      } catch {
        setNarrationBound(false);
        setNarrationBoundName("");
      }
    }
    if (!currentChatId) {
      setMascotBound(false);
      setMascotBoundName("");
      setNarrationBound(false);
      setNarrationBoundName("");
    } else {
      loadBinds();
    }
  }, [currentChatId]);

  // 绑定看板娘时每3秒自动刷新消息
  useEffect(() => {
    if (!currentChatId || !mascotBound) return;
    const interval = setInterval(async () => {
      try {
        await loadMessages();
      } catch {}
    }, 3000);
    return () => clearInterval(interval);
  }, [currentChatId, mascotBound]);

  // ─── 旁白 + 主动消息：闲置计时 ───
  // ── 主动消息调试日志 ──
  useEffect(() => {
    console.log("[narration] 启动条件检查:",
      "chatId=", currentChatId,
      "charId=", currentCharacterId,
      "proactive=", proactive.enabled,
      "narrationBound=", narrationBound,
      "intervalMin=", proactive.intervalMinutes,
      "silent=", proactive.silentStart, "~", proactive.silentEnd,
    );
  }, [currentChatId, currentCharacterId, proactive, narrationBound]);

  useEffect(() => {
    if (!currentChatId || !currentCharacterId || !proactive.enabled || !narrationBound) {
      if (narrationIdleTimerRef.current) {
        console.log("[narration] 闲置计时器停止 (条件不满足)");
        clearInterval(narrationIdleTimerRef.current);
        narrationIdleTimerRef.current = null;
      }
      return;
    }
    console.log("[narration] 闲置计时器启动");
    // 加载该对话最后一条用户消息的时间，作为闲置计时起点
    (async () => {
      try {
        const msgs = await getMessages(currentChatId);
        const lastUserMsg = [...msgs].reverse().find((m) => m.role === "user");
        if (lastUserMsg) {
          const ts = new Date(lastUserMsg.timestamp + (localStorage.getItem("luna-bind-clock") !== "false" ? 'Z' : '')).getTime();
          if (!isNaN(ts)) lastUserMsgTimeRef.current = ts;
        }
      } catch {}
    })();

    narrationIdleTimerRef.current = setInterval(async () => {
      const idleMs = Date.now() - lastUserMsgTimeRef.current;
      const idleMin = Math.floor(idleMs / 60000);
      console.log("[narration] 闲置: idle=" + idleMin + "min 阈值=" + proactive.intervalMinutes + "min");
      if (idleMin < proactive.intervalMinutes) {
        console.log("[narration] 闲置: 未达阈值，跳过");
        return;
      }

      // 静默时段
      if (proactive.silentStart && proactive.silentEnd) {
        const now = new Date();
        const nowMin = now.getHours() * 60 + now.getMinutes();
        const [sh, sm] = proactive.silentStart.split(":").map(Number);
        const [eh, em] = proactive.silentEnd.split(":").map(Number);
        const startMin = sh * 60 + sm;
        const endMin = eh * 60 + em;
        if (startMin <= endMin) {
          if (nowMin >= startMin && nowMin < endMin) { console.log("[narration] 闲置: 静默时段"); return; }
        } else {
          if (nowMin >= startMin || nowMin < endMin) { console.log("[narration] 闲置: 静默时段"); return; }
        }
      }

      // 已有队列不重复生成（不管到没到期）
      try {
        const exists = await invoke<boolean>("has_narration_queue", { chatId: currentChatId });
        if (exists) { console.log("[narration] 闲置: 队列已存在"); return; }
      } catch (e) { console.warn("[narration] 闲置: check队列失败", e); }

      try {
        console.log("[narration] 闲置: → generate_narration_queue");
        await invoke("generate_narration_queue", {
          chatId: currentChatId,
          idleMinutes: idleMin,
        });
        console.log("[narration] 闲置: ✓ 队列生成成功");
      } catch (e: any) {
        console.warn("[narration] 闲置: ✗ 生成失败:", e);
      }
    }, 30000);

    return () => {
      if (narrationIdleTimerRef.current) {
        clearInterval(narrationIdleTimerRef.current);
        narrationIdleTimerRef.current = null;
      }
    };
  }, [currentChatId, currentCharacterId, proactive.enabled, proactive.intervalMinutes,
      proactive.silentStart, proactive.silentEnd, narrationBound]);

  // ─── 旁白 + 主动消息：投递轮询 ───
  useEffect(() => {
    if (!currentChatId || !proactive.enabled || !narrationBound) {
      if (narrationPollTimerRef.current) {
        console.log("[narration] 投递轮询停止 (条件不满足)");
        clearInterval(narrationPollTimerRef.current);
        narrationPollTimerRef.current = null;
      }
      return;
    }
    console.log("[narration] 投递轮询启动");
    narrationPollTimerRef.current = setInterval(async () => {
      console.log("[narration] 投递: tick");
      try {
        // 投递也需遵守静默时段
        if (proactive.silentStart && proactive.silentEnd) {
          const now = new Date();
          const nowMin = now.getHours() * 60 + now.getMinutes();
          const [sh, sm] = proactive.silentStart.split(":").map(Number);
          const [eh, em] = proactive.silentEnd.split(":").map(Number);
          const startMin = sh * 60 + sm;
          const endMin = eh * 60 + em;
          if (startMin <= endMin) {
            if (nowMin >= startMin && nowMin < endMin) { console.log("[narration] 投递: 静默时段"); return; }
          } else {
            if (nowMin >= startMin || nowMin < endMin) { console.log("[narration] 投递: 静默时段"); return; }
          }
        }

        const due = await invoke<NarrationItem[]>("check_narration_queue", { chatId: currentChatId });
        if (!due || due.length === 0) {
          console.log("[narration] 投递: 无到期项");
          return;
        }
        console.log("[narration] 投递: 到期 " + due.length + " 条 — " + due.map(d => d.narration_type + ":" + d.text.slice(0, 20)).join(", "));

        for (const item of due) {
          const isAction = item.narration_type === "action";
          const content = isAction ? `*${item.text}*` : item.text;
          await saveMessage(
            currentChatId, "assistant", content,
            undefined, undefined, undefined, undefined, undefined, undefined, undefined,
            undefined, undefined, undefined,
            1, // is_proactive
            item.narration_type,
          );
        }
        await loadMessages();

        // 通知 L2D 窗口刷新消息
        if (mascotBound) {
          try { await emit("mascot:update", { chatId: currentChatId }); } catch {}
        }

        const ids = due.map((d: NarrationItem) => d.id);
        await invoke("deliver_narration_items", { chatId: currentChatId, itemIds: ids });
        console.log("[narration] 投递: ✓ " + ids.length + " 条已标记送达");
      } catch (e: any) {
        console.warn("[narration] 投递: ✗ 失败:", e);
      }
    }, 10000);

    return () => {
      if (narrationPollTimerRef.current) {
        clearInterval(narrationPollTimerRef.current);
        narrationPollTimerRef.current = null;
      }
    };
  }, [currentChatId, proactive.enabled, narrationBound,
      proactive.silentStart, proactive.silentEnd]);

  useEffect(() => {
    if (currentCharacterId) {
      loadCharacterData(currentCharacterId);
    } else {
      setCurrentCharacterData(null);
    }
  }, [currentCharacterId]);

  useEffect(() => {
    // 只有用户已经在底部时才自动滚；手动上划看历史时不强拉
    if (!showScrollToBottom) scrollToBottom();
  }, [messages, showTyping, showScrollToBottom]);

  useEffect(() => {
    if (editingChatId !== null && sidebarEditRef.current) {
      sidebarEditRef.current.focus();
      sidebarEditRef.current.select();
    }
  }, [editingChatId]);

  // 监听伴聊事件同步
  useEffect(() => {
    if (!window.__TAURI__?.event) return;
    const unlisten = window.__TAURI__.event.listen('luna:chat-update', () => {
      loadChats();
    });
    return () => { unlisten.then(f => f()); };
  }, []);

  // 加载内联属性条（必须等角色数据加载完才初始化，否则 stat_defaults 拿不到）
  useEffect(() => {
    if (!currentChatId || !currentCharacter) return;
    ensureChatStats(currentChatId, currentCharacter.stat_defaults).then(stats => {
      setInlineStats(stats);
    }).catch(() => setInlineStats(null));
  }, [currentChatId, currentCharacter, statsRefreshKey]);

  // 每次属性变化时同步回角色卡
  useEffect(() => {
    if (!currentCharacterId || !inlineStats || !currentCharacter) return;
    syncCharacterStatsFromChat(currentCharacterId).catch(console.warn);
  }, [inlineStats?.stat_happy, inlineStats?.stat_trust, inlineStats?.stat_affection]);

  // 检测当前人格状态 + 子卡切换
  useEffect(() => {
    if (!inlineStats || !currentCharacter || currentCharacter.card_type !== "companion") {
      setPersonalityStateName("");
      return;
    }
    const stats = inlineStats as any;
    const detected = detectPersonalityState(personalityStates, {
      stat_trust: stats.stat_trust ?? 50,
      stat_affection: stats.stat_affection ?? 50,
    });
    // personality_state_text = 子卡完整描述，用于注入 prompt
    setPersonalityStateName(detected?.state_name || "");
    setPersonalityStateText(detected ? `你当前处于「${detected.state_name}」状态，你的言行必须完全符合这个状态的设定，不能偏离：${detected.sub_personality || detected.prompt_text}` : "");

    // 子卡切换：将子卡性格写入角色卡
    if (detected && detected.sub_personality && detected.sub_personality !== currentCharacter.personality) {
      applySubCardPersonality(currentCharacter.id, detected as any).then(() => {
        // 重新加载角色数据，下次发消息 Rust 读到新 personality
        loadCharacterData(currentCharacter.id);
      }).catch(console.warn);
    }
  }, [inlineStats, personalityStates, currentCharacter]);

  // 打开上下文面板时加载 soul + memory 内容
  async function openContextPanel() {
    try {
      if (currentCharacterId) {
        const soul = await invoke<string>("get_soul_content", { characterId: currentCharacterId });
        setSoulContent(soul);
      } else {
        setSoulContent("");
      }
      if (currentChatId) {
        const mem = await invoke<string>("get_memory_content", { chatId: currentChatId });
        setMemoryContent(mem);
      } else {
        setMemoryContent("");
      }
    } catch (e) {
      console.warn("加载上下文失败:", e);
    }
    setShowContextPanel(true);
  }

  // 保存编辑后的 soul
  async function saveSoulEdit() {
    if (!currentCharacterId) return;
    try {
      await invoke("update_soul_command", { characterId: currentCharacterId, content: editingSoulText });
      setSoulContent(editingSoulText);
      setEditingSoul(false);
    } catch (e) {
      console.error("保存 soul 失败:", e);
    }
  }

  // 保存编辑后的 memory
  async function saveMemoryEdit() {
    if (!currentChatId) return;
    try {
      await invoke("update_memory_command", { chatId: currentChatId, content: editingMemoryText });
      setMemoryContent(editingMemoryText);
      setEditingMemory(false);
    } catch (e) {
      console.error("保存 memory 失败:", e);
    }
  }

  // 右键菜单：点击外部关闭
  useEffect(() => {
    if (!sidebarContextMenu) return;
    const close = () => setSidebarContextMenu(null);
    window.addEventListener("click", close);
    return () => window.removeEventListener("click", close);
  }, [sidebarContextMenu]);

  // 用户信息变更时同步到后端 user_info.md（每次都调，含首次 mount）
  useEffect(() => {
    invoke("save_user_info", {
      userName: settings.user_name || "",
      userPersona: settings.user_persona || "",
    }).catch((e) => console.warn("save_user_info failed:", e));
  }, [settings.user_name, settings.user_persona]);

  async function loadChats() {
    const data = await getChats();
    setChats(data);
    if (data.length > 0 && !currentChatId) {
      setCurrentChat(data[0].id);
    }
  }

  async function loadMessages() {
    if (!currentChatId) return;
    const data = await getMessages(currentChatId);
    setMessages(data as Message[]);
    // 加载被引用的消息（用于紧凑引用条显示）
    const quoteIds = data.filter((m: any) => m.reply_to_id).map((m: any) => m.reply_to_id);
    if (quoteIds.length > 0) {
      const uniqueIds = [...new Set(quoteIds)] as number[];
      const map: Record<number, { id: number; role: string; content: string }> = {};
      await Promise.all(uniqueIds.map(async (id) => {
        const msg = await getMessageById(id);
        if (msg) map[id] = msg;
      }));
      setQuotedMessagesMap(map);
    }
    // 刷新上下文面板 memory 内容
    if (showContextPanel) {
      invoke<string>("get_memory_content", { chatId: currentChatId })
        .then(setMemoryContent)
        .catch(console.warn);
    }
  }

  async function loadCharacters() {
    try {
      const data = await getCharacters();
      setCharacters(data.filter((c) => c.is_active === 1));
    } catch (err) {
      console.error("加载角色失败:", err);
    }
  }

  async function loadCharacterData(id: number) {
    try {
      const char = await getCharacterWithWorld(id);
      setCurrentCharacterData(char);
      // 加载人格状态（陪伴卡）
      const states = await getPersonalityStates(id);
      setPersonalityStates(states);
    } catch (err) {
      console.error("加载角色详情失败:", err);
    }
  }

  function scrollToBottom() {
    messagesEndRef.current?.scrollIntoView({ behavior: "smooth" });
  }

  async function handleNewChat() {
    const id = await createChat("新对话", currentCharacterId || undefined);
    await loadChats();
    setCurrentChat(id);
    setMessages([]);
  }

  async function handleDeleteChat(e: React.MouseEvent, id: number) {
    e.stopPropagation();
    setDeleteConfirmId(id);
  }

  async function confirmDeleteChat() {
    if (deleteConfirmId === null) return;
    const id = deleteConfirmId;
    setDeleteConfirmId(null);
    await deleteChat(id);
    await loadChats();
    if (currentChatId === id) {
      setCurrentChat(null);
      setMessages([]);
    }
  }

  async function handleTogglePin(e: React.MouseEvent, chatId: number, isPinned: boolean) {
    e.stopPropagation();
    await togglePinChat(chatId, !isPinned);
    await loadChats();
  }

  async function saveChatTitle(id: number) {
    if (editChatTitle.trim()) {
      await updateChatTitle(id, editChatTitle.trim());
      await loadChats();
    }
    setEditingChatId(null);
  }

  function handleEditKeyDown(e: React.KeyboardEvent, id: number) {
    if (e.key === "Enter" && !e.nativeEvent.isComposing) {
      saveChatTitle(id);
    } else if (e.key === "Escape") {
      setEditingChatId(null);
    }
  }

  function startEditTitle() {
    if (!currentChat) return;
    setTitleInput(currentChat.title);
    setEditingTitle(true);
    setTimeout(() => titleInputRef.current?.focus(), 0);
  }

  async function handleTitleSubmit() {
    if (!currentChatId || !titleInput.trim()) {
      setEditingTitle(false);
      return;
    }
    try {
      await updateChatTitle(currentChatId, titleInput.trim());
      await loadChats();
    } catch (err) {
      console.error("重命名失败:", err);
    }
    setEditingTitle(false);
  }

  function handleTitleKeyDown(e: React.KeyboardEvent) {
    if (e.key === "Enter") {
      e.preventDefault();
      handleTitleSubmit();
    } else if (e.key === "Escape") {
      setEditingTitle(false);
    }
  }

  async function handleSend() {
    // settings 未加载完毕，拦截
    if (!ready) return;
    // 如果正在生成，点击即为停止
    if (isGenerating) {
      // 立即重置所有状态，不等后端返回（后端 cancel token 有延迟）
      setIsGenerating(false);
      setIsLoading(false);
      setShowTyping(false);
      try {
        await invoke("stop_generation");
      } catch (e) {
        console.warn("stop_generation failed:", e);
      }
      return;
    }

    if (!input.trim() || !currentChatId || isLoading) return;

    const userContent = input.trim();
    setInput("");
    if (textareaRef.current) {
      textareaRef.current.style.height = "auto";
    }

    // 引用：只存 reply_to_id，不把引用文本塞进内容
    const quotedMsgId = quotedMessage?.id || null;

    // Save user message（干净的原文 + 引用 ID）
    await saveMessage(currentChatId, "user", userContent, undefined, undefined, undefined, undefined, undefined, undefined, quotedMsgId);
    await loadMessages();

    // 用户说话 → 清空旁白队列 + 重置计时器
    lastUserMsgTimeRef.current = Date.now();
    try {
      await invoke("clear_narration_queue", { chatId: currentChatId });
    } catch {}

    setIsLoading(true);
    setIsGenerating(true);
    setShowTyping(true);

    try {
      // 构建传给 AI 的历史消息（带日期+时间戳 + 引用上下文）
      const now = new Date();
      const currentDateStr = `${String(now.getMonth() + 1).padStart(2, "0")}-${String(now.getDate()).padStart(2, "0")}`;
      const currentTimeStr = `${String(now.getHours()).padStart(2, "0")}:${String(now.getMinutes()).padStart(2, "0")}`;

      const history: ChatMessage[] = messages.map((m) => {
        const ts = toLocal(m.timestamp);
        const dateStr = `${String(ts.getMonth() + 1).padStart(2, "0")}-${String(ts.getDate()).padStart(2, "0")}`;
        const timeStr = `${String(ts.getHours()).padStart(2, "0")}:${String(ts.getMinutes()).padStart(2, "0")}`;
        let content = m.content;
        if (m.reply_to_id && quotedMessagesMap[m.reply_to_id]) {
          const quoted = quotedMessagesMap[m.reply_to_id];
          const label = quoted.role === "assistant"
            ? (currentCharacter?.name || "AI") + " 刚才说的"
            : "之前说过的";
          content = `「用户引用了${label}」：\n"${quoted.content.slice(0, 200)}${quoted.content.length > 200 ? "..." : ""}"\n---\n${m.content}`;
        }
        // 注入日期+时间戳: [MM-DD HH:MM]
        content = `[${dateStr} ${timeStr}] ${content}`;
        return { role: m.role, content, reasoning_content: m.reasoning_content ?? undefined };
      });

      // 当前消息也补上时间戳 + 引用上下文给 AI
      let aiContent = `【当前时间: ${currentDateStr} ${currentTimeStr}】\n${userContent}`;
      if (quotedMessage) {
        const label = quotedMessage.role === "assistant"
          ? (currentCharacter?.name || "AI") + " 刚才说的"
          : "之前说过的";
        aiContent = `「用户引用了${label}」：\n"${quotedMessage.content.slice(0, 200)}${quotedMessage.content.length > 200 ? "..." : ""}"\n---\n${aiContent}`;
        setQuotedMessage(null);
      }

      const characterInfo: CharacterInfo | null = currentCharacter
        ? {
            name: currentCharacter.name,
            description: currentCharacter.description || "",
            personality: currentCharacter.personality || "",
            world_name: currentCharacter.world_name || "",
            world_description: currentCharacter.world_description || "",
          }
        : null;

      const response = await invoke<AgentResponse>("send_message", {
        content: aiContent,
        characterId: currentCharacterId ?? null,
        chatId: currentChatId,
        character: characterInfo,
        settings: getApiSettings(),
        history,
      });

      await saveMessage(
        currentChatId,
        "assistant",
        response.reply,
        response.emotion,
        response.speech,
        response.action,
        undefined,
        undefined,
        response.reasoning_content,
        undefined,
        response.quote?.content || null,
        response.quote?.speaker || null,
        response.quote?.time || null,
      );

      // 应用情绪变化到属性值系统
      if (response.emotion && response.emotion !== "idle") {
        applyEmotionDelta(currentChatId, null, response.emotion).then(() => {
  if (currentCharacterId) syncCharacterStatsFromChat(currentCharacterId).catch(console.warn);
  setStatsRefreshKey(k => k + 1);
}).catch(console.warn);
      }

      await loadMessages();

      // 如果该对话绑定了看板娘，通知刷新
      if (mascotBound) {
        try { await emit("mascot:update", { chatId: currentChatId }); } catch {}
      }

      if (currentChat?.title === "新对话") {
        try {
          const title = await invoke<string>("generate_chat_title", {
            userMessage: aiContent,
            assistantReply: response.reply,
            settings: getApiSettings(),
          });
          if (title && title.trim()) {
            await updateChatTitle(currentChatId, title.trim());
            await loadChats();
          }
        } catch {
          console.warn("自动生成标题失败");
        }
      }
    } catch (error) {
      const errorMsg = error instanceof Error ? error.message : String(error);
      // 用户取消生成时静默处理，不存错误消息
      if (!errorMsg.includes("取消")) {
        await saveMessage(currentChatId, "system", `错误: ${errorMsg}`, "sad");
        await loadMessages();
      }
    } finally {
      setIsLoading(false);
      setIsGenerating(false);
      setShowTyping(false);
    }
  }

  function handleKeyDown(e: React.KeyboardEvent) {
    if (e.key === "Enter" && !e.shiftKey && !isComposingRef.current) {
      e.preventDefault();
      handleSend();
    }
  }

  function handleInput(e: React.ChangeEvent<HTMLTextAreaElement>) {
    setInput(e.target.value);
    e.target.style.height = "auto";
    e.target.style.height = Math.min(e.target.scrollHeight, 120) + "px";
  }

  async function handleBranchAsNewChat(messageId: number) {
    if (!currentChatId || !currentChat) return;
    try {
      const title = currentChat.title || "新对话";
      const newChatId = await branchChat(currentChatId, messageId, `分支: ${title}`);
      await loadChats();
      setCurrentChat(newChatId);
    } catch (e) {
      console.error("分支失败:", e);
    }
  }

  async function handleRegenerate(assistantMsgId: number) {
    if (!currentChatId || isGenerating) return;

    const chatMessages = await getMessages(currentChatId);
    const assistantIdx = chatMessages.findIndex((m) => m.id === assistantMsgId);
    if (assistantIdx < 0) return;

    const prevMsg = assistantIdx > 0 ? chatMessages[assistantIdx - 1] : null;
    const isContinuation = prevMsg?.role === "assistant";

    if (isContinuation) {
      // 续写消息：只删除这条及之后，重新续写
      await deleteMessagesFrom(currentChatId, assistantMsgId);
      await loadMessages();

      setIsLoading(true);
      setIsGenerating(true);
      setShowTyping(true);

      try {
        const latestMessages = await getMessages(currentChatId);
        const history: ChatMessage[] = latestMessages.map((m) => {
          const ts = toLocal(m.timestamp);
          const dateStr = `${String(ts.getMonth() + 1).padStart(2, "0")}-${String(ts.getDate()).padStart(2, "0")}`;
          const timeStr = `${String(ts.getHours()).padStart(2, "0")}:${String(ts.getMinutes()).padStart(2, "0")}`;
          return {
            role: m.role,
            content: `[${dateStr} ${timeStr}] ${m.content}`,
            reasoning_content: m.reasoning_content ?? undefined,
          };
        });

        const characterInfo: CharacterInfo | null = currentCharacter
          ? {
              name: currentCharacter.name,
              description: currentCharacter.description || "",
              personality: currentCharacter.personality || "",
              world_name: currentCharacter.world_name || "",
              world_description: currentCharacter.world_description || "",
              personality_state_text: personalityStateText,
              stat_values_json: inlineStats ? JSON.stringify({stat_happy: inlineStats.stat_happy, stat_discomfort: inlineStats.stat_discomfort, stat_trust: inlineStats.stat_trust, stat_energy: inlineStats.stat_energy, stat_affection: inlineStats.stat_affection, stat_curiosity: inlineStats.stat_curiosity, stat_relax: inlineStats.stat_relax, stat_depression: inlineStats.stat_depression}) : "",
            }
          : null;

        const response = await invoke<AgentResponse>("continue_message", {
          characterId: currentCharacterId ?? null,
          chatId: currentChatId,
          character: characterInfo,
          settings: getApiSettings(),
          history,
        });

        await saveMessage(currentChatId, "assistant", response.reply, response.emotion, response.speech, response.action, undefined, undefined, response.reasoning_content, undefined, response.quote?.content || null, response.quote?.speaker || null, response.quote?.time || null);
        // 应用情绪变化
        if (response.emotion && response.emotion !== "idle") {
          applyEmotionDelta(currentChatId, null, response.emotion).then(() => {
  if (currentCharacterId) syncCharacterStatsFromChat(currentCharacterId).catch(console.warn);
  setStatsRefreshKey(k => k + 1);
}).catch(console.warn);
        }
        await loadMessages();
      } catch (error) {
        const errorMsg = error instanceof Error ? error.message : String(error);
        if (!errorMsg.includes("取消")) {
          await saveMessage(currentChatId, "system", `错误: ${errorMsg}`, "sad");
          await loadMessages();
        }
      } finally {
        setIsLoading(false);
        setIsGenerating(false);
        setShowTyping(false);
      }
    } else {
      // 非续写消息：找到前面最后一条 user，删除之后全部，重新 send_message
      let userIdx = assistantIdx - 1;
      while (userIdx >= 0 && chatMessages[userIdx].role !== "user") {
        userIdx--;
      }
      if (userIdx < 0) return;

      const lastUserMsg = chatMessages[userIdx];
      await deleteMessagesAfter(currentChatId, lastUserMsg.id);
      await loadMessages();

      setIsLoading(true);
      setIsGenerating(true);
      setShowTyping(true);

      try {
        const history: ChatMessage[] = messages.map((m) => {
          const ts = toLocal(m.timestamp);
          const dateStr = `${String(ts.getMonth() + 1).padStart(2, "0")}-${String(ts.getDate()).padStart(2, "0")}`;
          const timeStr = `${String(ts.getHours()).padStart(2, "0")}:${String(ts.getMinutes()).padStart(2, "0")}`;
          return {
            role: m.role,
            content: `[${dateStr} ${timeStr}] ${m.content}`,
            reasoning_content: m.reasoning_content ?? undefined,
          };
        });

        const characterInfo: CharacterInfo | null = currentCharacter
          ? {
              name: currentCharacter.name,
              description: currentCharacter.description || "",
              personality: currentCharacter.personality || "",
              world_name: currentCharacter.world_name || "",
              world_description: currentCharacter.world_description || "",
              personality_state_text: personalityStateText,
              stat_values_json: inlineStats ? JSON.stringify({stat_happy: inlineStats.stat_happy, stat_discomfort: inlineStats.stat_discomfort, stat_trust: inlineStats.stat_trust, stat_energy: inlineStats.stat_energy, stat_affection: inlineStats.stat_affection, stat_curiosity: inlineStats.stat_curiosity, stat_relax: inlineStats.stat_relax, stat_depression: inlineStats.stat_depression}) : "",
            }
          : null;

        const response = await invoke<AgentResponse>("send_message", {
          content: lastUserMsg.content,
          characterId: currentCharacterId ?? null,
          chatId: currentChatId,
          character: characterInfo,
          settings: getApiSettings(),
          history,
        });

        await saveMessage(currentChatId, "assistant", response.reply, response.emotion, response.speech, response.action, undefined, undefined, response.reasoning_content, undefined, response.quote?.content || null, response.quote?.speaker || null, response.quote?.time || null);
        if (response.emotion && response.emotion !== "idle") {
          applyEmotionDelta(currentChatId, null, response.emotion).then(() => {
  if (currentCharacterId) syncCharacterStatsFromChat(currentCharacterId).catch(console.warn);
  setStatsRefreshKey(k => k + 1);
}).catch(console.warn);
        }
        await loadMessages();
      } catch (error) {
        const errorMsg = error instanceof Error ? error.message : String(error);
        if (!errorMsg.includes("取消")) {
          await saveMessage(currentChatId, "system", `错误: ${errorMsg}`, "sad");
          await loadMessages();
        }
      } finally {
        setIsLoading(false);
        setIsGenerating(false);
        setShowTyping(false);
      }
    }
  }

  // 继续输出：角色根据上文再回复一句，用于推进剧情
  async function handleContinue() {
    if (!currentChatId || isGenerating) return;

    setIsLoading(true);
    setIsGenerating(true);
    setShowTyping(true);

    try {
      // 取最新消息构建历史
      const latestMessages = await getMessages(currentChatId);
      const history: ChatMessage[] = latestMessages.map((m) => {
        const ts = toLocal(m.timestamp);
        const timeStr = ts.toLocaleTimeString("zh-CN", { hour: "2-digit", minute: "2-digit" });
        return {
          role: m.role,
          content: `[${timeStr}] ${m.content}`,
          reasoning_content: m.reasoning_content ?? undefined,
        };
      });

      const characterInfo: CharacterInfo | null = currentCharacter
        ? {
            name: currentCharacter.name,
            description: currentCharacter.description || "",
            personality: currentCharacter.personality || "",
            world_name: currentCharacter.world_name || "",
            world_description: currentCharacter.world_description || "",
          }
        : null;

      const response = await invoke<AgentResponse>("continue_message", {
        characterId: currentCharacterId ?? null,
        chatId: currentChatId,
        character: characterInfo,
        settings: getApiSettings(),
        history,
      });

      await saveMessage(
        currentChatId,
        "assistant",
        response.reply,
        response.emotion,
        response.speech,
        response.action,
        undefined,
        undefined,
        response.reasoning_content,
        undefined,
        response.quote?.content || null,
        response.quote?.speaker || null,
        response.quote?.time || null,
      );

      if (response.emotion && response.emotion !== "idle") {
        applyEmotionDelta(currentChatId, null, response.emotion).then(() => {
  if (currentCharacterId) syncCharacterStatsFromChat(currentCharacterId).catch(console.warn);
  setStatsRefreshKey(k => k + 1);
}).catch(console.warn);
      }

      await loadMessages();
    } catch (error) {
      const errorMsg = error instanceof Error ? error.message : String(error);
      if (!errorMsg.includes("取消")) {
        await saveMessage(currentChatId, "system", `错误: ${errorMsg}`, "sad");
        await loadMessages();
      }
    } finally {
      setIsLoading(false);
      setIsGenerating(false);
      setShowTyping(false);
    }
  }

  // 修改最后一条用户输入
  async function handleEditLastUser(msg: Message) {
    if (!currentChatId || isGenerating) return;
    const content = msg.content;
    try {
      await deleteMessagesFrom(currentChatId, msg.id);
      await loadMessages();
      setInput(content);
      // 自动调整 textarea 高度
      setTimeout(() => {
        if (textareaRef.current) {
          textareaRef.current.focus();
          textareaRef.current.style.height = "auto";
          textareaRef.current.style.height = Math.min(textareaRef.current.scrollHeight, 120) + "px";
        }
      }, 0);
    } catch (err) {
      console.error("修改消息失败:", err);
    }
  }

  // 引用某条消息
  function handleQuote(msg: Message) {
    setQuotedMessage({ id: msg.id, content: msg.content, role: msg.role });
    setShowContextPanel(false);
  }

  // 清除引用
  function clearQuote() {
    setQuotedMessage(null);
  }

  // 存入记忆
  async function handleSaveToMemory(msg: Message) {
    if (!currentChatId) return;
    try {
      await invoke("append_memory_command", { chatId: currentChatId, content: msg.content });
      setSavedMsgId(msg.id);
      setTimeout(() => setSavedMsgId(null), 2000);
    } catch (e) {
      console.error("存入记忆失败:", e);
      alert("存入失败");
    }
  }

  async function handleDeleteMessage(messageId: number) {
    setDeleteConfirmMsgId(null);
    try {
      await deleteMessage(messageId);
      setMessages(messages.filter((m) => m.id !== messageId));
    } catch (err) {
      console.error("删除消息失败:", err);
    }
  }

  const currentChat = chats.find((c) => c.id === currentChatId);

  // 侧边栏：过滤 + 日期分组
  // 分离伴聊对话
  const companionChats = chats.filter((c: any) => (c as any).chat_type === 'companion');
  const normalChats = chats.filter((c: any) => (c as any).chat_type !== 'companion');

  const filteredChats = normalChats.filter((c) => {
    const matchSearch = !sidebarSearch || c.title.toLowerCase().includes(sidebarSearch.toLowerCase());
    const matchChar = sidebarFilterCharacter === null || c.character_id === sidebarFilterCharacter;
    return matchSearch && matchChar;
  });

  // 日期分组标签
  function getGroupLabel(dateStr: string): string {
    const d = new Date(dateStr + 'Z');
    const now = new Date();
    const today = new Date(now.getFullYear(), now.getMonth(), now.getDate());
    const yesterday = new Date(today.getTime() - 86400000);
    const weekAgo = new Date(today.getTime() - 7 * 86400000);
    if (d >= today) return "今天";
    if (d >= yesterday) return "昨天";
    if (d >= weekAgo) return "本周";
    return "更早";
  }

  // 置顶对话独立分组，其余按日期分组
  const pinnedChats = filteredChats.filter((c) => c.is_pinned === 1);
  const unpinnedChats = filteredChats.filter((c) => c.is_pinned === 0);
  const groupOrder = ["今天", "昨天", "本周", "更早"];
  const chatsByGroup: { label: string; items: typeof filteredChats }[] = [];
  if (pinnedChats.length > 0) {
    chatsByGroup.push({ label: "置顶", items: pinnedChats });
  }
  // 伴聊对话独立分组
  if (companionChats.length > 0) {
    chatsByGroup.push({ label: "💬 伴聊", items: companionChats as any });
  }
  for (const label of groupOrder) {
    const items = unpinnedChats.filter((c) => getGroupLabel(c.updated_at) === label);
    if (items.length > 0) {
      chatsByGroup.push({ label, items });
    }
  }

  return (
    <div className="flex h-full">
      {/* Sidebar - Chat List */}
      <aside className="w-56 bg-luna-bg-secondary border-r border-luna-border flex flex-col flex-shrink-0">
        <div className="p-3.5 pb-3.5 border-b border-luna-border">
          <button
            onClick={handleNewChat}
            className="w-full py-2 px-3.5 bg-luna-accent text-white rounded-md text-sm font-medium flex items-center justify-center gap-1.5 hover:bg-[#3C3489] transition-colors"
          >
            + 新建对话
          </button>
        </div>
        <div className="p-3">
          <input
            type="text"
            placeholder="搜索对话..."
            value={sidebarSearch}
            onChange={(e) => setSidebarSearch(e.target.value)}
            className="w-full py-2 px-3 bg-luna-bg border border-luna-border rounded-md text-sm text-luna-text outline-none focus:border-luna-accent placeholder:text-luna-text-tertiary"
          />
          <select
            value={sidebarFilterCharacter ?? ""}
            onChange={(e) => setSidebarFilterCharacter(e.target.value ? parseInt(e.target.value) : null)}
            className="w-full mt-1.5 py-1.5 px-2.5 bg-luna-bg border border-luna-border rounded-md text-xs text-luna-text-secondary outline-none focus:border-luna-accent"
          >
            <option value="">全部角色</option>
            {characters.map((c) => (
              <option key={c.id} value={c.id}>
                {c.avatar} {c.name}
              </option>
            ))}
          </select>
        </div>
        <div className="px-3.5 pb-1.5 text-xs font-medium text-luna-text-tertiary uppercase tracking-wider">
          对话
        </div>

        {/* 删除确认条 */}
        {deleteConfirmId !== null && (
          <div className="inline-flex items-center gap-1.5 mx-3 mb-2 px-2 py-1 bg-red-50 border border-red-200 rounded-lg text-xs">
            <span className="text-red-600">删除？</span>
            <button onClick={() => setDeleteConfirmId(null)} className="text-luna-text-tertiary hover:text-luna-text transition-colors">取消</button>
            <button onClick={confirmDeleteChat} className="text-red-500 hover:text-red-700 font-medium transition-colors">确认</button>
          </div>
        )}

        <div className="flex-1 overflow-y-auto scrollbar-thin px-2">
          {chatsByGroup.map(({ label, items }) => {
            if (items.length === 0) return null;
            return (
              <div key={label}>
                <div className="text-[11px] text-luna-text-tertiary px-1.5 py-1.5 mt-1 font-medium uppercase">
                  {label}
                </div>
                {items.map((chat) => (
                  <div
                    key={chat.id}
                    onClick={() => setCurrentChat(chat.id)}
                    onContextMenu={(e) => {
                      e.preventDefault();
                      setSidebarContextMenu({ chatId: chat.id, x: e.clientX, y: e.clientY });
                    }}
                    className={`group p-2.5 rounded-lg cursor-pointer mb-0.5 flex items-center gap-2.5 transition-colors border border-luna-border ${
                      currentChatId === chat.id
                        ? "bg-luna-bg"
                        : "bg-transparent hover:bg-luna-bg"
                    }`}
                  >
                    <div className="w-9 h-9 rounded-md bg-luna-accent-light flex items-center justify-center text-base flex-shrink-0">
                      
                    </div>
                    <div className="flex-1 min-w-0">
                      {editingChatId === chat.id ? (
                        <input
                          ref={sidebarEditRef}
                          type="text"
                          value={editChatTitle}
                          onChange={(e) => setEditChatTitle(e.target.value)}
                          onBlur={() => saveChatTitle(chat.id)}
                          onKeyDown={(e) => handleEditKeyDown(e, chat.id)}
                          onClick={(e) => e.stopPropagation()}
                          className="w-full text-sm font-medium text-luna-text bg-luna-bg-secondary border border-luna-accent rounded px-1.5 py-0.5 outline-none"
                        />
                      ) : (
                        <div className="text-sm font-medium text-luna-text truncate">
                          {chat.title}
                        </div>
                      )}
                      <div className="text-xs text-luna-text-tertiary truncate mt-0.5">
                        {toLocal(chat.updated_at).toLocaleDateString("zh-CN")}
                      </div>
                    </div>
                    <div className="flex items-center gap-0.5">
                      <button
                        onClick={(e) => handleTogglePin(e, chat.id, !!chat.is_pinned)}
                        className={`w-6 h-6 rounded-md flex items-center justify-center transition-all ${
                          chat.is_pinned
                            ? "text-luna-accent opacity-100"
                            : "text-luna-text-tertiary opacity-0 group-hover:opacity-100 hover:text-luna-accent hover:bg-luna-accent/10"
                        }`}
                        title={chat.is_pinned ? "取消置顶" : "置顶"}
                      >
                        <svg width="13" height="13" viewBox="0 0 16 16" fill="none" xmlns="http://www.w3.org/2000/svg">
                          <path d="M9.5 2.5L10.5 1.5L14.5 5.5L13.5 6.5L10 6L6 10L4 9L8 5L9.5 2.5Z" fill={chat.is_pinned ? "currentColor" : "none"} stroke="currentColor" strokeWidth="1.2" strokeLinejoin="round"/>
                          <line x1="6" y1="10" x2="1" y2="15" stroke="currentColor" strokeWidth="1.2" strokeLinecap="round"/>
                        </svg>
                      </button>
                      <button
                        onClick={(e) => handleDeleteChat(e, chat.id)}
                        className="w-6 h-6 rounded-md flex items-center justify-center text-luna-text-tertiary hover:text-luna-red hover:bg-red-50 transition-all opacity-0 group-hover:opacity-100"
                        title="删除对话"
                      >
                        <svg width="12" height="12" viewBox="0 0 14 14" fill="none" xmlns="http://www.w3.org/2000/svg">
                          <path d="M1 1L13 13M1 13L13 1" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round"/>
                        </svg>
                      </button>
                    </div>
                  </div>
                ))}
              </div>
            );
          })}
          {filteredChats.length === 0 && (
            <div className="text-xs text-luna-text-tertiary text-center py-6 px-2">
              {sidebarSearch || sidebarFilterCharacter ? "没有匹配的对话" : "暂无对话"}
            </div>
          )}
        </div>

        {/* 侧边栏右键菜单 */}
        {sidebarContextMenu && (
          <div
            className="fixed z-50 bg-luna-bg border border-luna-border rounded-lg shadow-xl py-1 min-w-[150px]"
            style={{ left: sidebarContextMenu.x, top: sidebarContextMenu.y }}
          >
            <button
              onClick={() => {
                const chat = chats.find((c) => c.id === sidebarContextMenu.chatId);
                if (chat) {
                  setEditingChatId(chat.id);
                  setEditChatTitle(chat.title);
                }
                setSidebarContextMenu(null);
              }}
              className="w-full text-left px-3.5 py-2 text-sm text-luna-text hover:bg-luna-bg-secondary flex items-center gap-2"
            >
              <span></span> 重命名对话
            </button>
            <button
              onClick={() => {
                setDeleteConfirmId(sidebarContextMenu.chatId);
                setSidebarContextMenu(null);
              }}
              className="w-full text-left px-3.5 py-2 text-sm text-luna-red hover:bg-red-50 flex items-center gap-2"
            >
              <span></span> 删除对话
            </button>
          </div>
        )}
      </aside>

      {/* Main Chat Area */}
      <main className="flex-1 flex flex-col min-w-0 overflow-hidden bg-luna-bg">
        {currentChatId ? (
          <>
            {/* Chat Header */}
            <div className="px-3.5 py-3.5 border-b border-luna-border flex items-center justify-between flex-shrink-0">
              <div className="flex items-center gap-3 min-w-0 flex-1">
                <div className="w-9 h-9 rounded-md bg-luna-accent-light flex items-center justify-center text-lg">
                  {currentCharacter?.avatar || "🌙"}
                </div>
                <div>
                  {editingTitle ? (
                    <input
                      ref={titleInputRef}
                      value={titleInput}
                      onChange={(e) => setTitleInput(e.target.value)}
                      onBlur={handleTitleSubmit}
                      onKeyDown={handleTitleKeyDown}
                      className="text-sm font-semibold text-luna-text bg-luna-bg border border-luna-accent rounded px-2 py-0.5 outline-none w-48"
                    />
                  ) : (
                    <div
                      onClick={startEditTitle}
                      className="text-sm font-semibold text-luna-text cursor-pointer hover:text-luna-accent transition-colors"
                      title="点击重命名"
                    >
                      {currentChat?.title || "新对话"}
                    </div>
                  )}
                  <div className="text-xs text-luna-text-tertiary flex items-center gap-1.5 min-w-0">
                    <span>{currentCharacter ? `正在扮演: ${currentCharacter.name}` : "LunA"}</span>
                    {currentCharacter?.world_name && <span className="text-luna-border">|</span>}
                    {currentCharacter?.world_name && (
                      <span className="text-luna-text-secondary truncate">{currentCharacter.world_name}</span>
                    )}
                  </div>
                </div>
              </div>
              <div className="flex items-center gap-2 flex-shrink-0">
                <button
                  onClick={openContextPanel}
                  className="w-8 h-8 rounded-md bg-luna-bg-secondary border border-luna-border flex items-center justify-center text-sm hover:bg-luna-bg-tertiary hover:border-luna-accent transition-colors"
                  title="查看角色与记忆"
                >
                  
                </button>
                {/* Character Selector */}
                <select
                  value={currentCharacterId || ""}
                  onChange={async (e) => {
                    const id = e.target.value ? parseInt(e.target.value) : null;
                    setCurrentCharacter(id);
                    // 更新当前对话绑定的角色
                    if (currentChatId) {
                      await updateChatCharacter(currentChatId, id);
                      await loadChats();
                    }
                  }}
                  className="py-1.5 px-3 bg-luna-bg-secondary border border-luna-border rounded-md text-sm text-luna-text outline-none focus:border-luna-accent"
                >
                  <option value="">默认模式</option>
                  {characters.map((char) => (
                    <option key={char.id} value={char.id}>
                      {char.avatar} {char.name}
                    </option>
                  ))}
                </select>
                {/* 看板娘绑定/解绑 */}
                <button
                  onClick={async () => {
                    if (!currentChatId) return;
                    if (mascotBound) {
                      try {
                        await invoke("unbind_mascot");
                        setMascotBound(false);
                        setMascotBoundName("");
                      } catch (e) {
                        console.error("解绑失败:", e);
                      }
                    } else {
                      try {
                        await invoke("bind_mascot", { chatId: currentChatId });
                        setMascotBound(true);
                        const bindInfo = await invoke<any>("get_mascot_bind");
                        setMascotBoundName(bindInfo?.characterName || bindInfo?.title || "");
                      } catch (e) {
                        console.error("绑定失败:", e);
                      }
                    }
                  }}
                  className={`text-xs px-2.5 py-1.5 rounded-md border transition-colors whitespace-nowrap ${
                    mascotBound
                      ? "bg-luna-accent text-white border-luna-accent"
                      : "bg-luna-bg-secondary text-luna-text-secondary border-luna-border hover:border-luna-accent hover:text-luna-accent"
                  }`}
                  title={mascotBound ? `已绑定看板娘: ${mascotBoundName}` : "绑定对话到看板娘"}
                >
                  {mascotBound ? "解绑" : "绑定看板娘"}
                </button>
                {/* 旁白绑定/解绑 */}
                <button
                  onClick={async () => {
                    if (!currentChatId) return;
                    if (narrationBound) {
                      try {
                        await invoke("unbind_narration");
                        setNarrationBound(false);
                        setNarrationBoundName("");
                      } catch (e) {
                        console.error("解绑旁白失败:", e);
                      }
                    } else {
                      try {
                        await invoke("bind_narration", { chatId: currentChatId });
                        setNarrationBound(true);
                        const bindInfo = await invoke<any>("get_narration_bind");
                        setNarrationBoundName(bindInfo?.characterName || bindInfo?.title || "");
                      } catch (e) {
                        console.error("绑定旁白失败:", e);
                      }
                    }
                  }}
                  className={`text-xs px-2.5 py-1.5 rounded-md border transition-colors whitespace-nowrap ${
                    narrationBound
                      ? "bg-luna-accent text-white border-luna-accent"
                      : "bg-luna-bg-secondary text-luna-text-secondary border-luna-border hover:border-luna-accent hover:text-luna-accent"
                  }`}
                  title={narrationBound ? `已绑定旁白: ${narrationBoundName}` : "绑定对话到旁白系统"}
                >
                  {narrationBound ? "解绑" : "绑定旁白"}
                </button>
              </div>
            </div>

            {/* 人格状态标签 + Inline Stats Bar */}
            {personalityStateName && (
              <div className="flex items-center gap-2 px-5 pt-2">
                <span className="text-[11px] px-2 py-0.5 rounded-full bg-gradient-to-r from-[#667eea] to-[#764ba2] text-white font-medium">✦ {personalityStateName}</span>
              </div>
            )}
            {currentChatId && currentCharacter && inlineStats && (
              <div
                className="px-3.5 py-2 bg-luna-bg-secondary border-b border-luna-border grid grid-cols-4 lg:grid-cols-8 gap-x-2 gap-y-1 cursor-pointer"
                onClick={() => setShowStatsPanel(true)}
                title="点击查看详细属性"
              >
                {INLINE_STAT_KEYS.map((key) => {
                  const val = Math.round((inlineStats as any)[key] || 0);
                  return (
                    <div key={key} className="flex items-center gap-1 min-w-0">
                      <span className="text-[10px] leading-none flex-shrink-0">{INLINE_STAT_EMOJI[key]}</span>
                      <div className="flex-1 h-2 rounded-full overflow-hidden min-w-[8px]" style={{ background: 'var(--color-luna-border, #3a3a4a)' }}>
                        <div className="h-full rounded-full transition-all"
                             style={{ width: `${val}%`, backgroundColor: INLINE_STAT_HEX[key] }} />
                      </div>
                      <span className="text-[9px] text-luna-text-secondary w-5 text-right flex-shrink-0">{val}</span>
                    </div>
                  );
                })}
              </div>
            )}

            {/* Messages */}
            <div ref={messageContainerRef} className="flex-1 overflow-y-auto p-5 flex flex-col gap-6 bg-luna-bg-tertiary" onScroll={(e) => {
                const el = e.currentTarget;
                setShowScrollToBottom(el.scrollHeight - el.scrollTop - el.clientHeight > 100);
              }}>
              {(() => {
                const reversedMsgs = [...messages].reverse();
                const lastUserMsgId = reversedMsgs.find(m => m.role === "user")?.id ?? null;
                return messages.map((msg) => (
                <div
                  key={msg.id}
                  className={`flex gap-2.5 items-start max-w-[85%] group ${
                    msg.role === "user" ? "flex-row-reverse self-end" : ""
                  }`}
                >
                  <div
                    className={`w-8 h-8 rounded-md flex items-center justify-center text-sm flex-shrink-0 overflow-hidden ${
                      msg.role === "user"
                        ? "bg-luna-accent text-white"
                        : "bg-luna-accent-light"
                    }`}
                  >
                    {msg.role === "user"
                      ? ""
                      : currentCharacter?.avatar || "🌙"}
                  </div>
                  <div className={`flex flex-col max-w-[calc(100%-42px)] ${
                    msg.role === "user" ? "items-end" : "items-start"
                  }`}>
                    <div
                      className={`w-fit px-3.5 py-2.5 rounded-xl text-sm leading-relaxed whitespace-pre-wrap ${
                        msg.role === "user"
                          ? "bg-luna-accent text-white rounded-tr-sm"
                          : msg.role === "system"
                          ? "bg-red-50 text-red-600 border border-red-200"
                          : "bg-luna-bg border border-luna-border rounded-tl-sm"
                      }`}
                    >
                      {/* 用户引用条 — 用户手动引用的消息 */}
                      {msg.reply_to_id && quotedMessagesMap[msg.reply_to_id] && (() => {
                        const quoted = quotedMessagesMap[msg.reply_to_id];
                        const label = quoted.role === "assistant"
                          ? (currentCharacter?.name || "AI")
                          : "你";
                        return (
                          <div className={`flex gap-2 pb-2 mb-2 text-xs border-l-2 pl-2.5 leading-relaxed ${
                            msg.role === "user"
                              ? "border-white/40 text-white/70"
                              : "border-luna-accent/40 text-luna-text-tertiary"
                          }`}>
                            <div className="min-w-0 flex-1">
                              <span className="font-medium">{label}</span>
                              <span className="ml-1">{quoted.content.length > 60 ? quoted.content.slice(0, 60) + "…" : quoted.content}</span>
                            </div>
                          </div>
                        );
                      })()}
                      {/* AI 自主引用条 — 角色自主引用的历史消息 */}
                      {msg.role === "assistant" && msg.quoted_content && (
                        <div className="flex gap-2 pb-2 mb-2 text-xs border-l-2 pl-2.5 leading-relaxed border-luna-accent/40 text-luna-text-tertiary">
                          <div className="min-w-0 flex-1">
                            <span className="font-medium">{msg.quoted_speaker}</span>
                            {msg.quoted_time && <span className="ml-1 text-luna-text-tertiary/60">{msg.quoted_time}</span>}
                            <span className="ml-1">{msg.quoted_content.length > 60 ? msg.quoted_content.slice(0, 60) + "…" : msg.quoted_content}</span>
                          </div>
                        </div>
                      )}
                      {/* 旁白/主动消息标记 */}
                      {msg.is_proactive === 1 && msg.narration_type === "dialogue" && (
                        <div className="text-[10px] text-luna-text-tertiary mb-1.5 flex items-center gap-1">
                          <span>💬</span>
                          <span>主动消息</span>
                        </div>
                      )}
                      {msg.is_proactive === 1 && msg.narration_type === "action" && (
                        <div className="text-[10px] text-luna-text-tertiary mb-1.5 opacity-50 italic">
                          旁白
                        </div>
                      )}
                      {/* 格式化角色回复：*动作* 斜体淡色，其余正文 */}
                      {msg.role === "assistant" && formatAssistantReply ? (
                        renderFormattedReply(msg.content)
                      ) : msg.role === "assistant" ? (
                        stripStarMarkers(msg.content)
                      ) : (
                        msg.content
                      )}
                    </div>
                    {/* 时间常住 + 操作图标行悬浮显隐 */}
                    <div className={`flex items-center gap-1 mt-1 px-1 ${
                      msg.role === "user" ? "flex-row-reverse" : "justify-start"
                    }`}>
                      <span className="text-sm text-luna-text-tertiary select-none">
                        {toLocal(msg.timestamp).toLocaleTimeString("zh-CN", {
                          hour: "2-digit",
                          minute: "2-digit",
                        })}
                      </span>
                      <div className="flex items-center gap-0.5 invisible group-hover:visible pointer-events-none group-hover:pointer-events-auto">
                        <button onClick={(e) => { e.stopPropagation(); handleQuote(msg); }} title="引用" className="w-5 h-5 rounded flex items-center justify-center text-luna-text-tertiary hover:text-luna-accent transition-colors">
                          <IconQuote />
                        </button>
                        <button onClick={(e) => { e.stopPropagation(); handleBranchAsNewChat(msg.id); }} title="从这里分支" className="w-5 h-5 rounded flex items-center justify-center text-luna-text-tertiary hover:text-luna-accent transition-colors">
                          <IconBranch />
                        </button>
                        {msg.role === "user" && msg.id === lastUserMsgId && (
                          <button onClick={(e) => { e.stopPropagation(); handleEditLastUser(msg); }} title="修改输入" className="w-5 h-5 rounded flex items-center justify-center text-luna-text-tertiary hover:text-luna-accent transition-colors">
                            <IconEdit />
                          </button>
                        )}
                        {msg.role === "user" && (
                          <button onClick={(e) => { e.stopPropagation(); handleSaveToMemory(msg); }} title="存入记忆" className={`w-5 h-5 rounded flex items-center justify-center transition-colors ${savedMsgId === msg.id ? "text-luna-green" : "text-luna-text-tertiary hover:text-luna-accent"}`}>
                            <IconBookmark />
                          </button>
                        )}
                        {msg.role === "assistant" && (
                          <button onClick={(e) => { e.stopPropagation(); handleRegenerate(msg.id); }} title="重新回答" className="w-5 h-5 rounded flex items-center justify-center text-luna-text-tertiary hover:text-luna-accent transition-colors">
                            <IconRefresh />
                          </button>
                        )}
                        {msg.role === "assistant" && (
                          <button onClick={(e) => { e.stopPropagation(); handleContinue(); }} title="继续输出" className="w-5 h-5 rounded flex items-center justify-center text-luna-text-tertiary hover:text-luna-accent transition-colors">
                            <IconContinue />
                          </button>
                        )}
                        <button onClick={(e) => { e.stopPropagation(); setDeleteConfirmMsgId(msg.id); }} title="删除" className="w-5 h-5 rounded flex items-center justify-center text-luna-text-tertiary hover:text-luna-red transition-colors">
                          <IconTrash />
                        </button>
                      </div>
                    </div>
                    {msg.role === "system" && (
                      <div className="flex items-center gap-1 mt-1 px-1">
                        <span className="text-sm text-luna-text-tertiary select-none">
                          {toLocal(msg.timestamp).toLocaleTimeString("zh-CN", { hour: "2-digit", minute: "2-digit" })}
                        </span>
                        <button onClick={(e) => { e.stopPropagation(); setDeleteConfirmMsgId(msg.id); }} title="删除" className="w-5 h-5 rounded flex items-center justify-center text-luna-text-tertiary hover:text-luna-red transition-colors invisible group-hover:visible pointer-events-none group-hover:pointer-events-auto">
                          <IconTrash />
                        </button>
                      </div>
                    )}
                  {deleteConfirmMsgId === msg.id && (
                    <div className="inline-flex items-center gap-1.5 mt-1.5 px-2 py-1 bg-red-50 border border-red-200 rounded-lg text-xs">
                      <span className="text-red-600">删除？</span>
                      <button onClick={(e) => { e.stopPropagation(); setDeleteConfirmMsgId(null); }} className="text-luna-text-tertiary hover:text-luna-text transition-colors">取消</button>
                      <button onClick={(e) => { e.stopPropagation(); handleDeleteMessage(msg.id); }} className="text-red-500 hover:text-red-700 font-medium transition-colors">确认</button>
                    </div>
                  )}
                  </div>
                </div>
              ));
              })()}

              {showTyping && (
                <div className="flex gap-2.5 items-start">
                  <div className="w-8 h-8 rounded-md bg-luna-accent-light flex items-center justify-center text-sm flex-shrink-0">
                    {currentCharacter?.avatar || "🌙"}
                  </div>
                  <div className="px-3.5 py-2 bg-luna-bg border border-luna-border rounded-xl rounded-tl-sm">
                    <div className="flex gap-1 py-1">
                      <span className="w-1.5 h-1.5 rounded-full bg-luna-text-tertiary animate-bounce" />
                      <span className="w-1.5 h-1.5 rounded-full bg-luna-text-tertiary animate-bounce [animation-delay:0.2s]" />
                      <span className="w-1.5 h-1.5 rounded-full bg-luna-text-tertiary animate-bounce [animation-delay:0.4s]" />
                    </div>
                  </div>
                </div>
              )}

              <div ref={messagesEndRef} />
            </div>

            {showScrollToBottom && (
              <div className="h-0 relative z-10 overflow-visible">
                <button
                  onClick={() => messagesEndRef.current?.scrollIntoView({ behavior: "smooth" })}
                  className="absolute left-1/2 -translate-x-1/2 -top-10 w-8 h-8 rounded-full bg-luna-bg border border-luna-border shadow-sm flex items-center justify-center text-luna-text-secondary hover:text-luna-accent hover:border-luna-accent transition-all"
                >
                  <svg width="14" height="14" viewBox="0 0 16 16" fill="none"><path d="M4 6L8 10L12 6" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"/></svg>
                </button>
              </div>
            )}

            {/* Input Area */}
            <div className="px-5 py-4 border-t border-luna-border bg-luna-bg flex-shrink-0">
              {(settings.user_name || settings.user_persona) && (
                <div className="text-xs text-luna-text-tertiary mb-2">
                   {settings.user_name || "未命名"}
                  {settings.user_persona && <span className="ml-2 text-luna-border-secondary">|</span>}
                  {settings.user_persona && <span className="ml-2">{settings.user_persona}</span>}
                </div>
              )}
              {/* Quote Bar */}
              {quotedMessage && (
                <div className="flex items-center gap-2 mb-2 px-3 py-1.5 bg-luna-accent-light border border-luna-accent/20 rounded-lg">
                  <span className="text-xs text-luna-accent font-medium flex-shrink-0"><IconQuote /> 引用</span>
                  <span className="text-xs text-luna-text-secondary flex-1 truncate">
                    {quotedMessage.role === "assistant" ? `${currentCharacter?.name || "AI"}: ` : "你: "}
                    {quotedMessage.content.slice(0, 80)}{quotedMessage.content.length > 80 ? "..." : ""}
                  </span>
                  <button onClick={clearQuote} className="text-luna-text-tertiary hover:text-luna-red text-sm flex-shrink-0">×</button>
                </div>
              )}
              <div className="flex gap-2.5 items-center">
                <textarea
                  ref={textareaRef}
                  value={input}
                  onChange={handleInput}
                  onKeyDown={handleKeyDown}
                  onCompositionStart={() => { isComposingRef.current = true; }}
                  onCompositionEnd={() => { setTimeout(() => { isComposingRef.current = false; }, 0); }}
                  placeholder={
                    !ready
                      ? "正在加载配置..."
                      : currentCharacter
                        ? `正在与 ${currentCharacter.name} 对话...`
                        : "输入你的消息..."
                  }
                  rows={1}
                  disabled={!ready}
                  className="flex-1 py-3 px-3.5 bg-luna-bg-secondary border border-luna-border rounded-xl text-sm text-luna-text resize-none outline-none focus:border-luna-accent focus:bg-luna-bg min-h-[46px] max-h-[120px] leading-relaxed placeholder:text-luna-text-tertiary disabled:opacity-50 disabled:cursor-not-allowed"
                />
                <button
                  onClick={handleSend}
                  disabled={!ready || (!isGenerating && (isLoading || !input.trim()))}
                  className={`w-11 h-11 rounded-lg flex items-center justify-center transition-colors flex-shrink-0 ${
                    isGenerating
                      ? "bg-red-500 text-white hover:bg-red-600"
                      : "bg-luna-accent text-white hover:bg-[#3C3489] disabled:bg-luna-bg-tertiary disabled:text-luna-text-tertiary disabled:cursor-not-allowed"
                  }`}
                  title={isGenerating ? "停止生成" : "发送"}
                >
                  {isGenerating ? "■" : (
                    <svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" strokeWidth="1.5" strokeMiterlimit="10" strokeLinecap="round" strokeLinejoin="round" xmlns="http://www.w3.org/2000/svg">
                      <path d="M19.83 15.6L18.69 15.86C17.87 16.05 17.23 16.69 17.04 17.51L16.77 18.65C16.74 18.77 16.57 18.77 16.54 18.65L16.28 17.51C16.09 16.69 15.45 16.05 14.63 15.86L13.49 15.59C13.37 15.56 13.37 15.39 13.49 15.36L14.63 15.1C15.45 14.91 16.09 14.27 16.28 13.45L16.55 12.31C16.58 12.19 16.75 12.19 16.78 12.31L17.04 13.45C17.23 14.27 17.87 14.91 18.69 15.1L19.83 15.37C19.95 15.4 19.95 15.57 19.83 15.6Z"/>
                      <path d="M12.31 18.37L9.51002 19.77C3.75002 22.65 1.40002 20.29 4.28002 14.54L5.15002 12.81C5.37002 12.37 5.37002 11.64 5.15002 11.2L4.28002 9.46001C1.40002 3.71001 3.76002 1.35001 9.51002 4.23001L18.07 8.51001C20.46 9.71001 21.36 11.37 20.78 12.92"/>
                      <path d="M5.44 12H10.84"/>
                    </svg>
                  )}
                </button>
              </div>
            </div>
          </>
        ) : (
          /* Empty State — 极简 LunA 品牌 */
          <div className="flex-1 flex flex-col items-center justify-center bg-luna-bg-tertiary select-none">
            <div className="text-[56px] leading-none mb-4">🌙</div>
            <div className="text-[22px] font-semibold text-luna-text tracking-[-0.028em]">
              LunA
            </div>
          </div>
        )}

        {/* Context Panel - 角色与记忆 */}
        {showContextPanel && (
          <>
            <div
              className="fixed inset-0 bg-black/20 z-40"
              style={{ top: '3rem' }}
              onClick={() => setShowContextPanel(false)}
            />
            <div className="fixed right-0 top-12 bottom-0 w-[380px] bg-luna-bg shadow-2xl z-50 flex flex-col">
              <div className="px-3.5 py-3.5 border-b border-luna-border flex items-center justify-between">
                <div className="flex items-center gap-3">
                  <div className="w-9 h-9 rounded-md bg-transparent" aria-hidden />
                  <h3 className="text-sm font-semibold text-luna-text">角色与记忆</h3>
                </div>
                <button
                  onClick={() => setShowContextPanel(false)}
                  className="w-7 h-7 rounded-full bg-luna-bg-secondary flex items-center justify-center text-luna-text-secondary hover:bg-luna-bg-tertiary"
                >
                  ×
                </button>
              </div>
              <div className="flex-1 overflow-y-auto p-5 space-y-5">
                {/* 角色信息 */}
                {currentCharacter && (
                  <div>
                    <div className="text-xs font-medium text-luna-text-tertiary uppercase tracking-wider mb-2">角色信息</div>
                    <div className="flex items-center gap-3 mb-2">
                      <div className="w-10 h-10 rounded-md bg-luna-accent-light flex items-center justify-center text-xl">
                        {currentCharacter.avatar}
                      </div>
                      <div>
                        <div className="text-sm font-semibold text-luna-text">{currentCharacter.name}</div>
                        {currentCharacter.world_name && (
                          <div className="text-xs text-luna-text-tertiary">{currentCharacter.world_name}</div>
                        )}
                      </div>
                    </div>
                    {currentCharacter.description && (
                      <div className="text-xs text-luna-text-secondary leading-relaxed">{currentCharacter.description}</div>
                    )}
                    {currentCharacter.personality && (
                      <div className="mt-1 text-xs text-luna-text-tertiary leading-relaxed">性格: {currentCharacter.personality}</div>
                    )}
                  </div>
                )}

                {/* Soul 文件 */}
                <div>
                  <div className="flex items-center justify-between mb-2">
                    <span className="text-xs font-medium text-luna-text-tertiary uppercase tracking-wider">灵魂 (Soul)</span>
                    {currentCharacterId && (
                      <button
                        onClick={() => {
                          if (editingSoul) {
                            saveSoulEdit();
                          } else {
                            setEditingSoulText(soulContent);
                            setEditingSoul(true);
                          }
                        }}
                        className="text-xs text-luna-accent hover:text-luna-accent/80 transition-colors"
                      >
                        {editingSoul ? "保存" : "编辑"}
                      </button>
                    )}
                  </div>
                  {editingSoul ? (
                    <div className="flex flex-col gap-1">
                      <textarea
                        value={editingSoulText}
                        onChange={(e) => setEditingSoulText(e.target.value)}
                        className="w-full p-2 bg-luna-bg border border-luna-border rounded-md text-xs text-luna-text resize-y min-h-[120px] outline-none focus:border-luna-accent leading-relaxed"
                        autoFocus
                      />
                      <div className="flex gap-1.5">
                        <button onClick={saveSoulEdit} className="text-xs px-2 py-0.5 rounded bg-luna-accent text-white hover:bg-luna-accent/90">保存</button>
                        <button onClick={() => { setEditingSoul(false); setEditingSoulText(""); }} className="text-xs px-2 py-0.5 rounded bg-luna-bg border border-luna-border text-luna-text-secondary hover:text-luna-text">取消</button>
                      </div>
                    </div>
                  ) : soulContent ? (
                    <div
                      className="p-3 bg-luna-bg-secondary rounded-lg text-xs text-luna-text-secondary leading-relaxed whitespace-pre-wrap max-h-[300px] overflow-y-auto border border-luna-border cursor-text hover:border-luna-border-hover transition-colors"
                      onClick={() => {
                        setEditingSoulText(soulContent);
                        setEditingSoul(true);
                      }}
                    >
                      {soulContent}
                    </div>
                  ) : (
                    <div
                      className="text-xs text-luna-text-tertiary italic p-3 bg-luna-bg-secondary rounded-lg border border-luna-border cursor-text hover:border-luna-border-hover transition-colors"
                      onClick={() => {
                        if (currentCharacterId) {
                          setEditingSoulText("");
                          setEditingSoul(true);
                        }
                      }}
                    >
                      暂无灵魂设定（点击编辑）
                    </div>
                  )}
                </div>

                {/* Memory 文件 */}
                <div>
                  <div className="flex items-center justify-between mb-2">
                    <span className="text-xs font-medium text-luna-text-tertiary uppercase tracking-wider">记忆 (Memory)</span>
                    {currentChatId && (
                      <button
                        onClick={() => {
                          if (editingMemory) {
                            saveMemoryEdit();
                          } else {
                            setEditingMemoryText(memoryContent);
                            setEditingMemory(true);
                          }
                        }}
                        className="text-xs text-luna-accent hover:text-luna-accent/80 transition-colors"
                      >
                        {editingMemory ? "保存" : "编辑"}
                      </button>
                    )}
                  </div>
                  {editingMemory ? (
                    <div className="flex flex-col gap-1">
                      <textarea
                        value={editingMemoryText}
                        onChange={(e) => setEditingMemoryText(e.target.value)}
                        className="w-full p-2 bg-luna-bg border border-luna-border rounded-md text-xs text-luna-text resize-y min-h-[120px] outline-none focus:border-luna-accent leading-relaxed"
                        autoFocus
                      />
                      <div className="flex gap-1.5">
                        <button onClick={saveMemoryEdit} className="text-xs px-2 py-0.5 rounded bg-luna-accent text-white hover:bg-luna-accent/90">保存</button>
                        <button onClick={() => { setEditingMemory(false); setEditingMemoryText(""); }} className="text-xs px-2 py-0.5 rounded bg-luna-bg border border-luna-border text-luna-text-secondary hover:text-luna-text">取消</button>
                      </div>
                    </div>
                  ) : memoryContent ? (
                    <div
                      className="p-3 bg-luna-bg-secondary rounded-lg text-xs text-luna-text-secondary leading-relaxed whitespace-pre-wrap max-h-[300px] overflow-y-auto border border-luna-border cursor-text hover:border-luna-border-hover transition-colors"
                      onClick={() => {
                        setEditingMemoryText(memoryContent);
                        setEditingMemory(true);
                      }}
                    >
                      {memoryContent}
                    </div>
                  ) : (
                    <div
                      className="text-xs text-luna-text-tertiary italic p-3 bg-luna-bg-secondary rounded-lg border border-luna-border cursor-text hover:border-luna-border-hover transition-colors"
                      onClick={() => {
                        if (currentChatId) {
                          setEditingMemoryText("");
                          setEditingMemory(true);
                        }
                      }}
                    >
                      暂无对话记忆（点击编辑）
                    </div>
                  )}
                </div>
              </div>
            </div>
          </>
        )}

        {/* 属性值面板 */}
        {showStatsPanel && currentChatId && (
          <StatsPanel chatId={currentChatId} onClose={() => setShowStatsPanel(false)} />
        )}
      </main>
    </div>
  );
}
