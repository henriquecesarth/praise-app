import net from 'node:net';

export interface EmulatorEndpoint {
  host: string;
  port: number;
}

/**
 * Parses FIRESTORE_EMULATOR_HOST into host and numeric port.
 * Supports `host:port` and `[ipv6]:port`.
 */
export function parseEmulatorHost(rawHost?: string): EmulatorEndpoint {
  const value = (rawHost || '').trim();
  if (!value) {
    throw new Error(
      'EMULATOR_UNAVAILABLE: FIRESTORE_EMULATOR_HOST is not configured.'
    );
  }

  let host = '';
  let portStr = '';

  if (value.startsWith('[')) {
    const closingIdx = value.indexOf(']:');
    if (closingIdx === -1) {
      throw new Error(
        `EMULATOR_UNAVAILABLE: Invalid FIRESTORE_EMULATOR_HOST "${value}". Expected "[host]:port".`
      );
    }
    host = value.slice(1, closingIdx).trim();
    portStr = value.slice(closingIdx + 2).trim();
  } else {
    const colonIdx = value.lastIndexOf(':');
    if (colonIdx === -1) {
      throw new Error(
        `EMULATOR_UNAVAILABLE: Invalid FIRESTORE_EMULATOR_HOST "${value}". Expected "host:port".`
      );
    }
    host = value.slice(0, colonIdx).trim();
    portStr = value.slice(colonIdx + 1).trim();
  }

  const port = Number(portStr);
  if (!host || !Number.isInteger(port) || port <= 0 || port > 65535) {
    throw new Error(
      `EMULATOR_UNAVAILABLE: Invalid FIRESTORE_EMULATOR_HOST "${value}". Expected valid "host:port".`
    );
  }

  return { host, port };
}

/**
 * Fails fast before integration tests run if the Firestore Emulator TCP port is unreachable.
 */
export async function verifyFirestoreEmulatorReachable(
  rawHost: string | undefined = process.env.FIRESTORE_EMULATOR_HOST || '127.0.0.1:8080',
  timeoutMs = 1500
): Promise<EmulatorEndpoint> {
  const { host, port } = parseEmulatorHost(rawHost);

  return new Promise<EmulatorEndpoint>((resolve, reject) => {
    const socket = net.createConnection({ host, port });
    let settled = false;

    const finish = (err?: Error) => {
      if (settled) return;
      settled = true;
      socket.removeAllListeners();
      socket.destroy();
      if (err) {
        reject(err);
      } else {
        resolve({ host, port });
      }
    };

    socket.setTimeout(timeoutMs);

    socket.once('connect', () => finish());
    socket.once('timeout', () =>
      finish(
        new Error(
          `EMULATOR_UNAVAILABLE: Firestore Emulator did not respond on ${host}:${port} within ${timeoutMs}ms. Start the emulator before running integration tests.`
        )
      )
    );
    socket.once('error', (err) =>
      finish(
        new Error(
          `EMULATOR_UNAVAILABLE: Firestore Emulator is not reachable on ${host}:${port} (${err.message}). Start the emulator before running integration tests.`
        )
      )
    );
  });
}
