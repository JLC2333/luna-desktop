use rusqlite::{Connection, params};
use std::path::Path;

/// 从 SQLite 加载记忆条目（Active Memory 检索）
pub fn load_memories_for_chat(db_path: &Path, chat_id: u32) -> Result<Vec<MemoryRow>, String> {
    let conn = Connection::open(db_path)
        .map_err(|e| format!("打开数据库失败: {}", e))?;

    // 优先长期记忆，然后短期，最多 20 条
    let mut stmt = conn
        .prepare(
            "SELECT id, chat_id, content, source, memory_type, created_at
             FROM memories
             WHERE chat_id = ?1
             ORDER BY
               CASE memory_type WHEN 'long_term' THEN 0 ELSE 1 END,
               created_at DESC
             LIMIT 50",
        )
        .map_err(|e| format!("准备查询失败: {}", e))?;

    let rows = stmt
        .query_map(params![chat_id], |row| {
            Ok(MemoryRow {
                id: row.get(0)?,
                chat_id: row.get(1)?,
                content: row.get(2)?,
                source: row.get(3)?,
                memory_type: row.get(4)?,
                created_at: row.get(5)?,
            })
        })
        .map_err(|e| format!("查询失败: {}", e))?;

    let mut result = Vec::new();
    for row in rows {
        result.push(row.map_err(|e| format!("读取行失败: {}", e))?);
    }
    Ok(result)
}

/// 全文搜索记忆（FTS5）
pub fn search_memories(db_path: &Path, chat_id: u32, query: &str) -> Result<Vec<MemoryRow>, String> {
    let conn = Connection::open(db_path)
        .map_err(|e| format!("打开数据库失败: {}", e))?;

    let mut stmt = conn
        .prepare(
            "SELECT m.id, m.chat_id, m.content, m.source, m.memory_type, m.created_at
             FROM memories m
             JOIN memories_fts fts ON m.id = fts.rowid
             WHERE m.chat_id = ?1 AND memories_fts MATCH ?2
             ORDER BY rank
             LIMIT 10",
        )
        .map_err(|e| format!("准备 FTS 查询失败: {}", e))?;

    let rows = stmt
        .query_map(params![chat_id, query], |row| {
            Ok(MemoryRow {
                id: row.get(0)?,
                chat_id: row.get(1)?,
                content: row.get(2)?,
                source: row.get(3)?,
                memory_type: row.get(4)?,
                created_at: row.get(5)?,
            })
        })
        .map_err(|e| format!("FTS 查询失败: {}", e))?;

    let mut result = Vec::new();
    for row in rows {
        result.push(row.map_err(|e| format!("读取行失败: {}", e))?);
    }
    Ok(result)
}

/// 检查是否已有相似记忆（去重用）
fn has_similar_memory(conn: &Connection, chat_id: u32, content: &str) -> Result<bool, String> {
    // 1. 精确匹配
    let exact: bool = conn
        .query_row(
            "SELECT COUNT(*) > 0 FROM memories WHERE chat_id = ?1 AND content = ?2",
            params![chat_id, content],
            |row| row.get(0),
        )
        .map_err(|e| format!("精确匹配查询失败: {}", e))?;
    if exact {
        return Ok(true);
    }

    // 2. 提取有意义的关键词（≥2 字符，去除非中文字词和标点）
    let keywords: Vec<String> = content
        .chars()
        .filter(|c| !c.is_ascii_punctuation())
        .collect::<String>()
        .split(|c: char| c.is_ascii_whitespace() || c == '\u{3000}')
        .flat_map(|s| {
            // 对中文：按 2 字滑动窗口取词，对非中文：取完整词
            let has_cjk = s.chars().any(|c| c as u32 >= 0x4E00 && c as u32 <= 0x9FFF);
            if has_cjk && s.len() >= 2 {
                // 2 字滑动窗口
                let chars: Vec<char> = s.chars().collect();
                (0..chars.len() - 1).map(|i| chars[i..=i + 1].iter().collect()).collect()
            } else if s.len() >= 3 {
                vec![s.to_string()]
            } else {
                vec![]
            }
        })
        .filter(|k| k.len() >= 2)
        .collect();

    if keywords.is_empty() {
        return Ok(false);
    }

    // 3. FTS5 搜索已有记忆
    let query = keywords.join(" AND ");
    let mut stmt = conn
        .prepare(
            "SELECT m.content FROM memories m
             JOIN memories_fts fts ON m.id = fts.rowid
             WHERE m.chat_id = ?1 AND memories_fts MATCH ?2
             ORDER BY rank
             LIMIT 10",
        )
        .map_err(|e| format!("FTS5 查询准备失败: {}", e))?;

    let rows = stmt
        .query_map(params![chat_id, query], |row| -> Result<String, rusqlite::Error> {
            row.get(0)
        })
        .map_err(|e| format!("FTS5 查询执行失败: {}", e))?;

    for row in rows {
        if let Ok(existing_content) = row {
            let overlap = keywords
                .iter()
                .filter(|k| existing_content.contains(k.as_str()))
                .count();
            if keywords.len() > 0 && (overlap as f64 / keywords.len() as f64) >= 0.6 {
                return Ok(true);
            }
        }
    }

    Ok(false)
}

/// 写入一条记忆（带自动去重）
pub fn insert_memory(db_path: &Path, chat_id: u32, content: &str, source: &str) -> Result<i64, String> {
    let conn = Connection::open(db_path)
        .map_err(|e| format!("打开数据库失败: {}", e))?;

    // 去重检查
    if has_similar_memory(&conn, chat_id, content)? {
        eprintln!("[memory-dedup] 跳过重复记忆: {}", content);
        return Ok(-1); // -1 表示已存在/跳过
    }

    let memory_type = if source == "consolidated" { "long_term" } else { "short_term" };

    conn.execute(
        "INSERT INTO memories (chat_id, content, source, memory_type) VALUES (?1, ?2, ?3, ?4)",
        params![chat_id, content, source, memory_type],
    )
    .map_err(|e| format!("插入记忆失败: {}", e))?;

    Ok(conn.last_insert_rowid())
}

/// 为一段用户消息格式化成 Active Memory 注入块
pub fn format_memories_for_prompt(memories: &[MemoryRow]) -> Option<String> {
    if memories.is_empty() {
        return None;
    }

    let mut lines = Vec::new();
    lines.push(String::new());
    lines.push("【关于用户的记忆】".to_string());

    for mem in memories {
        let tag = match mem.source.as_str() {
            "user" => "📝",
            "llm" => "🤖",
            "auto" => "⚡",
            "consolidated" => "📦",
            _ => "",
        };
        lines.push(format!("{}{}", tag, mem.content));
    }

    lines.push(String::new());
    Some(lines.join("\n"))
}

#[derive(Debug, Clone)]
pub struct MemoryRow {
    pub id: i64,
    pub chat_id: i32,
    pub content: String,
    pub source: String,
    pub memory_type: String,
    pub created_at: Option<String>,
}
