import { describe, expect, it } from 'vitest';
import { err, ok } from '../../src/core/index.js';
import {
  anthropicMessage,
  fakeAnthropicFetch,
  fakeClock,
  fakeModelClient,
} from '../support/fakes.js';

describe('R15.2 fakeClock', () => {
  it('R15.2 starts at the given time, advances and sets', () => {
    const clock = fakeClock(1_000);
    expect(clock.nowMs()).toBe(1_000);
    clock.advance(250);
    expect(clock.nowMs()).toBe(1_250);
    clock.set(5);
    expect(clock.nowMs()).toBe(5);
    clock.advance(-5);
    expect(clock.nowMs()).toBe(0);
  });
});

describe('R15.2 fakeModelClient', () => {
  it('R15.2 returns the replies in order and records the texts', async () => {
    const client = fakeModelClient([ok({ a: 1 }), err({ kind: 'refused', category: null })]);
    expect(await client.readRecipes('first')).toEqual({ ok: true, value: { a: 1 } });
    expect(await client.readRecipes('second')).toEqual({
      ok: false,
      error: { kind: 'refused', category: null },
    });
    expect(client.calls).toEqual(['first', 'second']);
  });

  it('R15.2 throws an Error reply', async () => {
    const client = fakeModelClient([new Error('boom')]);
    await expect(client.readRecipes('x')).rejects.toThrow('boom');
    expect(client.calls).toEqual(['x']);
  });

  it('R15.2 awaits a promised reply', async () => {
    const client = fakeModelClient([Promise.resolve(ok(7))]);
    expect(await client.readRecipes('x')).toEqual({ ok: true, value: 7 });
  });

  it('R15.2 throws past the last reply, so an unexpected call fails the test', async () => {
    const client = fakeModelClient([ok(1)]);
    await client.readRecipes('one');
    await expect(client.readRecipes('two')).rejects.toThrow('fakeModelClient: no reply left');
    expect(client.calls).toEqual(['one', 'two']);
  });
});

describe('R15.2 fakeAnthropicFetch', () => {
  it('R15.2 answers statuses, bodies and headers, and records the requests', async () => {
    const fake = fakeAnthropicFetch([
      { status: 200, body: { hello: 'world' }, headers: { 'x-extra': 'yes' } },
      { status: 529, body: { type: 'error', error: { type: 'overloaded_error', message: 'm' } } },
    ]);
    const first = await fake.fetch('https://api.example.test/v1/messages', {
      method: 'POST',
      headers: { 'x-api-key': 'test-key-not-real', 'content-type': 'application/json' },
      body: JSON.stringify({ n: 1 }),
    });
    expect(first.status).toBe(200);
    expect(first.headers.get('x-extra')).toBe('yes');
    expect(first.headers.get('content-type')).toMatch(/^application\/json/);
    expect(await first.json()).toEqual({ hello: 'world' });

    const second = await fake.fetch('https://api.example.test/v1/messages', { method: 'POST' });
    expect(second.status).toBe(529);
    expect(second.headers.get('retry-after-ms')).toBe('1');
    expect(second.headers.get('request-id')).toBe('req_test');

    expect(fake.requests).toHaveLength(2);
    expect(fake.requests[0]?.url).toBe('https://api.example.test/v1/messages');
    expect(fake.requests[0]?.body).toEqual({ n: 1 });
    expect(fake.requests[0]?.headers['x-api-key']).toBe('test-key-not-real');
    expect(fake.requests[1]?.body).toBeNull();
  });

  it('R15.2 rawBody is sent as the exact response text', async () => {
    const fake = fakeAnthropicFetch([{ status: 200, body: null, rawBody: 'not json{' }]);
    const res = await fake.fetch('https://api.example.test/x', {});
    expect(await res.text()).toBe('not json{');
  });

  it('R15.2 rejects with a TypeError for networkError', async () => {
    const fake = fakeAnthropicFetch([{ networkError: true }]);
    await expect(fake.fetch('https://api.example.test/x', {})).rejects.toBeInstanceOf(TypeError);
  });

  it('R15.2 a hang request never answers and rejects with an AbortError when aborted', async () => {
    const fake = fakeAnthropicFetch([{ hang: true }]);
    const controller = new AbortController();
    const pending = fake.fetch('https://api.example.test/x', { signal: controller.signal });
    let settled = false;
    void pending.then(
      () => (settled = true),
      () => (settled = true),
    );
    await new Promise((resolve) => setTimeout(resolve, 5));
    expect(settled).toBe(false);
    controller.abort();
    await expect(pending).rejects.toMatchObject({ name: 'AbortError' });
  });

  it('R15.2 throws past the last reply', async () => {
    const fake = fakeAnthropicFetch([]);
    await expect(fake.fetch('https://api.example.test/x', {})).rejects.toThrow(
      'fakeAnthropicFetch: no reply left',
    );
  });
});

describe('R15.2 anthropicMessage', () => {
  it('R15.2 builds a Messages API response body', () => {
    const body = anthropicMessage([{ type: 'text', text: '{}' }], 'end_turn');
    expect(body).toMatchObject({
      type: 'message',
      role: 'assistant',
      model: 'claude-opus-5-5',
      content: [{ type: 'text', text: '{}' }],
      stop_reason: 'end_turn',
      stop_details: null,
    });
    const refused = anthropicMessage([], 'refusal', { type: 'refusal', category: 'cyber' });
    expect(refused).toMatchObject({
      stop_reason: 'refusal',
      stop_details: { type: 'refusal', category: 'cyber' },
    });
  });
});
