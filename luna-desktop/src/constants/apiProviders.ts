import { ApiProviderTemplate } from "../types";

export const API_PROVIDERS: ApiProviderTemplate[] = [
  // ── 云端 API ──
  { id: "openai", name: "OpenAI", endpoint: "https://api.openai.com/v1", hint: "GPT-4o / o4-mini", category: "cloud" },
  { id: "anthropic", name: "Anthropic", endpoint: "https://api.anthropic.com/v1", hint: "Claude 系列", category: "cloud" },
  { id: "deepseek", name: "DeepSeek", endpoint: "https://api.deepseek.com/v1", hint: "V4 / R1", category: "cloud" },
  { id: "google", name: "Google Gemini", endpoint: "https://generativelanguage.googleapis.com/v1beta", hint: "Gemini 2.5", category: "cloud" },
  { id: "groq", name: "Groq", endpoint: "https://api.groq.com/openai/v1", hint: "开源模型推理", category: "cloud" },
  { id: "xai", name: "xAI / Grok", endpoint: "https://api.x.ai/v1", hint: "Grok 系列", category: "cloud" },
  { id: "mistral", name: "Mistral", endpoint: "https://api.mistral.ai/v1", hint: "Mistral Large", category: "cloud" },
  { id: "together", name: "Together AI", endpoint: "https://api.together.xyz/v1", hint: "开源模型托管", category: "cloud" },
  { id: "siliconflow", name: "硅基流动", endpoint: "https://api.siliconflow.cn/v1", hint: "国产模型聚合", category: "cloud" },
  { id: "zhipu", name: "智谱 GLM", endpoint: "https://open.bigmodel.cn/api/paas/v4", hint: "GLM-4 系列", category: "cloud" },
  { id: "dashscope", name: "阿里百炼", endpoint: "https://dashscope.aliyuncs.com/compatible-mode/v1", hint: "Qwen 系列", category: "cloud" },
  { id: "moonshot", name: "月之暗面", endpoint: "https://api.moonshot.cn/v1", hint: "Kimi", category: "cloud" },
  { id: "volcengine", name: "火山引擎", endpoint: "https://ark.cn-beijing.volces.com/api/v3", hint: "豆包系列", category: "cloud" },
  // ── 本地模型 ──
  { id: "lmstudio", name: "LM Studio", endpoint: "http://127.0.0.1:1234/v1", hint: "macOS / Windows 本地", category: "local" },
  { id: "ollama", name: "Ollama", endpoint: "http://localhost:11434/v1", hint: "跨平台本地", category: "local" },
  { id: "vllm", name: "vLLM", endpoint: "http://localhost:8000/v1", hint: "高性能推理", category: "local" },
  { id: "localai", name: "LocalAI", endpoint: "http://localhost:8080/v1", hint: "OpenAI API 兼容", category: "local" },
  // ── 自定义 ──
  { id: "custom", name: "自定义", endpoint: "", hint: "任意 OpenAI 兼容 API", category: "cloud" },
];
