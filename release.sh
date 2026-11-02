#!/usr/bin/env bash
#
# 易文本（YiText）一键发版脚本
#
# 用法：
#   ./release.sh v0.3.0 "本次版本说明（支持多行，会作为 Release 正文）"
#
# 流程：
#   1. 校验工作区干净（有未提交改动会中止，需先 commit）
#   2. 校验版本号格式、且该 tag 尚未存在
#   3. 同步 yitext.js 里的版本号（库版本 = tag 去掉开头的 v）
#   4. 自动提交「release: 版本号」
#   5. 推送 main 分支
#   6. 打 annotated tag 并推送
#   7. 用 gh 创建 Release（标题 = 易文本 版本号）
#
# 依赖：git + gh（gh 需已登录：gh auth login）
# 说明：此脚本已加入 .gitignore 之外的提交清单，若不想把脚本推上去可自行 git rm。
set -euo pipefail

VERSION="${1:-}"
NOTES="${2:-}"

# ---- 参数校验 ----
if [[ -z "$VERSION" ]]; then
  echo "❌ 用法：./release.sh <版本号> \"说明\""
  echo "   例如：./release.sh v0.3.0 \"新增 xxx 语法，修复 yyy\""
  exit 1
fi

if [[ ! "$VERSION" =~ ^v[0-9]+\.[0-9]+\.[0-9]+$ ]]; then
  echo "❌ 版本号格式不对，应为 v主.次.修订，例如 v0.3.0"
  exit 1
fi

if [[ -z "$NOTES" ]]; then
  echo "❌ 缺少版本说明（Release 正文）。请在第二个参数传入，可用 $'...' 或换行。"
  exit 1
fi

# ---- 环境检查 ----
if ! command -v gh >/dev/null 2>&1; then
  echo "❌ 未找到 gh CLI。请先安装：https://cli.github.com 并运行 gh auth login"
  exit 1
fi
if ! gh auth status >/dev/null 2>&1; then
  echo "❌ gh 未登录。请先运行：gh auth login"
  exit 1
fi

# ---- 工作区检查 ----
if ! git diff --quiet || ! git diff --cached --quiet; then
  echo "❌ 工作区有未提交的改动，请先 git add + git commit（或 git stash）再发版。"
  echo "   当前改动："
  git status --short
  exit 1
fi

# ---- tag 检查 ----
if git rev-parse "$VERSION" >/dev/null 2>&1; then
  echo "❌ 标签 $VERSION 已存在，请换一个新版本号。"
  exit 1
fi

LIB_VERSION="${VERSION#v}"   # 去掉开头的 v

# ---- 同步库版本号 ----
if [[ -f yitext.js ]]; then
  if grep -q "version: '[0-9.]*'" yitext.js; then
    # 精确替换 return 语句里的 version
    if grep -q "version: '$LIB_VERSION'" yitext.js; then
      echo "✓ yitext.js 已是 $LIB_VERSION"
    else
      sed -i '' -E "s/version: '[0-9]+\.[0-9]+\.[0-9]+'/version: '$LIB_VERSION'/" yitext.js
      echo "✓ yitext.js 版本已同步为 $LIB_VERSION"
    fi
  fi
  # 同步文件头注释里的版本号
  sed -i '' -E "s/版本：[0-9]+\.[0-9]+\.[0-9]+/版本：$LIB_VERSION/" yitext.js
fi

# ---- 提交（若有改动）----
if ! git diff --quiet; then
  git add yitext.js 2>/dev/null || true
  git commit -m "release: $VERSION（同步库版本号）"
  echo "✓ 已提交版本号变更"
fi

# ---- 推送 main ----
CURRENT_BRANCH="$(git rev-parse --abbrev-ref HEAD)"
git push origin "$CURRENT_BRANCH"
echo "✓ 已推送 $CURRENT_BRANCH"

# ---- 打 tag 并推送 ----
git tag -a "$VERSION" -m "易文本 $VERSION"
git push origin "$VERSION"
echo "✓ 已推送标签 $VERSION"

# ---- 创建 Release ----
TITLE="易文本 $VERSION"
echo "$NOTES" > /tmp/yiwenben_release_notes.md
URL="$(gh release create "$VERSION" --title "$TITLE" --notes-file /tmp/yiwenben_release_notes.md)"
echo ""
echo "✅ 发版完成：$VERSION"
echo "   Release：$URL"
