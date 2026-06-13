export interface Message {
  id: number;
  chat_id: number;
  role: "user" | "assistant" | "system";
  content: string;
  emotion?: string;
  speech?: string;
  action?: string;
  location?: string;
  branch_id?: string;
  reasoning_content?: string;
  reply_to_id?: number | null;
  timestamp: string;
  /** 角色自主引用的消息原文（非用户引用，是 AI 端的引用） */
  quoted_content?: string | null;
  quoted_speaker?: string | null;
  quoted_time?: string | null;
  /** 是否为主动消息（v1.1.5） */
  is_proactive?: number;
  /** 旁白类型: "action" | "dialogue" | null */
  narration_type?: string | null;
}

export interface Chat {
  id: number;
  title: string;
  character_id: number | null;
  created_at: string;
  updated_at: string;
  is_archived: number;
  is_pinned: number;
}

export interface ApiSettings {
  id: number;
  endpoint: string;
  api_key: string;
  model: string;
  temperature: number;
  max_tokens: number;
  system_prompt: string;
  user_name: string;
  user_persona: string;
}

/** API 配置方案（多 profile） */
export interface ApiProfile {
  id: number;
  name: string;
  provider: string;
  endpoint: string;
  api_key: string;
  model: string;
  temperature: number;
  max_tokens: number;
  system_prompt: string;
  is_default: number;
  is_verified: number;
  created_at: string;
  updated_at: string;
}

/** 厂商模板 */
export interface ApiProviderTemplate {
  id: string;
  name: string;
  endpoint: string;
  hint: string;
  category: 'cloud' | 'local';
}

// ─── Agent Runtime Types ───

/** 角色自主引用的历史消息 */
export interface QuoteInfo {
  /** 被引用的消息原文 */
  content: string;
  /** 说话者：角色名字 或 用户 */
  speaker: string;
  /** 可选时间描述，如 "早上 8:34" */
  time?: string;
}

/** AI 回复 + 工具调用 */
export interface AgentResponse {
  reply: string;
  emotion: string;
  speech: string;
  action: string;
  actions: ToolAction[];
  reasoning_content?: string;
  /** LLM 直接指定的属性值变化（覆盖 emotion 映射） */
  stat_deltas?: Partial<Record<'stat_happy' | 'stat_discomfort' | 'stat_trust' | 'stat_energy' | 'stat_affection' | 'stat_curiosity' | 'stat_relax' | 'stat_depression', number>>;
  stat_values?: Partial<Record<'stat_happy' | 'stat_discomfort' | 'stat_trust' | 'stat_energy' | 'stat_affection' | 'stat_curiosity' | 'stat_relax' | 'stat_depression', number>>;
  /** 角色自主引用的历史消息 */
  quote?: QuoteInfo;
}

/** AI 发起的工具调用 */
export interface ToolAction {
  tool: string;
  content: string;
}

/** Agent 上下文（soul/memory/world） */
export interface AgentContext {
  soul: string;
  memory: string;
  world: string;
}

/** 聊天历史消息（传给 Agent） */
export interface ChatMessage {
  role: string;
  content: string;
  reasoning_content?: string;
}

/** 角色信息（传给 Agent） */
export interface CharacterInfo {
  name: string;
  description: string;
  personality: string;
  world_name: string;
  world_description: string;
  personality_state_text: string;
  stat_values_json: string;
}

// ─── Legacy (keep for DB compatibility) ───

export interface Character {
  id: number;
  name: string;
  avatar: string;
  world_id: number | null;
  world_name?: string;
  world_description?: string;
  description: string;
  personality: string;
  tags: string;
  is_active: number;
  card_type: string;        // 'standard' | 'companion'
  stat_defaults: string | null;  // JSON: 8 stat defaults
  created_at: string;
  updated_at: string;
}

// ─── 角色属性值系统 ───

export interface ChatStats {
  id: number;
  chat_id: number;
  stat_happy: number;
  stat_discomfort: number;
  stat_trust: number;
  stat_energy: number;
  stat_affection: number;
  stat_curiosity: number;
  stat_relax: number;
  stat_depression: number;
  updated_at: string;
}

export interface StatSnapshot {
  id: number;
  chat_id: number;
  message_id: number | null;
  stat_happy: number;
  stat_discomfort: number;
  stat_trust: number;
  stat_energy: number;
  stat_affection: number;
  stat_curiosity: number;
  stat_relax: number;
  stat_depression: number;
  timestamp: string;
}

/** emotion → 属性值变化映射 */
export const EMOTION_DELTA: Record<string, Partial<Record<'stat_happy' | 'stat_discomfort' | 'stat_trust' | 'stat_energy' | 'stat_affection' | 'stat_curiosity' | 'stat_relax' | 'stat_depression', number>>> = {
  happy: { stat_happy: 10, stat_discomfort: -5, stat_trust: 5, stat_energy: 5, stat_affection: 5, stat_curiosity: 3, stat_relax: 5, stat_depression: -3 },
  love: { stat_happy: 15, stat_discomfort: -5, stat_trust: 10, stat_energy: 5, stat_affection: 12, stat_curiosity: 5, stat_relax: 8, stat_depression: -8 },
  excited: { stat_happy: 12, stat_discomfort: -5, stat_trust: 5, stat_energy: 10, stat_affection: 8, stat_curiosity: 10, stat_relax: -3, stat_depression: -2 },
  sad: { stat_happy: -15, stat_discomfort: 10, stat_trust: -20, stat_energy: -10, stat_affection: -5, stat_curiosity: -8, stat_relax: -8, stat_depression: 12 },
  angry: { stat_happy: -20, stat_discomfort: 15, stat_trust: -35, stat_energy: 5, stat_affection: -10, stat_curiosity: 3, stat_relax: -15, stat_depression: 5 },
  scared: { stat_happy: -15, stat_discomfort: 15, stat_trust: -15, stat_energy: -15, stat_affection: -8, stat_curiosity: -5, stat_relax: -12, stat_depression: 10 },
  shy: { stat_happy: 5, stat_discomfort: 5, stat_trust: 2, stat_energy: -5, stat_affection: 5, stat_curiosity: -3, stat_relax: -3, stat_depression: 2 },
  confused: { stat_happy: -5, stat_discomfort: 5, stat_trust: -8, stat_energy: -5, stat_affection: -3, stat_curiosity: 5, stat_relax: -8, stat_depression: 5 },
  thinking: { stat_happy: -5, stat_discomfort: 2, stat_trust: -3, stat_energy: -5, stat_affection: 0, stat_curiosity: 8, stat_relax: 2, stat_depression: -3 },
  sleepy: { stat_happy: -5, stat_energy: -10, stat_affection: -2, stat_curiosity: -3, stat_relax: 5, stat_depression: 2 },
  tired: { stat_happy: -5, stat_energy: -8, stat_discomfort: 3, stat_affection: -3, stat_curiosity: -5, stat_relax: -3, stat_depression: 8 },
  idle: { stat_energy: -2, stat_affection: 0, stat_curiosity: -2, stat_relax: 3, stat_depression: 0 },
};

export interface MemoryEntry {
  id?: number;
  chat_id: number;
  content: string;
  source: 'auto' | 'user' | 'llm' | 'consolidated';
  memory_type: 'short_term' | 'long_term';
  created_at?: string;
  consolidated_at?: string | null;
}

export interface DiaryEntry {
  id?: number;
  date: string;        // YYYY-MM-DD
  title: string;
  summary: string;
  manual_note: string;
  chat_ids: string;    // comma-separated
  created_at?: string;
}

/** 旁白/主动消息队列中的单条记录 */
export interface NarrationItem {
  id: number;
  delay_seconds: number;
  /** ISO 8601 绝对发送时间（后端计算） */
  scheduled_at?: string;
  narration_type: "action" | "dialogue";
  text: string;
  delivered: boolean;
}

/** 旁白+主动消息设置 */
export interface ProactiveSettings {
  enabled: boolean;
  intervalMinutes: number;
  /** "HH:mm" 格式的空闲时段起始，空字符串=不启用 */
  silentStart: string;
  /** "HH:mm" 格式的空闲时段结束 */
  silentEnd: string;
}

export const DEFAULT_PROACTIVE: ProactiveSettings = {
  enabled: false,
  intervalMinutes: 5,
  silentStart: "",
  silentEnd: "",
};

export const STAT_NAMES: Record<string, string> = {
  stat_happy: '开心',
  stat_discomfort: '不适',
  stat_trust: '信任',
  stat_energy: '精力',
  stat_affection: '好感度',
  stat_curiosity: '好奇',
  stat_relax: '放松',
  stat_depression: '沮丧',
};
