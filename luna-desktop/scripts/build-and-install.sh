#!/bin/bash

# LunA 构建并自动安装脚本

set -e

echo "🚀 开始构建 LunA..."

# 构建前端
echo "📦 构建前端..."
npm run build

# 构建 Tauri
echo "🔨 构建 Tauri 应用..."
npm run tauri build

# 检查应用是否正在运行
echo "🛑 检查并关闭正在运行的 LunA..."
if pgrep -x "LunA" > /dev/null; then
    echo "   正在关闭 LunA..."
    pkill -x "LunA" || true
    sleep 2
fi

# 卸载旧版本
echo "🗑️  删除旧版本..."
rm -rf /Applications/LunA.app

# 安装新版本
echo "📲 安装新版本..."
DMG_PATH="src-tauri/target/release/bundle/dmg/LunA_0.1.0_aarch64.dmg"

if [ ! -f "$DMG_PATH" ]; then
    echo "❌ 错误: 找不到 DMG 文件: $DMG_PATH"
    exit 1
fi

# 挂载 DMG
hdiutil attach "$DMG_PATH" -quiet

# 复制应用到 Applications
cp -R /Volumes/LunA/LunA.app /Applications/

# 卸载 DMG
hdiutil detach /Volumes/LunA -quiet

echo "✅ 安装完成！LunA 已安装到 /Applications/"
echo ""
echo "🎉 构建并安装成功！"
