# dsh-plugin-vision 安装与排障指南

> Installation & troubleshooting notes for `dsh-plugin-vision`（含配套的浏览器端图片粘贴插件）。
> 本文档记录实际部署中遇到的问题与解决办法，供后续安装与排查参考。

---

## 1. 安装 Install

### 1.1 前置条件

- Node.js ≥ 20
- DSH Web 已运行（`dsh web`）
- 至少一个视觉 API Key（Gemini 或智谱 GLM，均可免费申请）

### 1.2 从 GitHub 安装（npm 尚未发布时）

> ⚠️ **注意**：`dsh-plugin-vision` 尚未发布到 npm registry。README 中的 `npm i dsh-plugin-vision` 在发布前不可用，请改用 GitHub 安装。

```bash
# 安装到 web profile（Git 包通过 pnpm 转发，支持 GitHub 地址）
dsh plugin --profile web add https://github.com/tdf1995/dsh-plugin-vision.git

# 或临时试用（overlay patch，不写 profile）
dsh web --patch <repo-path>/cordis.patch.yml
```

### 1.3 验证安装

```bash
dsh plugin --profile web list          # 应看到 dsh-plugin-vision
```

重启 `dsh web` 后，在会话中询问模型「查看视觉工具配置」，模型应能调用 `see_image` / `vision_status`。

---

## 2. 更新与重装 Upgrade

### 现象

GitHub 仓库更新了版本（如 0.1.0 → 0.1.1 → 0.1.2），但直接再次 `add` 同一个 URL 后，拉取的可能仍是旧版。

### 原因

pnpm 对同一 Git 依赖有缓存；未指定 commit/ref 时不会感知上游新提交。

### 解决

先移除再重新添加，强制重新下载：

```bash
dsh plugin --profile web remove dsh-plugin-vision
dsh plugin --profile web add https://github.com/tdf1995/dsh-plugin-vision.git
```

确认下载日志出现 `downloaded 1`，且 `node_modules/dsh-plugin-vision/package.json` 的 `version` 为新版本号。修改宿主侧代码后**必须重启 `dsh web` 才生效**。

---

## 3. 架构说明：为什么图片粘贴是独立插件

### 背景

`dsh-plugin-vision` npm 包只带 **Host 半区**（三个模型工具）。浏览器端「粘贴/拖入图片 → 附件卡片」的能力原本以**动态 Cordis 插件**形式提供（`dynamic/dsh-vision-paste.js`），原因：

- 外部包的浏览器 → 宿主 RPC 端点需要平台级 api-proxy 白名单，无法随 npm 包分发；
- 动态插件机制是会话级的：定义、授权、加载都在会话内完成，**DSH 重启后丢失**，且无法程序化挂载（当前会话无 `cordis_define` 工具、Typert 暴露的方法中也没有 define、侧栏 Cordis 面板只能管理已定义插件）。

### 解决：持久化静态插件 `dsh-vision-paste`

将粘贴功能改造成**独立的持久静态 npm 插件**，随 profile 一起安装、重启不丢：

- **Host 半区**：通过 `ctx.webServer.register` 提供 `POST /vision/save-image`，在 Node 侧直接解码 base64 并写文件（替代动态沙盒中的 fs+shell 链路）；
- **Client 半区**：把粘贴/拖入 UI 翻译为标准 client bundle，用 `fetch` 调用上述端点（替代动态插件的 `host.call`）。

安装与 vision 包相同（`dsh plugin --profile web add <repo>`），两个插件都持久生效。

---

## 4. 常见问题 FAQ

### Q1：`see_image` 报 `curl: option --config: error encountered when reading a file (exit 26)`

**现象**：Key 已正确保存（`vision_status` 显示已配置），`.dsh-vision/curl-*.cfg` 也写入成功，但 curl 报读文件失败。

**根因（两个叠加的 Windows curl 路径问题）**：

1. **中文路径**：Windows 的 `curl.exe` 无法打开**含非 ASCII（中文）字符的路径**（argv 按 ANSI 代码页传递导致路径解析失败）。当工作区路径含中文（如 `D:\文档操作`）时，插件写在 `工作区/.dsh-vision/` 下的 cfg/payload 文件 curl 打不开。
2. **反斜杠转义**：curl `--config` 文件解析会把**反斜杠当作转义字符**。Windows 路径（如 `D:\文档操作\.dsh-vision\payload.json`）里的 `\` 会被吞掉/转义，导致 `data-binary "@..."` / `output "..."` 指向错误路径。

**排查方法**：对照实验——把同一份 cfg 复制到纯 ASCII 路径执行 `curl --config` 返回 `STATUS=200`；或用正斜杠改写 cfg 中路径后成功，即可分别定位两个原因。

**解决**（v0.1.3 中文路径 + v0.1.4 反斜杠转义，均已内置）：

- **路径一律使用正斜杠**：`tempDir()` 返回值统一 `.replace(/\\/g, '/')`（curl 配置文件、请求体路径不再有反斜杠转义问题）；
- **ASCII 工作区** → 仍用 `工作区/.dsh-vision`（沙箱友好）；
- **工作区含非 ASCII** → 自动改用系统临时目录 `os.tmpdir()/dsh-vision-<随机后缀>`（每次调用独立目录，调用结束后连同文件一起清理）。

> 注意：改用系统临时目录时，请确保会话文件策略允许写入系统临时目录（如 `danger-full-access`），否则 fs 写入会被沙箱拒绝（报「无法写入请求负载」）。

### Q2：插件加载失败 `cannot get property "config" / "tools" without inject`

**原因**：v0.1.0 的三个加载期 bug——`ctx.config` 未声明注入（应为 `apply(ctx, config)` 第二参数）、无配置时直接读 `geminiModel` 崩溃（应 `Config(config ?? {})` 填充默认值）、`inject` 缺少 `'tools'`。

**解决**：升级到 **v0.1.1+**（仓库已修复，并附 `scripts/load-test.mjs` 加载期回归测试：`npm test`）。

### Q3：Key 怎么配置？

三种方式（优先级从高到低）：环境变量 → `~/.dsh/.credentials.yaml` → 会话内 `vision_set_key` 工具。详见主 README「API Key 配置」章节。

### Q4：改了代码/装了新插件为什么不生效？

所有宿主侧代码改动与新增插件 entry 都需要**重启 `dsh web`** 才生效（动态插件除外，但动态插件本身也会在重启后丢失）。版本升级后请先 `remove + add` 规避 pnpm 缓存，再重启。

---

## 5. 验收清单 Checklist

重启 `dsh web` 后逐项确认：

- [ ] `dsh plugin --profile web list` 显示 `dsh-plugin-vision`（及 `dsh-vision-paste`，如已安装）
- [ ] 会话中 `vision_status` 返回两个提供商的配置状态
- [ ] `see_image` 实测一张图片（工作区含中文路径时尤其要测，确认无 exit 26）
- [ ] 浏览器端粘贴一张图片，出现附件卡片，输入问题发送后模型正确回答
- [ ] `~/.dsh/.credentials.yaml` 中无多余残留、仓库中无任何 Key

---

## 6. 版本历史

| 版本 | 内容 |
|---|---|
| 0.1.0 | 初始发布（含加载期三 bug） |
| 0.1.1 | 修复 `apply(ctx, config)` / `Config(config ?? {})` / `inject 'tools'`；新增加载期回归测试 |
| 0.1.2 | 修复配置化 Key 引用未生效；平台自适应 curl/pwsh；429/5xx 重试与故障转移；临时文件清理 |
| 0.1.3 | 修复 Windows curl 无法读取中文路径：临时目录自动切换到系统临时目录（ASCII），调用后清理 |
| 0.1.4 | 修复 curl `--config` 反斜杠转义：所有 curl 相关路径统一正斜杠（`tempDir` 返回值 `.replace(/\\/g, '/')`） |
