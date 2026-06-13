use std::collections::HashMap;
use std::path::PathBuf;
use std::sync::Arc;
use tokio::sync::Mutex;
use tokio_util::sync::CancellationToken;

use super::context::ContextManager;
use super::llm::LlmClient;
use super::narration::NarrationManager;
use super::types::*;
use super::memory_db;

/// 加载当前角色的日记（最近 500 字），不跨角色
async fn load_diary_for_character(db_path: &std::path::Path, char_name: &str) -> Result<String, String> {
    let db_path = db_path.to_path_buf();
    let name = char_name.to_string();
    tokio::task::spawn_blocking(move || {
        use rusqlite::params;
        let conn = rusqlite::Connection::open(&db_path)
            .map_err(|e| format!("打开 DB 失败: {}", e))?;

        let mut stmt = conn
            .prepare(
                "SELECT manual_note FROM diary_entries WHERE title LIKE ?1 ORDER BY date DESC LIMIT 5",
            )
            .map_err(|e| format!("查询日记失败: {}", e))?;

        let rows = stmt
            .query_map(params![format!("{}%", name)], |row| -> Result<String, rusqlite::Error> {
                row.get(0)
            })
            .map_err(|e| format!("读取日记失败: {}", e))?;

        let mut parts = Vec::new();
        for row in rows {
            if let Ok(content) = row {
                let trimmed = content.trim().to_string();
                if !trimmed.is_empty() {
                    parts.push(trimmed);
                }
            }
        }

        if parts.is_empty() {
            Ok(String::new())
        } else {
            let text = parts.join("\n\n---\n\n");
            let text: String = if text.chars().count() > 500 {
                text.chars().take(500).collect()
            } else {
                text
            };
            Ok(text)
        }
    })
    .await
    .map_err(|e| format!("spawn_blocking 失败: {}", e))?
}

/// Agent 运行时核心
/// 编排整个对话循环：上下文组装 → LLM 调用 → 响应解析 → 动作执行
pub struct AgentCore {
    context: Arc<Mutex<ContextManager>>,
    llm: LlmClient,
    cancel_token: Mutex<Option<CancellationToken>>,
    db_path: PathBuf,
    pub narration: NarrationManager,
}

impl AgentCore {
    pub fn new(context_dir: PathBuf, db_path: PathBuf, narration_dir: PathBuf) -> Self {
        Self {
            context: Arc::new(Mutex::new(ContextManager::new(context_dir, db_path.clone()))),
            llm: LlmClient::new(),
            cancel_token: Mutex::new(None),
            db_path,
            narration: NarrationManager::new(narration_dir),
        }
    }

    /// 处理一条用户消息，返回 AI 回复 + 执行的动作
    /// character_id 和 chat_id 用于定位 soul/memory 文件
    pub async fn process_message(
        &self,
        user_message: &str,
        character_id: Option<u32>,
        chat_id: Option<u32>,
        character: Option<CharacterInfo>,
        settings: ApiSettings,
        history: Vec<ChatMessage>,
        stat_string: Option<String>,
    ) -> Result<AgentResponse, String> {
        // 兜底：无角色/无对话时用默认上下文
        let effective_char_id = character_id.unwrap_or(0);
        let effective_chat_id = chat_id.unwrap_or(0);

        // 1. 初始化角色上下文（首次使用该角色时）
        if let Some(ref c) = character {
            if character_id.is_some() {
                self.context
                    .lock()
                    .await
                    .init_character_context(effective_char_id, c)
                    .await?;
            }
        }

        // 2. 加载当前上下文
        let mut ctx = self
            .context
            .lock()
            .await
            .load(effective_char_id, effective_chat_id)
            .await?;

        // 2a. Active Memory：从 SQLite memories 表检索相关记忆，注入到 ctx.memory
        if effective_chat_id > 0 {
            let memories = self
                .context
                .lock()
                .await
                .load_active_memory(effective_chat_id)
                .await;
            if !memories.is_empty() {
                let formatted = memory_db::format_memories_for_prompt(&memories);
                if let Some(active_block) = formatted {
                    // 将 SQLite 记忆作为主记忆块，flat file 记忆作为补充
                    let flat_memory = ctx.memory.trim();
                    let combined = if !flat_memory.is_empty() {
                        format!("{}\n\n{}（以下是从对话历史中自动提取的额外记忆）\n{}",
                            flat_memory, String::new(), active_block)
                    } else {
                        active_block
                    };
                    ctx.memory = combined;
                }
            }
            eprintln!("[agent] active-memory: chat_id={}, loaded {} entries",
                effective_chat_id, memories.len());
        }

        // 3. 组装 system prompt（按用户配置的模块顺序动态组装）
        let order = self.context.lock().await.load_prompt_order().await;

        // 2b. 加载当前角色的日记（日记 = 压缩过的对话历史）
        let diary_context = if let Some(ref c) = character {
            load_diary_for_character(&self.db_path, c.name.as_str())
                .await
                .unwrap_or_default()
        } else {
            String::new()
        };

        let system_prompt = ContextManager::assemble_system_prompt_dynamic(
            &ctx,
            character.as_ref(),
            &settings.user_name,
            &settings.user_persona,
            &settings.system_prompt,
            &order,
            &diary_context,
        );

        // debug: 确认用户信息是否进入 prompt
        let has_user_info = !ctx.user_info.trim().is_empty()
            || !settings.user_name.is_empty()
            || !settings.user_persona.is_empty();

        // 注入当前属性值到 system prompt（让 LLM 有据可依地判断 stat 变化）
        let system_prompt = if let Some(ref s) = stat_string {
            if !s.trim().is_empty() {
                format!(
                    "{}\n\n## 当前角色属性值\n{}\n\n**stat_deltas 是必填字段**：阅读当前属性值，基于本轮对话内容判断属性值变化程度，在回复 JSON 的 stat_deltas 字段中输出。日常对话输出全 0，重大转折时在 -50 到 50 范围内填值。",
                    system_prompt, s
                )
            } else {
                system_prompt
            }
        } else {
            system_prompt
        };

        log::info!(
            "[process_message] has_user_info={}, user_name='{}', user_persona='{}', ctx_ui='{}'",
            has_user_info,
            settings.user_name,
            settings.user_persona,
            ctx.user_info.trim().lines().take(1).collect::<Vec<_>>().join("")
        );

        // 4. 构建消息列表
        let mut messages: Vec<serde_json::Value> = Vec::new();
        messages.push(serde_json::json!({
            "role": "system",
            "content": system_prompt,
        }));

        // 硬编码记忆/工具调用规则（不受前端 prompt 配置影响）
        messages.push(serde_json::json!({
            "role": "system",
            "content": "## 记忆与工具使用规则（必须遵守）\n当用户提到关于自己的信息（名字、喜好、厌恶、经历、习惯、计划、健康等），你必须调用 write_memory 函数记录。\n不要只在回复文本中说记住了——必须通过函数调用实际保存。"
        }));

        // 只保留最近 N 条历史消息，防止 context 过长导致模型注意力分散
        const MAX_HISTORY: usize = 80;
        let history_slice = if history.len() > MAX_HISTORY {
            &history[history.len() - MAX_HISTORY..]
        } else {
            &history[..]
        };

        for msg in history_slice {
            let mut m = serde_json::json!({
                "role": msg.role,
                "content": msg.content,
            });
            if let Some(ref rc) = msg.reasoning_content {
                if !rc.is_empty() {
                    m["reasoning_content"] = serde_json::Value::String(rc.clone());
                }
            }
            messages.push(m);
        }

        messages.push(serde_json::json!({
            "role": "user",
            "content": user_message,
        }));

        // [废弃] tool_calls 循环，保留代码供回溯参考
        if false {
        }

        // 5. (简化版) 单次 LLM 对话
        let cancel = CancellationToken::new();
        {
            let mut token = self.cancel_token.lock().await;
            *token = Some(cancel.clone());
        }

        eprintln!("[agent] call: model={} endpoint={} n_messages={}",
            settings.model, settings.endpoint, messages.len());

        let raw_response = match self.llm
            .chat(
                &settings.endpoint,
                &settings.api_key,
                &settings.model,
                settings.temperature,
                settings.max_tokens,
                messages,
                cancel.clone(),
            )
            .await
        {
            Ok(text) => text,
            Err(e) => {
                let mut token = self.cancel_token.lock().await;
                *token = None;
                return Err(e);
            }
        };

        {
            let mut token = self.cancel_token.lock().await;
            *token = None;
        }

        // 6. 解析响应
        let mut response = Self::parse_response(&raw_response)?;

        // 7. Quote Skill：自动检测回复是否引用了用户的历史消息
        if response.quote.is_none() {
            response.quote = Self::auto_detect_quote(&response.reply, &history, &user_message, &settings.user_name);
        }

        // 8. 后向兼容：如果 LLM 没用原生 tool_calls 但在 JSON 里写了 actions，也执行
        if !response.actions.is_empty() {
            if let Err(e) = self
                .context
                .lock()
                .await
                .execute_actions(effective_char_id, effective_chat_id, &response.actions)
                .await
            {
                log::warn!("Agent action execution failed: {}", e);
            }
        }

        // 9. 画像提取：对话后异步调 API 提取用户画像
        // 只传本轮对话（最后一段交换），不传全量历史，省 token 防重复
        {
            let char_name = character.as_ref().map(|c| c.name.as_str()).unwrap_or("AI").to_string();
            let user_call = if settings.user_name.is_empty() { "对方".to_string() } else { settings.user_name.clone() };

            // 取已有记忆做参考，避免重复
            let existing_block: String = {
                let mgr = self.context.lock().await;
                let rows = mgr.load_active_memory(effective_chat_id).await;
                if rows.is_empty() {
                    "暂无".to_string()
                } else {
                    rows.iter().map(|r| r.content.as_str()).collect::<Vec<_>>().join("\n")
                }
            };

            let exchange = format!(
                "{}: {}\n\n{}: {}",
                user_call, user_message, char_name, response.reply
            );

            let ecid = effective_chat_id;
            let llm = self.llm.clone();
            let ctx = self.context.clone();
            let ep = settings.endpoint.clone();
            let ek = settings.api_key.clone();
            let em = settings.model.clone();
            tokio::spawn(async move {
                let cancel = tokio_util::sync::CancellationToken::new();
                let extract_prompt = vec![
                    serde_json::json!({
                        "role": "system",
                        "content": format!(
                            "从最新一轮对话中提取关于「{}」的**新画像信息**。\n\n✅ 必须提取：\n- 喜好/偏爱（固定偏好，不是随口一问）\n- 习惯/日常（规律行为）\n- 厌恶/忌讳\n- 经历/背景\n- 性格/特质\n- 重要个人信息\n\n❌ 不提取：\n- 情绪状态、临时话题、角色自己的话\n- 已在「已记录画像」中存在的任何内容\n\n⚠️ 用户明确说的喜好（如“我喜欢吃西瓜”）属于画像信息。\n\n已记录画像（不要重复提取这些）：\n{}\n\n格式：每条一行，用「{}」称呼对方。没有新信息只回复“无”。",
                            user_call, existing_block, user_call,
                        ),
                    }),
                    serde_json::json!({"role": "user", "content": &exchange}),
                ];
                eprintln!("[agent] portrait-extract: checking latest exchange...");
                match llm.chat(&ep, &ek, &em, 0.0, 512, extract_prompt, cancel).await {
                    Ok(t) => {
                        let trimmed = t.trim().to_string();
                        if !is_nothing_response(&trimmed) {
                            let preview: String = trimmed.chars().take(200).collect();
                            eprintln!("[agent] portrait-extract new: {}", preview);
                            ctx.lock().await.write_memory(ecid, &trimmed, "auto").await;
                        } else {
                            eprintln!("[agent] portrait-extract: no new info");
                        }
                    }
                    Err(e) => eprintln!("[agent] portrait-extract failed: {}", e),
                }
            });
        }

        Ok(response)
    }

    /// 生成旁白+主动消息队列（一次 API 调用）
    pub async fn generate_narration_queue(
        &self,
        chat_id: u32,
        idle_minutes: u32,
    ) -> Result<Vec<NarrationItem>, String> {
        eprintln!("[narration] generate_narration_queue: chat={}, idle={}min START", chat_id, idle_minutes);
        let db_path = self.db_path.clone();

        let (character, settings, user_name, history) = tokio::task::spawn_blocking(move || {
            let conn = rusqlite::Connection::open(&db_path).map_err(|e| e.to_string())?;

            let (cid, _ctitle): (Option<i64>, String) = conn.query_row(
                "SELECT character_id, title FROM chats WHERE id = ?1",
                rusqlite::params![chat_id],
                |row| Ok((row.get(0)?, row.get(1)?)),
            ).map_err(|e| format!("对话不存在: {}", e))?;

            let mut stmt = conn.prepare(
                "SELECT role, content FROM messages WHERE chat_id = ?1 AND deleted_at IS NULL AND role != 'system' ORDER BY timestamp ASC"
            ).map_err(|e| e.to_string())?;
            let hist: Vec<ChatMessage> = stmt.query_map(rusqlite::params![chat_id], |row| {
                Ok(ChatMessage {
                    role: row.get(0)?,
                    content: row.get(1)?,
                    reasoning_content: None,
                })
            }).map_err(|e| e.to_string())?
            .filter_map(|r| r.ok())
            .collect();
            drop(stmt);

            // 加载用户名称
            let user_name: String = conn
                .query_row(
                    "SELECT value FROM settings WHERE key = 'user_name'",
                    [],
                    |row| row.get(0),
                )
                .unwrap_or_default();

            let char_info: Option<CharacterInfo> = if let Some(cid2) = cid {
                conn.query_row(
                    "SELECT c.name, c.description, c.personality, w.name, w.description
                     FROM characters c LEFT JOIN worlds w ON c.world_id = w.id WHERE c.id = ?1",
                    rusqlite::params![cid2],
                    |row| {
                        Ok(Some(CharacterInfo {
                            name: row.get(0)?,
                            description: row.get(1)?,
                            personality: row.get(2)?,
                            world_name: row.get::<_, Option<String>>(3)?.unwrap_or_default(),
                            world_description: row.get::<_, Option<String>>(4)?.unwrap_or_default(),
                            personality_state_text: String::new(),
                            stat_values_json: String::new(),
                        }))
                    }
                ).ok().flatten()
            } else { None };

            let api_settings: ApiSettings = conn.query_row(
                "SELECT endpoint, api_key, model, temperature, max_tokens, system_prompt
                 FROM api_profiles WHERE is_default = 1",
                [],
                |row| {
                    Ok(ApiSettings {
                        endpoint: row.get(0)?,
                        api_key: row.get(1)?,
                        model: row.get(2)?,
                        temperature: row.get::<_, f64>(3)?,
                        max_tokens: row.get::<_, u32>(4)?,
                        system_prompt: row.get::<_, String>(5).unwrap_or_default(),
                        user_name: String::new(),
                        user_persona: String::new(),
                    })
                }
            ).map_err(|e| format!("获取API配置失败: {}", e))?;

            Ok::<_, String>((char_info, api_settings, user_name, hist))
        }).await.map_err(|e| format!("spawn_blocking 失败: {}", e))??;

        let char = character.as_ref().ok_or("该对话没有关联角色")?;
        let user_name = if user_name.is_empty() { "对方".to_string() } else { user_name };
        let idle_str = if idle_minutes < 60 {
            format!("{}分钟", idle_minutes)
        } else {
            format!("{}小时{}分钟", idle_minutes / 60, idle_minutes % 60)
        };

        let recent: String = history.iter().rev().take(20).rev()
            .map(|m| format!("{}: {}", m.role, m.content))
            .collect::<Vec<_>>()
            .join("\n");
        let recent = if recent.chars().count() > 1200 { recent.chars().take(1200).collect() } else { recent };

        // 离线时长 → 生成条数 + 时间跨度梯度控制
        // 短离线(≤10min)：8条/40min → ~12条/h，短时小爆发
        // 中离线(≤30min)：10条/90min → ~6.7条/h
        // 长离线(>30min)：12条/120min → 6条/h，不低于5条/h底线
        let (num_items, max_delay) = if idle_minutes <= 10 {
            (8, 2400u32)       // 40 min
        } else if idle_minutes <= 30 {
            (10, 5400u32)      // 90 min
        } else {
            (12, 7200u32)      // 120 min
        };
        let max_delay_min = max_delay / 60;

        let sys_prompt = format!(
            "你是{name}，{user_name}已经{idle}没来找你了。\
             \n请通读下面的角色信息、世界观和最近的对话，理解你是什么样的人、处于什么环境，\
             \n然后生成 {num_items} 条你在等待期间的**自然状态变化**——\
             \n这些变化必须完全符合你的性格、身份和所处的世界，不要套用日常模板。\
             \n\n要求：\
             \n- **动作**（type: action）：你在做什么，用第三方视角描述，不要用「我」\
             \n  例（仅供参考，请按角色设定替换）：来回踱步 / 擦拭刀刃 / 盯着天花板 / 翻看旧照片 \
             \n- **对话**（type: dialogue）：你自言自语或想对{user_name}说的话，自然的口语 \
             \n  例（仅供参考）：\"还没来啊……\" / \"呵，有意思\" / \"你最好快点\"\
             \n- 动作和对话交替出现，像真实的时间流逝\
             \n- 总时间跨度约 {max_delay_min} 分钟，从最早到最晚均匀分布\
             \n- 每条之间至少隔 1 分钟，不扎堆\
             \n- delay_seconds 范围：30 ~ {max_delay}\
             \n- 动作不超过 15 字，对话不超过 25 字\
             \n- **最重要：基于下面的角色信息和你所处的世界，决定你该做什么动作、说什么话**\
             \n- 语气完全遵循角色性格设定\
             \n\n## 角色信息\
             \n名字: {name}\
             \n简介: {desc}\
             \n性格: {personality}\
             \n世界观: {world} - {world_desc}\
             \n\n## 最近的对话\
             \n{recent}\
             \n\n输出格式（纯JSON，不要markdown包裹，不要其他文字——以下只是格式示例，内容已过时，务必按角色设定重新生成）：\
             \n{{\"items\": [\
             \n  {{\"type\": \"action\", \"delay_seconds\": 30, \"text\": \"靠在墙边闭着眼\"}},\
             \n  {{\"type\": \"dialogue\", \"delay_seconds\": 120, \"text\": \"还没回来啊……\"}},\
             \n  {{\"type\": \"action\", \"delay_seconds\": 300, \"text\": \"慢慢睁开眼看向门口\"}},\
             \n  {{\"type\": \"dialogue\", \"delay_seconds\": 600, \"text\": \"你最好快点，我等得不耐烦了\"}}\
             \n]}}",
            name = char.name, idle = idle_str, num_items = num_items,
            max_delay_min = max_delay_min, max_delay = max_delay,
            user_name = user_name,
            desc = char.description, personality = char.personality,
            world = char.world_name, world_desc = char.world_description,
        );

        let messages = vec![
            serde_json::json!({"role": "system", "content": sys_prompt}),
        ];

        eprintln!("[narration] generating for chat={}, char={}, idle={}", chat_id, char.name, idle_str);

        let raw = self.llm.chat(
            &settings.endpoint, &settings.api_key, &settings.model,
            0.6, 2048, messages, CancellationToken::new(),
        ).await?;

        eprintln!("[narration] raw: {}", &raw.chars().take(200).collect::<String>());

        let body = extract_narration_json(&raw);
        let parsed: serde_json::Value = serde_json::from_str(body.as_str())
            .map_err(|e| format!("解析旁白响应失败: {} (raw: {})", e, raw.chars().take(100).collect::<String>()))?;

        let items = parsed["items"].as_array()
            .ok_or("响应缺少 items 数组")?
            .iter()
            .enumerate()
            .filter_map(|(i, m)| {
                let typ = m["type"].as_str()?;
                if typ != "action" && typ != "dialogue" { return None; }
                let delay = m["delay_seconds"].as_u64().unwrap_or(30) as u32;
                let text = m["text"].as_str()?.to_string();
                if text.is_empty() { return None; }
                Some(NarrationItem {
                    id: i as u32,
                    delay_seconds: delay,
                    scheduled_at: String::new(),
                    narration_type: typ.to_string(),
                    text,
                    delivered: false,
                })
            })
            .collect::<Vec<_>>();

        if items.is_empty() {
            return Err("旁白生成为空，稍后重试".to_string());
        }

        let now = chrono::Utc::now().to_rfc3339();
        let queue = NarrationQueue { chat_id, created_at: now, items: items.clone() };
        self.narration.save_queue(&queue)?;

        Ok(items)
    }

    /// 停止当前正在进行的 LLM 生成
    /// 返回 true 表示有正在运行的生成被取消
    pub async fn stop_generation(&self) -> bool {
        let token = self.cancel_token.lock().await;
        if let Some(ref ct) = *token {
            ct.cancel();
            true
        } else {
            false
        }
    }

    /// 获取当前上下文
    pub async fn get_context(
        &self,
        character_id: u32,
        chat_id: u32,
    ) -> Result<AgentContext, String> {
        self.context.lock().await.load(character_id, chat_id).await
    }

    /// 直接更新 soul
    pub async fn set_soul(&self, character_id: u32, content: &str) -> Result<(), String> {
        self.context.lock().await.update_soul(character_id, content).await
    }

    /// 追加内容到角色 soul
    pub async fn append_soul(&self, character_id: u32, content: &str) -> Result<(), String> {
        self.context.lock().await.append_soul(character_id, content).await
    }

    /// 直接更新 world
    pub async fn set_world(&self, character_id: u32, content: &str) -> Result<(), String> {
        self.context.lock().await.update_world(character_id, content).await
    }

    /// 直接替换对话 memory
    pub async fn set_memory(&self, chat_id: u32, content: &str) -> Result<(), String> {
        self.context.lock().await.update_memory(chat_id, content).await
    }

    /// 追加内容到对话 memory
    pub async fn append_memory(&self, chat_id: u32, content: &str) -> Result<(), String> {
        self.context.lock().await.append_memory(chat_id, content).await
    }

    /// 保存用户信息到全局 user_info.md
    pub async fn save_user_info(&self, user_name: &str, user_persona: &str) -> Result<(), String> {
        self.context.lock().await.save_user_info(user_name, user_persona).await
    }

    /// 获取数据库路径（供外部命令直接操作 SQLite）
    pub fn db_path(&self) -> &PathBuf {
        &self.db_path
    }

    /// 获取 prompt 模块排序配置
    pub async fn get_prompt_order(&self) -> Result<PromptOrder, String> {
        Ok(self.context.lock().await.load_prompt_order().await)
    }

    /// 保存 prompt 模块排序配置
    pub async fn set_prompt_order(&self, order: PromptOrder) -> Result<(), String> {
        self.context.lock().await.save_prompt_order(&order).await
    }

    /// 重置 prompt 模块排序为默认值
    pub async fn reset_prompt_order(&self) -> Result<PromptOrder, String> {
        let ctx = self.context.lock().await;
        let default_order = PromptOrder::default();
        ctx.save_prompt_order(&default_order).await?;
        Ok(default_order)
    }

    /// 读取角色 soul.md 内容
    pub async fn get_soul_content(&self, character_id: u32) -> Result<String, String> {
        self.context.lock().await.get_soul_content(character_id).await
    }

    /// 读取对话 memory.md 内容
    pub async fn get_memory_content(&self, chat_id: u32) -> Result<String, String> {
        self.context.lock().await.get_memory_content(chat_id).await
    }

    /// 读取全局禁止词
    pub async fn get_banned_global_content(&self) -> Result<String, String> {
        self.context.lock().await.get_banned_global_content().await
    }

    /// 保存全局禁止词
    pub async fn update_banned_global(&self, content: &str) -> Result<(), String> {
        self.context.lock().await.update_banned_global(content).await
    }

    /// 读取角色禁止词
    pub async fn get_banned_content(&self, character_id: u32) -> Result<String, String> {
        self.context.lock().await.get_banned_content(character_id).await
    }

    /// 保存角色禁止词
    pub async fn update_banned_content(&self, character_id: u32, content: &str) -> Result<(), String> {
        self.context.lock().await.update_banned_content(character_id, content).await
    }

    /// 测试 API 连接
    pub async fn test_connection(
        &self,
        endpoint: &str,
        api_key: &str,
    ) -> Result<bool, String> {
        self.llm.test_connection(endpoint, api_key).await
    }

    /// 获取可用模型列表
    pub async fn list_models(
        &self,
        endpoint: &str,
        api_key: &str,
    ) -> Result<Vec<String>, String> {
        self.llm.list_models(endpoint, api_key).await
    }

    /// 根据首轮对话生成标题（5-10字中文）
    pub async fn generate_title(
        &self,
        user_message: &str,
        assistant_reply: &str,
        settings: &ApiSettings,
    ) -> Result<String, String> {
        let messages = vec![
            serde_json::json!({
                "role": "system",
                "content": "你是一个对话标题生成器。根据用户和AI的对话内容，生成一个简洁的中文标题（5-10字）。只输出标题本身，不要引号、符号、解释。"
            }),
            serde_json::json!({
                "role": "user",
                "content": format!("用户: {}\nAI: {}", user_message, assistant_reply)
            }),
        ];

        let raw = self
            .llm
            .chat(
                &settings.endpoint,
                &settings.api_key,
                &settings.model,
                0.3,
                50,
                messages,
                CancellationToken::new(),
            )
            .await?;

        // 清理：去引号、去首尾空白、截断过长
        let title = raw.trim().trim_matches('"').trim_matches('「').trim_matches('」');
        let title: String = title.chars().take(20).collect();
        Ok(title.to_string())
    }

    // ─── 内部方法 ───

    /// Quote Skill：自动检测回复是否引用了用户的历史消息
    ///
    /// 当 LLM 的回复中出现回应性关键词（如「你说过」「刚才说」等），
    /// 自动从历史中提取被引用的消息，创建引用条。
    /// 不需要 LLM 输出任何特殊格式 —— 纯后端判断。
    fn auto_detect_quote(
        reply: &str,
        history: &[ChatMessage],
        current_user_msg: &str,
        user_name: &str,
    ) -> Option<QuoteInfo> {
        // ─── 触发词：只保留明确复数词的引用短语，单字/泛词全部移除 ───
        // 这些词编译在 Rust 二进制中，不占用 LLM 上下文
        let trigger_phrases = [
            // ── 第二人称 + 说/讲/提/问/写/发 ──
            "你说过", "你讲过", "你提过", "你问过",
            "你写过", "你发过", "你说起过",
            "你刚才说", "你刚刚说",
            "你之前说", "你上次说", "你上回说",
            "你以前说", "你之前提过", "你上次提过",
            "你是说", "你是想说",
            // ── 时间 + 引用 ──
            "刚才说", "刚刚说",
            "之前说", "上次说", "上回说", "以前说",
            "刚才才说", "前边说", "前面说",
            "刚才不是说了",
            // ── 被动/被引 ──
            "被你说过", "被你提起过",
            "被你提到的", "被你问过的",
            // ── 转述/他称 ──
            "V说", "V说过", "V刚才说", "V之前说",
            "V上次说", "V刚刚说",
            // ── 引用性判断 ──
            "这话是你说的", "这句话你",
            "这句话是你说", "是你自己说的",
            "是你说的", "是你说过",
            "不就是你说的", "不就是你",
            "就是你刚才说的", "就是你之前说的",
            "你说的没错", "你说得对", "你说的是",
            "跟你说的", "跟你之前说的",
            "跟你说的那样", "跟你上次说",
            // ── 质疑/确认 (指向过去的话) ──
            "有说过", "没说过", "说过吗", "说过没",
            "确实说过", "确实没说过",
            "明明说过", "明明说", "明明讲了",
            "不是说过", "自己说过", "亲口说过",
            "之前说过", "上次说过", "刚刚才说过",
            "你自己说的", "你自己讲的",
            "不是你刚才说", "你没说过",
            "你刚才不是", "你之前不是",
            "你刚才还说", "你刚才明明",
            // ── 记得/记忆 ──
            "我记得你说", "我记着你说",
            "我记得你", "我记着你",
            "我记得你刚才", "我记得你之前",
            "我记得", "我清楚地记得",
            "我还记得你", "我记得你之前说",
            // ── 明确的消息引用 ──
            "那句话", "你那句话",
            "你这句话", "你之前那句话",
            "你刚才那句话", "你上次那句话",
            "这条消息", "这条信息",
            "你的原话", "你原话",
            // ── 复述/重复 ──
            "你刚才", "你刚刚",
            "你之前那", "你上次那",
            "你刚才那句", "你上次那句",
            "你刚刚那句",
            // ── 引用性介词 ──
            "正如你所说", "正如你说的",
            "就像你说的", "就跟你说的",
            "按你说的", "按你刚才说的",
            "照你说的", "照你刚才说的",
            "如你所说", "如你说的",
            // ── 倒装 ──
            "说过的话", "讲过的话",
            "聊过", "提到过", "谈到过",
            // ── 概括/总结别人的话 ──
            "你的意思", "你的意思是",
            "你说的意思", "你想说的是",
            "是不是说", "是不是想说",
        ];

        // 只检查回复前 500 字符
        let head: String = reply.chars().take(500).collect();
        let matched_trigger = trigger_phrases.iter().find(|w| head.contains(*w));
        let trigger_word = matched_trigger?;

        // ─── 从历史中找被引用的消息 ───
        // 取最近 8 条用户消息，包含当前消息
        let user_msgs: Vec<&ChatMessage> = history
            .iter()
            .rev()
            .filter(|m| m.role == "user")
            .take(8)
            .collect();

        if user_msgs.is_empty() {
            return None;
        }

        // 用整条回复做 bigram 匹配（比只查 trigger 附近更准）
        // 如果 LLM 在回复中提及了消息原文（即使是间接引用），必然有 bigram 重叠
        let full_reply = reply;
        let best_msg = user_msgs
            .iter()
            .filter_map(|msg| {
                let body = if msg.content.starts_with('[') {
                    msg.content.find("] ").map(|i| &msg.content[i+2..]).unwrap_or(&msg.content)
                } else {
                    &msg.content
                };
                let body_chars: Vec<char> = body.chars().collect();
                if body_chars.len() < 2 { return None; }
                let mut score = 0i32;
                for i in 0..body_chars.len().saturating_sub(1) {
                    let bigram: String = body_chars[i..i+2].iter().collect();
                    if bigram.chars().all(|c| !c.is_whitespace()) && full_reply.contains(&bigram) {
                        score += 1;
                    }
                }
                if score < 2 { return None; }
                Some((*msg, score))
            })
            .max_by_key(|(_, score)| *score)
            .map(|(msg, _)| msg);

        // 没有命中的话，放弃引用（避免引错）
        let best_msg = best_msg?;

        // 提取时间
        let (time, content) = if best_msg.content.starts_with('[') {
            if let Some(bracket_end) = best_msg.content.find("] ") {
                let time_str = &best_msg.content[1..bracket_end];
                let body = &best_msg.content[bracket_end + 2..];
                (Some(time_str.to_string()), body.to_string())
            } else {
                (None, best_msg.content.clone())
            }
        } else {
            (None, best_msg.content.clone())
        };

        // 截断过长内容
        let content = if content.chars().count() > 200 {
            content.chars().take(200).collect::<String>() + "…"
        } else {
            content
        };

        Some(QuoteInfo {
            content,
            speaker: user_name.to_string(),
            time,
        })
    }

    fn parse_response(raw: &str) -> Result<AgentResponse, String> {
        let json_str = extract_json(raw);

        // 尝试解析，失败则清理尾部逗号后重试
        let v = match serde_json::from_str::<serde_json::Value>(json_str)
            .or_else(|_| {
                let cleaned = clean_json(json_str);
                serde_json::from_str::<serde_json::Value>(&cleaned)
            }) {
            Ok(v) => v,
            Err(_) => {
                // JSON 解析失败，把 raw 当作纯文本回复，但需要清洗掉工具调用残留
                let cleaned = clean_reply(raw);
                let emotion = extract_emotion_from_reply(&cleaned);
                return Ok(AgentResponse {
                    reply: cleaned,
                    emotion,
                    speech: String::new(),
                    action: String::new(),
                    actions: Vec::new(),
                    reasoning_content: None,
                    stat_deltas: HashMap::new(),
                    stat_values: HashMap::new(),
                    quote: None, // quote 由 process_message 中的 auto_detect_quote 补充
                });
            }
        };

        let reply = v["reply"].as_str().unwrap_or(raw).to_string();
        let reply = clean_reply(&reply);
        let emotion = v["emotion"].as_str().unwrap_or("").to_string();
        // 如果 JSON 缺 emotion，从回复文本推断
        let emotion = if emotion.is_empty() {
            extract_emotion_from_reply(&reply)
        } else {
            emotion
        };
        let speech = v["speech"].as_str().unwrap_or("").trim_matches('"').trim_matches('\'').trim_matches('「').trim_matches('」').trim_matches('“').trim_matches('”').trim_matches('‘').trim_matches('’').to_string();
        let action = v["action"].as_str().unwrap_or("").trim_matches('"').trim_matches('\'').trim_matches('「').trim_matches('」').trim_matches('“').trim_matches('”').trim_matches('‘').trim_matches('’').to_string();
        let actions = parse_actions(&v);

        // stat_deltas: LLM 指定的直接属性变化
        let stat_deltas = v.get("stat_deltas")
            .and_then(|d| d.as_object())
            .map(|obj| {
                obj.iter().filter_map(|(k, v)| {
                    v.as_i64().map(|n| (k.clone(), n as i32))
                }).collect::<HashMap<String, i32>>()
            })
            .unwrap_or_default();

        // stat_values: LLM 指定的新绝对值（优先级高于 stat_deltas）
        let stat_values = v.get("stat_values")
            .and_then(|d| d.as_object())
            .map(|obj| {
                obj.iter().filter_map(|(k, v)| {
                    v.as_i64().map(|n| (k.clone(), n as i32))
                }).collect::<HashMap<String, i32>>()
            })
            .unwrap_or_default();

        // quote: 从 JSON 提取（如有），否则由 process_message 中的 auto_detect_quote 补充
        let quote = v.get("quote").and_then(|q| {
            if q.is_null() { return None; }
            serde_json::from_value::<QuoteInfo>(q.clone()).ok()
        });

        Ok(AgentResponse { reply, emotion, speech, action, actions, reasoning_content: None, stat_deltas, stat_values, quote })
    }
}

fn extract_json(raw: &str) -> &str {
    // 1. 去 ```json ... ``` 包裹
    if let Some(inner) = raw
        .strip_prefix("```json")
        .and_then(|s| s.strip_suffix("```"))
    {
        return inner.trim();
    }
    // 2. 去 ``` ... ``` 包裹，再在里面找 JSON
    if let Some(inner) = raw.strip_prefix("```").and_then(|s| s.strip_suffix("```")) {
        let trimmed = inner.trim();
        if let Some(json) = find_json_block(trimmed) {
            return json;
        }
        return trimmed;
    }
    // 3. 在整段文本里找第一个 { 到最后一个 } 的 JSON 块
    if let Some(json) = find_json_block(raw.trim()) {
        return json;
    }
    raw.trim()
}

/// 清理 LLM 返回 JSON 中的常见错误：尾部逗号（, 后紧跟 ] 或 }）
fn clean_json(s: &str) -> String {
    let chars: Vec<char> = s.chars().collect();
    let len = chars.len();
    let mut result = String::new();
    let mut i = 0;
    while i < len {
        if chars[i] == ',' && i + 1 < len {
            let mut j = i + 1;
            while j < len && chars[j].is_whitespace() {
                j += 1;
            }
            if j < len && (chars[j] == ']' || chars[j] == '}') {
                i = j;
                continue;
            }
        }
        result.push(chars[i]);
        i += 1;
    }
    result
}

/// 去掉 LLM 学舌输出的时间戳前缀 [MM-DD HH:MM] 或 [HH:MM]
fn strip_timestamp_prefix(s: &str) -> &str {
    let s = s.trim();
    if s.starts_with('[') {
        if let Some(bracket_end) = s.find("] ") {
            let inner = &s[1..bracket_end];
            // 匹配 MM-DD HH:MM 或 HH:MM
            let is_timestamp = inner.chars().all(|c| c.is_ascii_digit() || c == '-' || c == ':' || c == ' ');
            if is_timestamp {
                return s[bracket_end + 2..].trim();
            }
        }
    }
    s
}

/// 清洗 reply 文本中的常见 LLM 残留
fn clean_reply(s: &str) -> String {
    let s = s.trim();
    // 去掉 LLM 学舌的时间戳前缀 [MM-DD HH:MM] 或 [HH:MM]
    let s = strip_timestamp_prefix(s);
    // 去掉末尾多余的 "emotion: xxx" 残留
    let s = if let Some(pos) = s.rfind("\nemotion:") {
        s[..pos].trim()
    } else {
        s
    };
    // 去掉末尾 "---" 分隔符及之后的 🔧 工具调用行
    let s = if let Some(pos) = s.rfind("\n---") {
        s[..pos].trim()
    } else {
        s
    };
    // 去掉孤立的 🔧 行（出现在末尾或其他位置）
    let lines: Vec<&str> = s.lines()
        .filter(|line| !line.trim().starts_with("🔧"))
        .collect();
    lines.join("\n").trim().to_string()
}

/// 从回复文本中推断情绪（当 JSON 缺 emotion 字段时的备选方案）
fn extract_emotion_from_reply(reply: &str) -> String {
    // 情绪关键词映射：越靠前的匹配优先级越高
    let patterns: Vec<(&str, Vec<&str>)> = vec![
        ("angry", vec!["火", "吼", "怒", "瞪", "骂", "咬牙切齿", "气的", "愤怒", "😡", "🤬", "妈的", "操"]),
        ("excited", vec!["兴奋", "惊喜", "眼前一亮", "跳起来", "哇", "🎉", "🤩"]),
        ("love", vec!["温柔", "含情", "宠溺", "亲", "爱", "🥰", "😘", "💕"]),
        ("sad", vec!["叹气", "叹", "伤", "哭", "泪", "悲", "哀", "难过", "😢", "😭"]),
        ("scared", vec!["吓", "怕", "慌", "恐惧", "颤抖", "😨", "😰", "😱"]),
        ("shy", vec!["羞", "脸红", "不好意思", "挠头", "😳", "🥺"]),
        ("confused", vec!["疑惑", "不解", "茫然", "😕", "😶", "懵"]),
        ("thinking", vec!["沉思", "琢磨", "思索", "🤔"]),
        ("sleepy", vec!["困", "打哈欠", "哈欠", "😴"]),
        ("tired", vec!["累", "疲惫", "乏力", "倦", "😩"]),
        ("happy", vec!["笑", "乐", "喜", "开心", "高兴", "愉快", "😊", "😄", "🤗", "咧嘴", "哈哈", "呵呵"]),
    ];

    for (emotion, keywords) in &patterns {
        for kw in keywords {
            if reply.contains(kw) {
                return emotion.to_string();
            }
        }
    }

    String::new()
}

/// 在文本中找到第一个 { 到最后一个 } 组成的 JSON 对象
fn find_json_block(s: &str) -> Option<&str> {
    let start = s.find('{')?;
    let end = s.rfind('}')?;
    if end > start {
        Some(&s[start..=end])
    } else {
        None
    }
}

/// 从 LLM 回复中提取旁白/主动消息 JSON
fn extract_narration_json(raw: &str) -> String {
    let raw = raw.trim();
    if let Some(inner) = raw.strip_prefix("```json") {
        if let Some(end) = inner.rfind("```") {
            return inner[..end].trim().to_string();
        }
        return inner.trim().to_string();
    }
    if let Some(stripped) = raw.strip_prefix("```") {
        let trimmed = if let Some(end) = stripped.rfind("```") {
            &stripped[..end]
        } else {
            stripped
        };
        if let Some(json) = find_json_block(trimmed) {
            return json.to_string();
        }
        return trimmed.trim().to_string();
    }
    if let Some(json) = find_json_block(raw) {
        return json.to_string();
    }
    raw.to_string()
}

fn parse_actions(v: &serde_json::Value) -> Vec<ToolAction> {
    match v["actions"].as_array() {
        Some(arr) => arr
            .iter()
            .filter_map(|a| {
                let tool = a["tool"].as_str()?.to_string();
                let content = a["content"].as_str()?.to_string();
                if tool.is_empty() || content.is_empty() {
                    None
                } else {
                    Some(ToolAction { tool, content })
                }
            })
            .collect(),
        None => Vec::new(),
    }
}

/// 判断 LLM 记忆/灵魂提取结果是否为「没有新信息」
fn is_nothing_response(s: &str) -> bool {
    let s = s.trim();
    if s.is_empty() { return true; }
    // 常见「没有新信息」变体
    let nothing_keywords = [
        "无", "无。", "无.", "无．", "没有", "没有。", "没有.",
        "没有新", "没有新的", "没有新的信息", "没有新信息",
        "暂无", "暂无。", "没有提取", "没有提取到",
        "无新", "无新内容", "无新信息",
        "none", "nothing", "no new", "no information",
    ];
    let lower = s.to_lowercase();
    if nothing_keywords.iter().any(|k| lower == *k) { return true; }
    // 以否定关键词开头也视为无
    if lower.starts_with("没有") || lower.starts_with("无") || lower.starts_with("暂无")
        || lower.starts_with("none") || lower.starts_with("no new") || lower.starts_with("nothing")
    {
        return true;
    }
    false
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_parse_plain_text() {
        let resp = AgentCore::parse_response("你好呀~").unwrap();
        assert_eq!(resp.reply, "你好呀~");
        assert_eq!(resp.emotion, "");
        assert!(resp.actions.is_empty());
    }

    #[test]
    fn test_parse_json_response() {
        let json = r#"{"reply": "好的", "emotion": "happy"}"#;
        let resp = AgentCore::parse_response(json).unwrap();
        assert_eq!(resp.reply, "好的");
        assert_eq!(resp.emotion, "happy");
    }

    #[test]
    fn test_parse_with_actions() {
        let json = r#"{"reply": "记住了", "emotion": "idle", "actions": [{"tool": "write_memory", "content": "用户喜欢芒果"}]}"#;
        let resp = AgentCore::parse_response(json).unwrap();
        assert_eq!(resp.actions.len(), 1);
        assert_eq!(resp.actions[0].tool, "write_memory");
    }

    #[test]
    fn test_parse_text_with_json_trailing() {
        // LLM 偶尔会在 JSON 前面说一句
        let raw = "夜之城可是个充满神秘色彩的地方呢！\n{\"reply\": \"你好呀\", \"emotion\": \"happy\"}";
        let resp = AgentCore::parse_response(raw).unwrap();
        assert_eq!(resp.reply, "你好呀");
        assert_eq!(resp.emotion, "happy");
    }

    #[test]
    fn test_parse_trailing_comma() {
        // LLM 偶尔会在 JSON 最后一个字段后加逗号
        let raw = "{\"reply\": \"你是谁\", \"emotion\": \"happy\",}";
        let resp = AgentCore::parse_response(raw).unwrap();
        assert_eq!(resp.reply, "你是谁");
        assert_eq!(resp.emotion, "happy");
    }

    #[test]
    fn test_clean_reply_strips_tool_calls() {
        let s = "汪！\n\n---\n🔧 write_memory: V V 喜欢吃芒果";
        assert_eq!(clean_reply(s), "汪！");
    }

    #[test]
    fn test_clean_reply_strips_emotion() {
        let s = "好的\nemotion: happy";
        assert_eq!(clean_reply(s), "好的");
    }

    #[test]
    fn test_clean_reply_preserves_clean() {
        let s = "你好呀~";
        assert_eq!(clean_reply(s), "你好呀~");
    }
}
