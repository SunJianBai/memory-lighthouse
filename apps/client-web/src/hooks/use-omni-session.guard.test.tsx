// @vitest-environment jsdom
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createDemoState } from '../domain/demo-data';
import { useOmniSession } from './use-omni-session';
import type { RuntimeCallbacks, SessionOptions } from '../runtime/types';

const fixture = vi.hoisted(() => ({ sends: vi.fn(async (_request: unknown) => {}), starts: [] as SessionOptions[] }));
vi.mock('../runtime/session-runtime', () => ({
  SessionRuntime: class {
    constructor(private callbacks: RuntimeCallbacks) {}
    async start(options: SessionOptions) { fixture.starts.push(options); this.callbacks.onStatus('live'); }
    stop() {}
    sendTurn = fixture.sends;
  },
}));
let host: HTMLDivElement;
let root: Root;
let hook: ReturnType<typeof useOmniSession>;
let state = createDemoState();
function Harness() { hook = useOmniSession(state); return null; }
beforeEach(() => {
  Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });
  fixture.sends.mockReset().mockResolvedValue(undefined);
  fixture.starts.length = 0;
  state = createDemoState();
  state.consent.microphoneApproved = true;
  state.consent.cloudProcessingApproved = true;
  state.consent.cameraApproved = false;
  state.provider.referenceAudio = 'synthetic-audio';
  host = document.createElement('div'); document.body.append(host); root = createRoot(host);
});
afterEach(async () => { await act(async () => root.unmount()); host.remove(); });
const mount = async (provider: 'local' | 'cloud') => {
  state.provider.provider = provider;
  await act(async () => root.render(<Harness />));
};

describe('model action revalidation', () => {
  it.each(['local', 'cloud'] as const)('blocks %s sends carrying stale session prompt', async provider => {
    await mount(provider);
    const guard = vi.fn(async () => false);
    await act(async () => { await hook.start({ prompt: 'contains old routine A', beforeModelAction: guard }); });
    await act(async () => { expect(await hook.requestModelAction('remind B')).toBe(false); });
    expect(guard).toHaveBeenCalledOnce();
    expect(fixture.sends).not.toHaveBeenCalled();
  });
  it('never sends an old action through a replacement runtime', async () => {
    await mount('cloud');
    let resolve!: (ok: boolean) => void;
    await act(async () => { await hook.start({ beforeModelAction: () => new Promise<boolean>(done => { resolve = done; }) }); });
    let pending!: Promise<boolean>;
    act(() => { pending = hook.requestModelAction('old action'); });
    await act(async () => { await hook.start({ beforeModelAction: async () => true }); });
    await act(async () => { resolve(true); expect(await pending).toBe(false); });
    expect(fixture.sends).not.toHaveBeenCalled();
    expect(hook.session.status).toBe('live');
  });
  it('does not apply an old guard failure to a new session', async () => {
    await mount('cloud');
    let reject!: (error: Error) => void;
    await act(async () => { await hook.start({ beforeModelAction: () => new Promise<boolean>((_, fail) => { reject = fail; }) }); });
    let pending!: Promise<boolean>;
    act(() => { pending = hook.requestModelAction('old action'); });
    await act(async () => { await hook.start(); });
    await act(async () => { reject(Error('old network failure')); expect(await pending).toBe(false); });
    expect(hook.session.status).toBe('live');
    expect(hook.session.error).toBe('');
    expect(fixture.sends).not.toHaveBeenCalled();
  });
});
