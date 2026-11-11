import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { InMemoryTransport } from '@modelcontextprotocol/sdk/inMemory.js';
import { createKitchenServer } from '../../src/mcp/server.js';
import type { KitchenServerDeps } from '../../src/mcp/server.js';

/** A client connected to a fresh kitchen server over the SDK's in-memory transport pair. */
export async function connectInProcess(
  deps: KitchenServerDeps = { log: () => undefined },
): Promise<{ client: Client; close: () => Promise<void> }> {
  const [clientSide, serverSide] = InMemoryTransport.createLinkedPair();
  const server = createKitchenServer(deps);
  const client = new Client({ name: 'test', version: '0' });
  await Promise.all([server.connect(serverSide), client.connect(clientSide)]);
  return {
    client,
    close: async () => {
      await client.close();
      await server.close();
    },
  };
}

/** The text blocks of a tool result, in order. */
export function textsOf(result: unknown): string[] {
  const content = (result as { content?: { type: string; text?: string }[] }).content ?? [];
  return content.flatMap((c) => (c.type === 'text' && c.text !== undefined ? [c.text] : []));
}
