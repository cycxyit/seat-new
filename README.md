# 🏢 科室座位预订系统 (Seat Booking System)

[![Deploy with Vercel](https://vercel.com/button)](https://vercel.com/new/clone?repository-url=https://github.com/cycxyit/seat&env=ADMIN_SECRET_KEY,GOOGLE_SHEETS_ID,GOOGLE_SHEETS_RANGE,GOOGLE_SERVICE_ACCOUNT_KEY,TURSO_DATABASE_URL,TURSO_AUTH_TOKEN,GITHUB_TOKEN,GITHUB_REPO&project-name=seat-booking-system)

一个企业级、现代化且支持实时响应的科室座位选择预订系统。系统集成了前后端分离架构，支持完整的工号权限校验、多科室自定义网格管理功能，并支持将预订数据无缝自动同步到 **Google Sheets** 中。

---

## ✨ 功能特性 (Features)

- ✅ **一键部署** — 适配 Vercel Monorepo 架构，前后端一个按钮搞定。
- ✅ **工号认证系统** — 轻量化的员工工号/验证码登录拦截。
- ✅ **动态多科室管理** — 管理员可自由自定义办公座位布局。
- ✅ **Google Sheets 自动同步** — 预订数据实时同步到云端表格。
- ✅ **全平台响应式** — PC、平板与手机端完美自适应。

## 🛠️ 技术栈 (Tech Stack)

- **前端 (Frontend):** Vue 3, Vite, Axios
- **后端 (Backend):** Node.js (Vercel Serverless), Express, Turso (SQLite)
- **第三方集成:** Google Sheets API v4

---

## ⚡ Vercel 一键部署教程 (Recommended)

### 1. 准备工作
在点击部署按钮前，请确保你已拥有：
1. **Turso 数据库**：获取 `URL` 和 `Token`。
2. **Google Service Account**：获取 JSON 密钥内容。
3. **Google Sheet ID**：新建一个表格并分享编辑权限给 Service Account 邮箱。

### 2. 点击部署
点击顶部的 **Deploy with Vercel** 按钮：
- **环境变量配置**：
  - `ADMIN_SECRET_KEY`: 设置你的管理员后台密码。
  - `TURSO_DATABASE_URL` & `TURSO_AUTH_TOKEN`: 填入数据库信息。
  - `GOOGLE_SERVICE_ACCOUNT_KEY`: 直接粘贴 JSON 密钥的**完整内容**。
  - `GOOGLE_SHEETS_ID`: 填入表格 ID。
  - `GOOGLE_SHEETS_RANGE`: 填入同步范围（例如 `Bookings!A:G`）。
  - `GITHUB_TOKEN` & `GITHUB_REPO`: 用于支付凭证上传功能。
- **无需配置前端 URL**：系统会自动识别并适配。

### ⚠️ Vercel 避坑指南 (Limitations)
- **10秒超时限制**：Vercel Hobby 计划的函数有 10s 运行限制。本项目已优化，将耗时的同步操作改为按需触发，避免冷启动超时。
- **无状态环境**：Vercel Serverless 环境下 `setInterval` 定时任务无效。数据同步主要依赖用户操作触发。如需定时强制同步，建议在 Vercel Settings 中配置 **Cron Jobs** 定时请求 `/api/admin/sync`。
- **文件只读**：无法在服务器保存本地文件，所有数据必须存储在 Turso 数据库中。

---

## 🚀 本地开发配置 (Local Development)

### 第 1 步: 安装依赖
```bash
npm run install:all
```

### 第 2 步: 配置环境变量
在项目根目录创建 `.env` 文件：
```env
PORT=5000
TURSO_DATABASE_URL=your_url
TURSO_AUTH_TOKEN=your_token
ADMIN_SECRET_KEY=your_password
GOOGLE_SHEETS_ID=your_id
GOOGLE_SERVICE_ACCOUNT_KEY_PATH=./backend/config/service-key.json
```

### 第 3 步: 启动
```bash
npm run dev
```

---

## 🌐 服务器部署 (Manual Server)
如果你更倾向于使用物理服务器（如阿里云/腾讯云）：
1. **后端**：使用 PM2 启动 `backend/src/server.js`。
2. **前端**：`npm run build` 后使用 Nginx 托管 `dist` 目录。
3. **Nginx 配置**：确保将 `/api` 转发到后端的 5000 端口。

---
*Created and maintained with ❤️ for optimized business workflows.*
