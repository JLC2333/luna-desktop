mod agent;
mod commands;
mod feishu;

use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::{Mutex, OnceLock};
use std::path::{Path, PathBuf};

use crate::agent::types::{ApiSettings, CharacterInfo, ChatMessage};
use chrono::{Datelike, Timelike};

/// 最新鼠标位置（由追踪线程写入，供 IPC 读取）
static LAST_MOUSE: Mutex<(f64, f64)> = Mutex::new((0.0, 0.0));

use agent::AgentCore;
use tauri::{
    Emitter, Manager, RunEvent, WebviewUrl, WebviewWindowBuilder,
    menu::{Menu, MenuItem},
    tray::TrayIconBuilder,
};
use tauri::http::{Response, StatusCode};

/// 防止 exit_app 触发 ExitRequested 导致死循环
pub(crate) static IS_EXITING: AtomicBool = AtomicBool::new(false);

/// 模型文件根目录（由 setup 设置，供 luna-model:// 协议使用）
static MODELS_DIR: OnceLock<PathBuf> = OnceLock::new();

/// 查找内置模型文件所在的目录（优先 production bundle，降级 dev public）
fn find_bundled_models_dir(app: &tauri::App) -> Result<PathBuf, String> {
    // 1. Production: dist/live2d/model/ 在 resource_dir 根目录
    if let Ok(r) = app.path().resource_dir() {
        let test = r.join("live2d").join("model");
        if test.exists() { return Ok(test); }
    }
    // 2. Dev: 从 resource_dir 向上找 public/live2d/model/
    if let Ok(r) = app.path().resource_dir() {
        let mut dir = Some(r.as_path());
        while let Some(d) = dir {
            let test = d.join("public").join("live2d").join("model");
            if test.exists() { return Ok(test); }
            dir = d.parent();
        }
    }
    Err("未找到内置模型目录".to_string())
}

/// 将内置模型复制到 luna-models/（跳过已存在的目录）
fn deploy_bundled_models(src: &Path, dst: &Path) {
    let entries = match std::fs::read_dir(src) {
        Ok(e) => e,
        Err(_) => return,
    };
    for entry in entries.flatten() {
        let path = entry.path();
        if !path.is_dir() { continue; }
        let dir_name = match path.file_name().and_then(|n| n.to_str()) {
            Some(n) => n.to_string(),
            None => continue,
        };
        let target = dst.join(&dir_name);
        if target.exists() {
            // 已存在则跳过（避免覆盖用户导入）
            continue;
        }
        // 复制整个子目录
        copy_dir_inner(&path, &target);
    }
}

/// 递归复制目录
fn copy_dir_inner(src: &Path, dst: &Path) {
    if dst.exists() { return; }
    std::fs::create_dir_all(dst).ok();
    if let Ok(entries) = std::fs::read_dir(src) {
        for entry in entries.flatten() {
            let s = entry.path();
            let d = dst.join(entry.file_name());
            if s.is_dir() {
                copy_dir_inner(&s, &d);
            } else {
                let _ = std::fs::copy(&s, &d);
            }
        }
    }
}

/// 看板娘独立窗口状态
struct MascotState(Mutex<Option<tauri::WebviewWindow>>);

#[tauri::command]
fn toggle_mascot(app: tauri::AppHandle, state: tauri::State<'_, MascotState>) -> Result<bool, String> {
    const L: &str = "luna-mascot";
    if let Some(w) = app.get_webview_window(L) {
        if w.is_visible().unwrap_or(false) { w.hide().map_err(|e| e.to_string())?; Ok(false) }
        else { w.show().map_err(|e| e.to_string())?; let _ = w.set_always_on_top(true); Ok(true) }
    } else {
        let win = WebviewWindowBuilder::new(&app, L, WebviewUrl::App("mascot.html".into()))
            .title("").inner_size(350.0, 466.0).decorations(false).transparent(true)
            .always_on_top(true).resizable(false).skip_taskbar(true)
            .build().map_err(|e| format!("创建看板娘窗口失败: {}", e))?;
        #[cfg(target_os = "macos")]
        unsafe {
            use objc2::msg_send; use objc2_app_kit::NSWindow;
            if let Ok(p) = win.ns_window() {
                let ns = &*(p as *const NSWindow);
                let () = msg_send![ns, setLevel: 25i64]; // 高于菜单栏(24)，可拖到屏幕任意位置
                let () = msg_send![ns, setMovableByWindowBackground: true];
                let () = msg_send![ns, setIgnoresMouseEvents: false];
            }
        }
        let _ = win.set_always_on_top(true);

        // macOS: 原生鼠标追踪（绕过 WKWebView 不派发 mousemove 的 bug）
        #[cfg(target_os = "macos")]
        {
            let app2 = app.clone();
            std::thread::spawn(move || {
                use objc2::{msg_send, ClassType, Encode, Encoding};
                use objc2_app_kit::{NSEvent, NSScreen};
                use std::time::Duration;

                #[repr(C)]
                struct NSPoint { x: f64, y: f64 }
                unsafe impl Encode for NSPoint {
                    const ENCODING: Encoding = Encoding::Struct("CGPoint", &[f64::ENCODING, f64::ENCODING]);
                }
                #[repr(C)]
                struct NSSize { w: f64, h: f64 }
                unsafe impl Encode for NSSize {
                    const ENCODING: Encoding = Encoding::Struct("CGSize", &[f64::ENCODING, f64::ENCODING]);
                }
                #[repr(C)]
                struct NSRect { origin: NSPoint, size: NSSize }
                unsafe impl Encode for NSRect {
                    const ENCODING: Encoding = Encoding::Struct("CGRect", &[NSPoint::ENCODING, NSSize::ENCODING]);
                }

                loop {
                    std::thread::sleep(Duration::from_millis(16));
                    unsafe {
                        let loc: NSPoint = msg_send![NSEvent::class(), mouseLocation];
                        let screen: *mut NSScreen = msg_send![NSScreen::class(), mainScreen];
                        if screen.is_null() { continue };
                        let frame: NSRect = msg_send![screen, frame];
                        let sh = frame.size.h;
                        let sw = frame.size.w;
                        // 屏幕相对坐标（-1~1 全范围覆盖）
                        let nx = (loc.x / sw) * 2.0 - 1.0;
                        let ny = (loc.y / sh) * 2.0 - 1.0;
                        let nx2 = nx.clamp(-1.0, 1.0);
                        let ny2 = ny.clamp(-1.0, 1.0);
                        let _ = LAST_MOUSE.lock().map(|mut g| { *g = (nx2, ny2); });
                        let _ = app2.emit("luna:mousemove", serde_json::json!({"nx": nx2, "ny": ny2}));
                    }
                }
            });
        }

        *state.0.lock().map_err(|e| e.to_string())? = Some(win);
        Ok(true)
    }
}

/// 返回最新鼠标位置（由追踪线程持续写入）
#[tauri::command]
fn mascot_get_mouse() -> Result<(f64, f64), String> {
    LAST_MOUSE.lock().map_err(|e| e.to_string()).map(|g| *g)
}

/// 获取伴聊列表（chat_type = 'companion'）
#[derive(serde::Serialize, serde::Deserialize)]
struct CompanionChat {
    id: i64,
    title: String,
    character_id: Option<i64>,
    created_at: String,
}

#[tauri::command]
fn list_companion_chats(character_id: i64, app: tauri::AppHandle) -> Result<Vec<CompanionChat>, String> {
    let db_path = app.path().app_data_dir().map_err(|e| e.to_string())?.join("luna.db");
    let conn = rusqlite::Connection::open(&db_path).map_err(|e| e.to_string())?;
    let mut stmt = conn.prepare(
        "SELECT id, title, character_id, created_at FROM chats WHERE chat_type = 'companion' AND character_id = ? ORDER BY updated_at DESC"
    ).map_err(|e| e.to_string())?;
    let rows = stmt.query_map([character_id], |row| {
        Ok(CompanionChat {
            id: row.get(0)?,
            title: row.get(1)?,
            character_id: row.get(2)?,
            created_at: row.get(3)?,
        })
    }).map_err(|e| e.to_string())?;
    let mut chats = Vec::new();
    for row in rows {
        chats.push(row.map_err(|e| e.to_string())?);
    }
    Ok(chats)
}

#[tauri::command]
fn create_companion_chat(character_id: i64, title: String, app: tauri::AppHandle) -> Result<i64, String> {
    let db_path = app.path().app_data_dir().map_err(|e| e.to_string())?.join("luna.db");
    let conn = rusqlite::Connection::open(&db_path).map_err(|e| e.to_string())?;
    conn.execute(
        "INSERT INTO chats (title, character_id, chat_type) VALUES (?1, ?2, 'companion')",
        rusqlite::params![title, character_id],
    ).map_err(|e| e.to_string())?;
    Ok(conn.last_insert_rowid())
}

#[derive(serde::Serialize, serde::Deserialize)]
struct CompanionMessage {
    id: i64,
    role: String,
    content: String,
    created_at: String,
}

#[tauri::command]
fn get_companion_messages(chat_id: i64, app: tauri::AppHandle) -> Result<Vec<CompanionMessage>, String> {
    let db_path = app.path().app_data_dir().map_err(|e| e.to_string())?.join("luna.db");
    let conn = rusqlite::Connection::open(&db_path).map_err(|e| e.to_string())?;
    let mut stmt = conn.prepare(
        "SELECT id, role, content, created_at FROM messages WHERE chat_id = ? ORDER BY created_at ASC"
    ).map_err(|e| e.to_string())?;
    let rows = stmt.query_map([chat_id], |row| {
        Ok(CompanionMessage {
            id: row.get(0)?,
            role: row.get(1)?,
            content: row.get(2)?,
            created_at: row.get(3)?,
        })
    }).map_err(|e| e.to_string())?;
    let mut msgs = Vec::new();
    for row in rows {
        msgs.push(row.map_err(|e| e.to_string())?);
    }
    Ok(msgs)
}

// ─── 看板娘绑定 ───

/// 绑定对话到看板娘（仅允许一个对话绑定）
#[tauri::command]
fn bind_mascot(chat_id: i64, app: tauri::AppHandle) -> Result<(), String> {
    let db_path = app.path().app_data_dir().map_err(|e| e.to_string())?.join("luna.db");
    let conn = rusqlite::Connection::open(&db_path).map_err(|e| e.to_string())?;
    // 先解除所有绑定，再绑定指定对话
    conn.execute("UPDATE chats SET mascot_bind = 0", []).map_err(|e| e.to_string())?;
    conn.execute("UPDATE chats SET mascot_bind = 1 WHERE id = ?1", rusqlite::params![chat_id])
        .map_err(|e| e.to_string())?;
    // 获取对话信息用于事件
    let info: (String, Option<i64>) = conn.query_row(
        "SELECT title, character_id FROM chats WHERE id = ?1", rusqlite::params![chat_id],
        |row| Ok((row.get(0)?, row.get(1)?))
    ).map_err(|e| e.to_string())?;
    let char_name = if let Some(cid) = info.1 {
        conn.query_row("SELECT name FROM characters WHERE id = ?1", rusqlite::params![cid],
            |row| row.get::<_, String>(0)).ok()
    } else { None };
    let _ = app.emit("mascot:bound", serde_json::json!({
        "chatId": chat_id,
        "title": info.0,
        "characterName": char_name,
    }));
    Ok(())
}

/// 解除看板娘绑定
#[tauri::command]
fn unbind_mascot(app: tauri::AppHandle) -> Result<(), String> {
    let db_path = app.path().app_data_dir().map_err(|e| e.to_string())?.join("luna.db");
    let conn = rusqlite::Connection::open(&db_path).map_err(|e| e.to_string())?;
    conn.execute("UPDATE chats SET mascot_bind = 0", []).map_err(|e| e.to_string())?;
    let _ = app.emit("mascot:unbound", serde_json::json!({}));
    Ok(())
}

/// 获取当前绑定的对话信息
#[tauri::command]
fn get_mascot_bind(app: tauri::AppHandle) -> Result<Option<serde_json::Value>, String> {
    let db_path = app.path().app_data_dir().map_err(|e| e.to_string())?.join("luna.db");
    let conn = rusqlite::Connection::open(&db_path).map_err(|e| e.to_string())?;
    let mut stmt = conn.prepare(
        "SELECT c.id, c.title, c.character_id, ch.name, ch.avatar
         FROM chats c LEFT JOIN characters ch ON c.character_id = ch.id
         WHERE c.mascot_bind = 1"
    ).map_err(|e| e.to_string())?;
    let rows = stmt.query_map([], |row| {
        Ok(serde_json::json!({
            "chatId": row.get::<_, i64>(0)?,
            "title": row.get::<_, String>(1)?,
            "characterId": row.get::<_, Option<i64>>(2)?,
            "characterName": row.get::<_, Option<String>>(3)?,
            "characterAvatar": row.get::<_, Option<String>>(4)?,
        }))
    }).map_err(|e| e.to_string())?;
    for row in rows {
        return Ok(Some(row.map_err(|e| e.to_string())?));
    }
    Ok(None)
}

// ─── 旁白绑定（一次只能一个对话）───

#[tauri::command]
fn bind_narration(chat_id: i64, app: tauri::AppHandle) -> Result<(), String> {
    let db_path = app.path().app_data_dir().map_err(|e| e.to_string())?.join("luna.db");
    let conn = rusqlite::Connection::open(&db_path).map_err(|e| e.to_string())?;
    conn.execute("UPDATE chats SET narration_bind = 0", []).map_err(|e| e.to_string())?;
    conn.execute("UPDATE chats SET narration_bind = 1 WHERE id = ?1", rusqlite::params![chat_id])
        .map_err(|e| e.to_string())?;
    Ok(())
}

#[tauri::command]
fn unbind_narration(app: tauri::AppHandle) -> Result<(), String> {
    let db_path = app.path().app_data_dir().map_err(|e| e.to_string())?.join("luna.db");
    let conn = rusqlite::Connection::open(&db_path).map_err(|e| e.to_string())?;
    conn.execute("UPDATE chats SET narration_bind = 0", []).map_err(|e| e.to_string())?;
    Ok(())
}

#[tauri::command]
fn get_narration_bind(app: tauri::AppHandle) -> Result<Option<serde_json::Value>, String> {
    let db_path = app.path().app_data_dir().map_err(|e| e.to_string())?.join("luna.db");
    let conn = rusqlite::Connection::open(&db_path).map_err(|e| e.to_string())?;
    let mut stmt = conn.prepare(
        "SELECT c.id, c.title, c.character_id, ch.name, ch.avatar
         FROM chats c LEFT JOIN characters ch ON c.character_id = ch.id
         WHERE c.narration_bind = 1"
    ).map_err(|e| e.to_string())?;
    let rows = stmt.query_map([], |row| {
        Ok(serde_json::json!({
            "chatId": row.get::<_, i64>(0)?,
            "title": row.get::<_, String>(1)?,
            "characterId": row.get::<_, Option<i64>>(2)?,
            "characterName": row.get::<_, Option<String>>(3)?,
            "characterAvatar": row.get::<_, Option<String>>(4)?,
        }))
    }).map_err(|e| e.to_string())?;
    for row in rows {
        return Ok(Some(row.map_err(|e| e.to_string())?));
    }
    Ok(None)
}

// ─── 旁白 + 主动消息队列 ───

#[tauri::command]
async fn generate_narration_queue(
    agent: tauri::State<'_, crate::agent::AgentCore>,
    chat_id: i64,
    idle_minutes: u32,
) -> Result<Vec<crate::agent::types::NarrationItem>, String> {
    agent.generate_narration_queue(chat_id as u32, idle_minutes).await
}

#[tauri::command]
fn check_narration_queue(
    agent: tauri::State<'_, crate::agent::AgentCore>,
    chat_id: i64,
) -> Result<Vec<crate::agent::types::NarrationItem>, String> {
    agent.narration.get_due_items(chat_id as u32)
}

#[tauri::command]
fn deliver_narration_items(
    agent: tauri::State<'_, crate::agent::AgentCore>,
    chat_id: i64,
    item_ids: Vec<u32>,
) -> Result<(), String> {
    agent.narration.mark_delivered(chat_id as u32, &item_ids)
}

#[tauri::command]
fn clear_narration_queue(
    agent: tauri::State<'_, crate::agent::AgentCore>,
    chat_id: i64,
) -> Result<(), String> {
    agent.narration.clear_queue(chat_id as u32)
}

#[tauri::command]
fn has_narration_queue(
    agent: tauri::State<'_, crate::agent::AgentCore>,
    chat_id: i64,
) -> Result<bool, String> {
    Ok(agent.narration.has_pending(chat_id as u32))
}

/// 获取绑定对话的消息列表
#[tauri::command]
fn mascot_get_messages(chat_id: i64, app: tauri::AppHandle) -> Result<Vec<serde_json::Value>, String> {
    let db_path = app.path().app_data_dir().map_err(|e| e.to_string())?.join("luna.db");
    let conn = rusqlite::Connection::open(&db_path).map_err(|e| e.to_string())?;
    let mut stmt = conn.prepare(
        "SELECT id, role, content, emotion, timestamp FROM messages WHERE chat_id = ?1 AND deleted_at IS NULL ORDER BY timestamp ASC"
    ).map_err(|e| e.to_string())?;
    let msgs = stmt.query_map(rusqlite::params![chat_id], |row| {
        Ok(serde_json::json!({
            "id": row.get::<_, i64>(0)?,
            "role": row.get::<_, String>(1)?,
            "content": row.get::<_, String>(2)?,
            "emotion": row.get::<_, Option<String>>(3)?,
            "timestamp": row.get::<_, String>(4)?,
        }))
    }).map_err(|e| e.to_string())?
    .filter_map(|r| r.ok())
    .collect();
    Ok(msgs)
}

/// 看板娘发送消息（保存用户消息 → 调 AI → 保存回复 → 通知看板娘窗口）
#[tauri::command]
async fn mascot_send_message(
    agent: tauri::State<'_, crate::agent::AgentCore>,
    app: tauri::AppHandle,
    chat_id: i64,
    content: String,
) -> Result<serde_json::Value, String> {
    let db_path = app.path().app_data_dir().map_err(|e| e.to_string())?.join("luna.db");
    let db_path2 = db_path.clone();

    // ── Phase 1: 所有 DB 读写在 spawn_blocking 中（同步，跨 await 安全） ──
    let (character_id, _chat_title, current_user_msg, history, character, settings, stat_string) =
        tokio::task::spawn_blocking(move || {
            let conn = rusqlite::Connection::open(&db_path).map_err(|e| e.to_string())?;

            // 获取对话信息
            let (cid, ctitle): (Option<i64>, String) = conn.query_row(
                "SELECT character_id, title FROM chats WHERE id = ?1",
                rusqlite::params![chat_id],
                |row| Ok((row.get(0)?, row.get(1)?)),
            ).map_err(|e| format!("对话不存在: {}", e))?;

            // 保存用户消息
            conn.execute(
                "INSERT INTO messages (chat_id, role, content) VALUES (?1, 'user', ?2)",
                rusqlite::params![chat_id, content],
            ).map_err(|e| e.to_string())?;

            // 格式化时间戳（给 AI 看的当前时间）
            let now = chrono::Local::now();
            let date_str = format!("{:02}-{:02}", now.month(), now.day());
            let time_str = format!("{:02}:{:02}", now.hour(), now.minute());
            let cur_msg = format!("【当前时间: {} {}】\n{}", date_str, time_str, content);

            // 加载历史消息
            let mut stmt = conn.prepare(
                "SELECT role, content FROM messages WHERE chat_id = ?1 AND deleted_at IS NULL ORDER BY timestamp ASC"
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

            // 加载角色信息
            let char_info = if let Some(cid2) = cid {
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

            // 加载 API 配置（user_name/user_persona 在旧 api_settings 表，不走 profiles）
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

            // 加载属性值
            let stat_str: Option<String> = conn.query_row(
                "SELECT stat_happy, stat_discomfort, stat_trust, stat_energy, stat_affection, stat_curiosity, stat_relax, stat_depression
                 FROM chat_stats WHERE chat_id = ?1",
                rusqlite::params![chat_id],
                |row| {
                    Ok(Some(format!(
                        "stat_happy={},stat_discomfort={},stat_trust={},stat_energy={},stat_affection={},stat_curiosity={},stat_relax={},stat_depression={}",
                        row.get::<_, f64>(0)? as i32,
                        row.get::<_, f64>(1)? as i32,
                        row.get::<_, f64>(2)? as i32,
                        row.get::<_, f64>(3)? as i32,
                        row.get::<_, f64>(4)? as i32,
                        row.get::<_, f64>(5)? as i32,
                        row.get::<_, f64>(6)? as i32,
                        row.get::<_, f64>(7)? as i32,
                    )))
                }
            ).ok().flatten();

            Ok::<_, String>((cid, ctitle, cur_msg, hist, char_info, api_settings, stat_str))
        }).await.map_err(|e| format!("spawn_blocking 失败: {}", e))??;

    // ── Phase 2: AI 调用（异步，在 Tokio 线程池执行） ──
    let response = agent.process_message(
        &current_user_msg,
        character_id.map(|v| v as u32),
        Some(chat_id as u32),
        character,
        settings,
        history,
        stat_string,
    ).await?;

    // ── Phase 3: 保存回复、发事件（再次 spawn_blocking） ──
    let result = tokio::task::spawn_blocking(move || {
        let conn = rusqlite::Connection::open(&db_path2).map_err(|e| e.to_string())?;

        conn.execute(
            "INSERT INTO messages (chat_id, role, content, emotion, speech, action, reasoning_content)
             VALUES (?1, 'assistant', ?2, ?3, ?4, ?5, ?6)",
            rusqlite::params![
                chat_id,
                response.reply,
                response.emotion,
                response.speech,
                response.action,
                response.reasoning_content,
            ],
        ).map_err(|e| e.to_string())?;

        // 情绪变化
        if response.emotion != "idle" && !response.emotion.is_empty() {
            let emotion = &response.emotion;
            let delta_map: std::collections::HashMap<&str, Vec<(&str, i32)>> =
                std::collections::HashMap::from([
                    ("angry", vec![("stat_discomfort", 15), ("stat_happy", -5)]),
                    ("sad", vec![("stat_depression", 10), ("stat_happy", -5)]),
                    ("happy", vec![("stat_happy", 8), ("stat_relax", 5)]),
                    ("surprise", vec![("stat_curiosity", 8), ("stat_energy", 3)]),
                    ("fear", vec![("stat_discomfort", 10), ("stat_trust", -5)]),
                    ("love", vec![("stat_affection", 8), ("stat_trust", 3)]),
                    ("idle", vec![]),
                ]);
            if let Some(deltas) = delta_map.get(emotion.as_str()) {
                for (stat, delta) in deltas.iter() {
                    let sql = format!(
                        "UPDATE chat_stats SET {} = MAX(0, MIN(100, {} + {})), updated_at = datetime('now') WHERE chat_id = ?1",
                        stat, stat, delta
                    );
                    let _ = conn.execute(&sql, rusqlite::params![chat_id]);
                }
            }
        }

        // 加载最新消息
        let mut stmt = conn.prepare(
            "SELECT id, role, content, emotion, timestamp FROM messages WHERE chat_id = ?1 AND deleted_at IS NULL ORDER BY timestamp ASC"
        ).map_err(|e| e.to_string())?;
        let messages: Vec<serde_json::Value> = stmt.query_map(rusqlite::params![chat_id], |row| {
            Ok(serde_json::json!({
                "id": row.get::<_, i64>(0)?,
                "role": row.get::<_, String>(1)?,
                "content": row.get::<_, String>(2)?,
                "emotion": row.get::<_, Option<String>>(3)?,
                "timestamp": row.get::<_, String>(4)?,
            }))
        }).map_err(|e| e.to_string())?
        .filter_map(|r| r.ok())
        .collect();

        Ok::<_, String>(messages)
    }).await.map_err(|e| format!("spawn_blocking 失败: {}", e))??;

    // 事件通知（可在任何线程执行）
    let _ = app.emit("mascot:update", serde_json::json!({
        "chatId": chat_id,
        "messages": result,
    }));
    let _ = app.emit("luna:chat-update", serde_json::json!({}));

    Ok(result.last().cloned().unwrap_or(serde_json::json!({})))
}

/// 启动看板娘窗口的原生拖拽（使用 OS 窗口管理器，比手动 set_position 更平滑）
#[tauri::command]
fn start_mascot_drag(app: tauri::AppHandle) -> Result<(), String> {
    const L: &str = "luna-mascot";
    if let Some(w) = app.get_webview_window(L) {
        w.start_dragging().map_err(|e| e.to_string())
    } else {
        Err("看板娘窗口未找到".into())
    }
}

/// 获取看板娘窗口位置（逻辑像素）
#[tauri::command]
fn get_mascot_position(app: tauri::AppHandle) -> Result<(f64, f64), String> {
    const L: &str = "luna-mascot";
    if let Some(w) = app.get_webview_window(L) {
        let pos = w.outer_position().map_err(|e| e.to_string())?;
        let sf = w.scale_factor().map_err(|e| e.to_string())?;
        Ok((pos.x as f64 / sf, pos.y as f64 / sf))
    } else {
        Err("看板娘窗口未找到".into())
    }
}

/// 设置看板娘窗口位置
#[tauri::command]
fn set_mascot_position(x: f64, y: f64, app: tauri::AppHandle) -> Result<(), String> {
    const L: &str = "luna-mascot";
    if let Some(w) = app.get_webview_window(L) {
        w.set_position(tauri::LogicalPosition::new(x, y)).map_err(|e| e.to_string())
    } else {
        Err("看板娘窗口未找到".into())
    }
}

/// 调整看板娘窗口大小
#[tauri::command]
fn resize_mascot(width: u32, height: u32, app: tauri::AppHandle) -> Result<(), String> {
    const L: &str = "luna-mascot";
    if let Some(w) = app.get_webview_window(L) {
        w.set_size(tauri::LogicalSize::new(width as f64, height as f64)).map_err(|e| e.to_string())
    } else {
        Err("看板娘窗口未找到".into())
    }
}

/// 看板娘窗口 → 主窗口日志转发
#[tauri::command]
fn luna_log_from_mascot(level: String, msg: String, detail: String, app: tauri::AppHandle) -> Result<(), String> {
    let _ = app.emit("luna:log", serde_json::json!({
        "level": level,
        "msg": msg,
        "detail": detail,
    }));
    Ok(())
}

/// 清除所有用户数据（三遍确认后调用）
#[tauri::command]
fn clear_all_data(app: tauri::AppHandle) -> Result<(), String> {
    let app_data = app.path().app_data_dir().map_err(|e| e.to_string())?;
    let db_path = app_data.join("luna.db");
    if db_path.exists() {
        let conn = rusqlite::Connection::open(&db_path).map_err(|e| e.to_string())?;
        // 清空所有业务表（保留 schema）
        conn.execute_batch("
            DELETE FROM messages;
            DELETE FROM chat_stats;
            DELETE FROM stat_snapshots;
            DELETE FROM diary_entries;
            DELETE FROM memories_fts;
            DELETE FROM memories;
            DELETE FROM chats;
            DELETE FROM personality_states;
            DELETE FROM characters;
            DELETE FROM worlds;
            DELETE FROM api_profiles;
            DELETE FROM api_settings;
            DELETE FROM app_config;
        ").map_err(|e| e.to_string())?;
    }
    // 删除 agent 目录
    let agent = app_data.join("agent");
    if agent.exists() { std::fs::remove_dir_all(&agent).map_err(|e| e.to_string())?; }
    // 删除旁白目录
    let narration = app_data.join("narration");
    if narration.exists() { std::fs::remove_dir_all(&narration).map_err(|e| e.to_string())?; }
    // 删除模型目录
    let models = app_data.join("luna-models");
    if models.exists() { std::fs::remove_dir_all(&models).map_err(|e| e.to_string())?; }
    Ok(())
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    let app = tauri::Builder::default()
        .plugin(tauri_plugin_sql::Builder::new().build())
        .register_asynchronous_uri_scheme_protocol("luna-model", move |_app, request, responder| {
            let path = request.uri().path().trim_start_matches('/').to_string();
            let models_base = MODELS_DIR.get().cloned().unwrap_or_default();
            let file_path = models_base.join(&path);
            if file_path.exists() {
                let mime = if path.ends_with(".json") { "application/json" }
                    else if path.ends_with(".png") { "image/png" }
                    else if path.ends_with(".moc3") { "application/octet-stream" }
                    else if path.ends_with(".jpg") || path.ends_with(".jpeg") { "image/jpeg" }
                    else { "application/octet-stream" };
                match std::fs::read(&file_path) {
                    Ok(data) => {
                        let mut res = Response::new(data);
                        *res.status_mut() = StatusCode::OK;
                        res.headers_mut().insert("Content-Type", mime.parse().unwrap());
                        res.headers_mut().insert("Access-Control-Allow-Origin", "*".parse().unwrap());
                        let _ = responder.respond(res);
                    }
                    Err(_) => {
                        let mut res = Response::new(Vec::new());
                        *res.status_mut() = StatusCode::NOT_FOUND;
                        let _ = responder.respond(res);
                    }
                }
            } else {
                let mut res = Response::new(Vec::new());
                *res.status_mut() = StatusCode::NOT_FOUND;
                let _ = responder.respond(res);
            }
        })
        .setup(|app| {
            let app_data_dir = app
                .path()
                .app_data_dir()
                .expect("无法获取应用数据目录");
            let agent_dir = app_data_dir.join("agent");
            let db_path = app_data_dir.join("luna.db");
            let narration_dir = app_data_dir.join("narration");

            std::fs::create_dir_all(&agent_dir)
                .expect("无法创建 Agent 目录");
            std::fs::create_dir_all(&narration_dir)
                .expect("无法创建旁白目录");

            log::info!("LunA Agent context dir: {:?}", agent_dir);
            log::info!("LunA SQLite DB path: {:?}", db_path);
            log::info!("LunA narration dir: {:?}", narration_dir);

            app.manage(AgentCore::new(agent_dir, db_path, narration_dir));

            // 设置模型文件根目录（供 luna-model:// 协议使用）
            MODELS_DIR.set(app_data_dir.join("luna-models")).ok();

            // 将内置模型文件从 app bundle 部署到 luna-models/（仅首次运行）
            let models_target = app_data_dir.join("luna-models");
            std::fs::create_dir_all(&models_target).ok();
            if let Ok(models_source) = find_bundled_models_dir(app) {
                deploy_bundled_models(&models_source, &models_target);
            }

            // ─── 系统托盘（Mac 菜单栏 / Win 通知区） ───
            let show = MenuItem::with_id(app, "show", "显示窗口", true, None::<&str>)?;
            let quit = MenuItem::with_id(app, "quit", "退出 LunA", true, None::<&str>)?;
            let menu = Menu::with_items(app, &[&show, &quit])?;

            TrayIconBuilder::new()
                .tooltip("LunA")
                .icon(app.default_window_icon().cloned().unwrap())
                .menu(&menu)
                .on_menu_event(|app, event| {
                    match event.id().as_ref() {
                        "show" => {
                            if let Some(window) = app.get_webview_window("main") {
                                let _ = window.show();
                                let _ = window.set_focus();
                            }
                        }
                        "quit" => {
                            // 发事件给前端 → 前端确认后写日记再退出
                            if let Some(window) = app.get_webview_window("main") {
                                let _ = window.show();
                                let _ = window.set_focus();
                                let _ = window.emit("quit-requested", ());
                            }
                        }
                        _ => {}
                    }
                })
                .on_tray_icon_event(|tray, event| {
                    use tauri::tray::{MouseButton, MouseButtonState};
                    if let tauri::tray::TrayIconEvent::Click {
                        button: MouseButton::Left,
                        button_state: MouseButtonState::Up,
                        ..
                    } = event
                    {
                        let app = tray.app_handle();
                        if let Some(window) = app.get_webview_window("main") {
                            let _ = window.show();
                            let _ = window.set_focus();
                        }
                    }
                })
                .build(app)?;

            // 确保 Dock 图标始终显示（tray-icon 默认可能隐藏）
            app.set_activation_policy(tauri::ActivationPolicy::Regular);

            // 启动飞书 Bot Webhook 服务
            let feishu_cfg = feishu::FeishuConfig {
                app_id: "".into(),
                app_secret: "".into(),
            };
            let app_handle = app.handle().clone();
            tauri::async_runtime::spawn(async move {
                feishu::start_server(feishu_cfg, app_handle).await;
            });

            Ok(())
        })
        // 窗口关闭（Cmd+Q/macOS 红点）→ 触发日记流程
        .on_window_event(|window, event| {
            use tauri::Emitter;
            if let tauri::WindowEvent::CloseRequested { api, .. } = event {
                api.prevent_close();
                if let Err(e) = window.emit("quit-requested", ()) {
                    eprintln!("[app] window close emit failed: {e}");
                }
            }
        })
        .manage(MascotState(Mutex::new(None)))
        .invoke_handler(tauri::generate_handler![
            toggle_mascot,
            mascot_get_mouse,
            resize_mascot,
            set_mascot_position,
            get_mascot_position,
            list_companion_chats,
            create_companion_chat,
            get_companion_messages,
            start_mascot_drag,
            bind_mascot,
            unbind_mascot,
            get_mascot_bind,
            mascot_get_messages,
            mascot_send_message,
            commands::send_message,
            commands::get_agent_context,
            commands::set_agent_soul,
            commands::set_agent_world,
            commands::test_api_connection,
            commands::list_api_models,
            commands::generate_chat_title,
            commands::save_user_info,
            commands::stop_generation,
            commands::get_soul_content,
            commands::get_memory_content,
            commands::continue_message,
            commands::get_banned_global_content,
            commands::update_banned_global,
            commands::get_banned_content,
            commands::update_banned_content,
            commands::update_soul_command,
            commands::update_memory_command,
            commands::append_memory_command,
            commands::get_prompt_order,
            commands::set_prompt_order,
            commands::reset_prompt_order,
            commands::get_prompt_preview,
            commands::generate_diary,
            commands::save_diary_entry,
            commands::scan_models,
            commands::get_models_dir,
            commands::list_installed_models,
            commands::delete_model,
            commands::validate_model,
            commands::install_model,
            commands::read_model_file,
            commands::list_model_expressions,
            commands::exit_app,
            generate_narration_queue,
            check_narration_queue,
            deliver_narration_items,
            clear_narration_queue,
            bind_narration,
            unbind_narration,
            get_narration_bind,
            has_narration_queue,
            clear_all_data,
            luna_log_from_mascot,
        ])
        .build(tauri::generate_context!())
        .expect("error while building tauri application");

    app.run(|app_handle, event| {
        if let RunEvent::ExitRequested { api, .. } = event {
            // 退出标记已置位 → exit_app 正在执行，放行
            if IS_EXITING.load(Ordering::SeqCst) {
                eprintln!("[app] ExitRequested during exit_app — allowing through");
                return;
            }
            eprintln!("[app] ExitRequested fired — preventing exit");
            // 先让窗口可见，再发事件给前端
            if let Some(window) = app_handle.get_webview_window("main") {
                let _ = window.show();
                let _ = window.set_focus();
                eprintln!("[app] emitting quit-requested to frontend");
                let _ = window.emit("quit-requested", ());
            }
            api.prevent_exit();
            eprintln!("[app] exit prevented, staying alive");
        }
    });
}
