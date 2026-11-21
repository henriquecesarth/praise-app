import { createHash } from 'node:crypto';
import { Readable } from 'node:stream';
import { buffer } from 'node:stream/consumers';
import {
  CopyObjectCommand, DeleteObjectCommand, GetObjectCommand, HeadObjectCommand, PutObjectCommand, S3ServiceException,
} from '@aws-sdk/client-s3';

// Offline stand-in for the R2 development bucket (test support, excluded from the publish build): conditional HEAD/GET/COPY,
// ranged GET, create-only PUT, 404/412 answers and a content type stored per object. It lists nothing: there is no List API.

export interface StoredObject { bytes: Buffer; etag: string; modified: Date; contentType: string; cacheControl: string }
export const md5 = (bytes: Buffer) => `"${createHash('md5').update(bytes).digest('hex')}"`;

export function providerError(status: number, name: string): Error {
  return new S3ServiceException({ name, $fault: status >= 500 ? 'server' : 'client', $metadata: { httpStatusCode: status }, message: 'private' });
}

type Command = HeadObjectCommand | GetObjectCommand | PutObjectCommand | CopyObjectCommand | DeleteObjectCommand;

export function fakeR2() {
  const objects = new Map<string, StoredObject>();
  let clock = Date.UTC(2026, 10, 20, 12);
  const store = (key: string, bytes: Buffer, contentType: string, cacheControl = 'private, no-store') => {
    objects.set(key, { bytes, etag: md5(bytes), modified: new Date(clock), contentType, cacheControl });
  };
  const facts = (o: StoredObject) => ({
    ETag: o.etag, ContentLength: o.bytes.length, ContentType: o.contentType, CacheControl: o.cacheControl, LastModified: o.modified,
  });
  const impl = async (command: Command) => {
    const input = command.input as { Key: string; Range?: string; IfMatch?: string; IfNoneMatch?: string; ContentType?: string; CacheControl?: string };
    const object = objects.get(input.Key);
    if (command instanceof HeadObjectCommand) {
      if (!object) throw providerError(404, 'NotFound');
      if (input.IfMatch && input.IfMatch !== object.etag) throw providerError(412, 'PreconditionFailed');
      return facts(object);
    }
    if (command instanceof GetObjectCommand) {
      if (!object) throw providerError(404, 'NoSuchKey');
      if (input.IfMatch && input.IfMatch !== object.etag) throw providerError(412, 'PreconditionFailed');
      if (!input.Range) return { ...facts(object), Body: Readable.from([object.bytes]) };
      const [, from, to] = /^bytes=(\d+)-(\d+)$/.exec(input.Range)!;
      const part = Buffer.from(object.bytes.subarray(Number(from), Number(to) + 1));
      return { ETag: object.etag, ContentLength: part.length, ContentRange: `bytes ${from}-${to}/${object.bytes.length}`, Body: Readable.from([part]) };
    }
    if (command instanceof PutObjectCommand) {
      if (input.IfNoneMatch === '*' && object) throw providerError(412, 'PreconditionFailed');
      const bytes = await buffer(command.input.Body as Readable);
      store(input.Key, bytes, input.ContentType ?? 'application/octet-stream', input.CacheControl);
      return { ETag: md5(bytes) };
    }
    if (command instanceof CopyObjectCommand) {
      const source = objects.get(command.input.CopySource!.slice(command.input.Bucket!.length + 1));
      if (!source) throw providerError(404, 'NoSuchKey');
      if (command.input.CopySourceIfMatch !== source.etag || object) throw providerError(412, 'PreconditionFailed');
      objects.set(input.Key, { ...source, contentType: command.input.ContentType!, cacheControl: command.input.CacheControl!, modified: new Date(clock) });
      return { CopyObjectResult: { ETag: source.etag } };
    }
    objects.delete(input.Key);
    return {};
  };
  return { objects, store, impl, tick: (ms: number) => { clock += ms; } };
}
