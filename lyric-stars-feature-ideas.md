# Lyric Stars: Feature Ideas and Scenes

Companion to the Lyric Stars PRD. Priority order for the whole project: 1) word timing accuracy, 2) beautiful visuals and animation, 3) works with every song, 4) easy setup and install. Every item below must follow that order, and no visual effect may delay when a word appears.

---

## Part 1: More features

### Top picks (build first)

1. **Chorus detection.** When a line repeats, its stars return bigger and brighter, and the earlier constellation is redrawn with a glow. Repeated lines are found by comparing the lyric text.
2. **Beat pulse.** Stars pulse gently with the rhythm. Spotify's audio-analysis endpoint is no longer available to new apps, so this would use a steady pulse from a per-song tempo set by you, or the Windows audio output through a small native helper. Treat as a stretch goal.
3. **Constellation memory.** When a song ends, every line's stars fade together into one large "song map" shown for a few seconds, like a finished sky.

### Visual ideas

- Shooting stars that cross the screen between lines.
- Theme packs: Ice, Rose, Sunset, plus a theme that follows the album cover colors.
- A slow background nebula glow that changes with the song's colors.
- Emotion words (love, night, fire) get a small effect such as a glow or flicker.

### Timing and usefulness

- **Sync flash:** press a key when a word feels early or late and the app nudges that song's offset automatically.
- **Two-line preview:** the next line appears as faint dots before it is sung, so you can sing along.
- Romanized and translated lyrics for songs in other languages, shown small under each word.

### Everyday use

- **Now Playing mini mode:** a small corner widget with the cover and one line of lyrics.
- Screenshot or short video export of a sky you like.
- A history of songs played, with their star maps.

---

## Part 2: Lyric display styles (scenes)

The app becomes a set of scenes you can switch between with a key or from settings. All scenes share the same timing engine, so word accuracy is solved once and works everywhere.

### Typography styles

1. **Kinetic typography.** Big words slam, slide, and scale onto the screen in time with the singing, like lyric videos. The loudest word of a line is the biggest.
2. **Karaoke sweep.** Lines sit centered and a gold fill sweeps across each word as it is sung. Clean and readable, good for the normal window while working.
3. **Scrolling stack.** The current line is big in the middle, previous lines fade up and shrink above it, and upcoming lines wait faintly below, like Apple Music.
4. **Handwriting.** Words are drawn stroke by stroke as if written with a glowing pen, then fade like ink.

### Scene styles

5. **Rain / falling words.** Words drop slowly from the top like rain, and the current one lands and glows.
6. **Floating bubbles or lanterns.** Each word rises as a soft bubble or lantern and drifts upward.
7. **Neon sign.** Lines light up like a neon sign with a flicker and a faint wall glow.
8. **Typewriter / film subtitles.** Words type out on a dark film-like screen with a blinking cursor.
9. **Waveform ribbon.** Words ride along a flowing line that waves with the song's energy.
10. **Orbit.** Words circle slowly around the album cover, and the current word moves to the front.

### Mood styles

11. **Polaroid / lyric card.** Each line becomes a small card in the album's colors, like a shareable quote.
12. **Retro terminal.** Green or gold text on black with a scanline effect.
13. **Paper and ink.** A calm light theme with words written on paper, for daytime use.

### Scene system (shared)

- Switch scene with one key, and remember a favorite scene per song or per display mode (for example overlay defaults to karaoke sweep, fullscreen to constellation).
- A "random scene" mode that picks a new style each song.
- Every scene is a module with the same interface: it receives the current line, the timed words, the current time, the album colors, and the canvas, and draws one frame.
- Scenes respect the "reduce motion" setting.

---

## Suggested build order

1. Scene system (shared interface, scene switcher, per-mode favorites)
2. Karaoke sweep, scrolling stack, kinetic typography (most readable, best for the overlay)
3. Chorus detection, constellation memory, two-line preview
4. Theme packs and album-color theme
5. Sync flash
6. Remaining scenes (rain, lanterns, neon, typewriter, ribbon, orbit, polaroid, terminal, paper)
7. Shooting stars, nebula glow, emotion-word effects
8. Mini mode, translations, export, history
9. Beat pulse (only if a reliable tempo source is found)

---

## Scene system prompt (paste into your AI tool)

```
Refactor the renderer into a scene system. Create a scenes/ folder where each scene exports { name, init(canvas, ctx), draw(frame), resize() }. The frame object contains: the current line, its timed words (word, start, end), the current time, the previous line, the next line, the album colors, the display mode, and the reduce-motion flag. Move the existing constellation renderer into scenes/constellation.js without changing how it looks. Add a scene switcher on the S key and in settings, remember the chosen scene per display mode (fullscreen, window, overlay), and add a "random scene each song" option. Then add scenes/karaoke.js: lines centered, a gold fill sweeps across each word between its start and end times, previous and next lines faint above and below. Keep 60 fps and high-DPI support.
```
