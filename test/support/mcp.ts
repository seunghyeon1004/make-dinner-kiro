import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { InMemoryTransport } from '@modelcontextprotocol/sdk/inMemory.js';
import { createKitchenServer } from '../../src/mcp/server.js';
import type { KitchenServerDeps } from '../../src/mcp/server.js';
import type { SampleSource } from '../../src/mcp/samples.js';

/** A sample source over an in-memory map from path to text (a storage fake). */
export function memorySamples(files: Record<string, string>): SampleSource {
  return { readText: (path) => files[path] ?? null };
}

/** A sample source whose disk is broken: every read throws, with an absolute path in the message. */
export function throwingSamples(): SampleSource {
  return {
    readText: () => {
      throw new Error('EIO: i/o error, read /Users/someone/secret/samples/index.json');
    },
  };
}

/** A client connected to a fresh kitchen server over the SDK's in-memory transport pair. */
export async function connectInProcess(
  deps: Partial<KitchenServerDeps> = {},
): Promise<{ client: Client; close: () => Promise<void> }> {
  const [clientSide, serverSide] = InMemoryTransport.createLinkedPair();
  const server = createKitchenServer({
    log: () => undefined,
    samples: memorySamples({}),
    ...deps,
  });
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
