// The small caption under the lyrics: the romanized line and/or its translation, for the current line.
// It is plain text in the page (not part of any scene), so it works the same in every scene and never touches
// how a word is drawn. It changes when the line changes, from the same position the lyrics use.
import { lineIndexAt } from './lyrics/lrc.js';
import { romanizeLines } from './romanize.js';

export class Caption {
  constructor(el) {
    this.el = el;
    this.roman = null; // per line, or null
    this.trans = null;
    this.showRoman = false;
    this.showTrans = false;
    this.shown = -2; // the line currently on screen
    this.timeline = null;
  }

  // Call with the new timeline (or null) whenever the lyrics change.
  setTimeline(timeline) {
    this.timeline = timeline;
    this.roman = timeline ? romanizeLines(timeline.map((l) => l.text || '')) : null;
    this.trans = null;
    this.shown = -2;
    this.paint(-1);
  }

  setTranslation(lines) {
    this.trans = lines;
    this.shown = -2;
  }

  setOptions({ romanize, translate }) {
    this.showRoman = Boolean(romanize);
    this.showTrans = Boolean(translate);
    this.shown = -2;
  }

  // Called every frame with the playback position; only touches the page when the line changes.
  frame(pos) {
    const index = this.timeline ? lineIndexAt(this.timeline, pos) : -1;
    if (index === this.shown) return;
    this.paint(index);
  }

  paint(index) {
    this.shown = index;
    const rows = [];
    if (index >= 0) {
      if (this.showRoman && this.roman?.[index]) rows.push(['roman', this.roman[index]]);
      if (this.showTrans && this.trans?.[index]) rows.push(['trans', this.trans[index]]);
    }
    this.el.replaceChildren(
      ...rows.map(([cls, text]) => {
        const p = document.createElement('p');
        p.className = cls;
        p.textContent = text;
        return p;
      })
    );
    this.el.hidden = rows.length === 0;
  }
}
