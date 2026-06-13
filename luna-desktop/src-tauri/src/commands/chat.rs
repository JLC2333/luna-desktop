use tauri::State;
use tauri::Emitter;

use crate::agent::AgentCore;
use crate::agent::context::ContextManager;
use crate::agent::types::*;

/// 发送用户消息，获取 AI 回复
/// character_id 用于定位角色专属 soul.md
/// chat_id 用于定位对话专属 memory.md
#[tauri::command]
pub async fn send_message(
    agent: State<'_, AgentCore>,
    content: String,
    character_id: Option<u32>,
    chat_id: Option<u32>,
    character: Option<CharacterInfo>,
    settings: ApiSettings,
    history: Vec<ChatMessage>,
    stat_string: Option<String>,
) -> Result<AgentResponse, String> {
    agent
        .process_message(&content, character_id, chat_id, character, settings, history, stat_string)
        .await
}

/// 获取当前 Agent 上下文（soul/memory/world）
#[tauri::command]
pub async fn get_agent_context(
    agent: State<'_, AgentCore>,
    character_id: u32,
    chat_id: u32,
) -> Result<AgentContext, String> {
    agent.get_context(character_id, chat_id).await
}

/// 手动更新 soul（按角色 ID）
#[tauri::command]
pub async fn set_agent_soul(
    agent: State<'_, AgentCore>,
    character_id: u32,
    content: String,
) -> Result<(), String> {
    agent.set_soul(character_id, &content).await
}

/// 手动更新 world（按角色 ID）
#[tauri::command]
pub async fn set_agent_world(
    agent: State<'_, AgentCore>,
    character_id: u32,
    content: String,
) -> Result<(), String> {
    agent.set_world(character_id, &content).await
}

/// 测试 API 连接
#[tauri::command]
pub async fn test_api_connection(
    agent: State<'_, AgentCore>,
    endpoint: String,
    api_key: String,
) -> Result<bool, String> {
    agent.test_connection(&endpoint, &api_key).await
}

/// 获取 API 可用模型列表
#[tauri::command]
pub async fn list_api_models(
    agent: State<'_, AgentCore>,
    endpoint: String,
    api_key: String,
) -> Result<Vec<String>, String> {
    agent.list_models(&endpoint, &api_key).await
}

/// 根据首轮对话自动生成标题
#[tauri::command]
pub async fn generate_chat_title(
    agent: State<'_, AgentCore>,
    user_message: String,
    assistant_reply: String,
    settings: ApiSettings,
) -> Result<String, String> {
    agent.generate_title(&user_message, &assistant_reply, &settings).await
}

/// 保存用户信息到全局 user_info.md
#[tauri::command]
pub async fn save_user_info(
    agent: State<'_, AgentCore>,
    user_name: String,
    user_persona: String,
) -> Result<(), String> {
    agent.save_user_info(&user_name, &user_persona).await
}

/// 停止当前正在进行的 LLM 生成
#[tauri::command]
pub async fn stop_generation(
    agent: State<'_, AgentCore>,
) -> Result<bool, String> {
    Ok(agent.stop_generation().await)
}

/// 读取角色 soul.md 内容
#[tauri::command]
pub async fn get_soul_content(
    agent: State<'_, AgentCore>,
    character_id: u32,
) -> Result<String, String> {
    agent.get_soul_content(character_id).await
}

/// 读取对话 memory.md 内容
#[tauri::command]
pub async fn get_memory_content(
    agent: State<'_, AgentCore>,
    chat_id: u32,
) -> Result<String, String> {
    agent.get_memory_content(chat_id).await
}

/// 读取全局禁止词
#[tauri::command]
pub async fn get_banned_global_content(
    agent: State<'_, AgentCore>,
) -> Result<String, String> {
    agent.get_banned_global_content().await
}

/// 保存全局禁止词
#[tauri::command]
pub async fn update_banned_global(
    agent: State<'_, AgentCore>,
    content: String,
) -> Result<(), String> {
    agent.update_banned_global(&content).await
}

/// 读取角色禁止词
#[tauri::command]
pub async fn get_banned_content(
    agent: State<'_, AgentCore>,
    character_id: u32,
) -> Result<String, String> {
    agent.get_banned_content(character_id).await
}

/// 保存角色禁止词
#[tauri::command]
pub async fn update_banned_content(
    agent: State<'_, AgentCore>,
    character_id: u32,
    content: String,
) -> Result<(), String> {
    agent.update_banned_content(character_id, &content).await
}

#[tauri::command]
pub async fn update_soul_command(
    agent: State<'_, AgentCore>,
    character_id: u32,
    content: String,
) -> Result<(), String> {
    agent.set_soul(character_id, &content).await
}

#[tauri::command]
pub async fn update_memory_command(
    agent: State<'_, AgentCore>,
    chat_id: u32,
    content: String,
) -> Result<(), String> {
    agent.set_memory(chat_id, &content).await
}

/// 追加内容到对话记忆（不覆盖已有内容）
#[tauri::command]
pub async fn append_memory_command(
    agent: State<'_, AgentCore>,
    chat_id: u32,
    content: String,
) -> Result<(), String> {
    agent.append_memory(chat_id, &content).await
}

/// 继续输出：角色根据上文再回复一句，用于推进剧情
#[tauri::command]
pub async fn continue_message(
    agent: State<'_, AgentCore>,
    character_id: Option<u32>,
    chat_id: Option<u32>,
    character: Option<CharacterInfo>,
    settings: ApiSettings,
    history: Vec<ChatMessage>,
    stat_string: Option<String>,
) -> Result<AgentResponse, String> {
    // 用特殊提示词告诉 AI 继续上文
    let prompt = "（请继续上文，自然地推进对话或场景。保持角色性格和语气一致，不要重复上一句已说过的内容。不需要解释、不需要自我介绍，直接输出角色的下一句话或动作描述。）";
    agent
        .process_message(prompt, character_id, chat_id, character, settings, history, stat_string)
        .await
}

/// 获取 System Prompt 模块排序配置
#[tauri::command]
pub async fn get_prompt_order(
    agent: State<'_, AgentCore>,
) -> Result<PromptOrder, String> {
    agent.get_prompt_order().await
}

/// 保存 System Prompt 模块排序配置
#[tauri::command]
pub async fn set_prompt_order(
    agent: State<'_, AgentCore>,
    order: PromptOrder,
) -> Result<(), String> {
    agent.set_prompt_order(order).await
}

/// 重置 System Prompt 模块排序为默认值
#[tauri::command]
pub async fn reset_prompt_order(
    agent: State<'_, AgentCore>,
) -> Result<PromptOrder, String> {
    agent.reset_prompt_order().await
}

/// 生成日记：调用 LLM 根据今日对话写一篇角色视角的日记
#[tauri::command]
pub async fn generate_diary(
    context: String,
    character_name: String,
    character_personality: String,
    max_length: u32,
    previous_diary: String,
    is_continuation: bool,
    settings: ApiSettings,
) -> Result<String, String> {
    use crate::agent::llm::LlmClient;
    let now = chrono::Local::now();
    let date = now.format("%Y-%m-%d %A").to_string();
    let time_of_day = now.format("%H:%M").to_string();
    let user_ref = if settings.user_name.is_empty() { "对方" } else { &settings.user_name };
    let token_limit = (max_length as f64 * 2.5).max(200.0) as u32;
    let is_short = is_continuation && !previous_diary.is_empty();

    let messages: Vec<serde_json::Value> = if is_short {
        // 短对话 → 仅续写，不写新日记
        vec![
            serde_json::json!({
                "role": "system",
                "content": format!(
                    "你是{}。{}。\n\n你今天和「{}」说了几句话。请你用角色的口吻续写下面的日记，只输出续写文字，不要日期、抬头、emoji、标题，不要重复或概括之前的内容。直接在末尾续写，续写前加一行---\n\n{}",
                    character_name, character_personality, user_ref, previous_diary
                ),
            }),
            serde_json::json!({"role": "user", "content": format!("现在是{}。今天和「{}」新说的对话：\n{}", time_of_day, user_ref, context)}),
        ]
    } else {
        vec![
            serde_json::json!({
                "role": "system",
                "content": format!(
                    "从现在开始，你是{}。{}。请你以{}的身份写今天的日记。\n根据你和「{}」今天的对话记录，字数控制在{}字左右。\n\n要求：\n1. 严格遵守角色的性格和说话风格来写\n2. 用第一人称，像在写给自己看的私人日记\n3. 记录今天发生的事、「{}」的言行、你的感受\n4. 对话记录中每条消息前都有 [HH:MM] 时间标记——重要的事件（第一次打招呼、重要谈话等）请务必在日记中保留对应的时间，方便以后查阅\n5. 根据当前时间决定语气。上午不说晚安，下午不说早安\n6. 只输出日记内容本身，不需要标题、日期和署名",
                    character_name, character_personality, character_name, user_ref, max_length, user_ref
                ),
            }),
            serde_json::json!({"role": "user", "content": format!("现在是{}，日期是{}。\n\n今天的对话记录：\n{}", time_of_day, date, context)}),
        ]
    };

    let cancel = tokio_util::sync::CancellationToken::new();
    let llm = LlmClient::new();

    let fut = llm.chat(
        &settings.endpoint,
        &settings.api_key,
        &settings.model,
        0.7,
        token_limit,
        messages,
        cancel,
    );
    match tokio::time::timeout(std::time::Duration::from_secs(30), fut).await {
        Ok(result) => result,
        Err(_) => Err("日记生成超时（30秒），已跳过".to_string()),
    }
}

/// 直接写入日记到 SQLite（绕过前端 DB 操作，确保退出前落盘）
#[tauri::command]
pub async fn save_diary_entry(
    agent: State<'_, AgentCore>,
    date: String,
    character_name: String,
    content: String,
) -> Result<(), String> {
    let db_path = agent.db_path().clone();
    let title = format!("{} - {}", character_name, date);
    tokio::task::spawn_blocking(move || {
        use rusqlite::params;
        let conn = rusqlite::Connection::open(&db_path)
            .map_err(|e| format!("打开 DB 失败: {}", e))?;

        let existing: Option<String> = conn
            .query_row(
                "SELECT manual_note FROM diary_entries WHERE date = ?1 AND title = ?2",
                params![date, &title],
                |row| row.get(0),
            )
            .ok();

        match existing {
            Some(old) => {
                let updated = format!("{}\n\n---\n\n{}", old, content);
                conn.execute(
                    "UPDATE diary_entries SET manual_note = ?1, summary = substr(?1, 1, 100) WHERE date = ?2 AND title = ?3",
                    params![updated, date, &title],
                ).map_err(|e| format!("更新日记失败: {}", e))?;
            }
            None => {
                conn.execute(
                    "INSERT INTO diary_entries (date, title, summary, manual_note) VALUES (?1, ?2, substr(?3, 1, 100), ?3)",
                    params![date, &title, &content],
                ).map_err(|e| format!("写入日记失败: {}", e))?;
            }
        }
        Ok(())
    }).await
        .map_err(|e| format!("spawn_blocking 失败: {}", e))?
}

/// 安全退出 App（前端准备好后调用）
/// 先设退出标记防死循环，再用 app.exit(0) 让 Tauri/SQLite 有机会清理
#[tauri::command]
pub async fn exit_app(
    app: tauri::AppHandle,
) -> Result<(), String> {
    eprintln!("[app] exit_app called — terminating");
    crate::IS_EXITING.store(true, std::sync::atomic::Ordering::SeqCst);
    tokio::time::sleep(std::time::Duration::from_millis(200)).await;
    app.exit(0);
    Ok(())
}

/// 获取完整 System Prompt 预览（不含角色特定内容）
#[tauri::command]
pub async fn get_prompt_preview(
    agent: State<'_, AgentCore>,
    system_prompt: String,
    user_name: String,
    user_persona: String,
) -> Result<String, String> {
    let ctx = AgentContext {
        soul: String::new(),
        memory: String::new(),
        world: String::new(),
        user_info: String::new(),
        banned_global: String::new(),
        banned_character: String::new(),
    };
    let order = agent.get_prompt_order().await?;
    let prompt = ContextManager::assemble_system_prompt_dynamic(
        &ctx,
        None,
        &user_name,
        &user_persona,
        &system_prompt,
        &order,
        "",
    );
    Ok(prompt)
}
