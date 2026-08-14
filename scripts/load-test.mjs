// Load-time regression test for dsh-plugin-vision v0.1.1
// Verifies the three reported bugs are fixed:
//  1. apply(ctx, config) — config comes from the second parameter
//  2. Config(config ?? {}) — schemastery fills defaults when config is absent
//  3. inject includes 'tools' — ctx.tools.register resolves
import { Context } from '@deepseek-ai/cordis';
import plugin, { isAsciiPath, tempDir } from '../lib/index.js';

// 1) plugin shape
console.log('inject:', plugin.inject.join(','));
if (!plugin.inject.includes('tools')) throw new Error('BUG3: tools missing from inject');
if (plugin.apply.length < 2) throw new Error('BUG1: apply must accept (ctx, config)');

// 2) Config defaults via schemastery callable
const cfg = plugin.config({});
console.log('defaults:', JSON.stringify(cfg));
if (cfg.geminiModel !== 'gemini-3.6-flash') throw new Error('BUG2: geminiModel default missing');
if (cfg.glmModel !== 'glm-4.6v-flash') throw new Error('BUG2: glmModel default missing');
// 2b) custom credential refs are honored
const cfgCustom = plugin.config({ geminiKeyEnv: 'MY_GEMINI', glmKeyEnv: 'MY_ZHIPU' });
if (cfgCustom.geminiKeyEnv !== 'MY_GEMINI' || cfgCustom.glmKeyEnv !== 'MY_ZHIPU') {
  throw new Error('custom key env config not honored');
}
console.log('custom key envs OK: MY_GEMINI / MY_ZHIPU');

// 2c) tempDir: forward slashes + ASCII fallback (curl config escape & codepage fixes)
const t1 = tempDir('D:\\文档操作');
if (t1.dir.includes('\\') || !t1.isTmp) throw new Error('BUG: Chinese workspace must use ASCII tmpdir with forward slashes');
const t2 = tempDir('D:\\work');
if (t2.dir !== 'D:/work/.dsh-vision' || t2.isTmp) throw new Error('BUG: ASCII workspace must stay in workspace with forward slashes');
if (!isAsciiPath('D:/work') || isAsciiPath('D:\\文档操作')) throw new Error('BUG: isAsciiPath misbehaves');
console.log('tempDir OK:', t2.dir, '| tmp:', t1.dir.slice(t1.dir.lastIndexOf('/') + 1));

// 3) real mount on a minimal cordis context with stub services
const ctx = new Context();
ctx.provide('fs', {});
ctx.provide('shell', {});
ctx.provide('timer', {});
ctx.provide('subprocess', {});
const registered = [];
ctx.provide('tools', { register: (tool) => { registered.push(tool.name); return () => {}; } });

let thrown = null;
try {
  plugin.apply(ctx, undefined); // simulate "no config provided"
} catch (e) {
  thrown = e;
}
if (thrown) {
  console.error('MOUNT FAILED:', thrown.message);
  process.exit(1);
}
console.log('mount OK, tools registered at load:', registered.join(', '));
console.log('ALL CHECKS PASSED');
