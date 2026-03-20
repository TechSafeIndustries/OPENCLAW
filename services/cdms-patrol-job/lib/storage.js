'use strict';

const { Storage } = require('@google-cloud/storage');
const { log, logError } = require('./logger');
const { BLOCKED_WRITE_BUCKETS } = require('./config');

const PROJECT_ID = process.env.GCP_PROJECT_ID || 'tsi-automation';

function assertNotBlocked(gcsPath, operation) {
  if (!gcsPath || !gcsPath.startsWith('gs://')) return;
  const bucketName = gcsPath.slice(5).split('/')[0];
  for (const blocked of BLOCKED_WRITE_BUCKETS) {
    if (bucketName === blocked) {
      throw new Error(`BLOCKED: ${operation} to "${gcsPath}" refused. Bucket "${blocked}" is permanently blocked from patrol writes.`);
    }
  }
}

function createStorageClient() {
  const storage = new Storage({ projectId: PROJECT_ID });

  function parsePath(gcsPath) {
    if (!gcsPath || !gcsPath.startsWith('gs://')) throw new Error(`Invalid GCS path: ${gcsPath}`);
    const withoutPrefix = gcsPath.slice(5);
    const slashIndex = withoutPrefix.indexOf('/');
    if (slashIndex === -1) return { bucket: withoutPrefix, path: '' };
    return { bucket: withoutPrefix.slice(0, slashIndex), path: withoutPrefix.slice(slashIndex + 1) };
  }

  function isInsideRoots(gcsPath, roots) {
    const normalised = gcsPath.toLowerCase();
    return roots.some(root => normalised.startsWith(root.toLowerCase()));
  }

  return {
    parsePath,
    isInsideRoots,

    async objectExists(gcsPath) {
      const { bucket, path } = parsePath(gcsPath);
      const [exists] = await storage.bucket(bucket).file(path).exists();
      return exists;
    },

    async readObject(gcsPath) {
      const { bucket, path } = parsePath(gcsPath);
      const [contents] = await storage.bucket(bucket).file(path).download();
      return contents.toString('utf8');
    },

    async listObjects(gcsPrefix) {
      const { bucket, path } = parsePath(gcsPrefix);
      const [files] = await storage.bucket(bucket).getFiles({ prefix: path });
      return files.map(f => `gs://${bucket}/${f.name}`);
    },

    async writeObject(gcsPath, content, contentType = 'application/json') {
      assertNotBlocked(gcsPath, 'writeObject');
      const { bucket, path } = parsePath(gcsPath);
      const file = storage.bucket(bucket).file(path);
      await file.save(content, { contentType, resumable: false });
      log('gcs-write', { path: gcsPath, size: content.length });
    },

    async getMetadata(gcsPath) {
      const { bucket, path } = parsePath(gcsPath);
      const [metadata] = await storage.bucket(bucket).file(path).getMetadata();
      return { size: parseInt(metadata.size, 10), md5: metadata.md5Hash, generation: metadata.generation, updated: metadata.updated };
    },

    async moveObject(srcPath, dstPath) {
      assertNotBlocked(dstPath, 'moveObject-destination');
      const src = parsePath(srcPath);
      const dst = parsePath(dstPath);
      const srcFile = storage.bucket(src.bucket).file(src.path);
      const dstFile = storage.bucket(dst.bucket).file(dst.path);

      const [dstExists] = await dstFile.exists();
      if (dstExists) return { ok: false, src: srcPath, dst: dstPath, error: 'Destination already exists (no-overwrite rule)' };

      const [srcMeta] = await srcFile.getMetadata();

      try {
        await srcFile.copy(dstFile, { preconditionOpts: { ifGenerationMatch: 0 } });
      } catch (err) {
        return { ok: false, src: srcPath, dst: dstPath, error: `Copy failed: ${err.message}` };
      }

      const [dstMeta] = await dstFile.getMetadata();
      if (parseInt(dstMeta.size, 10) !== parseInt(srcMeta.size, 10)) {
        logError('move-verify-failed', { src: srcPath, dst: dstPath, srcSize: srcMeta.size, dstSize: dstMeta.size });
        return { ok: false, src: srcPath, dst: dstPath, error: `Verification failed: size mismatch (src=${srcMeta.size}, dst=${dstMeta.size})` };
      }

      try {
        await srcFile.delete();
      } catch (err) {
        logError('move-delete-failed', { src: srcPath, dst: dstPath, error: err.message });
        return { ok: false, src: srcPath, dst: dstPath, error: `Copy succeeded but source delete failed: ${err.message}. Manual cleanup required.` };
      }

      log('gcs-move', { src: srcPath, dst: dstPath, size: srcMeta.size });
      return { ok: true, src: srcPath, dst: dstPath };
    },
  };
}

module.exports = { createStorageClient };
