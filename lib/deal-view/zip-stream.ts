// A stored ZIP as a web ReadableStream (fflate). PDFs are already compressed, so entries are not deflated.
import { Zip, ZipPassThrough } from 'fflate';

/** Emits the archive file by file as the reader pulls. */
export function zipStream(parts: ReadonlyArray<{ name: string; data: Uint8Array }>): ReadableStream<Uint8Array> {
  let next = 0;
  let zip: Zip;
  return new ReadableStream<Uint8Array>({
    start(controller) {
      zip = new Zip((err, chunk, final) => {
        if (err) return controller.error(err);
        controller.enqueue(chunk);
        if (final) controller.close();
      });
    },
    pull() {
      if (next < parts.length) {
        const p = parts[next++];
        const entry = new ZipPassThrough(p.name);
        zip.add(entry);
        entry.push(p.data, true);
      }
      if (next >= parts.length) zip.end();
    },
  });
}
