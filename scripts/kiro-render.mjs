#!/usr/bin/env node
// Turns `kiro-cli chat --output-format stream-json` (JSON Lines on stdin) into a readable
// transcript on stdout: the agent's text, every tool call with what it touched, every
// shell command with its exit code and the tail of its output, the steering files Kiro
// loaded, and the credits the session reported. Nothing is invented: a line that is not
// in the event stream is not in the transcript.
import { createInterface } from 'node:readline';

const TAIL_LINES = Number(process.env.KIRO_RENDER_TAIL ?? 30);
const home = process.env.HOME ?? '';
const tidy = (s) =>
  String(s)
    .replace(/\x1b\[[0-9;?]*[a-zA-Z]/g, '')
    .replaceAll(home, '~');

const calls = new Map();
let text = '';
let credits = null;
let status = 'unknown';

const flushText = () => {
  if (text.trim()) console.log(`\n${tidy(text.trim())}\n`);
  text = '';
};

const tail = (s) => {
  const lines = tidy(s).trimEnd().split('\n');
  if (lines.length <= TAIL_LINES) return lines;
  return [`… (${lines.length - TAIL_LINES} earlier lines not shown)`, ...lines.slice(-TAIL_LINES)];
};

const describe = (call) => {
  const input = call.rawInput ?? {};
  if (call.kind === 'execute') return `$ ${input.command ?? call.title}`;
  const path = input.path ?? call.locations?.[0]?.path;
  return path ? `${call.title} ${path}` : `${call.title}`;
};

const rl = createInterface({ input: process.stdin });
for await (const line of rl) {
  if (!line.trim()) continue;
  let event;
  try {
    event = JSON.parse(line);
  } catch {
    // The CLI's own logger writes plain lines between events. Keep the ones that matter.
    if (/error|throttl|denied|fail/i.test(line)) console.log(`[cli] ${tidy(line)}`);
    continue;
  }
  if (event.type === 'runFinished') {
    status = `${event.data?.status} (${event.data?.stopReason})`;
    continue;
  }
  const update = event.data?.update;
  if (!update) continue;
  const kiro = update._meta?.kiro ?? {};

  switch (update.sessionUpdate) {
    case 'agent_message_chunk':
      text += update.content?.text ?? '';
      break;
    case 'tool_call':
      calls.set(update.toolCallId, update);
      break;
    case 'tool_call_update': {
      const call = { ...calls.get(update.toolCallId), ...update };
      calls.set(update.toolCallId, call);
      if (update.status !== 'completed' && update.status !== 'failed') break;
      flushText();
      console.log(
        `[tool:${call.kind ?? 'other'}${update.status === 'failed' ? ' FAILED' : ''}] ${tidy(describe(call))}`,
      );
      if (call.kind === 'execute') {
        const out = call.rawOutput?.output ?? call.rawOutput?.message ?? '';
        for (const l of tail(out)) console.log(`    ${l}`);
        console.log(`    exit ${call.rawOutput?.exitCode ?? '?'}`);
      }
      break;
    }
    case 'session_info_update':
      if (kiro.kind === 'steering_inclusion') {
        flushText();
        console.log(
          `[steering] ${tidy(JSON.stringify(kiro.steeringInclusion ?? kiro)).slice(0, 600)}`,
        );
      } else if (kiro.kind === 'session_usage') {
        credits = kiro.credits?.[0]?.usage ?? credits;
      }
      break;
    default:
      break;
  }
}
flushText();
console.log(
  `--- run ${status}; credits reported by this session: ${credits === null ? 'none' : credits.toFixed(2)} ---`,
);
