// Load-time regression test for dsh-plugin-vision v0.1.1
// Verifies the three reported bugs are fixed:
//  1. apply(ctx, config) — config comes from the second parameter
//  2. Config(config ?? {}) — schemastery fills defaults when config is absent
//  3. inject includes 'tools' — ctx.tools.register resolves
import { Context } from '@deepseek-ai/cordis';
import plugin from '../lib/index.js';

// 1) plugin shape
console.log('inject:', plugin.inject.join(','));
if (!plugin.inject.includes('tools')) throw new Error('BUG3: tools missing from inject');
if (plugin.apply.length < 2) throw new Error('BUG1: apply must accept (ctx, config)');

// 2) Config defaults via schemastery callable
const cfg = plugin.config({});
console.log('defaults:', JSON.stringify(cfg));
if (cfg.geminiModel !== 'gemini-3.6-flash') throw new Error('BUG2: geminiModel default missing');
if (cfg.glmModel !== 'glm-4.6v-flash') throw new Error('BUG2: glmModel default missing');

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
