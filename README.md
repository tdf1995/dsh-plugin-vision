# dsh-plugin-vision

> 让 DeepSeek Harness 里的纯文本大模型（DeepSeek 等）**看见图片**：通过 **Gemini** / **GLM** 免费视觉 API 描述图片、OCR、问答截图与图表。
>
> Vision for text-only LLMs inside DeepSeek Harness (DSH): describe images, OCR, VQA — powered by free Gemini / GLM vision APIs.

[![License: MIT](https://img.shields.io/badge/license-MIT-blue.svg)](LICENSE)

## 功能 Features

- **`see_image`** — 分析本地图片（png / jpg / jpeg / webp / gif，≤20MB），支持自定义提问、指定提供商与模型
- **双提供商**：Gemini（`gemini-3.6-flash`）与智谱 GLM（`glm-4.6v-flash`，完全免费、国内直连）
- **自动故障转移**：auto 模式记住上次成功的提供商（提速），网络失败 / 限流时自动切换到另一个
- **限流自动重试**：429 / “访问量过大” 自动退避重试（默认 3 次）
- **大图自动压缩**：超过 4MB 的图片先压缩到 1920px JPEG（质量 85）再上传，上传与推理更快
- **`vision_set_key` / `vision_status`** — 在会话内保存 / 查看 API Key（Key 永不写入仓库）
- **可选粘贴伴侣**：`dynamic/dsh-vision-paste.js` 提供浏览器端粘贴/拖入图片 → 附件卡片体验（详见下文）

## 快速开始 Quick start

### 1. 安装 Install

```bash
# 方式 A：把 npm 包装进 DSH 部署，然后以 overlay patch 挂载
npm i -D dsh-plugin-vision
dsh web --patch node_modules/dsh-plugin-vision/cordis.patch.yml

# 方式 B：持久化 —— 把 patch 合并进你的 profile cordis.patch.yml
```

或者把 `cordis.patch.yml` 里的行合并到你自己的 profile：

```yaml
- insert:
    - id: dsh-plugin-vision
      name: 'dsh-plugin-vision'
```

### 2. 配置 API Key（不放进仓库！）

插件**不内置、不提交任何 Key**。Key 按调用时解析，二选一即可：

```bash
# 方式 1：环境变量（推荐，临时）
export GEMINI_API_KEY=your_key        # Gemini（国内访问需要代理）
export ZHIPU_API_KEY=your_key         # 智谱 GLM（直连，国内推荐）
```

```yaml
# 方式 2：DSH 凭据库 ~/.dsh/.credentials.yaml（持久，界面可管理）
GEMINI_API_KEY: your_key
ZHIPU_API_KEY: your_key
```

```text
# 方式 3：会话内用工具保存（立即生效，无需重启）
> 帮我保存 Gemini 的 Key：AIza...          # 模型会调用 vision_set_key
```

> 🔑 **Key 申请（均免费）**
> - Gemini：[Google AI Studio](https://aistudio.google.com/apikey) 申请 `GEMINI_API_KEY`
> - 智谱：[open.bigmodel.cn](https://open.bigmodel.cn/) 申请 `ZHIPU_API_KEY`（`glm-4.6v-flash` 完全免费）

### 3. 使用 Usage

在对话中直接说：

```
帮我看看这张图 D:\work\screenshot.png
这张订单截图里商品是什么？多少钱？
用 GLM 分析 code/my/logo.png，描述配色
```

模型会自动调用 `see_image` 工具，并带上你的问题。也可显式指定提供商 / 模型：

```
用 gemini-3.6-flash 看 baojia/data/purchased_items/xxx.jpg，做 OCR
```

## 配置项 Configuration

| 字段 | 默认值 | 说明 |
|---|---|---|
| `provider` | `auto` | `auto` / `gemini` / `glm`，auto 记住上次成功者 |
| `geminiModel` | `gemini-3.6-flash` | Gemini 默认模型 |
| `glmModel` | `glm-4.6v-flash` | GLM 默认模型（免费） |
| `geminiKeyEnv` | `GEMINI_API_KEY` | Gemini Key 的凭据引用名 |
| `glmKeyEnv` | `ZHIPU_API_KEY` | GLM Key 的凭据引用名 |
| `maxAttempts` | `3` | 限流重试次数 |
| `maxImageBytes` | `20971520` | 图片读取上限（20MB） |
| `downscaleThreshold` | `4194304` | 大于该字节数时压缩；`0` 关闭 |
| `maxDimension` | `1920` | 压缩后最长边 |
| `jpegQuality` | `85` | 压缩质量（0-100） |

## 安全 Security

- 仓库中**没有任何 API Key**；Key 只存在于你的环境变量 / `~/.dsh/.credentials.yaml`。
- `.gitignore` 已排除 `.env`、`*.credentials.yaml`、`.dsh-vision/` 等敏感与临时路径。
- `vision_status` 只报告“是否已配置”，永不回显 Key。

## 成本 Cost

- 视觉调用走 **Gemini / GLM 免费额度**，通常为 0 元。
- 你侧 DeepSeek 的 token 消耗：一张图的工具往返约几千 tokens（含图片 base64 的请求体），正常使用每天成本通常低于 1 元；高峰时段单价见 DeepSeek 官网。

## 可选：粘贴 / 拖入图片（浏览器端）Optional: paste & drop

`dynamic/dsh-vision-paste.js` 是一个独立的**动态 Cordis 插件**伴侣，提供类似原生视觉模型的输入体验：

- 在聊天页 **Ctrl+V 粘贴 / 拖入 / 点 🖼️ 按钮**选择图片
- 图片保存到工作区 `.dsh-vision/uploads/`，输入框上方出现原生风格**附件卡片**（可移除、可继续添加）
- **不自动发送**：你输入问题后按 Enter，模型用 `see_image` 看图回答
- 发送后卡片自动消失

安装：在 DSH Web 的 Cordis 插件面板新建插件，把文件里的「HOST 半区」「CLIENT 半区」分别粘贴到对应代码框并运行（首次需批准，建议双勾）。

> 为什么需要两个部分：社区包（npm）只带 Host 半区，因为外部包的浏览器→宿主 RPC 端点需要平台级白名单，无法随包分发；粘贴伴侣用会话内动态插件机制补上这一环。动态插件随会话存在，重启后需重新加载。

## 开发 Development

```bash
git clone https://github.com/tdf1995/dsh-plugin-vision
cd dsh-plugin-vision
npm install            # 安装 peer deps
npm run check          # 语法检查 lib/index.js
npm pack               # 本地打包装验证
```

纯 JavaScript（ESM），无构建步骤，fork 即改。

## 兼容性 Compatibility

- Node.js >= 20
- DeepSeek Harness (DSH) 部署，Windows / POSIX 均可（大图压缩走 pwsh + System.Drawing，仅 Windows 生效，其他平台自动回退原图）
- 平台依赖：`curl.exe`（Windows 自带）或系统 `curl`

## 已知限制 Limitations

- 客户端粘贴伴侣随会话存在（重启需重载），与平台的正式 client-half 机制不同（见上）。
- GLM 免费层高峰偶发 429，插件会自动重试，但极端繁忙时可能失败。
- Gemini 在国内需要代理；GLM 直连即可。

## 许可证 License

[MIT](LICENSE) © 2026 dsh-plugin-vision contributors

## 生态 Ecosystem

- [awesome-deepseek-harness](https://github.com/0xsline/awesome-deepseek-harness) — DSH 插件精选列表
- [awesome-dsh-plugin](https://github.com/awesome-dsh-plugin/awesome-dsh-plugin)
- [vlln/plugin-registry](https://github.com/vlln/plugin-registry) — 社区插件基建与开发引导
