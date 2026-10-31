// The sync flash: a short ring of light in the theme color when you nudge a song's timing ([ and ]),
// so you see the correction landed. It is feedback for a key press, not part of the lyrics, so it runs on
// wall-clock time and is drawn over whatever scene is showing. With reduce motion it is a plain fade, no ring.
export const FLASH_MS = 650;

// 0 when there is no flash, otherwise how far through it we are (0..1].
export function flashProgress(now, at) {
  if (at == null) return 0;
  const t = (now - at) / FLASH_MS;
  return t >= 0 && t < 1 ? Math.max(t, 0.001) : 0;
}

export const flashing = (now, at) => flashProgress(now, at) > 0;

// dir: +1 lyrics now show earlier, -1 later, 0 reset. Earlier rings grow outwards from the centre,
// later rings shrink inwards, so the motion hints at which way you pushed.
export function drawFlash(ctx, w, h, now, flash, color, reduceMotion) {
  const t = flash ? flashProgress(now, flash.at) : 0;
  if (!t) return;
  const fade = (1 - t) * (1 - t);
  const [r, g, b] = color;
  const reach = Math.hypot(w, h) / 2;
  ctx.save();
  if (reduceMotion) {
    ctx.fillStyle = `rgba(${r},${g},${b},${0.08 * fade})`;
    ctx.fillRect(0, 0, w, h);
    ctx.restore();
    return;
  }
  const p = flash.dir < 0 ? 1 - t : t;
  const radius = reach * (0.12 + 0.7 * p);
  const grad = ctx.createRadialGradient(w / 2, h / 2, Math.max(0, radius - 60), w / 2, h / 2, radius + 60);
  grad.addColorStop(0, `rgba(${r},${g},${b},0)`);
  grad.addColorStop(0.5, `rgba(${r},${g},${b},${0.3 * fade})`);
  grad.addColorStop(1, `rgba(${r},${g},${b},0)`);
  ctx.fillStyle = grad;
  ctx.fillRect(0, 0, w, h);
  ctx.restore();
}
