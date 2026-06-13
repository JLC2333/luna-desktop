import Database from "@tauri-apps/plugin-sql";
import type { ApiProfile, ChatStats, StatSnapshot, MemoryEntry, DiaryEntry } from "../types";
import { EMOTION_DELTA } from "../types";

let db: Database | null = null;

export async function getDb(): Promise<Database> {
  if (db) return db;
  db = await Database.load("sqlite:luna.db");
  await initTables();
  return db;
}

async function initTables() {
  const database = await getDb();

  await database.execute(`
    CREATE TABLE IF NOT EXISTS chats (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      title TEXT NOT NULL DEFAULT '新对话',
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      updated_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      is_archived INTEGER DEFAULT 0
    );
  `);

  await database.execute(`
    CREATE TABLE IF NOT EXISTS messages (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      chat_id INTEGER NOT NULL,
      role TEXT NOT NULL CHECK(role IN ('user', 'assistant', 'system')),
      content TEXT NOT NULL,
      emotion TEXT,
      speech TEXT,
      action TEXT,
      location TEXT,
      timestamp DATETIME DEFAULT CURRENT_TIMESTAMP,
      FOREIGN KEY (chat_id) REFERENCES chats(id) ON DELETE CASCADE
    );
  `);
  // Migration: add speech column (v1.1.0)
  try {
    await database.execute("ALTER TABLE messages ADD COLUMN speech TEXT");
  } catch (_e) {
    // column already exists, ignore
  }
  // Migration: add branch_id column
  try {
    await database.execute("ALTER TABLE messages ADD COLUMN branch_id TEXT");
  } catch (_e) {
    // column already exists, ignore
  }
  // Migration: add deleted_at column to chats (soft delete)
  try {
    await database.execute("ALTER TABLE chats ADD COLUMN deleted_at DATETIME");
  } catch (_e) {
    // column already exists, ignore
  }
  // Migration: add deleted_at column to messages (soft delete)
  try {
    await database.execute("ALTER TABLE messages ADD COLUMN deleted_at DATETIME");
  } catch (_e) {
    // column already exists, ignore
  }
  // Migration: add is_proactive column (v1.1.5)
  try {
    await database.execute("ALTER TABLE messages ADD COLUMN is_proactive INTEGER DEFAULT 0");
  } catch (_e) { }
  // Migration: add narration_type column (v1.1.5)
  try {
    await database.execute("ALTER TABLE messages ADD COLUMN narration_type TEXT");
  } catch (_e) { }
  // Migration: add narration_bind column to chats (v1.1.5)
  try {
    await database.execute("ALTER TABLE chats ADD COLUMN narration_bind INTEGER DEFAULT 0");
  } catch (_e) { }

  await database.execute(`
    CREATE TABLE IF NOT EXISTS api_settings (
      id INTEGER PRIMARY KEY CHECK(id = 1),
      endpoint TEXT NOT NULL DEFAULT 'http://localhost:1234/v1',
      api_key TEXT NOT NULL DEFAULT 'lm-studio',
      model TEXT NOT NULL DEFAULT 'default',
      temperature REAL DEFAULT 0.7,
      max_tokens INTEGER DEFAULT 2000,
      system_prompt TEXT DEFAULT '',
      user_name TEXT DEFAULT '',
      user_persona TEXT DEFAULT '',
      updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
    );
  `);

  await database.execute(`
    CREATE INDEX IF NOT EXISTS idx_messages_chat_id ON messages(chat_id);
  `);

  // 世界观表
  await database.execute(`
    CREATE TABLE IF NOT EXISTS worlds (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      name TEXT NOT NULL,
      description TEXT,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
    );
  `);

  // 角色表
  await database.execute(`
    CREATE TABLE IF NOT EXISTS characters (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      name TEXT NOT NULL,
      avatar TEXT DEFAULT '🌙',
      world_id INTEGER,
      description TEXT,
      personality TEXT,
      tags TEXT,
      is_active INTEGER DEFAULT 1,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      updated_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      FOREIGN KEY (world_id) REFERENCES worlds(id) ON DELETE SET NULL
    );
  `);

  // 迁移：给 chats 表添加 character_id 字段（如果还没有）
  try {
    await database.execute(`ALTER TABLE chats ADD COLUMN character_id INTEGER DEFAULT NULL`);
  } catch (e) {
    // 字段已存在，忽略错误
  }

  // 迁移：给 chats 表添加 is_pinned 字段（如果还没有）
  try {
    await database.execute(`ALTER TABLE chats ADD COLUMN is_pinned INTEGER DEFAULT 0`);
  } catch (e) {
    // 字段已存在，忽略错误
  }

  // 迁移：给 api_settings 表添加 user_name 和 user_persona 字段
  try {
    const tableInfo = await database.select("PRAGMA table_info(api_settings)") as any[];
    const hasUserName = tableInfo.some((col: any) => col.name === 'user_name');
    const hasUserPersona = tableInfo.some((col: any) => col.name === 'user_persona');
    if (!hasUserName) {
      await database.execute(`ALTER TABLE api_settings ADD COLUMN user_name TEXT DEFAULT ''`);
    }
    if (!hasUserPersona) {
      await database.execute(`ALTER TABLE api_settings ADD COLUMN user_persona TEXT DEFAULT ''`);
    }
  } catch (e) {
    console.error("迁移 user_name/user_persona 字段失败:", e);
  }

  // 角色属性值表（v1.1.0）
  await database.execute(`
    CREATE TABLE IF NOT EXISTS chat_stats (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      chat_id INTEGER NOT NULL UNIQUE,
      stat_happy REAL NOT NULL DEFAULT 80,
      stat_discomfort REAL NOT NULL DEFAULT 0,
      stat_trust REAL NOT NULL DEFAULT 80,
      stat_energy REAL NOT NULL DEFAULT 80,
      stat_affection REAL NOT NULL DEFAULT 50,
      stat_curiosity REAL NOT NULL DEFAULT 60,
      stat_relax REAL NOT NULL DEFAULT 70,
      stat_depression REAL NOT NULL DEFAULT 0,
      updated_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      FOREIGN KEY (chat_id) REFERENCES chats(id) ON DELETE CASCADE
    );
  `);
  await database.execute(`
    CREATE TABLE IF NOT EXISTS stat_snapshots (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      chat_id INTEGER NOT NULL,
      message_id INTEGER,
      stat_happy REAL NOT NULL,
      stat_discomfort REAL NOT NULL,
      stat_trust REAL NOT NULL,
      stat_energy REAL NOT NULL,
      stat_affection REAL NOT NULL DEFAULT 50,
      stat_curiosity REAL NOT NULL DEFAULT 60,
      stat_relax REAL NOT NULL DEFAULT 70,
      stat_depression REAL NOT NULL DEFAULT 0,
      timestamp DATETIME DEFAULT CURRENT_TIMESTAMP,
      FOREIGN KEY (chat_id) REFERENCES chats(id) ON DELETE CASCADE,
      FOREIGN KEY (message_id) REFERENCES messages(id) ON DELETE SET NULL
    );
  `);
  // 兼容旧表：添加可能缺失的列（老数据库可能没有后4个属性列）
  for (const col of ['stat_affection', 'stat_curiosity', 'stat_relax', 'stat_depression']) {
    try { await database.execute(`ALTER TABLE chat_stats ADD COLUMN ${col} REAL NOT NULL DEFAULT 0;`); } catch (_) {}
    try { await database.execute(`ALTER TABLE stat_snapshots ADD COLUMN ${col} REAL NOT NULL DEFAULT 0;`); } catch (_) {}
  }


  // API 配置表（多 profile 支持）
  await database.execute(`
    CREATE TABLE IF NOT EXISTS api_profiles (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      name TEXT NOT NULL,
      provider TEXT NOT NULL DEFAULT 'custom',
      endpoint TEXT NOT NULL,
      api_key TEXT NOT NULL DEFAULT '',
      model TEXT NOT NULL DEFAULT '',
      temperature REAL DEFAULT 0.7,
      max_tokens INTEGER DEFAULT 2000,
      system_prompt TEXT DEFAULT '',
      is_default INTEGER DEFAULT 0,
      is_verified INTEGER DEFAULT 0,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
    );
  `);

  // 记忆系统表（v1.1.0 memory system）
  await database.execute(`
    CREATE TABLE IF NOT EXISTS memories (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      chat_id INTEGER NOT NULL,
      content TEXT NOT NULL,
      source TEXT NOT NULL DEFAULT 'auto' CHECK(source IN ('auto','user','llm','consolidated')),
      memory_type TEXT NOT NULL DEFAULT 'short_term' CHECK(memory_type IN ('short_term','long_term')),
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      consolidated_at DATETIME,
      FOREIGN KEY (chat_id) REFERENCES chats(id) ON DELETE CASCADE
    );
  `);
  // FTS5 全文索引（记忆搜索）
  try {
    await database.execute(`CREATE VIRTUAL TABLE IF NOT EXISTS memories_fts USING fts5(content, content='memories', content_rowid='id')`);
  } catch (e) {
    console.error("创建 memories_fts 索引失败:", e);
  }
  // FTS 触发器：保持同步
  try {
    await database.execute(`
      CREATE TRIGGER IF NOT EXISTS memories_ai AFTER INSERT ON memories BEGIN
        INSERT INTO memories_fts(rowid, content) VALUES (new.id, new.content);
      END
    `);
    await database.execute(`
      CREATE TRIGGER IF NOT EXISTS memories_ad AFTER DELETE ON memories BEGIN
        INSERT INTO memories_fts(memories_fts, rowid, content) VALUES('delete', old.id, old.content);
      END
    `);
    await database.execute(`
      CREATE TRIGGER IF NOT EXISTS memories_au AFTER UPDATE ON memories BEGIN
        INSERT INTO memories_fts(memories_fts, rowid, content) VALUES('delete', old.id, old.content);
        INSERT INTO memories_fts(rowid, content) VALUES (new.id, new.content);
      END
    `);
  } catch (e) {
    console.error("创建 FTS 触发器失败:", e);
  }

  // 日记表
  await database.execute(`
    CREATE TABLE IF NOT EXISTS diary_entries (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      date TEXT NOT NULL,
      title TEXT NOT NULL DEFAULT '',
      summary TEXT NOT NULL DEFAULT '',
      manual_note TEXT NOT NULL DEFAULT '',
      chat_ids TEXT NOT NULL DEFAULT '',
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP
    );
  `);
  await database.execute(`CREATE INDEX IF NOT EXISTS idx_diary_entries_date ON diary_entries(date);`);

  // 应用配置表（key-value 存储，用于看板娘邀请码等）
  await database.execute(`
    CREATE TABLE IF NOT EXISTS app_config (
      key TEXT PRIMARY KEY,
      value TEXT NOT NULL,
      updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
    );
  `);

  // 旧 api_settings 不再自动迁移为 profile（避免打包后出现"旧配置"占位）

  // 迁移：给 messages 表添加 branch_id 字段（分支对话）
  try {
    await database.execute(`ALTER TABLE messages ADD COLUMN branch_id TEXT DEFAULT NULL`);
  } catch (e) {
    // 字段已存在，忽略错误
  }

  // 迁移：给 messages 表添加 reasoning_content 字段（DeepSeek thinking 模式）
  try {
    await database.execute(`ALTER TABLE messages ADD COLUMN reasoning_content TEXT`);
  } catch (e) {
    // 字段已存在，忽略错误
  }

  // 迁移：给 messages 表添加 reply_to_id 字段（引用回复）
  try {
    await database.execute(`ALTER TABLE messages ADD COLUMN reply_to_id INTEGER DEFAULT NULL`);
  } catch (e) {
    // 字段已存在，忽略错误
  }

  // 迁移：给 messages 表添加 quoted_* 字段（AI 自主引用消息）
  try {
    await database.execute(`ALTER TABLE messages ADD COLUMN quoted_content TEXT`);
  } catch (e) {}
  try {
    await database.execute(`ALTER TABLE messages ADD COLUMN quoted_speaker TEXT`);
  } catch (e) {}
  try {
    await database.execute(`ALTER TABLE messages ADD COLUMN quoted_time TEXT`);
  } catch (e) {}

  // 迁移：给 characters 表添加 card_type 字段
  try {
    await database.execute(`ALTER TABLE characters ADD COLUMN card_type TEXT DEFAULT 'standard'`);
  } catch (e) {
    // 字段已存在，忽略错误
  }
  // 迁移：给 characters 表添加 stat_defaults 字段
  try {
    await database.execute(`ALTER TABLE characters ADD COLUMN stat_defaults TEXT DEFAULT NULL`);
  } catch (e) {
    // 字段已存在，忽略错误
  }

  // 迁移：chats 表添加 chat_type 字段（normal / companion）
  try {
    await database.execute(`ALTER TABLE chats ADD COLUMN chat_type TEXT DEFAULT 'normal'`);
  } catch (e) {}

  // 迁移：personality_states 表（陪伴卡人格状态/子卡）
  await database.execute(`
    CREATE TABLE IF NOT EXISTS personality_states (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      character_id INTEGER NOT NULL,
      state_name TEXT NOT NULL,
      min_trust REAL DEFAULT 0,
      max_trust REAL DEFAULT 100,
      min_love REAL DEFAULT 0,
      max_love REAL DEFAULT 100,
      prompt_text TEXT NOT NULL DEFAULT '',
      sub_description TEXT DEFAULT '',
      sub_personality TEXT DEFAULT '',
      sub_scenario TEXT DEFAULT '',
      is_special INTEGER DEFAULT 0,
      sort_order INTEGER DEFAULT 0,
      FOREIGN KEY (character_id) REFERENCES characters(id) ON DELETE CASCADE
    )
  `);
  // 迁移：添加 sd 新字段
  try { await database.execute(`ALTER TABLE personality_states ADD COLUMN sub_description TEXT DEFAULT ''`); } catch (e) {}
  try { await database.execute(`ALTER TABLE personality_states ADD COLUMN sub_personality TEXT DEFAULT ''`); } catch (e) {}
  try { await database.execute(`ALTER TABLE personality_states ADD COLUMN sub_scenario TEXT DEFAULT ''`); } catch (e) {}
  try { await database.execute(`ALTER TABLE personality_states ADD COLUMN is_special INTEGER DEFAULT 0`); } catch (e) {}

  // 迁移：chats 表添加 mascot_bind 字段（看板娘绑定）
  try {
    await database.execute(`ALTER TABLE chats ADD COLUMN mascot_bind INTEGER DEFAULT 0`);
  } catch (e) {}

  await database.execute(`
    CREATE INDEX IF NOT EXISTS idx_characters_world_id ON characters(world_id);
  `);

  await database.execute(`
    INSERT OR IGNORE INTO api_settings (id, endpoint, api_key, model, system_prompt)
    VALUES (1, 'http://127.0.0.1:1234/v1', 'lm-studio', '',
    '');
  `);
}

export async function createChat(title: string = "新对话", characterId?: number): Promise<number> {
  const db = await getDb();
  const result = await db.execute(
    "INSERT INTO chats (title, character_id) VALUES (?, ?)",
    [title, characterId || null]
  );
  return result.lastInsertId as number;
}

export async function getChats(): Promise<
  { id: number; title: string; character_id: number | null; created_at: string; updated_at: string; is_archived: number; is_pinned: number; chat_type: string }[]
> {
  const db = await getDb();
  return await db.select(
    "SELECT *, COALESCE(chat_type, 'normal') as chat_type FROM chats WHERE is_archived = 0 AND deleted_at IS NULL ORDER BY is_pinned DESC, updated_at DESC"
  );
}

export async function recoverChat(chatId: number) {
  const db = await getDb();
  await db.execute("UPDATE chats SET deleted_at = NULL WHERE id = ?", [chatId]);
}

export async function recoverMessage(messageId: number) {
  const db = await getDb();
  await db.execute("UPDATE messages SET deleted_at = NULL WHERE id = ?", [messageId]);
}

export async function getTrashChats(): Promise<
  { id: number; title: string; character_id: number | null; created_at: string; updated_at: string; deleted_at: string }[]
> {
  const db = await getDb();
  return await db.select(
    "SELECT id, title, character_id, created_at, updated_at, deleted_at FROM chats WHERE deleted_at IS NOT NULL ORDER BY deleted_at DESC"
  );
}

export async function emptyTrash(chatId?: number) {
  const db = await getDb();
  if (chatId) {
    // 真删单个已软删的对话
    await db.execute("DELETE FROM stat_snapshots WHERE chat_id = ?", [chatId]);
    await db.execute("DELETE FROM chat_stats WHERE chat_id = ?", [chatId]);
    await db.execute("DELETE FROM messages WHERE chat_id = ?", [chatId]);
    await db.execute("DELETE FROM chats WHERE id = ? AND deleted_at IS NOT NULL", [chatId]);
  } else {
    // 清空所有已软删的对话
    await db.execute("DELETE FROM stat_snapshots WHERE chat_id IN (SELECT id FROM chats WHERE deleted_at IS NOT NULL)");
    await db.execute("DELETE FROM chat_stats WHERE chat_id IN (SELECT id FROM chats WHERE deleted_at IS NOT NULL)");
    await db.execute("DELETE FROM messages WHERE chat_id IN (SELECT id FROM chats WHERE deleted_at IS NOT NULL)");
    await db.execute("DELETE FROM chats WHERE deleted_at IS NOT NULL");
  }
}

export async function getMessages(chatId: number, branchId?: string): Promise<
  { id: number; chat_id: number; role: string; content: string; emotion: string | null; speech: string | null; action: string | null; location: string | null; branch_id: string | null; reasoning_content: string | null; timestamp: string; quoted_content: string | null; quoted_speaker: string | null; quoted_time: string | null; is_proactive: number | null; narration_type: string | null }[]
> {
  const db = await getDb();
  if (branchId) {
    return await db.select(
      "SELECT * FROM messages WHERE chat_id = ? AND deleted_at IS NULL AND (branch_id IS NULL OR branch_id = ?) ORDER BY timestamp ASC",
      [chatId, branchId]
    );
  }
  return await db.select(
    "SELECT * FROM messages WHERE chat_id = ? AND deleted_at IS NULL AND branch_id IS NULL ORDER BY timestamp ASC",
    [chatId]
  );
}

/** 创建对话分支，返回新分支 ID */
export async function createBranch(chatId: number, parentMessageId: number): Promise<string> {
  const db = await getDb();
  const branchId = `branch_${Date.now()}`;
  // 把 branch point 之后、无分支标记的消息归到 "original" 分支
  await db.execute(
    `UPDATE messages SET branch_id = 'original' WHERE chat_id = ? AND id > ? AND branch_id IS NULL`,
    [chatId, parentMessageId]
  );
  return branchId;
}

/** 获取对话的所有分支 ID（用于切换） */
export async function getBranches(chatId: number): Promise<string[]> {
  const db = await getDb();
  const result = await db.select(
    `SELECT DISTINCT branch_id FROM messages WHERE chat_id = ? AND branch_id IS NOT NULL ORDER BY branch_id`,
    [chatId]
  ) as { branch_id: string }[];
  return result.map((r) => r.branch_id);
}

export async function saveMessage(
  chatId: number,
  role: string,
  content: string,
  emotion?: string,
  speech?: string,
  action?: string,
  location?: string,
  branchId?: string,
  reasoningContent?: string,
  replyToId?: number | null,
  quotedContent?: string | null,
  quotedSpeaker?: string | null,
  quotedTime?: string | null,
  isProactive?: number,
  narrationType?: string | null,
): Promise<number> {
  const db = await getDb();
  const result = await db.execute(
    "INSERT INTO messages (chat_id, role, content, emotion, speech, action, location, branch_id, reasoning_content, reply_to_id, quoted_content, quoted_speaker, quoted_time, is_proactive, narration_type) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)",
    [chatId, role, content, emotion || null, speech || null, action || null, location || null, branchId || null, reasoningContent || null, replyToId || null, quotedContent || null, quotedSpeaker || null, quotedTime || null, isProactive ?? 0, narrationType || null]
  );
  return result.lastInsertId as number;
}

export async function getMessageById(id: number): Promise<{ id: number; role: string; content: string; chat_id: number } | null> {
  const db = await getDb();
  const rows = await db.select(
    "SELECT id, role, content, chat_id FROM messages WHERE id = ? AND deleted_at IS NULL",
    [id]
  ) as { id: number; role: string; content: string; chat_id: number }[];
  return rows[0] || null;
}

export async function deleteMessage(messageId: number): Promise<void> {
  const db = await getDb();
  // 获取该消息所在 chat_id，用于清理旧版 NULL 快照
  const rows = await db.select<{chat_id: number}[]>("SELECT chat_id FROM messages WHERE id = ?", [messageId]);
  // 软删除：标记 deleted_at 而非真删
  await db.execute("UPDATE messages SET deleted_at = datetime('now') WHERE id = ?", [messageId]);
  await db.execute("DELETE FROM stat_snapshots WHERE message_id = ?", [messageId]);
  // 清理历史遗留的 NULL message_id 快照（assistantMsgId 传 null 时期的 bug）
  if (rows.length > 0) {
    await db.execute("DELETE FROM stat_snapshots WHERE chat_id = ? AND message_id IS NULL", [rows[0].chat_id]);
  }
}

export async function updateChatTitle(chatId: number, title: string) {
  const db = await getDb();
  await db.execute(
    "UPDATE chats SET title = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ?",
    [title, chatId]
  );
}

export async function updateChatCharacter(chatId: number, characterId: number | null) {
  const db = await getDb();
  await db.execute(
    "UPDATE chats SET character_id = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ?",
    [characterId, chatId]
  );
}

export async function togglePinChat(chatId: number, isPinned: boolean) {
  const db = await getDb();
  await db.execute(
    "UPDATE chats SET is_pinned = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ?",
    [isPinned ? 1 : 0, chatId]
  );
}

export async function deleteChat(chatId: number) {
  const db = await getDb();
  // 软删除：标记 deleted_at 而非真删，保留 stats 数据用于恢复
  await db.execute("UPDATE chats SET deleted_at = datetime('now') WHERE id = ?", [chatId]);
}

export async function getSettings(): Promise<
  { 
    id: number; 
    endpoint: string; 
    api_key: string; 
    model: string; 
    temperature: number; 
    max_tokens: number; 
    system_prompt: string;
    user_name: string;
    user_persona: string;
  } | null
> {
  const db = await getDb();
  const results = await db.select("SELECT * FROM api_settings WHERE id = 1") as any[];
  return results[0] || null;
}

export async function updateSettings(settings: {
  endpoint?: string;
  api_key?: string;
  model?: string;
  temperature?: number;
  max_tokens?: number;
  system_prompt?: string;
  user_name?: string;
  user_persona?: string;
}) {
  const db = await getDb();
  const fields = Object.keys(settings)
    .map((key) => `${key} = ?`)
    .join(", ");
  const values = Object.values(settings);
  await db.execute(
    `UPDATE api_settings SET ${fields}, updated_at = CURRENT_TIMESTAMP WHERE id = 1`,
    [...values]
  );
}

// ========== 角色管理 ==========

export interface Character {
  id: number;
  name: string;
  avatar: string;
  world_id: number | null;
  world_name?: string;
  description: string;
  personality: string;
  tags: string;
  is_active: number;
  card_type: string;
  stat_defaults: string | null;
  created_at: string;
  updated_at: string;
}

export async function getCharacters(): Promise<Character[]> {
  const db = await getDb();
  return await db.select(`
    SELECT c.*, w.name as world_name 
    FROM characters c 
    LEFT JOIN worlds w ON c.world_id = w.id 
    ORDER BY c.updated_at DESC
  `);
}

export async function getCharacterByChatId(chatId: number): Promise<{name: string; avatar: string} | null> {
  const db = await getDb();
  const results = await db.select(`
    SELECT c.name, c.avatar FROM characters c
    JOIN chats ch ON ch.character_id = c.id
    WHERE ch.id = ?
  `, [chatId]) as {name: string; avatar: string}[];
  return results[0] || null;
}

export async function getCharacterById(id: number): Promise<Character | null> {
  const db = await getDb();
  const results = await db.select(`
    SELECT c.*, w.name as world_name, w.description as world_description
    FROM characters c 
    LEFT JOIN worlds w ON c.world_id = w.id 
    WHERE c.id = ?
  `, [id]) as Character[];
  return results[0] || null;
}

export async function getCharacterWithWorld(id: number): Promise<(Character & { world_description?: string }) | null> {
  const db = await getDb();
  const results = await db.select(`
    SELECT c.*, w.name as world_name, w.description as world_description
    FROM characters c 
    LEFT JOIN worlds w ON c.world_id = w.id 
    WHERE c.id = ?
  `, [id]) as (Character & { world_description?: string })[];
  return results[0] || null;
}

export async function createCharacter(data: {
  name: string;
  avatar?: string;
  world_id?: number;
  description?: string;
  personality?: string;
  tags?: string;
  card_type?: string;
  stat_defaults?: string | null;
}): Promise<number> {
  const db = await getDb();
  const result = await db.execute(
    `INSERT INTO characters (name, avatar, world_id, description, personality, tags, card_type, stat_defaults)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
    [
      data.name,
      data.avatar || '🌙',
      data.world_id || null,
      data.description || '',
      data.personality || '',
      data.tags || '',
      data.card_type || 'standard',
      data.stat_defaults || null,
    ]
  );
  return result.lastInsertId as number;
}

export async function updateCharacter(
  id: number,
  data: Partial<{
    name: string;
    avatar: string;
    world_id: number;
    description: string;
    personality: string;
    tags: string;
    is_active: number;
    card_type: string;
    stat_defaults: string | null;
  }>
): Promise<void> {
  const db = await getDb();
  const fields: string[] = [];
  const values: any[] = [];
  
  Object.entries(data).forEach(([key, value]) => {
    if (value !== undefined) {
      fields.push(`${key} = ?`);
      values.push(value);
    }
  });
  
  if (fields.length === 0) return;
  
  fields.push('updated_at = CURRENT_TIMESTAMP');
  values.push(id);
  
  await db.execute(
    `UPDATE characters SET ${fields.join(', ')} WHERE id = ?`,
    values
  );
}

export async function deleteCharacter(id: number): Promise<void> {
  const db = await getDb();
  await db.execute("DELETE FROM characters WHERE id = ?", [id]);
}

// ========== 陪伴卡人格状态 ==========

export interface PersonalityState {
  id?: number;
  character_id: number;
  state_name: string;
  min_trust: number;
  max_trust: number;
  min_love: number;
  max_love: number;
  prompt_text: string;
  sub_description: string;
  sub_personality: string;
  sub_scenario: string;
  is_special: number;
  sort_order: number;
}

export async function getPersonalityStates(characterId: number): Promise<PersonalityState[]> {
  const db = await getDb();
  return await db.select(
    "SELECT * FROM personality_states WHERE character_id = ? ORDER BY sort_order",
    [characterId]
  );
}

export async function savePersonalityStates(characterId: number, states: Omit<PersonalityState, 'id' | 'character_id'>[]): Promise<void> {
  const db = await getDb();
  await db.execute("DELETE FROM personality_states WHERE character_id = ?", [characterId]);
  for (let i = 0; i < states.length; i++) {
    const s = states[i];
    await db.execute(
      `INSERT INTO personality_states (character_id, state_name, min_trust, max_trust, min_love, max_love, prompt_text, sub_description, sub_personality, sub_scenario, is_special, sort_order)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [characterId, s.state_name, s.min_trust, s.max_trust, s.min_love, s.max_love, s.prompt_text, s.sub_description, s.sub_personality, s.sub_scenario, s.is_special, s.sort_order]
    );
  }
}

/** 根据当前属性值计算匹配的人格状态（特殊子卡优先） */
export function detectPersonalityState(
  states: PersonalityState[],
  stats: Record<string, number>
): PersonalityState | null {
  const trust = stats["stat_trust"] ?? 50;
  const love = stats["stat_affection"] ?? 50;
  // 1. 特殊子卡优先（1s_special=1）
  const special = states.find(s => s.is_special && trust >= s.min_trust && trust <= s.max_trust && love >= s.min_love && love <= s.max_love);
  if (special) return special;
  // 2. 顺序子卡按 sort_order 匹配
  for (const s of states) {
    if (!s.is_special && trust >= s.min_trust && trust <= s.max_trust && love >= s.min_love && love <= s.max_love) {
      return s;
    }
  }
  return null;
}

/** 根据当前激活的子卡，更新角色卡的 personality（子卡切换时调用） */
export async function applySubCardPersonality(characterId: number, subCard: PersonalityState): Promise<void> {
  const db = await getDb();
  if (subCard.sub_personality) {
    await db.execute("UPDATE characters SET personality = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ?",
      [subCard.sub_personality, characterId]);
  }
}

/** 把聊天当前属性值同步回角色卡的 stat_defaults */
export async function syncCharacterStatsFromChat(characterId: number): Promise<void> {
  const db = await getDb();
  const chats = await db.select<{ chat_id: number }[]>(
    "SELECT id as chat_id FROM chats WHERE character_id = ? ORDER BY updated_at DESC LIMIT 1",
    [characterId]
  );
  if (chats.length === 0) return;
  const stats = await getChatStats(chats[0].chat_id);
  if (!stats) return;
  const defaults = JSON.stringify({
    stat_happy: stats.stat_happy,
    stat_discomfort: stats.stat_discomfort,
    stat_trust: stats.stat_trust,
    stat_energy: stats.stat_energy,
    stat_affection: stats.stat_affection,
    stat_curiosity: stats.stat_curiosity,
    stat_relax: stats.stat_relax,
    stat_depression: stats.stat_depression,
  });
  await db.execute("UPDATE characters SET stat_defaults = ? WHERE id = ?", [defaults, characterId]);
}

export async function toggleCharacterActive(id: number, isActive: boolean): Promise<void> {
  const db = await getDb();
  await db.execute(
    "UPDATE characters SET is_active = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ?",
    [isActive ? 1 : 0, id]
  );
}

// ========== 世界观管理 ==========

export interface World {
  id: number;
  name: string;
  description: string;
  created_at: string;
  updated_at: string;
}

export async function getWorlds(): Promise<World[]> {
  const db = await getDb();
  return await db.select("SELECT * FROM worlds ORDER BY updated_at DESC");
}

export async function createWorld(name: string, description?: string): Promise<number> {
  const db = await getDb();
  const result = await db.execute(
    "INSERT INTO worlds (name, description) VALUES (?, ?)",
    [name, description || '']
  );
  return result.lastInsertId as number;
}

export async function updateWorld(id: number, name: string, description?: string): Promise<void> {
  const db = await getDb();
  await db.execute(
    "UPDATE worlds SET name = ?, description = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ?",
    [name, description || '', id]
  );
}

export async function deleteWorld(id: number): Promise<void> {
  const db = await getDb();
  await db.execute("DELETE FROM worlds WHERE id = ?", [id]);
}

// ========== 分支 & 重新回答 ==========

/** 删除对话中指定消息之后的所有消息（用于重新回答） */
export async function deleteMessagesAfter(chatId: number, afterMessageId: number): Promise<void> {
  const db = await getDb();
  await db.execute(
    "DELETE FROM messages WHERE chat_id = ? AND id > ?",
    [chatId, afterMessageId]
  );
  await db.execute(
    "DELETE FROM stat_snapshots WHERE chat_id = ? AND message_id > ?",
    [chatId, afterMessageId]
  );
}

/** 删除指定消息及之后的所有消息（用于修改输入） */
export async function deleteMessagesFrom(chatId: number, fromMessageId: number): Promise<void> {
  const db = await getDb();
  await db.execute(
    "DELETE FROM messages WHERE chat_id = ? AND id >= ?",
    [chatId, fromMessageId]
  );
  await db.execute(
    "DELETE FROM stat_snapshots WHERE chat_id = ? AND message_id >= ?",
    [chatId, fromMessageId]
  );
}

/** 从对话中分支：创建新对话并复制消息到分支点 */
export async function branchChat(chatId: number, upToMessageId: number, newChatTitle: string): Promise<number> {
  const db = await getDb();

  const result = await db.execute(
    "INSERT INTO chats (title, character_id) SELECT ?, character_id FROM chats WHERE id = ?",
    [newChatTitle, chatId]
  );
  const newChatId = result.lastInsertId as number;

  await db.execute(
    `INSERT INTO messages (chat_id, role, content, emotion, speech, action, location, timestamp)
     SELECT ?, role, content, emotion, speech, action, location, timestamp
     FROM messages WHERE chat_id = ? AND id <= ? ORDER BY timestamp ASC`,
    [newChatId, chatId, upToMessageId]
  );

  // 复制 chat_stats（保持分支前的属性值）
  await db.execute(
    `INSERT OR REPLACE INTO chat_stats (chat_id, stat_happy, stat_discomfort, stat_trust, stat_energy, stat_affection, stat_curiosity, stat_relax, stat_depression, updated_at)
     SELECT ?, stat_happy, stat_discomfort, stat_trust, stat_energy, stat_affection, stat_curiosity, stat_relax, stat_depression, updated_at
     FROM chat_stats WHERE chat_id = ?`,
    [newChatId, chatId]
  );

  // 复制 stat_snapshots 历史快照到分支点（保持属性曲线）
  await db.execute(
    `INSERT INTO stat_snapshots (chat_id, message_id, stat_happy, stat_discomfort, stat_trust, stat_energy, stat_affection, stat_curiosity, stat_relax, stat_depression, timestamp)
     SELECT ?, message_id, stat_happy, stat_discomfort, stat_trust, stat_energy, stat_affection, stat_curiosity, stat_relax, stat_depression, timestamp
     FROM stat_snapshots WHERE chat_id = ? AND message_id IS NOT NULL AND message_id <= ? ORDER BY timestamp ASC`,
    [newChatId, chatId, upToMessageId]
  );

  return newChatId;
}

// ========== API Profile 管理 ==========

export async function getApiProfiles(): Promise<ApiProfile[]> {
  const db = await getDb();
  return await db.select("SELECT * FROM api_profiles ORDER BY is_default DESC, updated_at DESC");
}

export async function getDefaultProfile(): Promise<ApiProfile | null> {
  const db = await getDb();
  const results = await db.select("SELECT * FROM api_profiles WHERE is_default = 1 LIMIT 1") as ApiProfile[];
  return results[0] || null;
}

export async function addApiProfile(profile: {
  name: string;
  provider: string;
  endpoint: string;
  api_key: string;
  model: string;
  temperature?: number;
  max_tokens?: number;
  system_prompt?: string;
  is_verified?: number;
}): Promise<number> {
  const db = await getDb();
  const result = await db.execute(
    `INSERT INTO api_profiles (name, provider, endpoint, api_key, model, temperature, max_tokens, system_prompt, is_verified)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    [
      profile.name,
      profile.provider,
      profile.endpoint,
      profile.api_key,
      profile.model,
      profile.temperature ?? 0.7,
      profile.max_tokens ?? 2000,
      profile.system_prompt ?? '',
      profile.is_verified ?? 0,
    ]
  );
  return result.lastInsertId as number;
}

export async function updateApiProfile(
  id: number,
  data: Partial<{
    name: string;
    provider: string;
    endpoint: string;
    api_key: string;
    model: string;
    temperature: number;
    max_tokens: number;
    system_prompt: string;
    is_verified: number;
  }>
): Promise<void> {
  const db = await getDb();
  const fields: string[] = [];
  const values: any[] = [];

  Object.entries(data).forEach(([key, value]) => {
    if (value !== undefined) {
      fields.push(`${key} = ?`);
      values.push(value);
    }
  });

  if (fields.length === 0) return;

  fields.push('updated_at = CURRENT_TIMESTAMP');
  values.push(id);

  await db.execute(
    `UPDATE api_profiles SET ${fields.join(', ')} WHERE id = ?`,
    values
  );
}

export async function deleteApiProfile(id: number): Promise<void> {
  const db = await getDb();
  await db.execute("DELETE FROM api_profiles WHERE id = ?", [id]);
}

export async function setDefaultApiProfile(id: number): Promise<void> {
  const db = await getDb();
  await db.execute("UPDATE api_profiles SET is_default = 0");
  await db.execute("UPDATE api_profiles SET is_default = 1, updated_at = CURRENT_TIMESTAMP WHERE id = ?", [id]);
}

// ========== 角色属性值系统 ==========

const STAT_DEFAULTS = { happy: 80, discomfort: 0, trust: 80, energy: 80, affection: 50, curiosity: 60, relax: 70, depression: 0 };

export async function getChatStats(chatId: number): Promise<ChatStats | null> {
  const db = await getDb();
  const rows = await db.select<ChatStats[]>(
    "SELECT * FROM chat_stats WHERE chat_id = ?",
    [chatId]
  );
  return rows.length > 0 ? rows[0] : null;
}

export async function ensureChatStats(chatId: number, statDefaults?: string | null): Promise<ChatStats> {
  try {
    let stats = await getChatStats(chatId);
    if (!stats) {
      // 使用角色卡设定的默认值，如果没有就用全局默认值
      let init: Record<string, number> = { stat_happy: 80, stat_discomfort: 0, stat_trust: 80, stat_energy: 80, stat_affection: 50, stat_curiosity: 60, stat_relax: 70, stat_depression: 0 };
      if (statDefaults) {
        try {
          const parsed = JSON.parse(statDefaults);
          Object.assign(init, parsed);
        } catch {}
      }
      const db = await getDb();
      const result = await db.execute(
        "INSERT INTO chat_stats (chat_id, stat_happy, stat_discomfort, stat_trust, stat_energy, stat_affection, stat_curiosity, stat_relax, stat_depression) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)",
        [chatId, init.stat_happy, init.stat_discomfort, init.stat_trust, init.stat_energy, init.stat_affection, init.stat_curiosity, init.stat_relax, init.stat_depression]
      );
      stats = {
        id: result.lastInsertId as number,
        chat_id: chatId,
        stat_happy: init.stat_happy,
        stat_discomfort: init.stat_discomfort,
        stat_trust: init.stat_trust,
        stat_energy: init.stat_energy,
        stat_affection: init.stat_affection,
        stat_curiosity: init.stat_curiosity,
        stat_relax: init.stat_relax,
        stat_depression: init.stat_depression,
        updated_at: new Date().toISOString(),
      };
      // 插入基线快照
      await db.execute(
        "INSERT INTO stat_snapshots (chat_id, message_id, stat_happy, stat_discomfort, stat_trust, stat_energy, stat_affection, stat_curiosity, stat_relax, stat_depression) VALUES (?, NULL, ?, ?, ?, ?, ?, ?, ?, ?)",
        [chatId, init.stat_happy, init.stat_discomfort, init.stat_trust, init.stat_energy, init.stat_affection, init.stat_curiosity, init.stat_relax, init.stat_depression]
      );
    }
    return stats;
  } catch (e) {
    console.error("ensureChatStats failed:", e);
    return { id: 0, chat_id: chatId, stat_happy: 80, stat_discomfort: 0, stat_trust: 80, stat_energy: 80, stat_affection: 50, stat_curiosity: 60, stat_relax: 70, stat_depression: 0, updated_at: new Date().toISOString() };
  }
}

/**
 * 根据 LLM 输出应用属性值变化，创建快照
 * 优先级：statValues（绝对值）> statDeltas（变化量）> emotion 映射
 * LLM 拥有完整控制权，程序不做任何范围/漂移干预
 */
export async function applyEmotionDelta(
  chatId: number,
  messageId: number | null,
  emotion: string | null,
  statDeltas?: Partial<Record<'stat_happy' | 'stat_discomfort' | 'stat_trust' | 'stat_energy' | 'stat_affection' | 'stat_curiosity' | 'stat_relax' | 'stat_depression', number>> | null,
  statValues?: Partial<Record<'stat_happy' | 'stat_discomfort' | 'stat_trust' | 'stat_energy' | 'stat_affection' | 'stat_curiosity' | 'stat_relax' | 'stat_depression', number>> | null
): Promise<ChatStats> {
  try {
  let stats = await ensureChatStats(chatId);
  const updated = { ...stats };

  if (statValues && Object.keys(statValues).length > 0) {
    for (const [key, val] of Object.entries(statValues)) {
      if (typeof val !== 'number') continue;
      (updated as any)[key] = Math.max(0, Math.min(100, val));
    }
  } else if (statDeltas && Object.keys(statDeltas).length > 0) {
    for (const [key, val] of Object.entries(statDeltas)) {
      if (typeof val !== 'number') continue;
      const current = (stats as any)[key] as number;
      (updated as any)[key] = Math.max(0, Math.min(100, current + val));
    }
  } else if (emotion) {
    const delta = EMOTION_DELTA[emotion.toLowerCase()];
    if (delta) {
      for (const [key, val] of Object.entries(delta)) {
        const current = (stats as any)[key] as number;
        (updated as any)[key] = Math.max(0, Math.min(100, current + val));
      }
    }
  }

  const db = await getDb();
  await db.execute(
    "UPDATE chat_stats SET stat_happy = ?, stat_discomfort = ?, stat_trust = ?, stat_energy = ?, stat_affection = ?, stat_curiosity = ?, stat_relax = ?, stat_depression = ?, updated_at = CURRENT_TIMESTAMP WHERE chat_id = ?",
    [updated.stat_happy, updated.stat_discomfort, updated.stat_trust, updated.stat_energy, updated.stat_affection, updated.stat_curiosity, updated.stat_relax, updated.stat_depression, chatId]
  );

  // 创建快照
  await db.execute(
    "INSERT INTO stat_snapshots (chat_id, message_id, stat_happy, stat_discomfort, stat_trust, stat_energy, stat_affection, stat_curiosity, stat_relax, stat_depression) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)",
    [chatId, messageId, updated.stat_happy, updated.stat_discomfort, updated.stat_trust, updated.stat_energy, updated.stat_affection, updated.stat_curiosity, updated.stat_relax, updated.stat_depression]
  );

  stats = await getChatStats(chatId) as ChatStats;
  return stats;
  } catch (e) {
    console.error("applyEmotionDelta failed:", e);
    return (await ensureChatStats(chatId));
  }
}

/** 直接设置某个属性值（用于面板滑块拖动） */
export async function setStat(
  chatId: number,
  statName: string,
  value: number
): Promise<void> {
  const db = await getDb();
  await db.execute(
    `UPDATE chat_stats SET ${statName} = ?, updated_at = CURRENT_TIMESTAMP WHERE chat_id = ?`,
    [Math.max(0, Math.min(100, value)), chatId]
  );
}

/** 获取属性值历史变化记录 */
export async function getStatHistory(chatId: number): Promise<StatSnapshot[]> {
  const db = await getDb();
  return await db.select<StatSnapshot[]>(
    "SELECT * FROM stat_snapshots WHERE chat_id = ? ORDER BY timestamp ASC",
    [chatId]
  );
}

/** 回滚到指定消息之前的快照。无历史时重置为默认值。 */
export async function rollbackStats(chatId: number, toMessageId: number): Promise<ChatStats> {
  const db = await getDb();
  const snapshots = await db.select<StatSnapshot[]>(
    "SELECT * FROM stat_snapshots WHERE chat_id = ? AND message_id < ? ORDER BY timestamp DESC LIMIT 1",
    [chatId, toMessageId]
  );

  if (snapshots.length === 0) {
    await db.execute(
      `UPDATE chat_stats SET stat_happy = ${STAT_DEFAULTS.happy}, stat_discomfort = ${STAT_DEFAULTS.discomfort}, stat_trust = ${STAT_DEFAULTS.trust}, stat_energy = ${STAT_DEFAULTS.energy}, stat_affection = ${STAT_DEFAULTS.affection}, stat_curiosity = ${STAT_DEFAULTS.curiosity}, stat_relax = ${STAT_DEFAULTS.relax}, stat_depression = ${STAT_DEFAULTS.depression}, updated_at = CURRENT_TIMESTAMP WHERE chat_id = ?`,
      [chatId]
    );
    return (await getChatStats(chatId))!;
  }

  const snap = snapshots[0];
  await db.execute(
    "UPDATE chat_stats SET stat_happy = ?, stat_discomfort = ?, stat_trust = ?, stat_energy = ?, stat_affection = ?, stat_curiosity = ?, stat_relax = ?, stat_depression = ?, updated_at = CURRENT_TIMESTAMP WHERE chat_id = ?",
    [snap.stat_happy, snap.stat_discomfort, snap.stat_trust, snap.stat_energy, snap.stat_affection, snap.stat_curiosity, snap.stat_relax, snap.stat_depression, chatId]
  );

  // 删除该消息之后的所有快照（属性值已回滚，后续快照基于旧状态已失效）
  await db.execute(
    "DELETE FROM stat_snapshots WHERE chat_id = ? AND message_id >= ?",
    [chatId, toMessageId]
  );

  return (await getChatStats(chatId))!;
}

// ─── 记忆系统 CRUD ──────────────────────────────────────────

export async function getMemories(chatId: number): Promise<MemoryEntry[]> {
  const db = await getDb();
  return (await db.select(
    "SELECT * FROM memories WHERE chat_id = ? ORDER BY created_at DESC",
    [chatId]
  )) as MemoryEntry[];
}

// 去重：检查是否已有相似记忆
async function hasSimilarMemory(chatId: number, content: string): Promise<boolean> {
  const db = await getDb();
  // 1. 精确匹配
  const exact = await db.select(
    "SELECT COUNT(*) as cnt FROM memories WHERE chat_id = ? AND content = ?",
    [chatId, content]
  ) as { cnt: number }[];
  if (exact[0]?.cnt > 0) return true;

  // 2. 提取关键词（≥2 字符）
  const keywords: string[] = [];
  for (const raw of content.split(/[\s，。！？、；：”“（）【】\/\\]+/)) {
    const word = raw.trim();
    if (word.length >= 2) keywords.push(word);
  }
  if (keywords.length === 0) return false;

  // 3. FTS5 搜索
  try {
    const query = keywords.join(" AND ");
    const results = await db.select(
      `SELECT m.content FROM memories m
       JOIN memories_fts fts ON m.id = fts.rowid
       WHERE m.chat_id = ? AND memories_fts MATCH ?
       ORDER BY rank LIMIT 10`,
      [chatId, query]
    ) as { content: string }[];

    for (const row of results) {
      const overlap = keywords.filter((k) => row.content.includes(k)).length;
      if (keywords.length > 0 && overlap / keywords.length >= 0.6) {
        return true;
      }
    }
  } catch {
    // FTS5 不可用时跳过
  }

  return false;
}

/** 获取某个角色关联的最新对话 ID（用于手动添加记忆时绑定角色） */
export async function getChatIdForCharacter(characterId: number | null): Promise<number> {
  const db = await getDb();
  if (characterId) {
    const chats = await db.select(
      "SELECT id FROM chats WHERE character_id = ? AND deleted_at IS NULL ORDER BY updated_at DESC LIMIT 1",
      [characterId]
    ) as { id: number }[];
    if (chats.length > 0) return chats[0].id;
  }
  // 兜底：取最新可用对话
  const chats = await db.select(
    "SELECT id FROM chats WHERE deleted_at IS NULL ORDER BY updated_at DESC LIMIT 1"
  ) as { id: number }[];
  if (chats.length > 0) return chats[0].id;
  // 再无则创建一个
  const result = await db.execute("INSERT INTO chats (title) VALUES ('默认对话')");
  return result.lastInsertId as number;
}

export async function addMemory(entry: {
  chat_id: number;
  content: string;
  source: 'auto' | 'user' | 'llm' | 'consolidated';
  memory_type?: 'short_term' | 'long_term';
  userDate?: string;    // YYYY-MM-DD，覆盖 created_at
}): Promise<number> {
  const db = await getDb();
  // 去重
  const duplicate = await hasSimilarMemory(entry.chat_id, entry.content);
  if (duplicate) {
    console.log("[memory-dedup] 跳过重复记忆:", entry.content);
    return -1;
  }
  const createdAt = entry.userDate ? `${entry.userDate} 12:00:00` : undefined;
  const result = await db.execute(
    "INSERT INTO memories (chat_id, content, source, memory_type, created_at) VALUES (?, ?, ?, ?, COALESCE(?, CURRENT_TIMESTAMP))",
    [entry.chat_id, entry.content, entry.source, entry.memory_type || 'short_term', createdAt || null]
  );
  return result.lastInsertId as number;
}

export async function deleteMemory(id: number): Promise<void> {
  const db = await getDb();
  await db.execute("DELETE FROM memories WHERE id = ?", [id]);
}

export async function getAllMemoriesByDate(date: string): Promise<MemoryEntry[]> {
  const db = await getDb();
  return (await db.select(
    "SELECT * FROM memories WHERE date(created_at) = ? ORDER BY created_at DESC",
    [date]
  )) as MemoryEntry[];
}

export async function getMemoriesByCharacter(charId: number): Promise<MemoryEntry[]> {
  const db = await getDb();
  return (await db.select(
    `SELECT m.* FROM memories m
     JOIN chats c ON m.chat_id = c.id
     WHERE c.character_id = ?
     ORDER BY m.created_at DESC`,
    [charId]
  )) as MemoryEntry[];
}

export async function getMemoriesByDateAndCharacter(date: string, charId: number): Promise<MemoryEntry[]> {
  const db = await getDb();
  return (await db.select(
    `SELECT m.* FROM memories m
     JOIN chats c ON m.chat_id = c.id
     WHERE date(m.created_at) = ? AND c.character_id = ?
     ORDER BY m.created_at DESC`,
    [date, charId]
  )) as MemoryEntry[];
}

export async function getAllMemories(): Promise<MemoryEntry[]> {
  const db = await getDb();
  return (await db.select(
    "SELECT * FROM memories ORDER BY created_at DESC"
  )) as MemoryEntry[];
}

export async function consolidateMemories(chatId: number): Promise<string> {
  const db = await getDb();
  // 读取所有未固化的短期记忆
  const memories = await db.select(
    "SELECT * FROM memories WHERE chat_id = ? AND memory_type = 'short_term' AND consolidated_at IS NULL ORDER BY created_at ASC",
    [chatId]
  ) as MemoryEntry[];
  if (memories.length === 0) return '';

  const combined = memories.map((m: MemoryEntry) => `- ${m.content}`).join('\n');
  const consolidated = `[固化记忆 ${new Date().toISOString().slice(0,10)}]\n${combined}`;

  // 写入为长期记忆
  await db.execute(
    "INSERT INTO memories (chat_id, content, source, memory_type) VALUES (?, ?, 'consolidated', 'long_term')",
    [chatId, consolidated]
  );
  // 标记旧记忆为已固化
  const ids = memories.map((m: MemoryEntry) => m.id).join(',');
  await db.execute(
    `UPDATE memories SET consolidated_at = CURRENT_TIMESTAMP WHERE id IN (${ids})`
  );

  return consolidated;
}

export async function searchMemories(chatId: number, query: string): Promise<MemoryEntry[]> {
  const db = await getDb();
  try {
    // FTS5 搜索
    return (await db.select(
      "SELECT m.* FROM memories m JOIN memories_fts fts ON m.id = fts.rowid WHERE m.chat_id = ? AND memories_fts MATCH ? ORDER BY rank LIMIT 10",
      [chatId, query]
    )) as MemoryEntry[];
  } catch {
    // FTS5 不可用时降级为 LIKE 搜索
    return (await db.select(
      "SELECT * FROM memories WHERE chat_id = ? AND content LIKE ? ORDER BY created_at DESC LIMIT 10",
      [chatId, `%${query}%`]
    )) as MemoryEntry[];
  }
}

export async function getAllMemoriesForChat(chatId: number): Promise<MemoryEntry[]> {
  const db = await getDb();
  return (await db.select(
    "SELECT * FROM memories WHERE chat_id = ? AND memory_type = 'long_term' ORDER BY created_at DESC",
    [chatId]
  )) as MemoryEntry[];
}

// ─── 日记 CRUD ──────────────────────────────────────────────

export async function deleteDiaryEntry(id: number): Promise<void> {
  const db = await getDb();
  await db.execute("DELETE FROM diary_entries WHERE id = ?", [id]);
}

export async function getDiaryEntries(yearMonth?: string): Promise<DiaryEntry[]> {
  const db = await getDb();
  if (yearMonth) {
    return (await db.select(
      "SELECT * FROM diary_entries WHERE date LIKE ? ORDER BY date DESC",
      [`${yearMonth}%`]
    )) as DiaryEntry[];
  }
  return (await db.select(
    "SELECT * FROM diary_entries ORDER BY date DESC"
  )) as DiaryEntry[];
}

export async function getDiaryEntryByDate(date: string): Promise<DiaryEntry | null> {
  const db = await getDb();
  const rows = await db.select(
    "SELECT * FROM diary_entries WHERE date = ?",
    [date]
  ) as DiaryEntry[];
  return rows[0] || null;
}

// ─── 应用配置（key-value，看板娘邀请码等）───

export async function getAppConfig(key: string): Promise<string | null> {
  const db = await getDb();
  const rows = await db.select(
    "SELECT value FROM app_config WHERE key = ?",
    [key]
  ) as { value: string }[];
  return rows[0]?.value ?? null;
}

export async function setAppConfig(key: string, value: string): Promise<void> {
  const db = await getDb();
  await db.execute(
    "INSERT OR REPLACE INTO app_config (key, value, updated_at) VALUES (?, ?, CURRENT_TIMESTAMP)",
    [key, value]
  );
}

export async function deleteAppConfig(key: string): Promise<void> {
  const db = await getDb();
  await db.execute("DELETE FROM app_config WHERE key = ?", [key]);
}

export async function clearAllAppConfig(): Promise<void> {
  const db = await getDb();
  await db.execute("DELETE FROM app_config");
}

// ─── 看板娘绑定 ───

/** 绑定当前对话到看板娘（自动解除其他对话的绑定） */
export async function bindMascot(chatId: number): Promise<void> {
  const db = await getDb();
  await db.execute("UPDATE chats SET mascot_bind = 0");
  await db.execute("UPDATE chats SET mascot_bind = 1 WHERE id = ?", [chatId]);
}

/** 解除看板娘绑定 */
export async function unbindMascot(): Promise<void> {
  const db = await getDb();
  await db.execute("UPDATE chats SET mascot_bind = 0");
}

/** 获取当前绑定的对话（null 表示无绑定） */
export async function getMascotBind(): Promise<{ id: number; title: string; character_id: number | null } | null> {
  const db = await getDb();
  const rows = await db.select("SELECT id, title, character_id FROM chats WHERE mascot_bind = 1") as any[];
  return rows[0] || null;
}

export async function upsertDiaryEntry(entry: {
  date: string;
  title?: string;
  summary?: string;
  manual_note?: string;
  chat_ids?: string;
}): Promise<void> {
  const db = await getDb();
  const existing = await getDiaryEntryByDate(entry.date);
  if (existing) {
    // 追加到已有日记后，而不是覆盖
    const appendedNote = existing.manual_note
      ? existing.manual_note + "\n\n---\n\n" + (entry.manual_note || "")
      : entry.manual_note || existing.manual_note;
    const appendedSummary = existing.summary
      ? existing.summary + "\n" + (entry.summary || "")
      : entry.summary || existing.summary;
    await db.execute(
      `UPDATE diary_entries SET title = ?, summary = ?, manual_note = ?, chat_ids = ? WHERE date = ?`,
      [
        entry.title ?? existing.title,
        appendedSummary.slice(0, 500),
        appendedNote,
        entry.chat_ids ?? existing.chat_ids,
        entry.date
      ]
    );
  } else {
    await db.execute(
      `INSERT INTO diary_entries (date, title, summary, manual_note, chat_ids) VALUES (?, ?, ?, ?, ?)`,
      [
        entry.date,
        entry.title || '',
        entry.summary || '',
        entry.manual_note || '',
        entry.chat_ids || ''
      ]
    );
  }
}
