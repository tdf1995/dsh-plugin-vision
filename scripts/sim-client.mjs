// Simulate the browser module loader executing lib/client.js and assert that
// the factory RETURNS a valid plugin object ({ name, inject, apply }).
// Regression for: factory ending with only `module.exports = exports;` made the
// loader receive `undefined` -> "invalid plugin ... received undefined".
import { readFileSync } from 'node:fs';
import vm from 'node:vm';

const code = readFileSync(new URL('../lib/client.js', import.meta.url), 'utf8');

let captured = null;
const fakeReact = {
  createElement: () => ({}),
  useState: (v) => [v, () => {}],
  useEffect: () => {},
  useRef: () => ({ current: null }),
  Fragment: Symbol('Fragment'),
};

const sandbox = {
  window: {
    __ModuleLoader__: {
      load: (entry) => { captured = entry; },
    },
  },
};
sandbox.globalThis = sandbox;
vm.createContext(sandbox);
vm.runInContext(code, sandbox);

if (!captured) throw new Error('loader.load was not invoked');
if (typeof captured.factory !== 'function') throw new Error('factory missing');
const plugin = captured.factory((id) => {
  if (id === 'react') return fakeReact;
  throw new Error('unexpected require: ' + id);
});

if (!plugin || typeof plugin !== 'object') {
  throw new Error('factory returned ' + String(plugin) + ' — the loader needs the RETURNED exports');
}
if (plugin.name !== 'dsh-plugin-vision') throw new Error('name mismatch: ' + plugin.name);
if (!Array.isArray(plugin.inject)) throw new Error('inject missing');
if (typeof plugin.apply !== 'function') throw new Error('apply missing');
console.log('SIM OK: factory returned', plugin.name, '| inject:', plugin.inject.join(', '));
