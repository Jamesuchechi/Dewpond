export interface BlobWorkerHandle {
  worker: Worker;
  revoke: () => void;
}

/**
 * Instantiate a classic or module Web Worker from a same-origin Blob URL so that
 * on headerless static hosts (such as GitHub Pages) the worker strictly inherits
 * the document's <meta http-equiv="Content-Security-Policy"> rules.
 */
export async function spawnBlobWorker(
  scriptUrl: string,
  options?: WorkerOptions,
): Promise<BlobWorkerHandle> {
  const resolved = new URL(scriptUrl, window.location.href);
  if (resolved.origin !== window.location.origin) {
    throw new Error(`Refusing cross-origin worker script URL: ${resolved.origin}`);
  }

  const response = await fetch(resolved.href, { credentials: 'same-origin' });
  if (!response.ok) {
    throw new Error(
      `Failed to fetch same-origin worker script (${response.status}): ${resolved.href}`,
    );
  }

  const sourceText = await response.text();
  const blobUrl = URL.createObjectURL(new Blob([sourceText], { type: 'application/javascript' }));
  let revoked = false;
  const revoke = () => {
    if (!revoked) {
      revoked = true;
      URL.revokeObjectURL(blobUrl);
    }
  };

  try {
    const worker = new Worker(blobUrl, options);
    return { worker, revoke };
  } catch (err) {
    revoke();
    throw err;
  }
}
