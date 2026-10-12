import { describe, expect, it } from 'vitest';
import { fakeTransport } from './fake-transport.ts';
import { transportContract } from './transport.contract.ts';
import { TransportError } from './transport.ts';

transportContract('fake', () => {
  const fake = fakeTransport();
  return Promise.resolve({ transport: fake.transport, stored: fake.stored });
});

describe('TransportError', () => {
  it('says whether a retry may help, and keeps the cause', () => {
    const cause = new Error('ECONNREFUSED');
    const error = new TransportError('sink down', { retryable: true, cause });
    expect(error).toBeInstanceOf(Error);
    expect(error.name).toBe('TransportError');
    expect(error.retryable).toBe(true);
    expect(error.cause).toBe(cause);
  });
});
