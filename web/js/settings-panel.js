// Settings panel (S). Every control writes straight to settings and tells the app
// which key changed; there is no Save button.
import { settings } from './settings.js';
import { THEMES, FONTS } from './theme.js';
import { formatOffset } from './sync.js';

const esc = (v) =>
  String(v ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);

function radios(name, options, value) {
  return `<div class="seg" role="radiogroup">${options
    .map(
      ([v, label]) =>
        `<label><input type="radio" name="${name}" value="${v}"${v === value ? ' checked' : ''}><span>${esc(label)}</span></label>`
    )
    .join('')}</div>`;
}

export class SettingsPanel {
  // host: { onChange(key), globalOffset(), nudgeGlobal(ms), cacheStats(), clearCache(), canDisconnect(), disconnect() }
  constructor(el, host) {
    this.el = el;
    this.host = host;
    this.visible = false;
    el.addEventListener('change', (e) => this._changed(e.target));
    el.addEventListener('input', (e) => e.target.type === 'color' && this._changed(e.target));
    el.addEventListener('click', (e) => {
      const action = e.target.closest('[data-set]')?.dataset.set;
      if (action) this[action]();
    });
  }

  toggle() {
    this.visible = !this.visible;
    this.el.hidden = !this.visible;
    if (this.visible) this.render();
  }

  render() {
    if (!this.visible) return;
    const g = (k) => settings.get(k);
    const theme = g('theme');
    this.el.innerHTML = `
      <div class="editor-head"><h2>Settings</h2><span></span><button type="button" data-set="toggle" title="Close (S)">Close</button></div>
      <h3>Lyrics from</h3>
      ${radios('source', [['spotify', 'Spotify account'], ['media-session', 'Windows media session']], g('source'))}
      <h3>Show</h3>
      ${radios('mode', [['word', 'Word by word'], ['line', 'Line by line']], g('mode'))}
      <h3>Colors</h3>
      ${radios('theme', [...Object.entries(THEMES).map(([k, t]) => [k, t.name]), ['custom', 'Custom']], theme)}
      <label class="field"${theme === 'custom' ? '' : ' hidden'}>Custom color <input type="color" name="customColor" value="${esc(g('customColor'))}"></label>
      <label class="check"><input type="checkbox" name="albumColors"${g('albumColors') ? ' checked' : ''}> Take each song's colors from its album art</label>
      <h3>Font</h3>
      <select name="font">${Object.entries(FONTS)
        .map(([k, f]) => `<option value="${k}"${k === g('font') ? ' selected' : ''}>${esc(f.name)}</option>`)
        .join('')}</select>
      <h3>Sky</h3>
      <label class="check"><input type="checkbox" name="backgroundStars"${g('backgroundStars') ? ' checked' : ''}> Background stars</label>
      <label class="check"><input type="checkbox" name="reduceMotion"${g('reduceMotion') ? ' checked' : ''}> Reduce motion (no drift, twinkle or pop)</label>
      <h3>Corner</h3>
      ${radios('cornerInfo', [['off', 'Nothing'], ['title', 'Song title'], ['art', 'Album art and title']], g('cornerInfo'))}
      <h3>Global offset</h3>
      <p>For Bluetooth or speaker delay, on every song. <code>[</code> and <code>]</code> adjust just the current song.</p>
      <div class="row"><button type="button" data-set="later">Later</button><b data-part="offset">${formatOffset(this.host.globalOffset())}</b><button type="button" data-set="earlier">Earlier</button></div>
      <h3>Lyric cache</h3>
      <div class="row"><span data-part="cache">…</span><button type="button" data-set="clearCache">Clear</button></div>
      <div data-part="account"${this.host.canDisconnect() ? '' : ' hidden'}>
        <h3>Spotify</h3>
        <div class="row"><button type="button" data-set="disconnect">Disconnect Spotify</button></div>
      </div>`;
    this._showCache();
  }

  async _showCache() {
    const el = this.el.querySelector('[data-part=cache]');
    try {
      const s = await this.host.cacheStats();
      el.textContent = `${s.count} songs, ${s.bytes < 1e6 ? `${Math.ceil(s.bytes / 1024)} KB` : `${(s.bytes / 1e6).toFixed(1)} MB`}`;
    } catch {
      el.textContent = 'unavailable';
    }
  }

  _changed(input) {
    const name = input.name;
    if (!name) return;
    const value = input.type === 'checkbox' ? input.checked : input.value;
    settings.set(name, value);
    this.host.onChange(name);
    if (name === 'theme') this.render(); // shows or hides the custom color
  }

  earlier() {
    this.el.querySelector('[data-part=offset]').textContent = formatOffset(this.host.nudgeGlobal(50));
  }

  later() {
    this.el.querySelector('[data-part=offset]').textContent = formatOffset(this.host.nudgeGlobal(-50));
  }

  async clearCache() {
    await this.host.clearCache();
    this._showCache();
  }

  disconnect() {
    this.host.disconnect();
    this.render();
  }
}
