/**
 * dsh-plugin-vision
 *
 * Vision for text-only LLMs (e.g. DeepSeek) inside DeepSeek Harness.
 *
 * Registers three model tools:
 *   - see_image       : analyze a local image via Gemini or GLM vision API
 *   - vision_set_key  : store a provider API key (DSH credentials seam)
 *   - vision_status   : report which provider keys are configured
 *
 * API keys are NEVER embedded in this package. They are resolved per call from
 * (in order):
 *   1. the DSH credentials seam (`ctx.credentials.resolve(envName)`) — which
 *      itself reads the process environment, `~/.dsh/.credentials.yaml`, and
 *      `.env` layers, and
 *   2. the plain process environment (`process.env[envName]`) when the seam is
 *      unavailable (standalone usage).
 *
 * No client half is shipped in this package: the browser paste-to-attach UI is
 * an optional companion (see dynamic/dsh-vision-paste.js in this repository).
 * The model-facing tool path below needs no browser involvement.
 */
import { defineTool } from '@deepseek-ai/dsh-tools';
import z from '@deepseek-ai/schemastery';

/** Runtime configuration schema (cordis.yml row config or settings). */
const Config = z.object({
  /** Default provider when the caller does not pass one: auto | gemini | glm. */
  provider: z.union(['auto', 'gemini', 'glm']).default('auto'),
  /** Default Gemini model id. */
  geminiModel: z.string().default('gemini-3.6-flash'),
  /** Default GLM (Zhipu) model id. */
  glmModel: z.string().default('glm-4.6v-flash'),
  /** Credential reference (env var name) for the Gemini API key. */
  geminiKeyEnv: z.string().default('GEMINI_API_KEY'),
  /** Credential reference (env var name) for the Zhipu API key. */
  glmKeyEnv: z.string().default('ZHIPU_API_KEY'),
  /** Rate-limit retry attempts per provider before failing over. */
  maxAttempts: z.number().default(3),
  /** Reject images larger than this many bytes (read bound). */
  maxImageBytes: z.number().default(20 * 1024 * 1024),
  /** Images larger than this are downscaled before upload. 0 disables. */
  downscaleThreshold: z.number().default(4 * 1024 * 1024),
  /** Longest edge after downscale. */
  maxDimension: z.number().default(1920),
  /** JPEG quality used when downscaling (0-100). */
  jpegQuality: z.number().default(85),
});

const PROVIDERS = {
  gemini: {
    label: 'Gemini',
    keyRef: 'GEMINI_API_KEY',
    authHeader: 'x-goog-api-key',
    authPrefix: '',
    noproxy: false,
    buildUrl: (model) =>
      'https://generativelanguage.googleapis.com/v1beta/models/' + encodeURIComponent(model) + ':generateContent',
    buildPayload: (b64, mime, question, model) =>
      JSON.stringify({
        contents: [{ parts: [{ text: question }, { inline_data: { mime_type: mime, data: b64 } }] }],
        generationConfig: { temperature: 0.3, maxOutputTokens: 4096 },
      }),
    extract: (data) => {
      const cand = data && data.candidates && data.candidates[0];
      const parts = cand && cand.content && cand.content.parts;
      if (Array.isArray(parts)) {
        const text = parts.map((p) => (p && p.text) || '').join('').trim();
        if (text) return text;
      }
      if (data && data.error && data.error.message) throw new Error('Gemini API 错误: ' + data.error.message);
      throw new Error('Gemini 返回了空结果');
    },
  },
  glm: {
    label: 'GLM',
    keyRef: 'ZHIPU_API_KEY',
    authHeader: 'Authorization',
    authPrefix: 'Bearer ',
    noproxy: true,
    buildUrl: () => 'https://open.bigmodel.cn/api/paas/v4/chat/completions',
    buildPayload: (b64, mime, question, model) =>
      JSON.stringify({
        model,
        messages: [{ role: 'user', content: [
          { type: 'image_url', image_url: { url: 'data:' + mime + ';base64,' + b64 } },
          { type: 'text', text: question },
        ] }],
        max_tokens: 4096,
      }),
    extract: (data) => {
      const choice = data && data.choices && data.choices[0];
      const text =
        choice && choice.message && typeof choice.message.content === 'string'
          ? choice.message.content.trim()
          : '';
      if (text) return text;
      if (data && data.error && data.error.message) throw new Error('GLM API 错误: ' + data.error.message);
      throw new Error('GLM 返回了空结果');
    },
  },
};

const MIME = { png: 'image/png', jpg: 'image/jpeg', jpeg: 'image/jpeg', webp: 'image/webp', gif: 'image/gif' };
const DEFAULT_QUESTION = '请详细描述这张图片的内容：主体、场景、背景、文字以及任何值得注意的细节。';
const B64_ALPHABET = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/';
const IS_WIN = typeof process !== 'undefined' && process.platform === 'win32';
const CURL_BIN = IS_WIN ? 'curl.exe' : 'curl';
const PWSH_BIN = IS_WIN ? 'pwsh.exe' : 'pwsh';

/** Byte-accurate base64 (never goes through UTF-8 text encoding). */
function bytesToBase64(bytes) {
  let out = '';
  const len = bytes.length;
  for (let i = 0; i < len; i += 3) {
    const b0 = bytes[i];
    const b1 = i + 1 < len ? bytes[i + 1] : 0;
    const b2 = i + 2 < len ? bytes[i + 2] : 0;
    out += B64_ALPHABET[b0 >> 2];
    out += B64_ALPHABET[((b0 & 3) << 4) | (b1 >> 4)];
    out += i + 1 < len ? B64_ALPHABET[((b1 & 15) << 2) | (b2 >> 6)] : '=';
    out += i + 2 < len ? B64_ALPHABET[b2 & 63] : '=';
  }
  return out;
}

/** Resolve the sandbox policy for the calling session, when available. */
function resolvePolicy(ctx) {
  const policy = ctx.get('sandboxPolicy');
  if (policy === undefined) return undefined;
  let session;
  const agents = ctx.get('agents');
  if (agents !== undefined) {
    try {
      const agent = agents.currentInitiator();
      if (agent && agent.session) session = agent.session;
    } catch (e) { session = undefined; }
  }
  try {
    return policy.resolve(session !== undefined ? { session } : {});
  } catch (e) {
    return undefined;
  }
}

/** Resolve an API key: DSH credentials seam first, plain env fallback. */
async function resolveKey(ctx, refName) {
  const credentials = ctx.get('credentials');
  if (credentials !== undefined) {
    try {
      const r = await credentials.resolve(refName);
      if (r && r.value) return r.value;
    } catch (e) { /* fall through */ }
  }
  const env = process && process.env ? process.env[refName] : undefined;
  return env || undefined;
}

function isRateLimited(message) {
  if (typeof message !== 'string') return false;
  return (
    message.indexOf('访问量过大') >= 0 || message.indexOf('1305') >= 0 || message.indexOf('429') >= 0 ||
    message.indexOf('rate') >= 0 || message.indexOf('Rate') >= 0 || message.indexOf('quota') >= 0 ||
    message.indexOf('Quota') >= 0
  );
}

function isNetworkError(message) {
  if (typeof message !== 'string') return false;
  return message.indexOf('网络请求失败') >= 0 || message.indexOf('请求执行失败') >= 0;
}

/** Fallbackable: rate-limited, network failure, or any HTTP >= 429 (incl. 5xx). */
function isFallbackable(message, statusCode) {
  return (
    isRateLimited(message) || isNetworkError(message) ||
    (typeof statusCode === 'number' && statusCode >= 429)
  );
}

/** Run curl directly through the subprocess seam (no shell startup). */
async function runCurl(subprocess, cfgPath, workspaceRoot, signal) {
  const handle = subprocess.spawn({
    argv: [CURL_BIN, '--config', cfgPath],
    cwd: workspaceRoot || process.cwd(),
    stdio: { stdin: 'ignore', stdout: { maxBytes: 8192 }, stderr: { maxBytes: 8192 } },
    graceMs: 5000,
    signal,
  });
  const outcome = await handle.done;
  const outText = handle.collected.stdout ? handle.collected.stdout.readFrom(0).text : '';
  const errText = handle.collected.stderr ? handle.collected.stderr.readFrom(0).text : '';
  return { exitCode: outcome.exitCode, outText, errText };
}

/** Downscale large images to JPEG via pwsh + System.Drawing (best effort). */
async function maybeDownscale(ctx, target, ext, workspaceRoot, cfg, signal) {
  const fs = ctx.fs;
  const subprocess = ctx.get('subprocess');
  if (subprocess === undefined) return { useTarget: target, ext };
  try {
    const info = await fs.stat(target, signal);
    const size = info && typeof info.size === 'number' ? info.size : 0;
    if (size <= cfg.downscaleThreshold) return { useTarget: target, ext };
    const srcPath = fs.processPath(target);
    const dir = (workspaceRoot || process.cwd()) + '/.dsh-vision';
    const outPath = dir + '/resized.jpg';
    const quality = Math.max(1, Math.min(100, cfg.jpegQuality));
    const maxDim = Math.max(16, cfg.maxDimension);
    const script = [
      'Add-Type -AssemblyName System.Drawing',
      '$ErrorActionPreference = "Stop"',
      'New-Item -ItemType Directory -Force -Path (Split-Path $env:VOUT -Parent) | Out-Null',
      '$img = [System.Drawing.Image]::FromFile($env:VSRC)',
      '$w = $img.Width; $h = $img.Height',
      `$max = ${maxDim}`,
      'if ($w -le $max -and $h -le $max) { $img.Dispose(); exit 0 }',
      '$scale = $max / [Math]::Max($w, $h)',
      '$nw = [int][Math]::Round($w * $scale)',
      '$nh = [int][Math]::Round($h * $scale)',
      '$bmp = New-Object System.Drawing.Bitmap($nw, $nh)',
      '$g = [System.Drawing.Graphics]::FromImage($bmp)',
      '$g.InterpolationMode = [System.Drawing.Drawing2D.InterpolationMode]::HighQualityBicubic',
      '$g.DrawImage($img, 0, 0, $nw, $nh)',
      '$enc = [System.Drawing.Imaging.ImageCodecInfo]::GetImageEncoders() | Where-Object { $_.MimeType -eq "image/jpeg" } | Select-Object -First 1',
      '$ep = New-Object System.Drawing.Imaging.EncoderParameters(1)',
      `$ep.Param[0] = New-Object System.Drawing.Imaging.EncoderParameter([System.Drawing.Imaging.Encoder]::Quality, [long]${quality})`,
      '$bmp.Save($env:VOUT, $enc, $ep)',
      '$g.Dispose(); $bmp.Dispose(); $img.Dispose()',
    ].join('; ');
    const handle = subprocess.spawn({
      argv: [PWSH_BIN, '-NoProfile', '-NonInteractive', '-Command', script],
      cwd: workspaceRoot || process.cwd(),
      stdio: { stdin: 'ignore', stdout: { maxBytes: 4096 }, stderr: { maxBytes: 8192 } },
      graceMs: 10000,
      signal,
      env: { VSRC: srcPath, VOUT: outPath },
    });
    const outcome = await handle.done;
    if (outcome.exitCode !== 0) return { useTarget: target, ext };
    const resizedTarget = await fs.resolve(outPath, { signal });
    const st = await fs.stat(resizedTarget, signal);
    if (st && typeof st.size === 'number' && st.size > 0) return { useTarget: resizedTarget, ext: 'jpg' };
  } catch (e) { /* fall back to the original */ }
  return { useTarget: target, ext };
}

export default {
  inject: ['fs', 'shell', 'timer', 'subprocess', 'tools'],
  config: Config,
  apply(ctx, config) {
    const fs = ctx.fs;
    const subprocess = ctx.subprocess;
    const cfg = Config(config ?? {});

    // Provider remembered as the last successful auto-mode choice (speed).
    let lastGoodProvider = null;

    /** Credential reference (env var name) for one provider, from plugin config. */
    function keyEnvFor(name) {
      return name === 'gemini' ? cfg.geminiKeyEnv : cfg.glmKeyEnv;
    }

    /** Fire-and-forget deletion of request temp files (key-bearing cfg, payload, resp). */
    function cleanupFiles(paths) {
      for (const p of paths) {
        try {
          const argv = IS_WIN ? ['cmd.exe', '/d', '/c', 'del', '/q', p] : ['rm', '-f', p];
          const h = subprocess.spawn({
            argv,
            cwd: process.cwd(),
            stdio: { stdin: 'ignore', stdout: { maxBytes: 1024 }, stderr: { maxBytes: 1024 } },
            graceMs: 3000,
          });
          h.done.catch(() => {});
        } catch (e) { /* best effort */ }
      }
    }

    async function runVision(args, exec) {
      const imagePath = String(args.image_path || '').trim();
      if (!imagePath) throw new Error('缺少必需参数 image_path');
      const question = String(args.question || '').trim() || DEFAULT_QUESTION;
      const requested = args.provider === 'glm' || args.provider === 'gemini' ? args.provider : 'auto';
      const provider = requested === 'auto' ? (cfg.provider === 'glm' || cfg.provider === 'gemini' ? cfg.provider : 'auto') : requested;

      const policy = resolvePolicy(ctx);
      const workspaceRoot = policy && policy.workspaceRoot ? policy.workspaceRoot : undefined;

      let target;
      try {
        target = await fs.resolve(imagePath, { cwd: workspaceRoot, signal: exec.signal });
      } catch (e) {
        throw new Error('无法解析图片路径: ' + e.message);
      }
      const info0 = await fs.stat(target, exec.signal);
      if (!info0) throw new Error('图片文件不存在: ' + imagePath);
      let ext = imagePath.includes('.') ? imagePath.slice(imagePath.lastIndexOf('.') + 1).toLowerCase() : '';
      if (!MIME[ext]) throw new Error('不支持的图片格式: ' + (ext || '未知') + '（支持 png / jpg / jpeg / webp / gif）');

      const down = await maybeDownscale(ctx, target, ext, workspaceRoot, cfg, exec.signal);
      const mime = MIME[down.ext];
      let bytes;
      try {
        bytes = await fs.readBytes(down.useTarget, exec.signal, cfg.maxImageBytes);
      } catch (e) {
        throw new Error('读取图片失败: ' + e.message);
      }
      if (!bytes || bytes.length === 0) throw new Error('图片文件为空: ' + imagePath);
      const b64 = bytesToBase64(bytes);

      const candidates = [];
      if (provider !== 'auto') {
        const p = PROVIDERS[provider];
        const key = await resolveKey(ctx, keyEnvFor(provider));
        if (key) candidates.push({ def: p, key, name: provider });
      } else {
        let names = ['gemini', 'glm'];
        if (lastGoodProvider === 'glm') names = ['glm', 'gemini'];
        for (const name of names) {
          const p = PROVIDERS[name];
          const key = await resolveKey(ctx, keyEnvFor(name));
          if (key) candidates.push({ def: p, key, name });
        }
      }
      if (candidates.length === 0) {
        throw new Error(
          '未找到可用的视觉 API Key：设置环境变量 ' + cfg.geminiKeyEnv + '（Gemini）或 ' + cfg.glmKeyEnv +
          '（GLM），或写入 ~/.dsh/.credentials.yaml（也可用 vision_set_key 工具保存）'
        );
      }

      const dir = workspaceRoot ? workspaceRoot + '/.dsh-vision' : '.dsh-vision';
      const modelOverride = String(args.model || '').trim();
      const fallbackNotes = [];
      let lastError = null;

      for (let ci = 0; ci < candidates.length; ci += 1) {
        const chosen = candidates[ci].def;
        const key = candidates[ci].key;
        const name = candidates[ci].name;
        const model = modelOverride || (name === 'gemini' ? cfg.geminiModel : cfg.glmModel);
        const url = chosen.buildUrl(model);
        const payloadPath = dir + '/payload-' + chosen.keyRef + '.json';
        const respPath = dir + '/resp-' + chosen.keyRef + '.json';
        const cfgPath = dir + '/curl-' + chosen.keyRef + '.cfg';
        const payload = chosen.buildPayload(b64, mime, question, model);

        try {
          await fs.writeText(await fs.resolve(payloadPath, { signal: exec.signal }), payload, undefined, exec.signal, policy);
        } catch (e) {
          lastError = new Error('无法写入请求负载: ' + e.message);
          break;
        }
        const cfgLines = [
          'silent',
          'show-error',
          'max-time "90"',
          'request "POST"',
          'header "Content-Type: application/json"',
          'header "' + chosen.authHeader + ': ' + chosen.authPrefix + key + '"',
          'data-binary "@' + payloadPath + '"',
          'output "' + respPath + '"',
          'write-out "STATUS=%{http_code}"',
        ];
        if (chosen.noproxy) cfgLines.push('noproxy "*"');
        cfgLines.push('url "' + url + '"');
        try {
          await fs.writeText(await fs.resolve(cfgPath, { signal: exec.signal }), cfgLines.join('\n'), undefined, exec.signal, policy);
        } catch (e) {
          lastError = new Error('无法写入请求配置: ' + e.message);
          break;
        }

        let attemptError = null;
        let lastStatusCode = null;
        const maxAttempts = Math.max(1, Math.min(6, cfg.maxAttempts));
        for (let attempt = 0; attempt < maxAttempts; attempt += 1) {
          let run;
          try {
            run = await runCurl(subprocess, cfgPath, workspaceRoot, exec.signal);
          } catch (e) {
            attemptError = new Error('请求执行失败: ' + e.message);
            break;
          }
          const statusMatch = /STATUS=(\d+)/.exec(run.outText);
          const statusCode = statusMatch ? parseInt(statusMatch[1], 10) : null;
          lastStatusCode = statusCode;
          if (run.exitCode !== 0 && (statusCode === null || statusCode === 0)) {
            attemptError = new Error('网络请求失败 [exit=' + run.exitCode + ']: ' + (run.errText || run.outText || '未知错误'));
            break;
          }
          let data = null;
          try {
            const raw = await fs.readText(await fs.resolve(respPath, { signal: exec.signal }), exec.signal);
            data = JSON.parse(raw);
          } catch (e) {
            attemptError = new Error('无法解析 API 响应 (HTTP ' + (statusCode === null ? '?' : statusCode) + '): ' + e.message);
            break;
          }
          try {
            const text = chosen.extract(data);
            lastGoodProvider = name;
            let content = text;
            if (fallbackNotes.length > 0) content = '[' + fallbackNotes.join(' → ') + ' 失败，已自动切换]\n\n' + text;
            const out = { content, provider: chosen.label, model };
            if (statusCode !== null) out.statusCode = statusCode;
            cleanupFiles([cfgPath, payloadPath, respPath]);
            return out;
          } catch (e) {
            attemptError = e;
            const retryable = isRateLimited(e.message) || statusCode === 429 || (statusCode !== null && statusCode >= 500);
            if (retryable && attempt < maxAttempts - 1) {
              await ctx.timeout(3000 * (attempt + 1));
              continue;
            }
            break;
          }
        }
        cleanupFiles([cfgPath, payloadPath, respPath]);
        lastError = attemptError || new Error(chosen.label + ' 请求失败');
        if (ci < candidates.length - 1 && isFallbackable(lastError.message, lastStatusCode)) {
          fallbackNotes.push(chosen.label);
          continue;
        }
        throw lastError;
      }
      throw lastError || new Error('视觉请求失败');
    }

    const seeImageTool = defineTool({
      name: 'see_image',
      description:
        '让 AI 通过外部视觉模型（Gemini 或 GLM）分析一张本地图片并回答问题。' +
        'DeepSeek 自身不支持图片输入，需要理解图片内容时请调用本工具。',
      parameters: {
        image_path: {
          type: 'string',
          required: true,
          description: '图片文件路径（绝对路径或相对当前工作区的路径），支持 png / jpg / jpeg / webp / gif',
        },
        question: { type: 'string', description: '针对图片的具体问题或分析要求；省略时默认详细描述图片内容' },
        provider: {
          type: 'string',
          enum: ['auto', 'gemini', 'glm'],
          description: '视觉模型提供商；auto 表示自动选择已配置 API Key 的提供商（记住上次成功者），失败自动切换',
        },
        model: { type: 'string', description: '覆盖默认模型名（Gemini 默认 ' + cfg.geminiModel + '，GLM 默认 ' + cfg.glmModel + '）' },
      },
      output: {
        schema: {
          type: 'object',
          additionalProperties: false,
          properties: {
            content: { type: 'string', required: true },
            provider: { type: 'string', required: true },
            model: { type: 'string', required: true },
            statusCode: { type: 'integer' },
          },
        },
        render: (_args, value) => [{ type: 'text', text: value.content }],
      },
      timeoutMs: 120000,
      execute: runVision,
    });

    const setKeyTool = defineTool({
      name: 'vision_set_key',
      description: '保存 Gemini 或 GLM 的 API Key（优先写入 DSH 凭据库 ~/.dsh/.credentials.yaml，立即生效；凭据服务不可用时提示设置环境变量）。',
      parameters: {
        provider: {
          type: 'string',
          enum: ['gemini', 'glm'],
          required: true,
          description: '哪个提供商的 Key：gemini 用 ' + cfg.geminiKeyEnv + '，glm 用 ' + cfg.glmKeyEnv,
        },
        api_key: { type: 'string', required: true, description: 'API Key 值（非空）' },
      },
      output: {
        schema: {
          type: 'object',
          additionalProperties: false,
          properties: { content: { type: 'string', required: true } },
        },
        render: (_args, value) => [{ type: 'text', text: value.content }],
      },
      async execute(args) {
        const p = PROVIDERS[args.provider];
        if (!p) throw new Error('未知提供商: ' + args.provider);
        const value = String(args.api_key || '').trim();
        if (!value) throw new Error('api_key 不能为空');
        const ref = keyEnvFor(args.provider);
        const credentials = ctx.get('credentials');
        if (credentials === undefined) {
          return {
            content:
              '凭据服务不可用（credentials 未挂载）。请把 ' + ref + ' 写入环境变量（或 ~/.dsh/.credentials.yaml）后重启 DSH。',
          };
        }
        await credentials.set(ref, value);
        return { content: '已保存 ' + p.label + ' API Key（引用 ' + ref + '），下一次 see_image 调用立即生效。' };
      },
    });

    const statusTool = defineTool({
      name: 'vision_status',
      description: '查看 Gemini / GLM 视觉 API Key 的配置状态（只显示是否已配置、来源和可写性，不显示 Key 本身）。',
      parameters: {},
      output: {
        schema: {
          type: 'object',
          additionalProperties: false,
          properties: { content: { type: 'string', required: true } },
        },
        render: (_args, value) => [{ type: 'text', text: value.content }],
      },
      async execute() {
        const lines = [];
        for (const name of ['gemini', 'glm']) {
          const p = PROVIDERS[name];
          const ref = keyEnvFor(name);
          const env = process && process.env ? process.env[ref] : undefined;
          const credentials = ctx.get('credentials');
          if (credentials !== undefined) {
            try {
              const info = await credentials.describe(ref);
              if (info && info.configured) {
                lines.push(p.label + ' (' + ref + '): 已配置，来源 ' + (info.source || '?') + (info.writable ? '，可写入' : ''));
                continue;
              }
            } catch (e) { /* fall through */ }
          }
          lines.push(p.label + ' (' + ref + '): ' + (env ? '已配置（环境变量）' : '未配置'));
        }
        return { content: lines.join('\n') };
      },
    });

    const register = (tool) => ctx.tools.register(tool);
    ctx.effect(() => register(seeImageTool), 'dsh-plugin-vision: see_image');
    ctx.effect(() => register(setKeyTool), 'dsh-plugin-vision: vision_set_key');
    ctx.effect(() => register(statusTool), 'dsh-plugin-vision: vision_status');
  },
};
