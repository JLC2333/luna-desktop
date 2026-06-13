# LunA — 项目架构文档

> 版本：v1.1.0 | 技术栈：Tauri v2 + React + TypeScript + SQLite + Tailwind CSS

---

## 一、项目概述

LunA 是一个桌面 AI 角色扮演聊天应用，基于 Tauri v2 构建。核心差异化在于 **8 维角色属性系统 + 上下文智能管理（soul/memory 文件化持久） + LLM function calling 驱动工具调用**，而非单纯模仿 SillyTavern 的功能清单。

**定位：** 开箱即用的 AI 角色扮演桌面端，强调沉浸感和角色一致性。

---

## 二、项目结构

```
luna-desktop/
├── index.html                          # 入口 HTML
├── package.json                        # 前端依赖
├── vite.config.ts                      # Vite 构建配置
├── tailwind.config.js                  # Tailwind 主题（自定义色板）
├── tsconfig.json                       # TS 编译配置
│
├── src/                                # 前端（React + TypeScript）
│   ├── main.tsx                        # React 入口
│   ├── App.tsx                         # 全局路由（顶栏 + 页面切换）
│   ├── styles.css                      # 全局样式 + CSS 变量（深色/浅色主题）
│   │
│   ├── pages/
│   │   ├── ChatPage.tsx                # 聊天页（核心，~1500 行）
│   │   ├── CharactersPage.tsx          # 角色管理页
│   │   ├── WorldsPage.tsx              # 世界观管理页
│   │   ├── HistoryPage.tsx             # 历史记录页
│   │   ├── SettingsPage.tsx            # 设置页（API/Prompt/外观/回收站）
│   │   └── UserProfilePage.tsx         # 我的页面
│   │
│   ├── components/
│   │   ├── StatsPanel.tsx              # 属性统计面板（进度条 + 折线图）
│   │   └── EmotionActionStrip.tsx      # 情绪/动作展示条
│   │
│   ├── stores/
│   │   ├── settingsStore.ts            # 设置状态（主题/API/颜色）
│   │   └── chatStore.ts                # 聊天状态（当前对话/消息）
│   │
│   ├── types/
│   │   └── index.ts                    # TS 类型定义（Message/Chat/ChatStats 等）
│   │
│   ├── constants/
│   │   └── apiProviders.ts             # API 厂商模板预设
│   │
│   └── utils/
│       └── db.ts                       # SQLite 数据库初始化 + 全部 CRUD 操作
│
├── src-tauri/                          # 后端（Rust）
│   ├── Cargo.toml                      # Rust 依赖
│   ├── tauri.conf.json                 # Tauri 配置
│   └── src/
│       ├── main.rs                     # 原生入口
│       ├── lib.rs                      # Tauri Builder + 全部 command 注册
│       ├── commands/
│       │   ├── mod.rs
│       │   └── chat.rs                 # Tauri commands（22 个）
│       └── agent/                      # Agent 核心引擎
│           ├── mod.rs
│           ├── types.rs                # 数据结构（AgentResponse/ChatMessage 等）
│           ├── context.rs              # 文件系统上下文（soul/memory/world 读写）
│           ├── llm.rs                  # LLM API 客户端（OpenAI 兼容）
│           └── core.rs                 # 核心业务逻辑（process_message 主循环）
│
└── scripts/
    └── build-and-install.sh            # 构建 + 安装脚本
```

---

## 三、数据库设计（SQLite）

文件位置：`~/Library/Application Support/com.luna.desktop/luna.db`

### 3.1 chats — 对话表

```sql
CREATE TABLE chats (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  title TEXT DEFAULT '新对话',
  character_id INTEGER,                  -- 关联角色 ID
  created_at TEXT DEFAULT (datetime('now','localtime')),
  updated_at TEXT DEFAULT (datetime('now','localtime')),
  is_archived INTEGER DEFAULT 0,
  is_pinned INTEGER DEFAULT 0,           -- 置顶
  deleted_at TEXT,                        -- 软删除时间戳（NULL = 未删除）
  chat_stats_id INTEGER                   -- 关联 chat_stats 表
);
```

### 3.2 messages — 消息表

```sql
CREATE TABLE messages (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  chat_id INTEGER NOT NULL,
  role TEXT NOT NULL,                    -- "user" | "assistant" | "system"
  content TEXT NOT NULL,
  emotion TEXT,
  speech TEXT,                           -- 旁白/动作描述
  action TEXT,
  location TEXT,
  branch_id TEXT,                        -- 分支标识（用于对话分支）
  reasoning_content TEXT,                -- DeepSeek thinking 缓存
  timestamp TEXT DEFAULT (datetime('now','localtime')),
  branch_from INTEGER,                   -- 分支源消息 ID
  deleted_at TEXT,                       -- 软删除
  FOREIGN KEY (chat_id) REFERENCES chats(id) ON DELETE CASCADE
);
CREATE INDEX idx_messages_chat_id ON messages(chat_id);
```

### 3.3 worlds — 世界观表

```sql
CREATE TABLE worlds (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  name TEXT NOT NULL,
  description TEXT DEFAULT '',
  created_at TEXT DEFAULT (datetime('now','localtime')),
  deleted_at TEXT
);
```

### 3.4 characters — 角色表

```sql
CREATE TABLE characters (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  name TEXT NOT NULL,
  avatar TEXT DEFAULT '😊',              -- emoji 头像
  world_id INTEGER,                      -- 关联世界观
  description TEXT DEFAULT '',            -- 简介
  personality TEXT DEFAULT '',            -- 性格设定
  tags TEXT DEFAULT '',
  is_active INTEGER DEFAULT 1,           -- 启停状态
  created_at TEXT DEFAULT (datetime('now','localtime')),
  updated_at TEXT DEFAULT (datetime('now','localtime')),
  deleted_at TEXT,
  FOREIGN KEY (world_id) REFERENCES worlds(id) ON DELETE SET NULL
);
CREATE INDEX idx_characters_world_id ON characters(world_id);
```

### 3.5 api_settings — API 设置（单例）

```sql
CREATE TABLE api_settings (
  id INTEGER PRIMARY KEY CHECK(id = 1),  -- 强制单行
  endpoint TEXT DEFAULT '',
  api_key TEXT DEFAULT '',
  model TEXT DEFAULT '',
  temperature REAL DEFAULT 0.7,
  max_tokens INTEGER DEFAULT 2048,
  system_prompt TEXT DEFAULT '',
  user_name TEXT DEFAULT '',
  user_persona TEXT DEFAULT ''
);
```

### 3.6 api_profiles — API 多配置方案

```sql
CREATE TABLE api_profiles (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  name TEXT NOT NULL,
  provider TEXT DEFAULT '',
  endpoint TEXT DEFAULT '',
  api_key TEXT DEFAULT '',
  model TEXT DEFAULT '',
  temperature REAL DEFAULT 0.7,
  max_tokens INTEGER DEFAULT 2048,
  system_prompt TEXT DEFAULT '',
  is_default INTEGER DEFAULT 0,
  is_verified INTEGER DEFAULT 0,
  created_at TEXT DEFAULT (datetime('now','localtime')),
  updated_at TEXT DEFAULT (datetime('now','localtime'))
);
```

### 3.7 chat_stats — 角色属性状态表

```sql
CREATE TABLE chat_stats (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  chat_id INTEGER NOT NULL,
  stat_happy INTEGER DEFAULT 50,
  stat_discomfort INTEGER DEFAULT 50,
  stat_trust INTEGER DEFAULT 50,
  stat_energy INTEGER DEFAULT 50,
  stat_affection INTEGER DEFAULT 50,      -- 5/25 追加
  stat_curiosity INTEGER DEFAULT 50,
  stat_relax INTEGER DEFAULT 50,
  stat_depression INTEGER DEFAULT 50,
  updated_at TEXT DEFAULT (datetime('now','localtime')),
  FOREIGN KEY (chat_id) REFERENCES chats(id) ON DELETE CASCADE
);
```

### 3.8 stat_snapshots — 属性快照表（用于历史曲线）

```sql
CREATE TABLE stat_snapshots (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  chat_id INTEGER NOT NULL,
  message_id INTEGER,                    -- 触发消息 ID（NULL = 基线快照）
  stat_happy INTEGER DEFAULT 50,
  stat_discomfort INTEGER DEFAULT 50,
  stat_trust INTEGER DEFAULT 50,
  stat_energy INTEGER DEFAULT 50,
  stat_affection INTEGER DEFAULT 50,
  stat_curiosity INTEGER DEFAULT 50,
  stat_relax INTEGER DEFAULT 50,
  stat_depression INTEGER DEFAULT 50,
  timestamp TEXT DEFAULT (datetime('now','localtime')),
  FOREIGN KEY (chat_id) REFERENCES chats(id) ON DELETE CASCADE
);
```

---

## 四、Rust 后端（Tauri Commands）

### 4.1 注册的 commands（22 个）

| Command | 参数 | 返回值 | 描述 |
|---------|------|--------|------|
| `send_message` | content, character_id, chat_id, character, settings, history, stat_string | `AgentResponse` | 发送用户消息 → AI 回复 |
| `get_agent_context` | character_id, chat_id | `AgentContext` | 读取 soul/memory/world |
| `set_agent_soul` | character_id, content | `()` | 写入 soul.md |
| `set_agent_world` | character_id, content | `()` | 写入 world.md |
| `test_api_connection` | endpoint, api_key | `bool` | 测试 API 连通性 |
| `list_api_models` | endpoint, api_key | `Vec<String>` | 获取模型列表 |
| `generate_chat_title` | user_message, assistant_reply, settings | `String` | 自动生成对话标题 |
| `save_user_info` | user_name, user_persona | `()` | 保存用户信息 |
| `stop_generation` | — | `bool` | 停止 LLM 生成 |
| `get_soul_content` | character_id | `String` | 读取 soul.md |
| `get_memory_content` | chat_id | `String` | 读取 memory.md |
| `get_banned_global_content` | — | `String` | 读取全局禁止词 |
| `update_banned_global` | content | `()` | 保存全局禁止词 |
| `get_banned_content` | character_id | `String` | 读取角色禁止词 |
| `update_banned_content` | character_id, content | `()` | 保存角色禁止词 |
| `update_soul_command` | character_id, content | `()` | 更新 soul（前端用） |
| `update_memory_command` | character_id, content | `()` | 更新 memory（前端用） |
| `append_memory_command` | chat_id, content | `()` | 追加记忆 |
| `continue_message` | character_id, chat_id, character, settings, history, stat_string | `AgentResponse` | 继续输出 |
| `get_prompt_order` | — | `PromptOrder` | 获取 prompt 模块排序 |
| `set_prompt_order` | order | `()` | 保存 prompt 模块排序 |
| `reset_prompt_order` | — | `PromptOrder` | 重置为默认排序 |

### 4.2 AgentResponse 结构

```rust
struct AgentResponse {
    reply: String,                       // AI 回复文本
    emotion: String,                     // 情绪状态（happy/sad/angry...）
    speech: String,                      // 旁白/动作
    action: String,                      // 动作描述
    actions: Vec<ToolAction>,            // JSON tools 调用列表（旧协议）
    reasoning_content: Option<String>,   // DeepSeek thinking 推理过程
    stat_deltas: HashMap<String, i32>,   // 属性值变化
    stat_values: HashMap<String, i32>,   // 当前属性值（LLM 直接指定）
}
```

### 4.3 核心数据流（process_message）

```
前端 invoke("send_message")
  → AgentCore::process_message()
    → 1. 从 DB 加载聊天历史
    → 2. 加载 soul/memory/world 文件
    → 3. 构建 system prompt（按 PromptOrder 排序的 9 个模块）
    → 4. 调用 LlmClient::chat_with_tools()（带 tools 参数）
    → 5. 解析回复 + tool_calls
       → 有 tool_calls → 执行工具 → 回送结果（最多 5 轮循环）
       → 无 tool_calls → 解析 emotion/stat_deltas → 返回
    → 6. 应用属性变化（applyEmotionDelta）
    → 7. 保存到 DB
    → 8. 异步生成对话标题
```

### 4.4 LLM Function Calling 协议

**定义的工具**（当前 1 个）：

```json
{
  "type": "function",
  "function": {
    "name": "write_memory",
    "description": "记录关于用户的重要信息，如喜好、经历、习惯等",
    "parameters": {
      "type": "object",
      "properties": {
        "content": { "type": "string", "description": "要记录的内容" }
      },
      "required": ["content"]
    }
  }
}
```

**执行流程：** 多轮循环，模型返回 tool_calls → 执行 → 结果回送 → 模型继续，最多 5 轮。后向兼容旧 JSON `actions` 数组格式。

---

## 五、前端架构

### 5.1 页面路由（App.tsx）

| 路由 | 页面 | 路径 | 页签 |
|------|------|------|------|
| chat | 聊天页 | `/chat` | 💬 聊天 |
| characters | 角色管理 | `/characters` | 👤 角色 |
| worlds | 世界观管理 | `/worlds` | 🌍 世界观 |
| user | 我的 | `/user` | 👤 我的 |
| history | 历史记录 | `/history` | 🕐 历史 |
| settings | 设置 | `/settings` | ⚙ 设置 |

### 5.2 状态管理

**settingsStore（Zustand）：**
- `theme`: 'light' | 'dark' | 'auto'
- `accentColor`: string
- `apiEndpoint` / `apiKey` / `model` — API 配置
- `setSettings(settings)` — 批量更新

**chatStore（Zustand）：**
- `currentChatId`: number | null
- `messages`: Message[]
- `isGenerating`: boolean
- `currentProfileId`: number | null
- `setMessages(messages)` / `addMessage(msg)` / `setCurrentChat(id)`

### 5.3 CSS 变量系统

全局样式定义在 `styles.css`，支持深色/浅色切换：

```css
:root {
  --luna-bg: #f0efe9;         /* 主背景 */
  --luna-bg-secondary: #f5f4f0; /* 卡片/次级背景 */
  --luna-bg-tertiary: #eeede8;  /* 气泡背景 */
  --luna-text: #2d2a24;        /* 主文字 */
  --luna-text-secondary: #78746a;
  --luna-text-tertiary: #a09e96;
  --luna-accent: #534ab7;      /* 紫色主题色 */
  --luna-border: #e2dfd9;
  --luna-red: #dc3545;
}

.dark {
  --luna-bg: #1c1c26;
  --luna-bg-secondary: #24242e;
  --luna-bg-tertiary: #2a2a34;
  --luna-text: #e8e6e0;
  --luna-text-secondary: #a09e96;
  --luna-accent: #7b70e0;
  --luna-border: #303040;
}
```

### 5.4 8 维属性系统（StatSystem）

**emotion → 属性映射表（EMOTION_DELTA）：**

| emotion | happy | discomfort | trust | energy | affection | curiosity | relax | depression |
|---------|-------|-----------|-------|--------|-----------|-----------|-------|-----------|
| happy | +10 | -5 | +5 | +5 | +5 | +3 | +5 | -3 |
| love | +15 | -5 | +10 | +5 | +12 | +5 | +8 | -8 |
| excited | +12 | -5 | +5 | +10 | +8 | +10 | -3 | -2 |
| sad | -15 | +10 | -20 | -10 | -5 | -8 | -8 | +12 |
| angry | -20 | +15 | -35 | +5 | -10 | +3 | -15 | +5 |
| scared | -15 | +15 | -15 | -15 | -8 | -5 | -12 | +10 |
| shy | +5 | +5 | +2 | -5 | +5 | -3 | -3 | +2 |
| confused | -5 | +5 | -8 | -5 | -3 | +5 | -8 | +5 |
| thinking | -5 | +2 | -3 | -5 | 0 | +8 | +2 | -3 |
| sleepy | -5 | 0 | 0 | -10 | -2 | -3 | +5 | +2 |
| tired | -5 | +3 | 0 | -8 | -3 | -5 | -3 | +8 |
| idle | 0 | 0 | 0 | -2 | 0 | -2 | +3 | 0 |

**数据流：**
1. AI 回复含 `emotion` 字段 → `EMOTION_DELTA` 查表 → 8 维增量
2. 或 LLM 直接输出 `stat_deltas`（JSON 格式）→ 直接覆盖
3. `applyEmotionDelta` 计算新值 → 更新 `chat_stats` + 写入 `stat_snapshots`
4. 前端 `StatsPanel` 读取 `loadStats()` → 渲染进度条 + 折线图

---

## 六、文件系统存储（Agent Context）

数据存储在 `~/Library/Application Support/com.luna.desktop/agent/`：

```
agent/
├── user_info.md                        # 用户全局信息
├── banned_global.md                    # 全局禁止词
├── char_1/
│   ├── soul.md                         # 角色灵魂定义
│   └── banned.md                       # 角色级禁止词
├── char_2/
│   ├── soul.md
│   └── banned.md
├── ...
└── chat_1/
    └── memory.md                       # 对话记忆
```

---

## 七、System Prompt 模块系统（PromptOrder）

9 个可排序/启用的模块：

| ID | 内容 | 说明 |
|----|------|------|
| `user_info` | 用户姓名 + 简介 | 对话级 |
| `global_system_prompt` | 全局系统提示词 | 设置页配置 |
| `character_identity` | 角色名 + 世界观 + 性格 | 核心角色注入 |
| `character_soul` | 灵魂文件内容 | 深度角色人格 |
| `memory` | 对话记忆 + 存入的内容 | 上下文持久化 |
| `banned_words` | 禁止词列表 | 内容过滤 |
| `tools` | 工具定义 + 调用说明 | Function calling |
| `behavior_rules` | 行为规则 | AGI 行为约束 |
| `world_info` | 世界观 + 环境设定 | 场景上下文 |

---

## 八、构建与部署

### 8.1 开发环境

```bash
cd /Users/jlc/Desktop/LunA/v1.1.0/luna-desktop
npm install
npx tauri dev          # 开发模式
npx vite build         # 仅前端构建
```

### 8.2 生产构建

```bash
npx tauri build        # macOS DMG 构建
# 输出位置：src-tauri/target/release/bundle/dmg/LunA_0.1.0_aarch64.dmg
```

### 8.3 Windows 交叉编译

```bash
# Tauri 支持 macOS→Windows 交叉编译（需安装 windows 工具链）
cargo tauri build --target x86_64-pc-windows-msvc
# NSIS 安装包输出：target/x86_64-pc-windows-msvc/release/bundle/nsis/
```

### 8.4 构建体积（预估）

| 平台 | 体积 | 格式 |
|------|------|------|
| macOS (ARM64) | ~8-15MB | DMG |
| Windows (x64) | ~5-10MB | NSIS 安装包 |
| Linux (x64) | ~5-8MB | AppImage/deb |

---

## 九、API 厂商预设

`src/constants/apiProviders.ts` 定义了 9 个预设厂商模板：

| ID | 厂商 | 类型 | Endpoint |
|----|------|------|----------|
| openai | OpenAI | cloud | `https://api.openai.com/v1` |
| deepseek | DeepSeek | cloud | `https://api.deepseek.com/v1` |
| anthropic | Anthropic | cloud | `https://api.anthropic.com/v1` |
| groq | Groq | cloud | `https://api.groq.com/openai/v1` |
| openrouter | OpenRouter | cloud | `https://openrouter.ai/api/v1` |
| lmstudio | LM Studio | local | `http://127.0.0.1:1234/v1` |
| ollama | Ollama | local | `http://127.0.0.1:11434/v1` |
| kobold | KoboldCPP | local | `http://127.0.0.1:5001/v1` |
| tabbyapi | TabbyAPI | local | `http://127.0.0.1:5000/v1` |

---

## 十、完整 UI 交互清单

见同级文件 `LunA_UI_Inventory.md`（10 大模块、所有按钮/输入/弹窗/状态）。

---

## 十一、待办（远期）

- **Windows 打包测试**（上线前做）
- **主动消息系统**：预存消息 + 定时触发 + 属性校验，增强沉浸感
- **Rust 后端抽成独立 HTTP 服务**：接微信/QQ adapter
- **Web 部署**：Axum/Actix HTTP 层，Vercel+Railway+VPS 方案
