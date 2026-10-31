// Saving what the sky looks like: a picture (PNG) or a short clip (WebM video), from the canvas itself.
// No library and no network. Only the sky is saved, not the buttons around it.

// "Title - Artist" made safe to use as a file name.
export function fileName(track, ext, stamp = new Date()) {
  const base = [track?.title, track?.artist].filter(Boolean).join(' - ') || 'Lyric Stars';
  const clean = base.replace(/[\\/:*?"<>|\u0000-\u001f]+/g, ' ').replace(/\s+/g, ' ').trim().slice(0, 80) || 'Lyric Stars';
  const t = stamp.toISOString().slice(0, 19).replace(/[-:T]/g, '').replace(/^(\d{8})(\d{6})$/, '$1-$2');
  return `${clean} ${t}.${ext}`;
}

function download(blob, name) {
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob);
  a.download = name;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(a.href), 30_000);
}

export function canvasBlob(canvas, type = 'image/png') {
  return new Promise((resolve) => canvas.toBlob((b) => resolve(b), type));
}

// Saves the sky as it is right now. Returns the file name, or null if the browser could not make the picture.
export async function savePicture(canvas, track) {
  const blob = await canvasBlob(canvas);
  if (!blob) return null;
  const name = fileName(track, 'png');
  download(blob, name);
  return name;
}

export const CLIP_SECONDS = 10;

function clipType() {
  for (const t of ['video/webm;codecs=vp9', 'video/webm;codecs=vp8', 'video/webm']) {
    if (globalThis.MediaRecorder?.isTypeSupported?.(t)) return t;
  }
  return null;
}

export const canRecord = () => Boolean(globalThis.MediaRecorder && HTMLCanvasElement.prototype.captureStream && clipType());

// Records the next `seconds` of the sky as a video and saves it. Resolves with the file name (or null when it
// could not record). The sky only repaints when something changes, so record while a song is playing.
export function recordClip(canvas, track, seconds = CLIP_SECONDS) {
  return new Promise((resolve) => {
    const type = clipType();
    if (!type || !canvas.captureStream) return resolve(null);
    try {
      const stream = canvas.captureStream(30);
      const rec = new MediaRecorder(stream, { mimeType: type, videoBitsPerSecond: 6_000_000 });
      const chunks = [];
      rec.ondataavailable = (e) => e.data.size && chunks.push(e.data);
      rec.onstop = () => {
        stream.getTracks().forEach((t) => t.stop());
        if (!chunks.length) return resolve(null);
        const name = fileName(track, 'webm');
        download(new Blob(chunks, { type: 'video/webm' }), name);
        resolve(name);
      };
      rec.onerror = () => resolve(null);
      rec.start(500);
      setTimeout(() => rec.state !== 'inactive' && rec.stop(), seconds * 1000);
    } catch {
      resolve(null);
    }
  });
}
