/// <reference lib="webworker" />
import { parseUploads, type UploadFile } from './pipeline';

// Parsing Excel besar (±10.000 baris) di worker agar UI tidak membeku.
self.onmessage = async (e: MessageEvent<{ uploads: UploadFile[]; skipHashes: string[] }>) => {
  try {
    const res = await parseUploads(e.data.uploads, new Set(e.data.skipHashes));
    (self as unknown as Worker).postMessage({ ok: true, res });
  } catch (err) {
    (self as unknown as Worker).postMessage({ ok: false, error: (err as Error).message });
  }
};
