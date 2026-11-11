import vitest from '@vitest/eslint-plugin';
import { createNodeResolver, importX } from 'eslint-plugin-import-x';
import { builtinModules } from 'node:module';
import tseslint from 'typescript-eslint';

// Import boundaries from structure.md, as text patterns on the import specifier.
const OTHER_PACKAGES = ['**/server/**', '**/web/**', '**/mcp/**', '**/test/**', '**/e2e/**'];
const NODE_BUILTINS = builtinModules.map((name) => ({
  name,
  message: 'The browser code cannot use Node modules.',
}));

/** server, web and mcp reach core only through src/core/index.js. */
const coreOnlyThroughIndex = {
  group: ['**/core/**', '!**/core/index.js'],
  message: 'Import core only through src/core/index.js.',
};

const noTestImports = {
  group: ['**/test/**', '**/e2e/**'],
  message: 'src/ never imports test/ or e2e/.',
};

// Describe-style calls whose modifiers disable or isolate tests (testing.md).
const TEST_MODIFIERS = '/^(skip|only|todo|fails|fixme|fail)$/';
const forbiddenTestModifier = (object) => ({
  selector: `MemberExpression[object.name=${object}][property.name=${TEST_MODIFIERS}]`,
  message: 'No .skip, .only, .todo, .fails or .fixme tests (testing.md).',
});

export default tseslint.config(
  {
    ignores: [
      'node_modules/',
      'dist/',
      'public/assets/',
      'recordings/',
      'coverage/',
      'test-results/',
      'playwright-report/',
      'docs/',
      '.kiro/',
    ],
  },

  ...tseslint.configs.recommended,

  {
    files: ['**/*.{ts,tsx,js,mjs}'],
    plugins: { 'import-x': importX },
    settings: {
      // Without this, import-x skips .ts/.tsx files and no-cycle silently checks nothing.
      'import-x/extensions': ['.ts', '.tsx', '.js', '.mjs'],
      'import-x/resolver-next': [
        createNodeResolver({
          extensions: ['.ts', '.tsx', '.js', '.mjs', '.json'],
          extensionAlias: { '.js': ['.ts', '.tsx', '.js'] },
        }),
      ],
    },
    rules: {
      'import-x/no-cycle': 'error',
      'import-x/no-default-export': 'error',
    },
  },

  // Tool configuration files must default-export: that is how the tools read them.
  {
    files: ['eslint.config.js', 'vitest.config.ts', 'playwright.config.ts'],
    rules: { 'import-x/no-default-export': 'off' },
  },

  // src/core: pure and isomorphic. Imports only zod and other core files.
  {
    files: ['src/core/**/*.ts'],
    rules: {
      'no-restricted-imports': [
        'error',
        {
          patterns: [
            {
              // Anything that is not a relative path and not exactly "zod".
              regex: '^(?!\\.{1,2}/|zod$)',
              message: 'src/core imports only zod and other files in src/core.',
            },
            {
              group: OTHER_PACKAGES,
              message: 'src/core imports only zod and other files in src/core.',
            },
          ],
        },
      ],
      'no-restricted-globals': [
        'error',
        ...['Date', 'performance', 'crypto', 'setTimeout', 'setInterval', 'process'].map(
          (name) => ({ name, message: `src/core is deterministic: ${name} is not allowed.` }),
        ),
      ],
      'no-restricted-syntax': [
        'error',
        {
          selector: 'MemberExpression[object.name="Math"][property.name="random"]',
          message: 'src/core is deterministic: Math.random is not allowed.',
        },
      ],
    },
  },

  // src/server: core through index only; never web or mcp.
  {
    files: ['src/server/**/*.ts'],
    rules: {
      'no-restricted-imports': [
        'error',
        {
          patterns: [
            coreOnlyThroughIndex,
            {
              group: ['**/web/**', '**/mcp/**'],
              message: 'src/server never imports src/web or src/mcp.',
            },
            noTestImports,
          ],
        },
      ],
    },
  },

  // src/web: core through index only; never server, mcp, Node, the SDK or hono.
  {
    files: ['src/web/**/*.{ts,tsx}'],
    rules: {
      'no-restricted-imports': [
        'error',
        {
          paths: NODE_BUILTINS,
          patterns: [
            coreOnlyThroughIndex,
            {
              group: ['**/server/**', '**/mcp/**'],
              message: 'src/web never imports src/server or src/mcp.',
            },
            { group: ['node:*'], message: 'The browser code cannot use Node modules.' },
            {
              group: ['@anthropic-ai/*', 'hono', 'hono/*', '@hono/*', '@modelcontextprotocol/*'],
              message: 'Server-side packages never reach the browser bundle.',
            },
            noTestImports,
          ],
        },
      ],
    },
  },

  // src/mcp: core through index only; neither server nor web; no network, no file writes, no
  // child processes, no model SDK, no environment (kitchen-mcp design, "Lint"; KM6.1).
  {
    files: ['src/mcp/**/*.ts'],
    rules: {
      'no-restricted-imports': [
        'error',
        {
          paths: [
            ...[
              'http',
              'https',
              'net',
              'tls',
              'dgram',
              'child_process',
              'worker_threads',
              'fs/promises',
            ].flatMap((name) => [
              { name: `node:${name}`, message: 'src/mcp does no network, process or file writes.' },
              { name, message: 'src/mcp does no network, process or file writes.' },
            ]),
            ...['@anthropic-ai/sdk', 'hono', '@hono/node-server'].map((name) => ({
              name,
              message: 'src/mcp calls no model and serves no HTTP.',
            })),
            ...['node:fs', 'fs'].map((name) => ({
              name,
              allowImportNames: ['readFileSync'],
              message: 'src/mcp only reads files: import readFileSync alone.',
            })),
          ],
          patterns: [
            coreOnlyThroughIndex,
            {
              // The MCP SDK's own `server/` folder is not src/server (exception added by hand:
              // the pattern also matched `@modelcontextprotocol/sdk/server/*.js`).
              group: ['**/server/**', '!@modelcontextprotocol/sdk/server/**', '**/web/**'],
              message: 'src/mcp imports neither src/server nor src/web.',
            },
            noTestImports,
          ],
        },
      ],
      'no-restricted-globals': [
        'error',
        { name: 'fetch', message: 'src/mcp opens no network connection.' },
        { name: 'WebSocket', message: 'src/mcp opens no network connection.' },
        { name: 'XMLHttpRequest', message: 'src/mcp opens no network connection.' },
      ],
      'no-restricted-properties': [
        'error',
        { object: 'process', property: 'env', message: 'src/mcp reads no environment.' },
        { object: 'process', property: 'stdout', message: 'stdout carries only MCP messages.' },
        { object: 'process', property: 'argv', message: 'src/mcp reads no arguments.' },
      ],
    },
  },

  // Vitest tests: nothing disabled, nothing focused.
  {
    files: ['test/**/*.ts'],
    plugins: { vitest },
    rules: {
      'vitest/no-disabled-tests': 'error',
      'vitest/no-focused-tests': 'error',
      'no-restricted-syntax': [
        'error',
        forbiddenTestModifier('it'),
        forbiddenTestModifier('test'),
        forbiddenTestModifier('describe'),
        {
          selector: `MemberExpression[object.object.name=/^(it|test|describe)$/][property.name=${TEST_MODIFIERS}]`,
          message: 'No .skip, .only, .todo, .fails or .fixme tests (testing.md).',
        },
      ],
    },
  },

  // Playwright specs: the same rule, spelled the Playwright way.
  {
    files: ['e2e/**/*.ts'],
    rules: {
      'no-restricted-syntax': [
        'error',
        forbiddenTestModifier('test'),
        {
          selector: `MemberExpression[object.object.name="test"][property.name=${TEST_MODIFIERS}]`,
          message: 'No .skip, .only, .todo, .fails or .fixme tests (testing.md).',
        },
      ],
    },
  },
);
