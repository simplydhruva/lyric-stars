// History panel (H): the songs played, newest first, each with its constellation picture.
import { ago } from './history.js';

const esc = (v) =>
  String(v ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);

export class HistoryPanel {
  // host: { history: History }
  constructor(el, host) {
    this.el = el;
    this.host = host;
    this.visible = false;
    el.addEventListener('click', async (e) => {
      if (e.target.closest('[data-set=clear]')) {
        await this.host.history.clear();
        this.render();
      }
    });
  }

  async toggle() {
    this.visible = !this.visible;
    this.el.hidden = !this.visible;
    if (this.visible) await this.render();
  }

  async render() {
    if (!this.visible) return;
    await this.host.history.load();
    const list = this.host.history.entries;
    const rows = list
      .map(
        (e) => `<li>
          ${e.thumb ? `<img class="hist-map" src="${esc(e.thumb)}" alt="Constellation of ${esc(e.title)}" width="96" height="60">` : `<span class="hist-map none">${e.art ? `<img src="${esc(e.art)}" alt="" width="60" height="60">` : ''}</span>`}
          <span class="hist-text"><b>${esc(e.title)}</b><span>${esc(e.artist)}</span><span class="hist-when">${ago(e.playedAt)}${e.plays > 1 ? ` · played ${e.plays} times` : ''}</span></span>
        </li>`
      )
      .join('');
    this.el.innerHTML = `<h2>History</h2>
      ${list.length ? `<ul class="hist">${rows}</ul>` : '<p>Songs you play will appear here, each with its own constellation.</p>'}
      <div class="row"><button type="button" data-set="clear"${list.length ? '' : ' disabled'}>Clear history</button></div>
      <p>Kept only on this PC.</p>`;
  }
}
