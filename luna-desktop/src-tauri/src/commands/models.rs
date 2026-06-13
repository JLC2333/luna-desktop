use tauri::Manager;
use std::path::PathBuf;
use std::path::Path;
use serde::{Deserialize, Serialize};
use std::fs;

#[derive(Debug, Serialize, Deserialize, Clone)]
pub struct ModelInfo {
    pub dir_name: String,
    pub model_name: String,
    pub json_file: String,
    pub has_moc: bool,
    pub texture_count: usize,
    pub expression_count: usize,
    pub motion_groups: Vec<String>,
}

#[derive(Debug, Deserialize, Serialize)]
#[serde(rename_all = "PascalCase")]
struct Model3Json {
    #[serde(default)]
    file_references: FileReferences,
}

#[derive(Debug, Deserialize, Default, Serialize)]
#[serde(rename_all = "PascalCase")]
struct FileReferences {
    #[serde(default)]
    moc: Option<String>,
    #[serde(default)]
    textures: Vec<String>,
    #[serde(default)]
    physics: Option<String>,
    #[serde(default)]
    display_info: Option<String>,
    #[serde(default)]
    expressions: Vec<ExpressionRef>,
    #[serde(default)]
    motions: MotionMap,
}

#[derive(Debug, Deserialize, Serialize)]
#[serde(rename_all = "PascalCase")]
struct ExpressionRef {
    #[serde(default)]
    name: String,
    #[serde(default)]
    file: String,
}

#[derive(Debug, Deserialize, Default, Serialize)]
struct MotionMap {
    #[serde(flatten)]
    groups: std::collections::HashMap<String, Vec<MotionRef>>,
}

#[derive(Debug, Deserialize, Serialize)]
struct MotionRef {
    #[serde(default)]
    file: String,
}

#[tauri::command]
pub fn scan_models(dir: String) -> Result<Vec<ModelInfo>, String> {
    let dir_path = Path::new(&dir);
    if !dir_path.is_dir() { return Err(format!("目录不存在: {}", dir)); }
    let mut models = Vec::new();
    if let Some(json_path) = find_model3_json(dir_path) {
        if let Some(info) = parse_model3(&json_path) { models.push(info); }
        return Ok(models);
    }
    let entries = fs::read_dir(dir_path).map_err(|e| format!("读取目录失败: {}", e))?;
    for entry in entries {
        let entry = entry.map_err(|e| format!("读取条目失败: {}", e))?;
        let path = entry.path();
        if !path.is_dir() { continue; }
        if let Some(json_path) = find_model3_json(&path) {
            let dir_name = path.file_name().and_then(|n| n.to_str()).unwrap_or("unknown").to_string();
            if let Some(info) = parse_model3(&json_path) {
                models.push(ModelInfo { dir_name, ..info });
            }
        }
    }
    Ok(models)
}

fn find_model3_json(dir: &Path) -> Option<PathBuf> {
    if !dir.is_dir() { return None; }
    fs::read_dir(dir).ok()?.find_map(|entry| {
        let entry = entry.ok()?;
        let n = entry.file_name().to_str()?.to_string();
        if n.ends_with(".model3.json") { Some(entry.path()) } else { None }
    })
}

fn parse_model3(json_path: &Path) -> Option<ModelInfo> {
    let content = fs::read_to_string(json_path).ok()?;
    let parsed: Model3Json = serde_json::from_str(&content).ok()?;
    let dir_name = json_path.parent().and_then(|p| p.file_name()).and_then(|n| n.to_str()).unwrap_or("unknown").to_string();
    let model_name = json_path.file_stem().and_then(|n| n.to_str()).unwrap_or("unknown").to_string();
    let json_file = json_path.file_name().and_then(|n| n.to_str()).unwrap_or("unknown").to_string();
    Some(ModelInfo { dir_name, model_name, json_file,
        has_moc: parsed.file_references.moc.is_some(),
        texture_count: parsed.file_references.textures.len(),
        expression_count: parsed.file_references.expressions.len(),
        motion_groups: parsed.file_references.motions.groups.keys().cloned().collect(),
    })
}

fn copy_dir(src: &Path, dst: &Path) -> Result<(), String> {
    if dst.exists() { fs::remove_dir_all(dst).map_err(|e| format!("清理失败: {}", e))?; }
    fs::create_dir_all(dst).map_err(|e| format!("创建目录失败: {}", e))?;
    for entry in fs::read_dir(src).map_err(|e| format!("读取失败: {}", e))? {
        let e = entry.map_err(|e| format!("条目失败: {}", e))?;
        let s = e.path(); let d = dst.join(e.file_name());
        if s.is_dir() { copy_dir(&s, &d)?; } else { fs::copy(&s, &d).map_err(|_| format!("复制失败"))?; }
    }
    Ok(())
}

#[tauri::command]
pub fn install_model(source_dir: String, dev_target_dir: String, app: tauri::AppHandle) -> Result<ModelInfo, String> {
    let src = Path::new(&source_dir);
    if !src.is_dir() { return Err(format!("目录不存在: {}", source_dir)); }
    let model_json_path = find_model3_json(src)
        .ok_or_else(|| "未找到 .model3.json".to_string())?;
    let mut model_info = parse_model3(&model_json_path)
        .ok_or_else(|| "解析失败".to_string())?;
    let dir_name = model_info.dir_name.clone();
    let app_data = app.path().app_data_dir().map_err(|e| format!("数据目录失败: {}", e))?;
    let persist_target = app_data.join("luna-models").join(&dir_name);

    // 1. 复制到持久化目录
    eprintln!("[install_model] copying to {:?}", persist_target);
    copy_dir(src, &persist_target)
        .map_err(|e| format!("复制到持久化目录失败: {}", e))?;

    // 2. 创建 {dirName}.model3.json 别名
    let alias_name = format!("{}.model3.json", dir_name);
    let orig_in_persist = find_model3_json(&persist_target)
        .ok_or_else(|| format!("持久化目录中未找到 .model3.json: {:?}", persist_target))?;
    let alias_path = persist_target.join(&alias_name);
    if orig_in_persist != alias_path && !alias_path.exists() {
        let content = fs::read_to_string(&orig_in_persist)
            .map_err(|e| format!("读取原 json 失败: {}", e))?;
        fs::write(&alias_path, &content)
            .map_err(|e| format!("写入别名失败: {}", e))?;
    }

    // 3. 验证：确认别名文件存在且可读
    if !alias_path.exists() {
        return Err(format!("安装验证失败: 别名文件未创建 {:?}", alias_path));
    }
    let _test = fs::read_to_string(&alias_path)
        .map_err(|e| format!("安装验证失败: 别名文件读取失败 {}", e))?;

    eprintln!("[install_model] OK — installed to {:?}", persist_target);

    model_info.json_file = alias_name;
    model_info.model_name = dir_name;
    Ok(model_info)
}


/// 获取默认模型安装目录
#[tauri::command]
pub fn get_models_dir(app: tauri::AppHandle) -> Result<String, String> {
    // 尝试从 resource_dir 向上查找 public/live2d/model/（仅 dev 模式有效）
    if let Ok(resource) = app.path().resource_dir() {
        let mut dir = Some(resource.as_path());
        while let Some(d) = dir {
            let test = d.join("public").join("live2d").join("model");
            if test.exists() {
                return Ok(test.to_string_lossy().to_string());
            }
            dir = d.parent();
        }
    }
    // 备用：app_data + luna-models（打包后统一用这个）
    let app_data = app.path().app_data_dir().map_err(|e| format!("获取数据目录失败: {}", e))?;
    let fallback = app_data.join("luna-models");
    fs::create_dir_all(&fallback).ok();
    Ok(fallback.to_string_lossy().to_string())
}

/// 列出已安装的模型（从 luna-models/ 目录）
#[tauri::command]
pub fn list_installed_models(app: tauri::AppHandle) -> Result<Vec<ModelInfo>, String> {
    let app_data = app.path().app_data_dir().map_err(|e| format!("获取数据目录失败: {}", e))?;
    let models_dir = app_data.join("luna-models");
    if !models_dir.exists() {
        return Ok(Vec::new());
    }
    let mut models = Vec::new();
    let entries = fs::read_dir(&models_dir).map_err(|e| format!("读取目录失败: {}", e))?;
    for entry in entries {
        let entry = entry.map_err(|e| format!("读取条目失败: {}", e))?;
        let path = entry.path();
        if !path.is_dir() { continue; }
        if let Some(json_path) = find_model3_json(&path) {
            if let Some(info) = parse_model3(&json_path) {
                let dir_name = path.file_name().and_then(|n| n.to_str()).unwrap_or("unknown").to_string();
                let dn = dir_name.clone();
                models.push(ModelInfo {
                    dir_name,
                    json_file: format!("{}.model3.json", dn),
                    ..info
                });
            }
        }
    }
    Ok(models)
}

/// 删除已安装的模型（从 dev 目录 + 持久化目录）
#[tauri::command]
pub fn delete_model(dir_name: String, app: tauri::AppHandle) -> Result<(), String> {
    let mut deleted = 0;
    // 持久化目录
    let app_data = app.path().app_data_dir().map_err(|e| format!("获取数据目录失败: {}", e))?;
    let persist_dir = app_data.join("luna-models").join(&dir_name);
    if persist_dir.exists() {
        fs::remove_dir_all(&persist_dir).map_err(|e| format!("删除持久化目录失败: {}", e))?;
        deleted += 1;
    }
    // Dev 目录（通过 get_models_dir 逻辑，打包后 resource_dir 可能不可用）
    if let Ok(resource) = app.path().resource_dir() {
        let mut dir = Some(resource.as_path());
        while let Some(d) = dir {
            let dev_dir = d.join("public").join("live2d").join("model").join(&dir_name);
            if dev_dir.exists() {
                fs::remove_dir_all(&dev_dir).map_err(|e| format!("删除 dev 目录失败: {}", e))?;
                deleted += 1;
                break;
            }
            dir = d.parent();
        }
    }
    if deleted == 0 {
        Err(format!("未找到模型目录: {}", dir_name))
    } else {
        Ok(())
    }
}

/// 扫描模型目录中的所有 .exp3.json 文件（兜底：model3.json 没列表情时用）
#[derive(Debug, Serialize, Deserialize, Clone)]
pub struct ExpressionEntry {
    pub name: String,
    pub file: String,
}

#[tauri::command]
pub fn list_model_expressions(dir_name: String, app: tauri::AppHandle) -> Result<Vec<ExpressionEntry>, String> {
    let mut expressions = Vec::new();

    // 先读 model3.json 的 FileReferences.Expressions
    let app_data = app.path().app_data_dir().map_err(|e| format!("{}", e))?;
    let model_dir = app_data.join("luna-models").join(&dir_name);
    if let Some(json_path) = find_model3_json(&model_dir) {
        if let Ok(content) = fs::read_to_string(&json_path) {
            if let Ok(parsed) = serde_json::from_str::<Model3Json>(&content) {
                for exp in &parsed.file_references.expressions {
                    expressions.push(ExpressionEntry {
                        name: exp.name.clone(),
                        file: exp.file.clone(),
                    });
                }
            }
        }
    }

    // 兜底：直接扫描目录中的 .exp3.json 文件
    if expressions.is_empty() {
        // 先试 app_data/luna-models（导入的模型）
        let mut scan_dirs = vec![app_data.join("luna-models").join(&dir_name)];
        // 再试 public/live2d/model（内置模型）
        if let Ok(resource) = app.path().resource_dir() {
            let mut d = Some(resource.as_path());
            while let Some(p) = d {
                let dev = p.join("public").join("live2d").join("model").join(&dir_name);
                if dev.exists() { scan_dirs.push(dev); break; }
                d = p.parent();
            }
        }
        for scan_dir in &scan_dirs {
            if !scan_dir.exists() { continue }
            if let Ok(entries) = fs::read_dir(scan_dir) {
            for entry in entries.flatten() {
                let fname = entry.file_name().to_string_lossy().to_string();
                if fname.ends_with(".exp3.json") {
                    let name = fname.trim_end_matches(".exp3.json").to_string();
                    if !expressions.iter().any(|e| e.name == name) {
                        expressions.push(ExpressionEntry { name, file: fname });
                    }
                }
            }
            }
        }
    }

    Ok(expressions)
}

/// 通过 IPC 读取模型文件（绕过自定义协议，返回 Vec<u8> 由前端转 ArrayBuffer）
#[tauri::command]
pub fn read_model_file(path: String, app: tauri::AppHandle) -> Result<Vec<u8>, String> {
    let app_data = app.path().app_data_dir().map_err(|e| format!("数据目录失败: {}", e))?;
    let models_dir = app_data.join("luna-models");

    // 安全校验：禁止 .. 路径穿越
    let cleaned = path.replace('\\', "/");
    if cleaned.starts_with("..") || cleaned.contains("/../") || cleaned.contains("\\..\\") {
        return Err("非法路径".to_string());
    }

    let file_path = models_dir.join(&cleaned);
    eprintln!("[read_model_file] {:?}", file_path);
    std::fs::read(&file_path).map_err(|e| format!("读取文件失败: {} [path={:?}]", e, file_path))
}

/// 校验模型完整性
#[tauri::command]
pub fn validate_model(dir_name: String, app: tauri::AppHandle) -> Result<ModelInfo, String> {
    let app_data = app.path().app_data_dir().map_err(|e| format!("获取数据目录失败: {}", e))?;
    let models_dir = app_data.join("luna-models").join(&dir_name);
    if !models_dir.exists() {
        return Err("模型目录不存在".to_string());
    }
    let json_path = find_model3_json(&models_dir)
        .ok_or_else(|| "未找到 .model3.json".to_string())?;
    parse_model3(&json_path)
        .ok_or_else(|| "解析 model3.json 失败".to_string())
}

