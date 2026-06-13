import { useState, useEffect } from "react";
import { invoke } from "@tauri-apps/api/core";
import { emit } from "@tauri-apps/api/event";

interface ModelInfo {
  json_file: string;
  dir_name: string;
  model_name: string;
  has_moc: boolean;
  texture_count: number;
  expression_count: number;
  motion_groups: string[];
}

export default function ModelsPanel() {
  const [scanDir, setScanDir] = useState("");
  const [results, setResults] = useState<ModelInfo[]>([]);
  const [installed, setInstalled] = useState<ModelInfo[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const [message, setMessage] = useState("");

  // 加载已安装模型
  const loadInstalled = async () => {
    try {
      const list = await invoke<ModelInfo[]>("list_installed_models");
      setInstalled(list);
    } catch (_) {}
  };
  useEffect(() => { loadInstalled(); }, []);

  const handleScan = async () => {
    const dir = scanDir.trim();
    if (!dir) { setError("请输入目录路径"); return; }
    setLoading(true); setError(""); setMessage("");
    try {
      const result = await invoke<ModelInfo[]>("scan_models", { dir });
      setResults(result);
      if (result.length === 0) setError("未找到 Live2D 模型");
    } catch (e) { setError(`扫描失败: ${e}`); }
    setLoading(false);
  };

  const handleInstall = async (m: ModelInfo) => {
    try {
      const devTargetDir = await invoke<string>("get_models_dir");
      // sourceDir 必须是模型所在的子目录，而不是扫描的父目录
      const srcDir = scanDir + "/" + m.dir_name;
      await invoke<ModelInfo>("install_model", {
        sourceDir: srcDir,
        devTargetDir: devTargetDir + "/" + m.dir_name,
      });
      setMessage(`✅ "${m.dir_name}" 已安装`);
      loadInstalled();
      // 通知看板娘窗口切换模型
      try {
        await emit("luna:change-model", {
          dirName: m.dir_name,
          jsonFile: m.dir_name + ".model3.json",
          label: m.dir_name,
        });
        setMessage(`✅ "${m.dir_name}" 已安装并切换为当前看板娘`);
      } catch(e) {}
      setResults([]);
    } catch (e) { setError(`安装失败: ${e}`); }
  };

  const [deleteTarget, setDeleteTarget] = useState<string | null>(null);
  const handleDelete = async () => {
    if (!deleteTarget) return;
    try {
      await invoke("delete_model", { dirName: deleteTarget });
      setMessage(`已删除 "${deleteTarget}"`);
      setDeleteTarget(null);
      loadInstalled();
    } catch (e) { setError(`删除失败: ${e}`); }
  };

  const handleValidate = async (m: ModelInfo) => {
    try {
      const info = await invoke<ModelInfo>("validate_model", { dirName: m.dir_name });
      setMessage(`✅ "${m.dir_name}" 校验通过 — 贴图:${info.texture_count} 表情:${info.expression_count}`);
    } catch (e) { setError(`校验失败: ${e}`); }
  };

  const handleSwitchModel = async (m: ModelInfo) => {
    try {
      await emit("luna:change-model", {
        dirName: m.dir_name,
        jsonFile: m.dir_name + ".model3.json",
        label: m.dir_name,
      });
      setMessage(`✅ 已切换到 "${m.dir_name}"`);
    } catch(e) { setError(`切换失败: ${e}`); }
  };

  const card = (m: ModelInfo, isResult: boolean) => (
    <div key={m.dir_name} className="bg-luna-bg-secondary border border-luna-border rounded-lg p-4">
      <div className="flex items-center justify-between mb-2">
        <div>
          <span className="text-sm font-medium text-luna-text">{m.dir_name}</span>
          <span className="text-xs text-luna-text-tertiary ml-2">({m.model_name})</span>
        </div>
        <div className="flex items-center gap-2">
          <span className={`text-xs px-2 py-0.5 rounded-full ${m.has_moc ? "bg-green-900/30 text-green-400" : "bg-red-900/30 text-red-400"}`}>
            {m.has_moc ? "完整" : "不完整"}
          </span>
          {isResult ? (
            <button onClick={() => handleInstall(m)} className="px-3 py-1 bg-luna-accent text-white rounded-md text-xs hover:bg-[#3C3489]">
              安装并使用
            </button>
          ) : (
            <>
              <button onClick={() => handleSwitchModel(m)} className="px-2 py-1 bg-luna-accent/70 text-white rounded text-xs hover:bg-luna-accent">
                切换
              </button>
              <button onClick={() => handleValidate(m)} className="px-2 py-1 border border-luna-border rounded text-xs text-luna-text-secondary hover:bg-luna-bg-tertiary">
                校验
              </button>
              <button onClick={() => setDeleteTarget(m.dir_name)} className="px-2 py-1 border border-red-900/30 rounded text-xs text-red-400 hover:bg-red-900/20">
                删除
              </button>
            </>
          )}
        </div>
      </div>
      <div className="flex flex-wrap gap-3 text-xs text-luna-text-secondary">
        <span>贴图: {m.texture_count}</span>
        <span>表情: {m.expression_count}</span>
        {m.motion_groups.length > 0 && <span>动作: {m.motion_groups.join(", ")}</span>}
      </div>
    </div>
  );

  return (
    <div className="space-y-4">
      <p className="text-sm text-luna-text-secondary">
        扫描本地目录中的 Live2D 模型，安装后可作为看板娘使用。
      </p>
      <p className="text-xs text-luna-accent bg-luna-accent/10 rounded-md px-3 py-2">
        💡 打开看板娘后，按住 <kbd className="px-1.5 py-0.5 bg-luna-bg-secondary border border-luna-border rounded text-[11px] font-mono">Tab</kbd> 键调出交互层：切换模型、缩放、换装表情、查看日志
      </p>

      {/* 已安装模型 */}
      {installed.length > 0 ? (
        <div className="space-y-3">
          <div className="text-sm font-medium text-luna-text flex items-center gap-2">
            📦 已安装模型 ({installed.length})
          </div>
          {installed.map(m => card(m, false))}
        </div>
      ) : (
        <div className="py-8 text-center">
          <div className="text-3xl mb-2">📭</div>
          <p className="text-sm text-luna-text-secondary">未导入模型</p>
          <p className="text-xs text-luna-text-tertiary mt-1">请在下方的扫描区导入 Live2D 模型</p>
        </div>
      )}

      {/* 扫描区 */}
      <div className="pt-2 border-t border-luna-border">
        <div className="text-sm font-medium text-luna-text mb-2">🔍 扫描导入</div>
        <div className="flex gap-2 mb-3">
          <input type="text" value={scanDir} onChange={e => { setScanDir(e.target.value); setError(""); }}
            placeholder="模型目录路径，如 /Users/xxx/Models/"
            className="flex-1 py-2 px-3 bg-luna-bg border border-luna-border rounded-md text-sm text-luna-text outline-none focus:border-luna-accent"
          />
          <button onClick={handleScan} disabled={loading}
            className="px-4 py-2 bg-luna-accent text-white rounded-md text-sm font-medium hover:bg-[#3C3489] disabled:opacity-50">
            {loading ? "扫描中..." : "扫描"}
          </button>
        </div>
      </div>

      {error && <p className="text-sm text-luna-red">{error}</p>}
      {message && <p className="text-sm text-green-500">{message}</p>}

      {results.length > 0 && (
        <div className="space-y-3">
          <div className="text-sm font-medium text-luna-text">发现 {results.length} 个模型：</div>
          {results.map(m => card(m, true))}
        </div>
      )}

      {/* 删除确认 */}
      {deleteTarget && (
        <div className="bg-red-900/10 border border-red-900/30 rounded-lg p-3 flex items-center gap-3">
          <span className="text-sm text-red-400 flex-1">
            确定删除 "{deleteTarget}"？此操作不可恢复。
          </span>
          <button onClick={handleDelete} className="px-3 py-1 bg-red-600 text-white rounded text-xs hover:bg-red-700">
            确认删除
          </button>
          <button onClick={() => setDeleteTarget(null)} className="px-3 py-1 border border-luna-border rounded text-xs text-luna-text-secondary hover:bg-luna-bg-tertiary">
            取消
          </button>
        </div>
      )}
    </div>
  );
}
