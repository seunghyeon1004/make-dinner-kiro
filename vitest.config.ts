import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    projects: [
      {
        test: {
          name: 'examples',
          include: ['test/**/*.test.ts'],
          environment: 'node',
        },
      },
      {
        test: {
          name: 'props',
          include: ['test/**/*.pbt.ts'],
          environment: 'node',
        },
      },
    ],
  },
});
