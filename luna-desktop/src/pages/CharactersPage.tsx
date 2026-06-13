import { useState, useEffect } from "react";
import { invoke } from "@tauri-apps/api/core";
import {
  getCharacters,
  createCharacter,
  updateCharacter,
  deleteCharacter,
  toggleCharacterActive,
  getWorlds,
  getPersonalityStates,
  savePersonalityStates,
  detectPersonalityState,
  type Character,
  type World,
  type PersonalityState,
} from "../utils/db";

const STAT_KEYS = ['stat_happy', 'stat_discomfort', 'stat_trust', 'stat_energy', 'stat_affection', 'stat_curiosity', 'stat_relax', 'stat_depression'] as const;
const STAT_NAMES: Record<string, string> = {
  stat_happy: '开心',
  stat_discomfort: '不适',
  stat_trust: '信任',
  stat_energy: '精力',
  stat_affection: '好感度',
  stat_curiosity: '好奇',
  stat_relax: '放松',
  stat_depression: '沮丧',
};
const STAT_EMOJI: Record<string, string> = {
  stat_happy: '😊',
  stat_discomfort: '😖',
  stat_trust: '🤝',
  stat_energy: '⚡',
  stat_affection: '💕',
  stat_curiosity: '🤔',
  stat_relax: '😌',
  stat_depression: '😞',
};
const STAT_DEFAULTS: Record<string, number> = {
  stat_happy: 80, stat_discomfort: 0, stat_trust: 80, stat_energy: 80,
  stat_affection: 50, stat_curiosity: 60, stat_relax: 70, stat_depression: 0,
};

export default function CharactersPage() {
  const [characters, setCharacters] = useState<Character[]>([]);
  const [worlds, setWorlds] = useState<World[]>([]);
  const [loading, setLoading] = useState(true);
  const [deleteConfirmId, setDeleteConfirmId] = useState<number | null>(null);

  // 删除确认键盘
  useEffect(() => {
    if (deleteConfirmId === null) return;
    const id = deleteConfirmId;
    function onKeyDown(e: KeyboardEvent) {
      if (e.key === "Enter") {
        e.preventDefault();
        setDeleteConfirmId(null);
        deleteCharacter(id).then(() => loadData());
      } else if (e.key === "Escape") {
        setDeleteConfirmId(null);
      }
    }
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [deleteConfirmId]);

  const [showModal, setShowModal] = useState(false);
  const [editingId, setEditingId] = useState<number | null>(null);
  const [editingSoul, setEditingSoul] = useState("");
  const [editingSoulText, setEditingSoulText] = useState("");
  const [draggingStat, setDraggingStat] = useState<string | null>(null);
  const [formData, setFormData] = useState({
    name: "",
    avatar: "🌙",
    world_id: "",
    description: "",
    personality: "",
    tags: "",
    banned_content: "",
    card_type: "standard",
  });
  const [statValues, setStatValues] = useState<Record<string, number>>({...STAT_DEFAULTS});
  const [personalityStates, setPersonalityStates] = useState<Omit<PersonalityState, 'id' | 'character_id'>[]>([]);

  // 统计滑块拖拽
  useEffect(() => {
    if (!draggingStat) return;
    const onMove = (e: MouseEvent) => {
      const bar = document.querySelector(`[data-statbar="${draggingStat}"]`);
      if (!bar) return;
      const rect = bar.getBoundingClientRect();
      const pct = Math.round(((e.clientX - rect.left) / rect.width) * 100);
      setStatValues(prev => ({ ...prev, [draggingStat]: Math.max(0, Math.min(100, pct)) }));
    };
    const onUp = () => setDraggingStat(null);
    window.addEventListener("mousemove", onMove);
    window.addEventListener("mouseup", onUp);
    return () => { window.removeEventListener("mousemove", onMove); window.removeEventListener("mouseup", onUp); };
  }, [draggingStat]);

  useEffect(() => {
    loadData();
  }, []);

  async function loadData() {
    setLoading(true);
    try {
      const [chars, wds] = await Promise.all([getCharacters(), getWorlds()]);
      setCharacters(chars);
      setWorlds(wds);
    } catch (err) {
      console.error("加载角色数据失败:", err);
    }
    setLoading(false);
  }

  function openCreate(cardType: string = "standard") {
    setEditingId(null);
    setFormData({
      name: "", avatar: "🌙", world_id: "", description: "",
      personality: "", tags: "", banned_content: "", card_type: cardType,
    });
    setStatValues({...STAT_DEFAULTS});
    setPersonalityStates(getDefaultPersonalityStates());
    setEditingSoul("");
    setEditingSoulText("");
    setShowModal(true);
  }

  async function openEdit(char: Character) {
    setEditingId(char.id);
    setFormData({
      name: char.name,
      avatar: char.avatar,
      world_id: char.world_id?.toString() || "",
      description: char.description,
      personality: char.personality,
      tags: char.tags,
      banned_content: "",
      card_type: char.card_type || "standard",
    });
    // 加载 stat defaults
    try {
      const parsed = char.stat_defaults ? JSON.parse(char.stat_defaults) : null;
      setStatValues(parsed ? { ...STAT_DEFAULTS, ...parsed } : { ...STAT_DEFAULTS });
    } catch {
      setStatValues({ ...STAT_DEFAULTS });
    }
    // 加载 soul
    try {
      const soul = await invoke<string>("get_soul_content", { characterId: char.id });
      setEditingSoul(soul);
    } catch {
      setEditingSoul("");
    }
    // 加载 banned
    try {
      const banned = await invoke<string>("get_banned_content", { characterId: char.id });
      setFormData((f) => ({ ...f, banned_content: banned }));
    } catch {
      setFormData((f) => ({ ...f, banned_content: "" }));
    }
    // 加载人格状态
    try {
      const loaded = await getPersonalityStates(char.id);
      if (loaded.length > 0) {
        setPersonalityStates(loaded.map(s => ({
          state_name: s.state_name,
          min_trust: s.min_trust,
          max_trust: s.max_trust,
          min_love: s.min_love,
          max_love: s.max_love,
          prompt_text: s.prompt_text,
          sub_description: s.sub_description || '',
          sub_personality: s.sub_personality || '',
          sub_scenario: s.sub_scenario || '',
          is_special: s.is_special || 0,
          sort_order: s.sort_order,
        })));
      } else {
        setPersonalityStates(getDefaultPersonalityStates());
      }
    } catch {
      setPersonalityStates(getDefaultPersonalityStates());
    }
    setShowModal(true);
  }

  async function handleSubmit() {
    if (!formData.name.trim()) return;

    const data = {
      name: formData.name.trim(),
      avatar: formData.avatar,
      world_id: formData.world_id ? parseInt(formData.world_id) : undefined,
      description: formData.description,
      personality: formData.personality,
      tags: formData.tags,
      card_type: formData.card_type,
      stat_defaults: JSON.stringify(statValues),
    };

    try {
      let charId = editingId;
      if (editingId) {
        await updateCharacter(editingId, data);
        await invoke("update_banned_content", { characterId: editingId, content: formData.banned_content });
        if (editingSoulText) {
          await invoke("update_soul_command", { characterId: editingId, content: editingSoulText });
        }
      } else {
        charId = await createCharacter(data) as number;
      }
      // 保存人格状态（陪伴卡）
      if (formData.card_type === "companion" && charId) {
        await savePersonalityStates(charId, personalityStates);
      }
      await loadData();
      setShowModal(false);
    } catch (err) {
      console.error("保存角色失败:", err);
    }
  }

  function handleDelete(id: number) {
    setDeleteConfirmId(id);
  }

  async function handleToggleActive(char: Character) {
    try {
      await toggleCharacterActive(char.id, !char.is_active);
      await loadData();
    } catch (err) {
      console.error("切换状态失败:", err);
    }
  }

  function formatDate(dateStr: string) {
    const date = new Date(dateStr);
    const now = new Date();
    const diff = now.getTime() - date.getTime();
    const days = Math.floor(diff / (1000 * 60 * 60 * 24));
    if (days === 0) return "今天";
    if (days === 1) return "昨天";
    if (days < 7) return `${days}天前`;
    if (days < 30) return `${Math.floor(days / 7)}周前`;
    return `${Math.floor(days / 30)}个月前`;
  }

  return (
    <div className="h-full flex flex-col overflow-hidden">
      {/* Header */}
      <div className="px-6 py-5 border-b border-luna-border bg-luna-bg flex items-center justify-between flex-shrink-0">
        <div>
          <h1 className="text-lg font-semibold text-luna-text">角色工坊</h1>
          <p className="text-xs text-luna-text-tertiary mt-0.5">构建和管理你的角色卡片</p>
        </div>
        <div className="flex gap-2.5">
          <button
            onClick={() => openCreate("companion")}
            className="px-4 py-2.5 bg-gradient-to-r from-[#667eea] to-[#764ba2] text-white rounded-md text-sm font-medium hover:brightness-110 transition-all"
          >
            ✦ 新建陪伴卡
          </button>
          <button
            onClick={() => openCreate("standard")}
            className="px-4 py-2.5 bg-luna-accent text-white rounded-md text-sm font-medium hover:bg-[#3C3489] transition-colors"
          >
            + 新建普通卡
          </button>
        </div>
      </div>

      {/* Delete confirm bar */}
      {deleteConfirmId !== null && (
        <div className="flex items-center gap-2 px-4 py-2 bg-red-50 border-b border-red-200 text-xs">
          <span className="text-red-600">删除「{characters.find(c => c.id === deleteConfirmId)?.name || '此'}」角色？</span>
          <button onClick={() => setDeleteConfirmId(null)} className="text-luna-text-tertiary hover:text-luna-text ml-auto transition-colors">取消</button>
          <button onClick={async () => { const id = deleteConfirmId; setDeleteConfirmId(null); await deleteCharacter(id); await loadData(); }} className="text-red-500 hover:text-red-700 font-medium transition-colors">确认</button>
        </div>
      )}

      {/* Card grid */}
      <div className="flex-1 overflow-y-auto p-6 grid grid-cols-[repeat(auto-fill,minmax(280px,1fr))] gap-5 bg-luna-bg-tertiary">
        {loading ? (
          <div className="col-span-full text-center text-luna-text-secondary py-20">加载中...</div>
        ) : characters.length === 0 ? (
          <div className="col-span-full text-center text-luna-text-secondary py-20">
            <div className="text-4xl mb-3">🛠️</div>
            <div className="text-sm">还没有角色，点击上方创建你的第一张卡</div>
          </div>
        ) : (
          characters.map((char) => (
            <div
              key={char.id}
              className="bg-luna-bg border border-luna-border rounded-xl overflow-hidden transition-all hover:-translate-y-1 hover:shadow-lg hover:border-luna-accent cursor-pointer group/card"
            >
              {/* Banner */}
              <div className="h-24 bg-gradient-to-br from-[#667eea22] to-[#764ba222] relative">
                <div className="w-[72px] h-[72px] rounded-full bg-luna-bg border-[3px] border-luna-bg absolute -bottom-9 left-4 flex items-center justify-center text-[32px]">
                  {char.avatar}
                </div>
                {/* Card type badge */}
                <div className="absolute top-2.5 left-3">
                  <span className={`text-[10px] px-2 py-0.5 rounded-full font-medium ${
                    char.card_type === "companion"
                      ? "bg-gradient-to-r from-[#667eea] to-[#764ba2] text-white"
                      : "bg-luna-bg/80 text-luna-text-secondary"
                  }`}>
                    {char.card_type === "companion" ? "✦ 陪伴卡" : "普通卡"}
                  </span>
                </div>
                <div className="absolute top-2.5 right-2.5 flex gap-1.5 opacity-0 group-hover/card:opacity-100 transition-opacity z-10">
                  <button onClick={(e) => { e.stopPropagation(); e.preventDefault(); openEdit(char); }}
                    className="h-7 px-2.5 rounded-full bg-luna-bg/90 border-0 flex items-center justify-center text-luna-text-secondary text-xs hover:bg-luna-bg hover:text-luna-accent shadow-sm">
                    详细信息
                  </button>
                  <button onClick={(e) => { e.stopPropagation(); e.preventDefault(); handleDelete(char.id); }}
                    className="w-7 h-7 rounded-full bg-luna-bg/90 border-0 flex items-center justify-center text-luna-text-secondary text-xs hover:bg-luna-bg hover:text-luna-red shadow-sm">
                    <svg width="12" height="12" viewBox="0 0 14 14" fill="none" xmlns="http://www.w3.org/2000/svg">
                      <path d="M1 1L13 13M1 13L13 1" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round"/>
                    </svg>
                  </button>
                </div>
              </div>
              {/* Info */}
              <div className="pt-11 px-4 pb-4 min-h-[100px]">
                <div className="text-[15px] font-semibold text-luna-text mb-1">{char.name}</div>
                <div className="text-xs text-luna-accent mb-2">{char.world_name || "未设置世界"}</div>
                <div className="text-sm text-luna-text-secondary leading-relaxed line-clamp-2">
                  {char.description || "暂无描述"}
                </div>
              </div>
              {/* Footer */}
              <div className="px-4 py-2.5 border-t border-luna-border flex items-center justify-between">
                <span className="text-xs text-luna-text-tertiary">
                  创建于 {formatDate(char.created_at)}
                </span>
                <button onClick={(e) => { e.stopPropagation(); handleToggleActive(char); }}
                  className={`px-2 py-0.5 rounded-full text-xs font-medium transition-colors ${
                    char.is_active
                      ? "bg-green-100 text-green-600 hover:bg-green-200"
                      : "bg-gray-100 text-gray-500 hover:bg-gray-200"
                  }`}>
                  {char.is_active ? "启用" : "停用"}
                </button>
              </div>
            </div>
          ))
        )}
      </div>

      {/* Modal */}
      {showModal && (
        <div className="fixed inset-0 bg-black/40 flex items-center justify-center z-[1000]">
          <div className="w-[90%] max-w-[720px] max-h-[88vh] bg-luna-bg rounded-xl overflow-hidden flex flex-col">
            <div className="px-5 py-4 border-b border-luna-border flex items-center justify-between">
              <h2 className="text-base font-semibold text-luna-text">
                {editingId ? "编辑角色" : `新建${formData.card_type === "companion" ? "陪伴" : "普通"}卡`}
              </h2>
              <button onClick={() => setShowModal(false)}
                className="w-7 h-7 rounded-full bg-luna-bg-secondary flex items-center justify-center text-luna-text-secondary hover:bg-luna-bg-tertiary">×</button>
            </div>

            <div className="flex-1 overflow-y-auto p-5 space-y-4">
              {/* 卡类型 + 头像 + 名称 */}
              <div className="flex gap-3 items-start">
                {/* Card type */}
                <div className="flex flex-col gap-1">
                  <label className="text-xs font-medium text-luna-text-secondary">卡类型</label>
                  <select value={formData.card_type} onChange={(e) => setFormData({ ...formData, card_type: e.target.value })}
                    className="py-2 px-2.5 bg-luna-bg border border-luna-border rounded-md text-xs text-luna-text outline-none focus:border-luna-accent">
                    <option value="standard">普通卡</option>
                    <option value="companion">✦ 陪伴卡</option>
                  </select>
                </div>
                {/* Avatar */}
                <div className="flex flex-col items-center gap-1">
                  <label className="text-xs font-medium text-luna-text-secondary">头像</label>
                  <div className="w-16 h-16 rounded-lg bg-luna-bg-secondary border-2 border-dashed border-luna-border-secondary flex flex-col items-center justify-center cursor-pointer text-luna-text-tertiary text-2xl hover:border-luna-accent hover:text-luna-accent transition-all"
                    onClick={() => {
                      const emojis = ["🌙", "⭐", "🔮", "⚔️", "🧙", "🧚", "🐉", "🌸", "❄️", "🔥"];
                      const idx = emojis.indexOf(formData.avatar);
                      setFormData({ ...formData, avatar: emojis[(idx + 1) % emojis.length] });
                    }}>
                    {formData.avatar}
                    <span className="text-[9px] mt-0.5">切换</span>
                  </div>
                </div>
                {/* Name + tags */}
                <div className="flex-1 space-y-2.5">
                  <div>
                    <label className="text-xs font-medium text-luna-text-secondary mb-1 block">角色名称 *</label>
                    <input type="text" value={formData.name} onChange={(e) => setFormData({ ...formData, name: e.target.value })}
                      placeholder="例如：角色名称"
                      className="w-full py-2 px-3 bg-luna-bg border border-luna-border rounded-md text-sm text-luna-text outline-none focus:border-luna-accent" />
                  </div>
                  <div>
                    <label className="text-xs font-medium text-luna-text-secondary mb-1 block">标签</label>
                    <input type="text" value={formData.tags} onChange={(e) => setFormData({ ...formData, tags: e.target.value })}
                      placeholder="用逗号分隔，例如：神秘、冷酷、实战派"
                      className="w-full py-2 px-3 bg-luna-bg border border-luna-border rounded-md text-sm text-luna-text outline-none focus:border-luna-accent" />
                  </div>
                </div>
              </div>

              {/* World */}
              <div>
                <label className="text-xs font-medium text-luna-text-secondary mb-1 block">所属世界</label>
                <select value={formData.world_id} onChange={(e) => setFormData({ ...formData, world_id: e.target.value })}
                  className="w-full py-2 px-3 border border-luna-border rounded-md text-sm text-luna-text outline-none focus:border-luna-accent bg-luna-bg">
                  <option value="">未选择</option>
                  {worlds.map((w) => (<option key={w.id} value={w.id}>{w.name}</option>))}
                </select>
              </div>

              {/* Description + Personality */}
              <div className="grid grid-cols-2 gap-4">
                <div className="col-span-2 lg:col-span-1">
                  <label className="text-xs font-medium text-luna-text-secondary mb-1 block">角色简介</label>
                  <textarea value={formData.description} onChange={(e) => setFormData({ ...formData, description: e.target.value })}
                    placeholder="简单描述这个角色的身份和特点..."
                    className="w-full py-2 px-3 bg-luna-bg border border-luna-border rounded-md text-sm text-luna-text outline-none focus:border-luna-accent resize-y min-h-[80px] leading-relaxed" />
                </div>
                <div className="col-span-2 lg:col-span-1">
                  <label className="text-xs font-medium text-luna-text-secondary mb-1 block">性格设定</label>
                  <textarea value={formData.personality} onChange={(e) => setFormData({ ...formData, personality: e.target.value })}
                    placeholder="描述角色的性格、说话风格、习惯等..."
                    className="w-full py-2 px-3 bg-luna-bg border border-luna-border rounded-md text-sm text-luna-text outline-none focus:border-luna-accent resize-y min-h-[80px] leading-relaxed" />
                </div>
              </div>

              {/* Soul */}
              <div>
                <div className="flex items-center justify-between mb-1.5">
                  <label className="text-xs font-medium text-luna-text-secondary">灵魂 (Soul)</label>
                  <button type="button" onClick={() => {
                    if (editingSoulText) { setEditingSoul(editingSoulText); setEditingSoulText(""); }
                    else { setEditingSoulText(editingSoul); }
                  }} className="text-xs text-luna-accent hover:text-luna-accent/80 transition-colors">
                    {editingSoulText ? "完成" : "编辑"}
                  </button>
                </div>
                {editingSoulText ? (
                  <textarea value={editingSoulText} onChange={(e) => setEditingSoulText(e.target.value)}
                    className="w-full py-2 px-3 bg-luna-bg border border-luna-border rounded-md text-sm text-luna-text outline-none focus:border-luna-accent resize-y min-h-[120px] leading-relaxed" autoFocus />
                ) : editingSoul ? (
                  <div className="p-3 bg-luna-bg-secondary rounded-lg text-xs text-luna-text-secondary leading-relaxed whitespace-pre-wrap max-h-[200px] overflow-y-auto border border-luna-border cursor-pointer hover:border-luna-accent/50"
                    onClick={() => { setEditingSoulText(editingSoul); }}>
                    {editingSoul}
                  </div>
                ) : (
                  <div className="text-xs text-luna-text-tertiary italic p-3 bg-luna-bg-secondary rounded-lg border border-luna-border cursor-pointer hover:border-luna-accent/50"
                    onClick={() => { setEditingSoulText(""); }}>
                    暂无言灵设定（与角色对话后 AI 会自动写入）
                  </div>
                )}
              </div>

              {/* 8-dim stat defaults */}
              <div>
                <label className="text-xs font-medium text-luna-text-secondary mb-2 block">初始属性值</label>
                <p className="text-[10px] text-luna-text-tertiary mb-2">新建对话时角色将以此为基础状态开始</p>
                <div className="grid grid-cols-2 lg:grid-cols-4 gap-x-4 gap-y-2">
                  {STAT_KEYS.map((key) => {
                    const val = statValues[key] ?? STAT_DEFAULTS[key];
                    return (
                      <div key={key}>
                        <div className="flex items-center justify-between text-[11px] mb-0.5">
                          <span className="text-luna-text">{STAT_EMOJI[key]} {STAT_NAMES[key]}</span>
                          <span className="text-luna-text-secondary w-5 text-right">{val}</span>
                        </div>
                        <div data-statbar={key}
                          className="relative h-4 rounded-full overflow-hidden cursor-pointer bg-luna-bg-secondary"
                          onMouseDown={(e) => {
                            const rect = e.currentTarget.getBoundingClientRect();
                            const pct = Math.round(((e.clientX - rect.left) / rect.width) * 100);
                            setStatValues(prev => ({ ...prev, [key]: Math.max(0, Math.min(100, pct)) }));
                            setDraggingStat(key);
                          }}>
                          <div className="h-full rounded-full transition-all"
                            style={{ width: `${val}%`, backgroundColor: STAT_KEY_COLORS[key] || '#534AB7' }} />
                        </div>
                      </div>
                    );
                  })}
                </div>
              </div>

              {/* 子卡系统（陪伴卡专属） */}
              {formData.card_type === "companion" && (
                <div>
                  <div className="flex items-center justify-between mb-1">
                    <label className="text-xs font-medium text-luna-text-secondary">子卡系统</label>
                    <div className="flex gap-1.5">
                      <button onClick={() => setPersonalityStates([...personalityStates, { state_name: "", min_trust: 0, max_trust: 100, min_love: 0, max_love: 100, prompt_text: "", sub_description: "", sub_personality: "", sub_scenario: "", is_special: 0, sort_order: personalityStates.length }])}
                        className="text-xs text-luna-accent hover:text-luna-accent/80 transition-colors">+ 顺序子卡</button>
                      <button onClick={() => setPersonalityStates([...personalityStates, { state_name: "", min_trust: 0, max_trust: 100, min_love: 0, max_love: 100, prompt_text: "", sub_description: "", sub_personality: "", sub_scenario: "", is_special: 1, sort_order: personalityStates.length }])}
                        className="text-xs text-[#ec4899] hover:text-[#ec4899]/80 transition-colors">+ 特殊子卡</button>
                    </div>
                  </div>
                  <p className="text-[10px] text-luna-text-tertiary mb-2">
                    角色简介「{formData.description || '（未填写）'}」为全局人设固定不变。子卡的「性格」在激活时替换角色性格。
                    顺序子卡基于信任和好感度阈值从左到右递增；特殊子卡优先匹配，数值达到任何区间即切换。
                  </p>

                  {/* 预览：当前 stat_defaults 会命中哪个子卡 */}
                  {(() => {
                    const matched = detectPersonalityState(personalityStates as any, statValues);
                    return matched ? <div className="text-[10px] text-luna-accent mb-2">✦ 当前默认值将会命中: {matched.state_name || '(未命名)'}</div> : null;
                  })()}

                  <div className="space-y-2">
                    {personalityStates.sort((a, b) => a.is_special !== b.is_special ? (a.is_special ? 1 : -1) : a.sort_order - b.sort_order).map((st, i) => {
                      const realIndex = personalityStates.indexOf(st);
                      // 校验：顺序子卡的阈值不能低于前一个
                      const seqCards = personalityStates.filter(s => !s.is_special);
                      const idxInSeq = seqCards.indexOf(st);
                      const prevInSeq = idxInSeq > 0 ? seqCards[idxInSeq - 1] : null;
                      const thresholdErr = !st.is_special && prevInSeq && (st.min_trust < (prevInSeq.min_trust + prevInSeq.max_trust) / 2 || st.min_love < (prevInSeq.min_love + prevInSeq.max_love) / 2);
                      return (
                      <div key={realIndex} className={`p-3 rounded-lg border space-y-2 ${st.is_special ? 'bg-pink-50 dark:bg-pink-900/10 border-pink-200 dark:border-pink-800/30' : 'bg-luna-bg-secondary border-luna-border'}`}>
                        <div className="flex items-center gap-2">
                          {st.is_special && <span className="text-[9px] px-1.5 py-0.5 rounded bg-pink-200 dark:bg-pink-800/50 text-pink-700 dark:text-pink-300 font-medium">特殊</span>}
                          <input type="text" value={st.state_name} onChange={(e) => {
                            const next = [...personalityStates]; next[realIndex] = {...next[realIndex], state_name: e.target.value}; setPersonalityStates(next);
                          }} placeholder="子卡名（如：信赖）" className="flex-1 py-1.5 px-2 bg-luna-bg border border-luna-border rounded text-xs text-luna-text outline-none focus:border-luna-accent" />
                          <button onClick={() => setPersonalityStates(personalityStates.filter((_, j) => j !== realIndex))}
                            className="text-xs text-luna-text-tertiary hover:text-luna-red transition-colors">×</button>
                        </div>
                        {thresholdErr && <div className="text-[9px] text-red-500">顺序子卡阈值不能低于前一个子卡</div>}
                        <div className="grid grid-cols-2 gap-2 text-[11px]">
                          <div><span className="text-luna-text-secondary">信任</span>
                            <input type="number" min={0} max={100} value={st.min_trust} onChange={(e) => {
                              const next = [...personalityStates]; next[realIndex] = {...next[realIndex], min_trust: Math.max(0, Math.min(100, parseInt(e.target.value) || 0))}; setPersonalityStates(next);
                            }} className="w-14 ml-1 py-0.5 px-1 bg-luna-bg border border-luna-border rounded text-xs text-luna-text text-center outline-none" /> ~
                            <input type="number" min={0} max={100} value={st.max_trust} onChange={(e) => {
                              const next = [...personalityStates]; next[realIndex] = {...next[realIndex], max_trust: Math.max(0, Math.min(100, parseInt(e.target.value) || 0))}; setPersonalityStates(next);
                            }} className="w-14 ml-1 py-0.5 px-1 bg-luna-bg border border-luna-border rounded text-xs text-luna-text text-center outline-none" />
                          </div>
                          <div><span className="text-luna-text-secondary">好感度</span>
                            <input type="number" min={0} max={100} value={st.min_love} onChange={(e) => {
                              const next = [...personalityStates]; next[realIndex] = {...next[realIndex], min_love: Math.max(0, Math.min(100, parseInt(e.target.value) || 0))}; setPersonalityStates(next);
                            }} className="w-14 ml-1 py-0.5 px-1 bg-luna-bg border border-luna-border rounded text-xs text-luna-text text-center outline-none" /> ~
                            <input type="number" min={0} max={100} value={st.max_love} onChange={(e) => {
                              const next = [...personalityStates]; next[realIndex] = {...next[realIndex], max_love: Math.max(0, Math.min(100, parseInt(e.target.value) || 0))}; setPersonalityStates(next);
                            }} className="w-14 ml-1 py-0.5 px-1 bg-luna-bg border border-luna-border rounded text-xs text-luna-text text-center outline-none" />
                          </div>
                        </div>
                        <div>
                          <textarea value={st.sub_personality} onChange={(e) => {
                            const next = [...personalityStates]; next[realIndex] = {...next[realIndex], sub_personality: e.target.value}; setPersonalityStates(next);
                          }} placeholder="子卡性格（激活时替换角色性格，如：多疑易怒、言辞犀利）"
                            rows={2} className="w-full py-1.5 px-2 bg-luna-bg border border-luna-border rounded text-xs text-luna-text outline-none focus:border-luna-accent resize-y" />
                        </div>
                      </div>
                    );})}
                  </div>
                </div>
              )}

              {/* Banned content */}
              <div>
                <label className="text-xs font-medium text-luna-text-secondary mb-1 block">禁止内容</label>
                <textarea value={formData.banned_content} onChange={(e) => setFormData({ ...formData, banned_content: e.target.value })}
                  placeholder="每行一个禁止词或描述。留空则使用全局禁止词。"
                  rows={2}
                  className="w-full py-2 px-3 bg-luna-bg border border-luna-border rounded-md text-sm text-luna-text outline-none focus:border-luna-accent resize-y leading-relaxed" />
                <div className="text-xs text-luna-text-tertiary mt-1">仅在对话中使用此角色时生效，与全局禁止词叠加</div>
              </div>
            </div>

            {/* Footer */}
            <div className="px-5 py-4 border-t border-luna-border flex justify-end gap-2.5">
              <button onClick={() => setShowModal(false)}
                className="px-4 py-2 border border-luna-border rounded-md bg-luna-bg text-sm text-luna-text-secondary hover:bg-luna-bg-secondary transition-colors">
                取消
              </button>
              <button onClick={handleSubmit}
                className="px-4 py-2 bg-luna-accent text-white rounded-md text-sm font-medium hover:bg-[#3C3489] transition-colors">
                {editingId ? "保存修改" : `创建${formData.card_type === "companion" ? "陪伴" : ""}卡`}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

function getDefaultPersonalityStates(): Omit<PersonalityState, 'id' | 'character_id'>[] {
  return [
    { state_name: "疏远", min_trust: 0, max_trust: 29, min_love: 0, max_love: 39, prompt_text: "话少、客气、保持距离", sub_description: "", sub_personality: "内向、沉静、谨慎、话少", sub_scenario: "", is_special: 0, sort_order: 0 },
    { state_name: "普通", min_trust: 30, max_trust: 60, min_love: 40, max_love: 60, prompt_text: "日常状态，友好但克制", sub_description: "", sub_personality: "平和有礼、自然交流、不卑不亢", sub_scenario: "", is_special: 0, sort_order: 1 },
    { state_name: "熟络", min_trust: 61, max_trust: 85, min_love: 61, max_love: 80, prompt_text: "放得开、有说有笑", sub_description: "", sub_personality: "坦诚、放松、会开玩笑、不拘谨", sub_scenario: "", is_special: 0, sort_order: 2 },
    { state_name: "信赖", min_trust: 86, max_trust: 100, min_love: 81, max_love: 100, prompt_text: "无话不谈、真实自我", sub_description: "", sub_personality: "直言不讳、卸下防备、愿吐露心声", sub_scenario: "", is_special: 0, sort_order: 3 },
  ];
}

const STAT_KEY_COLORS: Record<string, string> = {
  stat_happy: '#22c55e',
  stat_discomfort: '#ef4444',
  stat_trust: '#3b82f6',
  stat_energy: '#eab308',
  stat_affection: '#ec4899',
  stat_curiosity: '#a855f7',
  stat_relax: '#14b8a6',
  stat_depression: '#78716c',
};
