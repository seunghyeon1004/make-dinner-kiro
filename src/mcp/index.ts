import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { createKitchenServer } from './server.js';

const log = (line: string): void => {
  process.stderr.write(`${line}\n`);
};

try {
  const server = createKitchenServer({ log });
  await server.connect(new StdioServerTransport());
  log('make-dinner MCP server ready');
} catch (e) {
  log(`make-dinner MCP server failed to start: ${e instanceof Error ? e.message : String(e)}`);
  process.exitCode = 1;
}
