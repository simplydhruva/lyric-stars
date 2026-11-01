// Settings panel (S). Every control writes straight to settings and tells the app
// which key changed; there is no Save button.
import { settings } from './settings.js';
import { THEMES, FONTS } from './theme.js';
import { formatOffset } from './sync.js';
import { LANGUAGES } from './translate.js';
import { SCENES, DISPLAY_MODES, sceneSettingKey, validScene } from './scenes/index.js';

const esc = (v) =>
  String(v ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);

const SOURCE_HELP = {
  auto: 'Spotify on this PC first (fastest, no login), then your Spotify account for your phone or speakers, then any other player on this PC.',
  spotify: 'Your Spotify account, on any device. Needs login.',
  'media-session': 'What plays on this PC, no login: Spotify first, otherwise another player (browser, Apple Music…). Windows only.',
};

function radios(name, options, value) {
  return `<div class="seg" role="radiogroup">${options
    .map(
      ([v, label]) =>
        `<label><input type="radio" name="${name}" value="${v}"${v === value ? ' checked' : ''}><span>${esc(label)}</span></label>`
    )
    .join('')}</div>`;
}

export class SettingsPanel {
  // host: { onChange(key), globalOffset(), nudgeGlobal(ms), cacheStats(), clearCache(), canDisconnect(), disconnect(),
  //         desktop?() -> { info, bridge } in the desktop app }
  constructor(el, host) {
    this.el = el;
    this.host = host;
    this.visible = false;
    el.addEventListener('change', (e) => this._changed(e.target));
    el.addEventListener('input', (e) => (e.target.type === 'color' || e.target.type === 'range') && this._changed(e.target));
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
      ${radios('source', [['auto', 'Automatic'], ['spotify', 'Spotify account'], ['media-session', 'This PC only']], g('source'))}
      <p>${esc(SOURCE_HELP[g('source')] || '')}</p>
      <h3>Show</h3>
      ${radios('mode', [['word', 'Word by word'], ['line', 'Line by line']], g('mode'))}
      <h3>Scene <span class="hint">(V switches)</span></h3>
      ${DISPLAY_MODES.map(
        (m) => `<div class="field-label">${m === 'window' ? 'Window' : 'Fullscreen'}</div>
      ${radios(sceneSettingKey(m), SCENES.map((s) => [s.id, s.name]), validScene(g(sceneSettingKey(m)), m))}`
      ).join('')}
      <label class="check"><input type="checkbox" name="sceneRandom"${g('sceneRandom') ? ' checked' : ''}> Random scene each song</label>
      <h3>Colors</h3>
      ${radios('theme', [...Object.entries(THEMES).map(([k, t]) => [k, t.name]), ['custom', 'Custom']], theme)}
      <label class="field"${theme === 'custom' ? '' : ' hidden'}>Custom color <input type="color" name="customColor" value="${esc(g('customColor'))}"></label>
      <label class="check"><input type="checkbox" name="albumColors"${g('albumColors') ? ' checked' : ''}> Take each song's colors from its album art</label>
      <h3>Font</h3>
      <select name="font">${Object.entries(FONTS)
        .map(([k, f]) => `<option value="${k}"${k === g('font') ? ' selected' : ''}>${esc(f.name)}</option>`)
        .join('')}</select>
      <h3>Sky</h3>
      <label class="field">Spread <input type="range" name="spread" min="0" max="100" step="5" value="${esc(g('spread'))}"> <b>${esc(g('spread'))}</b></label>
      <label class="field">Chaos <input type="range" name="chaos" min="0" max="100" step="5" value="${esc(g('chaos'))}"> <b>${esc(g('chaos'))}</b></label>
      <label class="field" title="The small glow on the star of the word being sung">Glow <input type="range" name="glow" min="0" max="100" step="5" value="${esc(g('glow'))}"> <b>${esc(g('glow'))}</b></label>
      <div class="field-label">Night sky <span class="hint">(behind every scene)</span></div>
      ${radios('sky', [['off', 'Off'], ['stars', 'Stars'], ['comets', 'Stars + comets']], g('sky'))}
      <button type="button" data-set="resetSky">Reset sky to defaults</button>
      <label class="check"><input type="checkbox" name="previewNext"${g('previewNext') ? ' checked' : ''}> Preview the next line as faint dots (constellation)</label>
      <label class="check"><input type="checkbox" name="songMap"${g('songMap') ? ' checked' : ''}> Show the whole song as one map at the end (constellation)</label>
      <label class="check"><input type="checkbox" name="emojis"${g('emojis') ? ' checked' : ''}> Emojis next to words like love and fire (Kinetic scene)</label>
      <label class="check"><input type="checkbox" name="filmLook"${g('filmLook') ? ' checked' : ''}> Film look: grain and faded colour on the photos (Polaroid scene)</label>
      <label class="check"><input type="checkbox" name="polaroidFlash"${g('polaroidFlash') ? ' checked' : ''}> Camera flash now and then (Polaroid scene)</label>
      <div class="field-label">Reel background <span class="hint">(Reel scene)</span></div>
      ${radios('reelBackground', [['crisp', 'Crisp dim (album cover)'], ['blur', 'Soft blur'], ['off', 'Off (black sky)']], g('reelBackground'))}
      <div class="field-label">Reel intensity <span class="hint">(shake, RGB split, flicker, distortion)</span></div>
      ${radios('reelIntensity', [['calm', 'Calm'], ['normal', 'Normal'], ['wild', 'Wild']], g('reelIntensity'))}
      <div class="field-label">Reel fonts <span class="hint">(T re-rolls the current line)</span></div>
      ${radios('reelFonts', [['random', 'Random'], ['single', 'Single font (Anton)']], g('reelFonts'))}
      <div class="field-label">Pixel screen <span class="hint">(Pixel scene)</span></div>
      ${radios('pixelScreen', [['fill', 'Fill the window'], ['portrait', 'Portrait 9:16']], g('pixelScreen'))}
      <div class="field-label">Pixel palette</div>
      ${radios('pixelPalette', [['dreamy', 'Dreamy'], ['sunset', 'Sunset'], ['green', 'Classic green']], g('pixelPalette'))}
      <div class="field-label">Pixel font</div>
      ${radios('pixelFont', [['press', 'Press Start 2P'], ['silk', 'Silkscreen']], g('pixelFont'))}
      <div class="field-label">Pixel size</div>
      ${radios('pixelSize', [['fine', 'Fine'], ['normal', 'Normal'], ['chunky', 'Chunky']], g('pixelSize'))}
      <div class="field-label">Pixel animation speed</div>
      ${radios('pixelSpeed', [['slow', 'Slow'], ['normal', 'Normal'], ['fast', 'Fast']], g('pixelSpeed'))}
      <label class="check"><input type="checkbox" name="pixelHud"${g('pixelHud') ? ' checked' : ''}> Handheld interface: battery, signal, menu labels, progress bar (Pixel scene)</label>
      <label class="check"><input type="checkbox" name="pixelCrt"${g('pixelCrt') ? ' checked' : ''}> CRT texture: faint scanlines and vignette (Pixel scene)</label>
      <label class="check"><input type="checkbox" name="pixelAlbum"${g('pixelAlbum') ? ' checked' : ''}> Use album colours for the accent (Pixel scene)</label>
      <label class="check"><input type="checkbox" name="pixelSound"${g('pixelSound') ? ' checked' : ''}> Tiny blip sound when the line changes (Pixel scene)</label>
      <label class="check"><input type="checkbox" name="emotion"${g('emotion') ? ' checked' : ''}> Glow on words like love, fire and night (some scenes)</label>
${this.host.desktop ? `      <label class="check"><input type="checkbox" name="beatPulse"${g('beatPulse') ? ' checked' : ''}> Pulse to the beat (listens to the sound your PC is playing)</label>
      <p>${esc(this.host.beatStatus?.() || '')}Windows only. Lyric Stars measures the loudness of your PC's audio output to find the beat; it records nothing and sends nothing. Windows may show a screen-capture indicator while this is on.</p>
` : ''}      <label class="check"><input type="checkbox" name="reduceMotion"${g('reduceMotion') ? ' checked' : ''}> Reduce motion (no drift, twinkle or pop)</label>
      <label class="check"><input type="checkbox" name="fullFrameRate"${g('fullFrameRate') ? ' checked' : ''}> Match a fast screen's refresh rate (smoother on 120 Hz+, uses more power)</label>
      <h3>Lyric text</h3>
      <label class="check"><input type="checkbox" name="backupLyrics"${g('backupLyrics') ? ' checked' : ''}> Use a backup lyrics source (NetEase) when LRCLIB is down or has no timed lyrics; sends the song title and artist there</label>
      <label class="check"><input type="checkbox" name="romanize"${g('romanize') ? ' checked' : ''}> Show Korean, Japanese (kana), Russian and Greek lyrics in Latin letters (works offline)</label>
      <label class="check"><input type="checkbox" name="translate"${g('translate') ? ' checked' : ''}> Show a translation under each line</label>
      <p>Translation sends the song's lyric text to the free MyMemory service (api.mymemory.translated.net), once per song. It may be slow or limited; if it fails the lyrics just show without it.</p>
      <label class="field">Translate into <select name="translateTo">${LANGUAGES.map(([k, n]) => `<option value="${k}"${k === g('translateTo') ? ' selected' : ''}>${n}</option>`).join('')}</select></label>
      <h3>Corner</h3>
      ${radios('cornerInfo', [['off', 'Nothing'], ['title', 'Song title'], ['art', 'Album art and title']], g('cornerInfo'))}
      ${this._desktopHtml()}
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

  _desktopHtml() {
    const d = this.host.desktop?.();
    if (!d) return '';
    const { info } = d;
    const keys = (a) => esc(a.replace('Control', 'Ctrl'));
    let update = '';
    if (info.updatesEnabled) {
      const u = info.update;
      const status = u?.available
        ? `Version ${esc(u.version)} is available.`
        : u?.error
          ? 'Could not check for updates.'
          : u
            ? 'You have the latest version.'
            : '';
      update = `<div class="row"><span>${status}</span>${
        u?.available ? '<button type="button" data-set="openRelease">Download</button>' : '<button type="button" data-set="checkUpdates">Check now</button>'
      }</div>`;
    }
    return `
      <h3>Desktop app</h3>
      ${radios('desk:style', [['window', 'Window'], ['fullscreen', 'Fullscreen']], info.style)}
      <p>F fullscreen · ${keys(info.shortcuts.toggleShow)} show or hide</p>
      <label class="check"><input type="checkbox" name="desk:startWithWindows"${info.startWithWindows ? ' checked' : ''}${info.canStartWithWindows ? '' : ' disabled'}> Start with Windows${info.canStartWithWindows ? '' : ' (installed app only)'}</label>
      <label class="check"><input type="checkbox" name="desk:openToTray"${info.openToTray ? ' checked' : ''}> Open to the tray at startup</label>
      <p>Version ${esc(info.version)}${info.secureTokens ? ' · Spotify login stored encrypted' : ''}</p>
      ${update}`;
  }

  _desktopChanged(name, input) {
    const { bridge } = this.host.desktop();
    const v = input.type === 'checkbox' ? input.checked : input.value;
    if (name === 'style') bridge.setStyle(v);
    else bridge.setOption(name, v);
  }

  async checkUpdates() {
    await this.host.desktop().bridge.checkForUpdates();
  }

  openRelease() {
    this.host.desktop().bridge.openRelease();
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
    if (name.startsWith('desk:')) return this._desktopChanged(name.slice(5), input);
    let value = input.type === 'checkbox' ? input.checked : input.value;
    if (input.type === 'range') {
      value = Number(value);
      input.nextElementSibling.textContent = String(value);
    }
    settings.set(name, value);
    this.host.onChange(name);
    if (name === 'theme' || name === 'source') this.render(); // custom color, source help
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

  resetSky() {
    settings.set('spread', 100);
    settings.set('chaos', 50);
    settings.set('glow', 25);
    settings.set('sky', 'comets');
    this.host.onChange('spread');
    this.render();
  }

  disconnect() {
    this.host.disconnect();
    this.render();
  }
}
