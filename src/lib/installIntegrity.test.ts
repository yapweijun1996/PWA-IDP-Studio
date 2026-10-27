import { expect, it } from 'vitest';
import { requireBuildIdentity } from './installIntegrity';

it('accepts only a successful response naming this build', async () => {
  await expect(requireBuildIdentity('B', { ok: true, json: async () => ({ build: 'B' }) })).resolves.toBeUndefined();
  for (const identity of [null, {}, [], 'B', { build: 'A' }, { build: 1 }]) {
    await expect(requireBuildIdentity('B', { ok: true, json: async () => identity })).rejects.toThrow();
  }
  await expect(requireBuildIdentity('B', { ok: false, json: async () => ({ build: 'B' }) })).rejects.toThrow();
  await expect(requireBuildIdentity('B', { ok: true, json: async () => { throw new SyntaxError('invalid JSON'); } })).rejects.toThrow();
  await expect(requireBuildIdentity('B', Promise.reject(new Error('network unavailable')))).rejects.toThrow('network unavailable');
});
