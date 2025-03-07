#!/bin/bash

# 设置新的邮箱和用户名
NEW_EMAIL="qfdk2010@gmail.com"
NEW_NAME="qfdk"

# 清理之前可能存在的 filter-branch 备份
rm -rf .git/refs/original/
git for-each-ref --format="%(refname)" refs/original/ | xargs -n 1 git update-ref -d 2>/dev/null

# 运行 filter-branch 命令
git filter-branch -f --env-filter '
    export GIT_COMMITTER_EMAIL="'"$NEW_EMAIL"'"
    export GIT_COMMITTER_NAME="'"$NEW_NAME"'"
    export GIT_AUTHOR_EMAIL="'"$NEW_EMAIL"'"
    export GIT_AUTHOR_NAME="'"$NEW_NAME"'"
' --tag-name-filter cat -- --branches --tags

# 清理并优化仓库
git gc --prune=now

echo "✅ 所有提交已更新为："
echo "邮箱: $NEW_EMAIL"
echo "用户名: $NEW_NAME"
echo
echo "执行以下命令推送更改："
echo "git push --force --tags origin 'refs/heads/*'"
