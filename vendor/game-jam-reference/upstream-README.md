# Herstory Pop-up City Game Jam

活动作品页面，用于展示 Herstory Pop-up City 现场开发的 AI Passport 玩法，并在浏览器中预检活动固件协议。

## 当前能力

- 活动首页与作品画廊
- 分类及关键词搜索
- `herstory-event-v1` 三层固件规则说明
- `event-app.json` 与 `*-full.bin` 浏览器本地预检
- SHA-256 审核摘要生成
- GitHub Pages 静态部署

文件选择只在浏览器本地读取，不会自动上传。GitHub Pages 是静态托管，不能永久接收投稿文件；共享投稿仍需提交给组织方审核，后续可接入 Supabase 或对象存储。

## 本地运行

```bash
npm install
npm run dev
```

打开 `http://localhost:3000`。

## 构建

```bash
npm run lint
npm run build
```

静态产物输出到 `out/`。

## 连接 Starter Repo

网站从环境变量读取 Starter Repo 地址：

```bash
NEXT_PUBLIC_STARTER_REPO_URL=https://github.com/YOUR_ACCOUNT/herstory-ai-passport-starter
```

在 GitHub 仓库的 **Settings → Secrets and variables → Actions → Variables** 中创建：

```text
Name: STARTER_REPO_URL
Value: Starter Repo 的完整 GitHub URL
```

## 上传到 GitHub

1. 在 GitHub 新建空仓库：`herstory-popupcity-game-jam`。不要勾选自动创建 README。
2. 在本目录执行：

```bash
git init
git add .
git commit -m "feat: launch Herstory Pop-up City Game Jam site"
git branch -M main
git remote add origin https://github.com/YOUR_ACCOUNT/herstory-popupcity-game-jam.git
git push -u origin main
```

3. 打开仓库 **Settings → Pages**。
4. 在 **Build and deployment → Source** 中选择 **GitHub Actions**。
5. 打开 **Actions**，等待 `Deploy website to GitHub Pages` 完成。
6. 页面地址通常是：

```text
https://YOUR_ACCOUNT.github.io/herstory-popupcity-game-jam/
```

未经明确授权，本地开发 Agent 不应替你创建远程仓库或推送代码。
