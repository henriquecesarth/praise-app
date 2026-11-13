import net from 'node:net';
import { describe, expect, it } from 'vitest';
import {
  parseEmulatorHost,
  verifyFirestoreEmulatorReachable,
} from './firestore-emulator-preflight';

describe('Firestore Emulator Preflight Guard (M09)', () => {
  it('parses IPv4, hostname, and bracketed IPv6 emulator hosts', () => {
    expect(parseEmulatorHost('127.0.0.1:8080')).toEqual({
      host: '127.0.0.1',
      port: 8080,
    });
    expect(parseEmulatorHost('[::1]:8080')).toEqual({
      host: '::1',
      port: 8080,
    });
    expect(() => parseEmulatorHost('')).toThrow(/EMULATOR_UNAVAILABLE/);
    expect(() => parseEmulatorHost('127.0.0.1')).toThrow(/EMULATOR_UNAVAILABLE/);
    expect(() => parseEmulatorHost('127.0.0.1:99999')).toThrow(/EMULATOR_UNAVAILABLE/);
  });

  it('fails fast with EMULATOR_UNAVAILABLE when port is not listening', async () => {
    const server = net.createServer();
    await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
    const address = server.address() as net.AddressInfo;
    await new Promise<void>((resolve) => server.close(() => resolve()));

    await expect(
      verifyFirestoreEmulatorReachable(`127.0.0.1:${address.port}`, 500)
    ).rejects.toThrow(/EMULATOR_UNAVAILABLE/);
  });

  it('resolves cleanly when emulator port accepts TCP connections', async () => {
    const server = net.createServer((socket) => socket.end());
    await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
    const address = server.address() as net.AddressInfo;

    try {
      await expect(
        verifyFirestoreEmulatorReachable(`127.0.0.1:${address.port}`, 1000)
      ).resolves.toEqual({ host: '127.0.0.1', port: address.port });
    } finally {
      await new Promise<void>((resolve) => server.close(() => resolve()));
    }
  });
});
