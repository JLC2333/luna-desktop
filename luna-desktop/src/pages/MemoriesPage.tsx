import { useState, useEffect } from "react";
import type { MemoryEntry, Character, DiaryEntry } from "../types";
import {
  addMemory,
  deleteMemory,
  getAllMemories,
  getAllMemoriesByDate,
  getMemoriesByCharacter,
  getMemoriesByDateAndCharacter,
  getCharacters,
  getCharacterByChatId,
  getChatIdForCharacter,
  getDiaryEntries,
  deleteDiaryEntry,
} from "../utils/db";
import { generateDiary } from "../utils/diary";
import { useSettingsStore } from "../stores/settingsStore";

const MONTHS = ["1月","2月","3月","4月","5月","6月","7月","8月","9月","10月","11月","12月"];
const DAYS_OF_WEEK = ["日","一","二","三","四","五","六"];

// ─── Calendar ───

function CalendarGrid({
  year,
  month,
  selectedDate,
  onSelectDate,
}: {
  year: number;
  month: number;
  selectedDate: string;
  onSelectDate: (date: string) => void;
}) {
  const firstDay = new Date(year, month, 1).getDay();
  const daysInMonth = new Date(year, month + 1, 0).getDate();
  const today = new Date();
  const todayStr = `${today.getFullYear()}-${String(today.getMonth() + 1).padStart(2, "0")}-${String(today.getDate()).padStart(2, "0")}`;

  const cells: (number | null)[] = [];
  for (let i = 0; i < firstDay; i++) cells.push(null);
  for (let d = 1; d <= daysInMonth; d++) cells.push(d);

  return (
    <div className="grid grid-cols-7 gap-1">
      {DAYS_OF_WEEK.map((d) => (
        <div key={d} className="text-center text-xs text-luna-text-tertiary py-1">
          {d}
        </div>
      ))}
      {cells.map((day, i) => {
        if (day === null) return <div key={`e-${i}`} />;
        const dateStr = `${year}-${String(month + 1).padStart(2, "0")}-${String(day).padStart(2, "0")}`;
        const isToday = dateStr === todayStr;
        const isSelected = dateStr === selectedDate;
        return (
          <button
            key={dateStr}
            onClick={() => onSelectDate(isSelected ? "" : dateStr)}
            className={`
              aspect-square rounded-lg text-sm flex items-center justify-center
              transition-all relative
              ${isSelected
                ? "ring-1 ring-luna-accent text-luna-accent bg-luna-accent-light font-bold"
                : isToday
                  ? "bg-luna-accent-light text-luna-accent font-bold"
                  : "hover:bg-luna-bg-tertiary text-luna-text"
              }
            `}
          >
            {day}
          </button>
        );
      })}
    </div>
  );
}

// ─── Character Selector ───

function CharacterSelector({
  characters,
  selectedCharId,
  onSelect,
}: {
  characters: Character[];
  selectedCharId: number | null;
  onSelect: (id: number | null) => void;
}) {
  return (
    <div className="flex flex-col gap-1">
      <button
        onClick={() => onSelect(null)}
        className={`
          flex items-center gap-2 px-3 py-2 rounded-lg text-sm transition-all text-left
          ${selectedCharId === null
            ? "bg-luna-accent-light text-luna-accent font-medium"
            : "text-luna-text-secondary hover:bg-luna-bg-tertiary"
          }
        `}
      >
        <span className="text-base">📋</span>
        <span>全部角色</span>
      </button>
      {characters.map((c) => (
        <button
          key={c.id}
          onClick={() => onSelect(c.id)}
          className={`
            flex items-center gap-2 px-3 py-2 rounded-lg text-sm transition-all text-left
            ${selectedCharId === c.id
              ? "bg-luna-accent-light text-luna-accent font-medium"
              : "text-luna-text-secondary hover:bg-luna-bg-tertiary"
            }
          `}
        >
          <span className="text-base">{c.avatar || "💬"}</span>
          <span className="truncate">{c.name}</span>
        </button>
      ))}
    </div>
  );
}

// ─── Memory Item ───

function MemoryItem({
  mem,
  charInfo,
  deleteConfirmId,
  onRequestDelete,
  onConfirmDelete,
}: {
  mem: MemoryEntry;
  charInfo: { name: string; avatar: string } | null;
  deleteConfirmId: number | null;
  onRequestDelete: (id: number | null) => void;
  onConfirmDelete: (id: number) => void;
}) {
  const avatar = charInfo?.avatar || "📌";
  const name = charInfo?.name || "全局";
  const isConfirming = deleteConfirmId === mem.id;
  return (
    <div className={`flex items-start gap-3 p-2.5 rounded-lg transition-colors ${isConfirming ? "bg-red-50" : "hover:bg-luna-bg-tertiary group"}`}>
      {/* Character avatar + name */}
      <div className="flex flex-col items-center gap-0.5 w-12 shrink-0 pt-0.5">
        <span className="text-lg">{avatar}</span>
        <span className="text-[10px] text-luna-text-tertiary truncate max-w-12 text-center leading-tight">{name}</span>
      </div>
      {/* Content */}
      <div className="flex-1 min-w-0">
        {isConfirming ? (
          <div className="flex items-center gap-2 text-xs">
            <span className="text-red-600">删除这条记忆？</span>
            <button onClick={() => onRequestDelete(null)} className="text-luna-text-tertiary hover:text-luna-text transition-colors ml-auto">取消</button>
            <button onClick={() => onConfirmDelete(mem.id!)} className="text-red-500 hover:text-red-700 font-medium transition-colors">确认</button>
          </div>
        ) : (
          <>
            <p className="text-sm text-luna-text leading-relaxed">{mem.content}</p>
            <div className="flex gap-2 mt-1.5">
              <span className="text-xs text-luna-text-tertiary">
                {mem.created_at?.slice(0, 16).replace("T", " ")}
              </span>
              <span className={`text-xs px-1.5 py-0.5 rounded-full ${
                mem.source === "auto" ? "bg-blue-500/10 text-blue-500" :
                mem.source === "user" ? "bg-green-500/10 text-green-500" :
                mem.source === "llm" ? "bg-purple-500/10 text-purple-500" :
                "bg-orange-500/10 text-orange-500"
              }`}>
                {mem.source === "auto" ? "自动" :
                 mem.source === "user" ? "手动" :
                 mem.source === "llm" ? "AI" : "固化"}
              </span>
              {mem.memory_type === "long_term" && (
                <span className="text-xs px-1.5 py-0.5 rounded-full bg-amber-500/10 text-amber-500">长期</span>
              )}
            </div>
          </>
        )}
      </div>
      {!isConfirming && (
        <button
          onClick={() => onRequestDelete(mem.id!)}
          className="opacity-0 group-hover:opacity-100 text-luna-text-tertiary hover:text-luna-red text-sm transition-all shrink-0"
          title="删除"
        >
          ✕
        </button>
      )}
    </div>
  );
}

// ─── Memory Display Panel ───

function MemoryPanel({
  selectedDate,          // "" = 不筛选
  selectedCharId,        // null = 全部角色
  addCharId,             // 添加时默认选中的角色（从侧边栏继承）
  characters,            // 角色列表（供下拉框用）
}: {
  selectedDate: string;
  selectedCharId: number | null;
  addCharId: number | null;
  characters: Character[];
}) {
  const [memories, setMemories] = useState<MemoryEntry[]>([]);
  const [charInfoMap, setCharInfoMap] = useState<Record<number, { name: string; avatar: string } | null>>({});
  const [loading, setLoading] = useState(true);
  const [newMemory, setNewMemory] = useState("");
  const [searchQuery, setSearchQuery] = useState("");

  // 添加表单的额外字段
  const [addCharacterId, setAddCharacterId] = useState<number | null>(addCharId);
  const [addDate, setAddDate] = useState(selectedDate || new Date().toISOString().slice(0, 10));

  // 当侧边栏的角色选择变化时，同步到添加表单的默认值
  useEffect(() => {
    setAddCharacterId(selectedCharId);
  }, [selectedCharId]);

  // 如果没有任何角色被选中，自动选第一个角色（陪伴app，记忆必须绑定角色）
  useEffect(() => {
    if (addCharacterId === null && characters.length > 0) {
      setAddCharacterId(characters[0].id);
    }
  }, [characters, addCharacterId]);

  useEffect(() => {
    if (selectedDate) setAddDate(selectedDate);
  }, [selectedDate]);

  // Load memories based on filters
  useEffect(() => {
    async function load() {
      setLoading(true);
      const hasDate = !!selectedDate;
      const hasChar = selectedCharId !== null;

      let results: MemoryEntry[];
      if (hasDate && hasChar) {
        results = await getMemoriesByDateAndCharacter(selectedDate, selectedCharId);
      } else if (hasDate) {
        results = await getAllMemoriesByDate(selectedDate);
      } else if (hasChar) {
        results = await getMemoriesByCharacter(selectedCharId);
      } else {
        results = await getAllMemories();
      }
      setMemories(results);

      // Batch fetch character info for all unique chat_ids
      const uniqueChatIds = [...new Set(results.map((m) => m.chat_id))];
      const map: Record<number, { name: string; avatar: string } | null> = {};
      await Promise.all(uniqueChatIds.map(async (cid) => {
        if (cid === 0) {
          map[cid] = null;
          return;
        }
        const info = await getCharacterByChatId(cid);
        map[cid] = info;
      }));
      setCharInfoMap(map);
      setLoading(false);
    }
    load();
  }, [selectedDate, selectedCharId]);

  const handleAddMemory = async () => {
    const text = newMemory.trim();
    if (!text) return;

    // 获取真实的 chat_id（关联到选中的角色或默认对话）
    const chatId = await getChatIdForCharacter(addCharacterId);

    await addMemory({
      chat_id: chatId,
      content: text,
      source: "user",
      userDate: addDate || undefined,
    });
    setNewMemory("");

    // Refresh
    const hasDate = !!selectedDate;
    const hasChar = selectedCharId !== null;
    let results: MemoryEntry[];
    if (hasDate && hasChar) {
      results = await getMemoriesByDateAndCharacter(selectedDate, selectedCharId);
    } else if (hasDate) {
      results = await getAllMemoriesByDate(selectedDate);
    } else if (hasChar) {
      results = await getMemoriesByCharacter(selectedCharId);
    } else {
      results = await getAllMemories();
    }
    setMemories(results);

    // 更新角色信息映射（新记忆的 chat_id 可能不在旧映射里）
    const uniqueChatIds = [...new Set(results.map((m) => m.chat_id))];
    const map: Record<number, { name: string; avatar: string } | null> = { ...charInfoMap };
    await Promise.all(uniqueChatIds.map(async (cid) => {
      if (cid === 0) { map[cid] = null; return; }
      if (map[cid] === undefined) {
        const info = await getCharacterByChatId(cid);
        map[cid] = info;
      }
    }));
    setCharInfoMap(map);
  };

  const [deleteConfirmId, setDeleteConfirmId] = useState<number | null>(null);

  const handleDeleteMemory = async (id: number) => {
    setDeleteConfirmId(null);
    await deleteMemory(id);
    setMemories((prev) => prev.filter((m) => m.id !== id));
  };

  // 删除确认键盘
  useEffect(() => {
    if (deleteConfirmId === null) return;
    function onKeyDown(e: KeyboardEvent) {
      if (e.key === "Enter") {
        e.preventDefault();
        handleDeleteMemory(deleteConfirmId!);
      } else if (e.key === "Escape") {
        setDeleteConfirmId(null);
      }
    }
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [deleteConfirmId]);

  const handleSearch = async () => {
    const q = searchQuery.trim();
    if (!q) return;
    // FTS5 搜索跨所有对话
    const results: MemoryEntry[] = [];
    // 按当前筛选范围搜索
    const hasDate = !!selectedDate;
    const hasChar = selectedCharId !== null;
    let base: MemoryEntry[];
    if (hasDate && hasChar) {
      base = await getMemoriesByDateAndCharacter(selectedDate, selectedCharId);
    } else if (hasDate) {
      base = await getAllMemoriesByDate(selectedDate);
    } else if (hasChar) {
      base = await getMemoriesByCharacter(selectedCharId);
    } else {
      base = await getAllMemories();
    }
    // 客户端过滤
    const lower = q.toLowerCase();
    for (const m of base) {
      if (m.content.toLowerCase().includes(lower)) {
        results.push(m);
      }
    }
    setMemories(results);
  };

  const getFilterLabel = () => {
    if (selectedDate && selectedCharId !== null) {
      return `${selectedDate} · 指定角色`;
    } else if (selectedDate) {
      return `${selectedDate} 的记忆`;
    } else if (selectedCharId !== null) {
      return `指定角色的记忆`;
    }
    return "全部记忆";
  };

  return (
    <div className="flex-1 flex flex-col min-h-0">
      {/* Search */}
      <div className="flex gap-2 mb-4">
        <input
          type="text"
          value={searchQuery}
          onChange={(e) => setSearchQuery(e.target.value)}
          onKeyDown={(e) => e.key === "Enter" && handleSearch()}
          placeholder="搜索记忆..."
          className="flex-1 px-3 py-2 rounded-lg bg-luna-bg-secondary border border-luna-border text-sm text-luna-text outline-none focus:border-luna-accent"
        />
        <button
          onClick={handleSearch}
          className="px-3 py-2 rounded-lg bg-luna-accent text-white text-sm hover:brightness-110 transition-all"
        >
          搜索
        </button>
      </div>

      {/* Header */}
      <div className="mb-4">
        <h2 className="text-lg font-semibold text-luna-text">
          {getFilterLabel()}
        </h2>
        {!selectedDate && selectedCharId === null && (
          <p className="text-xs text-luna-text-tertiary mt-1">
            选择日期或角色来筛选记忆
          </p>
        )}
      </div>

      {/* Memory list */}
      <div className="flex-1 overflow-y-auto space-y-1">
        {loading && (
          <p className="text-xs text-luna-text-tertiary text-center py-4">加载中...</p>
        )}
        {!loading && memories.length === 0 && (
          <p className="text-xs text-luna-text-tertiary text-center py-8">
            {selectedDate || selectedCharId !== null
              ? "没有找到匹配的记忆"
              : "还没有任何记忆记录"}
          </p>
        )}
        {!loading && memories.map((mem) => (
          <MemoryItem key={mem.id} mem={mem} charInfo={charInfoMap[mem.chat_id] ?? null} deleteConfirmId={deleteConfirmId} onRequestDelete={setDeleteConfirmId} onConfirmDelete={handleDeleteMemory} />
        ))}
      </div>

      {/* Add memory — 含角色 + 日期选择 */}
      <div className="mt-4 pt-3 border-t border-luna-border space-y-2.5">
        <div className="flex items-center gap-2">
          {/* 角色选择 */}
          <select
            value={addCharacterId ?? ""}
            onChange={(e) => setAddCharacterId(e.target.value ? parseInt(e.target.value) : null)}
            className="px-2.5 py-2 rounded-lg bg-luna-bg-secondary border border-luna-border text-xs text-luna-text outline-none focus:border-luna-accent"
          >
            {characters.map((c) => (
              <option key={c.id} value={c.id}>
                {c.avatar} {c.name}
              </option>
            ))}
          </select>

          {/* 日期选择 */}
          <input
            type="date"
            value={addDate}
            onChange={(e) => setAddDate(e.target.value)}
            className="px-2.5 py-2 rounded-lg bg-luna-bg-secondary border border-luna-border text-xs text-luna-text outline-none focus:border-luna-accent"
          />

          {/* 保存按钮 */}
          <button
            onClick={handleAddMemory}
            disabled={!newMemory.trim()}
            className="px-3 py-2 rounded-lg bg-luna-accent text-white text-xs font-medium hover:brightness-110 transition-all disabled:opacity-40 disabled:cursor-not-allowed"
          >
            保存
          </button>
        </div>
        <input
          type="text"
          value={newMemory}
          onChange={(e) => setNewMemory(e.target.value)}
          onKeyDown={(e) => e.key === "Enter" && handleAddMemory()}
          placeholder="写下你想记住的内容…"
          className="w-full px-3 py-2 rounded-lg bg-luna-bg-secondary border border-luna-border text-sm text-luna-text outline-none focus:border-luna-accent"
        />
      </div>
    </div>
  );
}

// ─── Page ───

export default function MemoriesPage() {
  const now = new Date();
  const [currentYear, setCurrentYear] = useState(now.getFullYear());
  const [currentMonth, setCurrentMonth] = useState(now.getMonth());
  const [selectedDate, setSelectedDate] = useState<string>("");
  const [selectedCharId, setSelectedCharId] = useState<number | null>(null);
  const [characters, setCharacters] = useState<Character[]>([]);
  const [viewMode, setViewMode] = useState<"memories" | "diary">("diary");
  const [diaryEntries, setDiaryEntries] = useState<DiaryEntry[]>([]);
  const [diaryLoading, setDiaryLoading] = useState(false);
  const [diaryDeleteConfirm, setDiaryDeleteConfirm] = useState<number | null>(null);
  const [diaryWriting, setDiaryWriting] = useState(false);
  const [diaryWriteMsg, setDiaryWriteMsg] = useState<string | null>(null);

  // Load characters
  useEffect(() => {
    async function load() {
      const chars = await getCharacters();
      setCharacters(chars);
    }
    load();
  }, []);

  // 加载日记条目（日期/角色筛选时也重新加载）
  useEffect(() => {
    if (viewMode !== "diary") return;
    setDiaryLoading(true);
    const dateParam = selectedDate || undefined;
    getDiaryEntries(dateParam).then((entries) => {
      if (selectedCharId !== null) {
        const charName = characters.find(c => c.id === selectedCharId)?.name;
        if (charName) {
          setDiaryEntries(entries.filter((e: any) => e.title?.startsWith(charName)));
        } else {
          setDiaryEntries(entries);
        }
      } else {
        setDiaryEntries(entries);
      }
    }).catch(() => {}).finally(() => setDiaryLoading(false));
  }, [viewMode, selectedDate, selectedCharId, characters]);

  // 日记删除键盘
  useEffect(() => {
    if (diaryDeleteConfirm === null) return;
    function onKeyDown(e: KeyboardEvent) {
      if (e.key === "Enter") {
        e.preventDefault();
        const id = diaryDeleteConfirm!;
        setDiaryDeleteConfirm(null);
        deleteDiaryEntry(id).then(() => {
          setDiaryEntries((prev: DiaryEntry[]) => prev.filter((d) => d.id !== id));
        });
      } else if (e.key === "Escape") {
        setDiaryDeleteConfirm(null);
      }
    }
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [diaryDeleteConfirm]);

  const prevMonth = () => {
    if (currentMonth === 0) {
      setCurrentYear((y) => y - 1);
      setCurrentMonth(11);
    } else {
      setCurrentMonth((m) => m - 1);
    }
  };

  const nextMonth = () => {
    if (currentMonth === 11) {
      setCurrentYear((y) => y + 1);
      setCurrentMonth(0);
    } else {
      setCurrentMonth((m) => m + 1);
    }
  };

  return (
    <div className="h-full flex">
      {/* Left sidebar: Calendar + Character */}
      <div className="w-72 shrink-0 border-r border-luna-border p-4 flex flex-col gap-4 overflow-y-auto">
        {/* Month nav */}
        <div className="flex items-center justify-between">
          <button
            onClick={prevMonth}
            className="w-8 h-8 flex items-center justify-center rounded-lg hover:bg-luna-bg-tertiary text-luna-text-secondary"
          >
            ◀
          </button>
          <span className="text-base font-semibold text-luna-text">
            {currentYear}年 {MONTHS[currentMonth]}
          </span>
          <button
            onClick={nextMonth}
            className="w-8 h-8 flex items-center justify-center rounded-lg hover:bg-luna-bg-tertiary text-luna-text-secondary"
          >
            ▶
          </button>
        </div>

        {/* Calendar — 再点已选中日期取消筛选 */}
        <CalendarGrid
          year={currentYear}
          month={currentMonth}
          selectedDate={selectedDate}
          onSelectDate={(date) => setSelectedDate(date)}
        />

        {/* Divider */}
        <div className="border-t border-luna-border" />

        {/* Character filter */}
        <div>
          <h3 className="text-xs font-medium text-luna-text-tertiary mb-2 uppercase tracking-wide">
            角色筛选
          </h3>
          <CharacterSelector
            characters={characters}
            selectedCharId={selectedCharId}
            onSelect={(id) => setSelectedCharId(id)}
          />
        </div>

        {/* Stats */}
        <div className="mt-auto pt-3 border-t border-luna-border text-xs text-luna-text-tertiary space-y-1">
          <p>{characters.length} 个角色</p>
        </div>
      </div>

      {/* Content area */}
      <div className="flex-1 p-4 flex flex-col min-h-0">
        {/* View mode tabs */}
        <div className="flex gap-1 mb-3">
          <button onClick={() => setViewMode("diary")}
            className={`px-3 py-1.5 rounded-md text-xs font-medium transition-colors ${
              viewMode === "diary"
                ? "bg-luna-accent text-white"
                : "text-luna-text-secondary hover:bg-luna-bg-tertiary"
            }`}>
            日记
          </button>
          <button onClick={() => setViewMode("memories")}
            className={`px-3 py-1.5 rounded-md text-xs font-medium transition-colors ${
              viewMode === "memories"
                ? "bg-luna-accent text-white"
                : "text-luna-text-secondary hover:bg-luna-bg-tertiary"
            }`}>
            记忆
          </button>
        </div>

        {viewMode === "memories" ? (
          <MemoryPanel
            selectedDate={selectedDate}
            selectedCharId={selectedCharId}
            addCharId={selectedCharId}
            characters={characters}
          />
        ) : (
          <div className="flex-1 flex flex-col min-h-0">
            {/* 手动写日记 */}
            <div className="flex items-center gap-2 mb-3">
              <button onClick={async () => {
                if (diaryWriting) return;
                setDiaryWriting(true);
                setDiaryWriteMsg(null);
                const { settings, activeProfile } = useSettingsStore.getState();
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
                const bindClock = useSettingsStore.getState().bindSystemClock;
                const maxLen = useSettingsStore.getState().diaryMaxLength;
                const result = await generateDiary({
                  bindSystemClock: bindClock,
                  diaryMaxLength: maxLen,
                  settings: apiSettings,
                  onStatus: (msg) => setDiaryWriteMsg(msg),
                });
                setDiaryWriteMsg(result.written ? "✅ 日记已保存" : `⚠️ ${result.message}`);
                setDiaryWriting(false);
                // 刷新列表
                getDiaryEntries().then(setDiaryEntries).catch(() => {});
              }}
                disabled={diaryWriting}
                className="px-3 py-1.5 bg-luna-accent text-white rounded-md text-xs font-medium hover:bg-[#3C3489] transition-colors disabled:opacity-40"
              >
                {diaryWriting ? "✍️ 正在写..." : "✍️ 写日记"}
              </button>
              {diaryWriteMsg && (
                <span className="text-xs text-luna-text-secondary">{diaryWriteMsg}</span>
              )}
            </div>

            <div className="flex-1 overflow-y-auto space-y-3 min-h-0">
            {diaryLoading && <p className="text-xs text-luna-text-tertiary text-center py-4">加载中...</p>}
            {!diaryLoading && diaryEntries.length === 0 && (
              <p className="text-xs text-luna-text-tertiary text-center py-8">还没有日记</p>
            )}
            {!diaryLoading && diaryEntries.map((entry) => {
              const isDeleting = diaryDeleteConfirm === entry.id;
              const titleParts = entry.title?.split(' - ') || [];
              const entryCharName = titleParts[0] || '';
              const entryChar = characters.find(c => c.name === entryCharName);
              return (
              <div key={entry.id} className={`bg-luna-bg border rounded-xl p-4 group ${isDeleting ? 'border-red-300 bg-red-50' : 'border-luna-border'}`}>
                <div className="flex items-center gap-2 mb-2">
                  <span className="text-lg">{entryChar?.avatar || '📖'}</span>
                  <div className="flex-1">
                    <div className="text-sm font-semibold text-luna-text">{entryCharName}</div>
                    <div className="text-xs text-luna-text-tertiary">{entry.date}</div>
                  </div>
                  {isDeleting ? (
                    <div className="flex items-center gap-2 text-xs">
                      <span className="text-red-600">删除？</span>
                      <button onClick={() => setDiaryDeleteConfirm(null)} className="text-luna-text-tertiary hover:text-luna-text transition-colors">取消</button>
                      <button onClick={async () => { const id = entry.id!; setDiaryDeleteConfirm(null); await deleteDiaryEntry(id); setDiaryEntries((prev: DiaryEntry[]) => prev.filter((d) => d.id !== id)); }} className="text-red-500 hover:text-red-700 font-medium transition-colors">确认</button>
                    </div>
                  ) : (
                    <button onClick={() => setDiaryDeleteConfirm(entry.id!)}
                      className="text-luna-text-tertiary hover:text-luna-red text-sm transition-colors opacity-0 group-hover:opacity-100" title="删除日记">
                      ✕
                    </button>
                  )}
                </div>
                <div className="text-sm text-luna-text leading-relaxed whitespace-pre-wrap">{entry.manual_note || entry.summary}</div>
              </div>
              );
            })}
          </div>
          </div>
        )}
      </div>
    </div>
  );
}
