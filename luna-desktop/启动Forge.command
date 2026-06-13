#!/bin/bash
cd "/Users/jlc/Desktop/LunA Forge 打包测试/luna-desktop"

# 杀掉所有相关进程
pkill -9 -f "luna-desktop" 2>/dev/null
lsof -ti:1420 | xargs kill -9 2>/dev/null
sleep 1

echo "正在启动 LunA Forge..."
npm run tauri dev
