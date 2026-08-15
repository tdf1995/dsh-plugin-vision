# dsh-plugin-vision

> **为 DeepSeek Harness 中的纯文本大模型提供视觉能力**——通过 Gemini / GLM 免费视觉 API 完成图像描述、OCR 与视觉问答。
>
> **Vision for text-only LLMs inside DeepSeek Harness (DSH)** — describe images, OCR, and answer visual questions through the free Gemini / GLM vision APIs.

![License](https://img.shields.io/badge/license-MIT-blue.svg)
![Node](https://img.shields.io/badge/node-%3E%3D20-green.svg)
![Platform](https://img.shields.io/badge/platform-DeepSeek%20Harness-4B32C3.svg)
![Vision](https://img.shields.io/badge/vision-Gemini%20%7C%20GLM-1a73e8.svg)

---

## 目录 Table of Contents

- [简介 Introduction](#简介-introduction)
- [功能特性 Features](#功能特性-features)
- [安装 Installation](#安装-installation)
- [API Key 配置 API Key Configuration](#api-key-配置-api-key-configuration)
- [使用方法 Usage](#使用方法-usage)
- [工具参考 Tool Reference](#工具参考-tool-reference)
- [插件配置项 Plugin Configuration](#插件配置项-plugin-configuration)
- [安全说明 Security](#安全说明-security)
- [成本说明 Cost](#成本说明-cost)
- [浏览器端图片粘贴（可选）Browser Paste & Drop (Optional)](#浏览器端图片粘贴可选browser-paste--drop-optional)
- [开发构建 Development](#开发构建-development)
- [兼容性 Compatibility](#兼容性-compatibility)
- [已知限制 Limitations](#已知限制-limitations)
- [常见问题 FAQ](#常见问题-faq)
- [许可证 License](#许可证-license)

---

## 简介 Introduction

DeepSeek 等主流文本模型不支持图片输入。本插件通过 **Gemini**（`gemini-3.6-flash`）与 **智谱 GLM**（`glm-4.6v-flash`，完全免费、国内直连）等外部视觉 API，把「看图」能力封装为 DSH 会话内可直接调用的工具，无需切换模型即可完成截图解读、文档 OCR、图表分析等任务。

本插件遵循 DSH 官方插件格式发布（`dsh.bundle.patch` + `cordis.patch.yml`），可作为 npm 包安装，或以 overlay patch 挂载。**任何 API Key 都不会进入代码或仓库。**

## 功能特性 Features

| 特性 | 说明 |
|---|---|
| 🖼️ `see_image` 工具 | 分析本地图片（png / jpg / jpeg / webp / gif，≤ 20MB），支持自定义提问 |
| 🔀 双提供商 | Gemini 与 GLM 双通道，`auto` 模式自动选择可用 Key 的提供商 |
| ⚡ 粘性路由 | 自动记住上次成功的提供商，减少无效请求等待 |
| 🔄 故障转移 | 网络失败或限流时自动切换至另一提供商 |
| ⏱️ 限流重试 | 429 / 访问量过大自动退避重试（默认 3 次） |
| 🗜️ 大图压缩 | 超过 4MB 的图片自动压缩至 1920px（JPEG 质量 85）后上传 |
| 🔑 `vision_set_key` | 会话内保存 API Key（写入 DSH 凭据库，立即生效） |
| 📊 `vision_status` | 查看各提供商 Key 配置状态（不泄露 Key 本身） |
| 📋 粘贴/拖入图片（内置） | 浏览器端 Ctrl+V / 拖入 / 🖼️ 按钮 → 原生风格附件卡片，随包集成、重启不丢 |

## 安装 Installation

### 前置要求 Prerequisites

- Node.js ≥ 20
- DeepSeek Harness (DSH) 已部署
- 至少一个视觉 API Key（Gemini 或智谱 GLM，均可免费申请）

### 方式一：overlay patch（临时试用）

```bash
npm i -D dsh-plugin-vision
dsh web --patch node_modules/dsh-plugin-vision/cordis.patch.yml
```

### 方式二：合并进 profile（持久安装）

将以下内容合并进你的 profile `cordis.patch.yml`：

```yaml
- insert:
    - id: dsh-plugin-vision
      name: 'dsh-plugin-vision'
```

如需自定义配置，可附加 `config`（字段见 [插件配置项](#插件配置项-plugin-configuration)）：

```yaml
- insert:
    - id: dsh-plugin-vision
      name: 'dsh-plugin-vision'
      config:
        provider: auto        # auto | gemini | glm
        glmModel: glm-4.6v-flash
```

### 验证安装 Verify

重启 DSH 会话后，输入「查看我的视觉工具配置」或直接询问模型图片路径，模型应能调用 `see_image`。

## API Key 配置 API Key Configuration

插件**不内置、不提交任何 Key**。按以下任意一种方式提供即可（优先级从高到低）：

### 方式 1：环境变量

```bash
export GEMINI_API_KEY=your_key        # Gemini（国内访问需代理）
export ZHIPU_API_KEY=your_key         # 智谱 GLM（直连，国内推荐）
```

### 方式 2：DSH 凭据库（持久）

编辑 `~/.dsh/.credentials.yaml`：

```yaml
GEMINI_API_KEY: your_key
ZHIPU_API_KEY: your_key
```

### 方式 3：会话内工具（立即生效，无需重启）

在对话中直接说：

```
帮我保存 Gemini 的 Key：AIza...
```

模型将调用 `vision_set_key` 完成写入。

### Key 申请

- **Gemini**：[Google AI Studio](https://aistudio.google.com/apikey)（免费额度）
- **智谱 GLM**：[open.bigmodel.cn](https://open.bigmodel.cn/)（`glm-4.6v-flash` 完全免费）

## 使用方法 Usage

在对话中自然描述需求即可，模型会自动调用视觉工具：

```
帮我看看这张图 D:\work\screenshot.png
这张订单截图里商品是什么？多少钱？
用 GLM 分析 code/my/logo.png，描述一下配色
```

显式指定提供商 / 模型：

```
用 gemini-3.6-flash 看 baojia/data/purchased_items/xxx.jpg，做 OCR
```

## 工具参考 Tool Reference

### `see_image`

分析本地图片并返回视觉模型的理解结果。

| 参数 | 类型 | 必填 | 说明 |
|---|---|---|---|
| `image_path` | string | ✅ | 图片路径（绝对路径或相对当前工作区） |
| `question` | string | — | 针对图片的问题；省略时默认要求详细描述 |
| `provider` | string | — | `auto` / `gemini` / `glm`，默认 `auto` |
| `model` | string | — | 覆盖默认模型名 |

### `vision_set_key`

保存提供商 API Key 至 DSH 凭据库（`~/.dsh/.credentials.yaml`）。

| 参数 | 类型 | 必填 | 说明 |
|---|---|---|---|
| `provider` | string | ✅ | `gemini` 或 `glm` |
| `api_key` | string | ✅ | API Key 值（非空） |

### `vision_status`

查询各提供商 Key 配置状态（仅报告是否已配置、来源与可写性，不回显 Key 内容）。

## 插件配置项 Plugin Configuration

| 字段 | 默认值 | 说明 |
|---|---|---|
| `provider` | `auto` | 默认提供商：`auto` / `gemini` / `glm` |
| `geminiModel` | `gemini-3.6-flash` | Gemini 默认模型 |
| `glmModel` | `glm-4.6v-flash` | GLM 默认模型（免费） |
| `geminiKeyEnv` | `GEMINI_API_KEY` | Gemini Key 的凭据引用名 |
| `glmKeyEnv` | `ZHIPU_API_KEY` | GLM Key 的凭据引用名 |
| `maxAttempts` | `3` | 限流重试次数（1-6） |
| `maxImageBytes` | `20971520` | 图片读取上限（字节） |
| `downscaleThreshold` | `4194304` | 超过该字节数触发压缩；`0` 关闭 |
| `maxDimension` | `1920` | 压缩后最长边（像素） |
| `jpegQuality` | `85` | 压缩质量（0-100） |

## 安全说明 Security

- 仓库中**不含任何 API Key**；Key 仅存在于你的环境变量或 `~/.dsh/.credentials.yaml`。
- `.gitignore` 已排除 `.env`、`*.credentials.yaml`、`.dsh-vision/` 等敏感与临时路径。
- `vision_status` 只报告配置状态，永不回显 Key。
- 调用凭证经 DSH 凭据服务按次解析，支持热更新，无需重启。
- 请求临时文件（含认证头的 curl 配置、请求/响应体）在每次调用后自动清理，不残留磁盘。

## 成本说明 Cost

- 视觉调用使用 **Gemini / GLM 免费额度**，通常为 0 元。
- 本插件自身的 DeepSeek token 开销：单次图像分析往返约数千 tokens，日常使用成本可忽略；具体计费见 DeepSeek 官方定价。

## 浏览器端图片粘贴与拖入（内置）Browser Paste & Drop (Built-in)

从 **v0.2.0** 起，粘贴能力**随包集成**（Host 半区注册 `/vision/save-image` HTTP 路由，Client 半区以标准 client bundle 加载），与视觉工具同装同删、**重启不丢**，不再需要单独的动态插件。

- 在聊天页 **Ctrl+V 粘贴 / 拖入 / 点击 🖼️ 按钮** 添加图片（可多张）；
- 图片经 `POST /vision/save-image` 保存至工作区 `.dsh-vision/uploads/`，输入框上方展示原生风格**附件卡片**（缩略图、可移除、可继续添加）；
- **不自动发送**：输入问题后按 Enter 发送，模型自动调用 `see_image` 看图；
- 发送成功后附件卡片自动清除。

> 说明：浏览器→宿主通道由插件自有的 HTTP 路由实现（`ctx.webServer.register`），不依赖平台级 api-proxy 白名单，因此可以随 npm 包分发。

## 开发构建 Development

```bash
git clone https://github.com/tdf1995/dsh-plugin-vision
cd dsh-plugin-vision
npm install            # 安装 peer dependencies
npm run check          # 语法检查 lib/index.js
npm test               # 加载期回归测试
npm pack               # 本地打包验证
```

本插件为纯 JavaScript（ESM），无构建步骤，fork 即可修改。

## 兼容性 Compatibility

| 环境 | 支持 | 备注 |
|---|---|---|
| Node.js | ≥ 20 | — |
| 平台 | Windows / POSIX | 大图压缩依赖 pwsh + System.Drawing，仅 Windows 生效；其他平台自动回退原图 |
| HTTP 客户端 | `curl` | Windows 自带 `curl.exe` |

## 已知限制 Limitations

- 粘贴/拖入仅对 Web UI（`dsh web`）生效；Host 侧工具在无 Web 界面（TUI 等）时也可用（此时无保存路由，浏览器功能自动缺席）。
- `/vision/save-image` 路由仅监听回环地址，文件名经过消毒、大小受限；仍建议仅在本机使用。
- GLM 免费层高峰时段偶发 429，插件自动重试，但极端繁忙时可能失败。
- Gemini 在国内网络需代理访问；GLM 直连即可。

## 常见问题 FAQ

**Q：为什么不把图片直接作为附件发送？**

A：DeepSeek 等文本模型不支持图片输入，DSH 的输入框会拦截图片附件。本插件采用「保存图片 → 路径入消息 → 工具读图」的桥接方案，是文本模型下最接近原生视觉模型体验的实现。

**Q：两个提供商都配了，会重复扣费吗？**

A：不会。`auto` 模式按顺序尝试（记住上次成功者），仅在失败时切换；不会并行请求两个提供商。

**Q：Key 存在哪里？安全吗？**

A：存于 `~/.dsh/.credentials.yaml`（权限 0600）或环境变量。仓库、会话日志均不落盘 Key。

## 许可证 License

[MIT](LICENSE) © 2026 dsh-plugin-vision contributors

## 生态 Ecosystem

- [awesome-deepseek-harness](https://github.com/0xsline/awesome-deepseek-harness) — DSH 插件精选列表
- [awesome-dsh-plugin](https://github.com/awesome-dsh-plugin/awesome-dsh-plugin)
- [vlln/plugin-registry](https://github.com/vlln/plugin-registry) — 社区插件基建与开发引导
