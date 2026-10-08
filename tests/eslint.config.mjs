// The lab's static check for real bugs (not style): names that do not exist, code that cannot run, values computed and never
// used, conditions that are always the same. CI runs it (.github/workflows/verify.yml):
//   npx --yes eslint@9 -c tests/eslint.config.mjs .
// No dependency of the lab: ESLint is fetched by npx there. Generated or assembled code is left out: the samples' built
// bp/scripts, TS REPL's bundles, sandbox-be's VM fragments (one script assembled from many files), vendored code, data.
const node = Object.fromEntries(['process', 'Buffer', 'console', 'setTimeout', 'clearTimeout', 'setInterval', 'clearInterval', 'setImmediate', 'clearImmediate',
  'URL', 'URLSearchParams', 'TextEncoder', 'TextDecoder', 'fetch', 'Response', 'Request', 'Headers', 'AbortController', 'AbortSignal', 'structuredClone',
  'queueMicrotask', 'performance', '__dirname', '__filename', 'require', 'module', 'exports', 'crypto', 'WebAssembly', 'atob', 'btoa', 'Blob', 'FormData',
  'EventTarget', 'Event', 'MessageChannel', 'BroadcastChannel', 'WebSocket', 'DOMException', 'navigator', 'ReadableStream', 'WritableStream', 'TransformStream',
  'CompressionStream', 'DecompressionStream', 'File'].map((k) => [k, 'readonly']));
const browser = Object.fromEntries(['window', 'document', 'location', 'localStorage', 'sessionStorage', 'history', 'getComputedStyle', 'requestAnimationFrame',
  'HTMLElement', 'Image', 'EventSource', 'alert', 'confirm', 'prompt', 'innerWidth', 'innerHeight', 'devicePixelRatio', 'matchMedia', 'IntersectionObserver',
  'ResizeObserver', 'MutationObserver', 'Node', 'CustomEvent', 'KeyboardEvent', 'MouseEvent', 'DOMParser', 'XMLHttpRequest', 'FileReader', 'ImageData', 'OffscreenCanvas'].map((k) => [k, 'readonly']));
const rules = {
  'no-undef': 'error', 'no-unreachable': 'error', 'no-dupe-keys': 'error', 'no-dupe-else-if': 'error', 'no-duplicate-case': 'error', 'no-self-assign': 'error',
  'no-self-compare': 'error', 'no-unsafe-finally': 'error', 'no-unsafe-negation': 'error', 'no-cond-assign': ['error', 'except-parens'],
  'no-constant-condition': ['error', { checkLoops: false }], 'no-import-assign': 'error', 'no-obj-calls': 'error', 'use-isnan': 'error', 'valid-typeof': 'error',
  'no-redeclare': 'error', 'no-shadow-restricted-names': 'error', 'no-compare-neg-zero': 'error', 'getter-return': 'error', 'no-setter-return': 'error',
  'no-async-promise-executor': 'error', 'no-loss-of-precision': 'error', 'no-unused-private-class-members': 'error', 'no-useless-backreference': 'error',
  'no-empty-character-class': 'error', 'no-invalid-regexp': 'error', 'no-fallthrough': 'error', 'no-global-assign': 'error', 'no-constant-binary-expression': 'error',
  'no-unreachable-loop': 'error', 'array-callback-return': ['error', { checkForEach: false }], 'no-dupe-class-members': 'error', 'no-const-assign': 'error',
  'no-this-before-super': 'error', 'no-class-assign': 'error', 'no-ex-assign': 'error', 'no-unsafe-optional-chaining': 'error',
  'no-unused-vars': ['error', { args: 'none', caughtErrors: 'none', ignoreRestSiblings: true, varsIgnorePattern: '^_' }],
};
export default [
  { ignores: ['**/node_modules/**', '**/.lab/**', '**/dist/**', '**/runs/**', 'training/**', 'bds/addons/**', 'end/plugins/**', 'll/mods/**', 'skills/probes/**', 'bds/docs/*/bp/**',
    'bds/bench/**/bp/**', 'bds/vendor/**', 'common/nethernet-connect/**', 'sandbox-be/src/vm/runtime/**', 'sandbox-be/src/vm/commands/**', '**/data/**', 'common/kit/kit.js'] },
  { files: ['**/*.mjs', '**/*.js'], languageOptions: { ecmaVersion: 2024, sourceType: 'module', globals: node }, rules },
  { files: ['**/*.cjs'], languageOptions: { ecmaVersion: 2024, sourceType: 'commonjs', globals: node }, rules },
  // run in a browser page (the lab's pages, the app lab's page scripts, bedrock-binary's report, the management panel and the
// page.evaluate callbacks of its browser test)
  { files: ['bedrock-binary/src/report/assets/**/*.js', 'common/nethernet-connect/web/**/*.js', 'app/lib/playwright-login.mjs', 'panel/**/*.js', 'panel/**/*.mjs', 'tests/panel-browser.mjs'], languageOptions: { globals: { ...node, ...browser } } },
  // run in the game: the in-world helper (common/helper.js: its form wrappers are spliced in by text, core.mjs EVAL_HELPER)
  { files: ['common/helper.js'], rules: { 'no-unused-vars': ['error', { args: 'none', caughtErrors: 'none', varsIgnorePattern: '^(_|wrapForm$)' }] } },
  // LegacyScriptEngine (the ll lab's helper): its own globals
  { files: ['ll/lib/*.js'], languageOptions: { sourceType: 'script', globals: { ...node, mc: 'readonly', logger: 'readonly', ll: 'readonly', PermType: 'readonly', ParamType: 'readonly', File: 'readonly', data: 'readonly', network: 'readonly', NBT: 'readonly', JsonConfigFile: 'readonly', KVDatabase: 'readonly', money: 'readonly', system: 'readonly', colorLog: 'readonly', log: 'readonly' } } },
];
