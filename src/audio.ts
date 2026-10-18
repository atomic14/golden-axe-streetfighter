// Sound playback for clips recorded from the original sound board (see tools/cut-audio.ts).
// Clips are named by the sound command byte the game sent to the board.

interface Clip {
  file: string;
  dur: number;
  music?: boolean;
  loopStart?: number;
  loopEnd?: number;
}

/** Sound commands, as sent by the original game code (filled in from a log of a playthrough). */
export const SND: Record<string, string> = {
  // identified from which game code sends each command (tools/explore/sounds.ts)
  swing: '90', // the hero's attack (0xde7c)
  hit: '91', // the hero's blow connects (0xdaf4)
  jump: '95', // jump (0xd470)
  hurt: '97', // the shared damage routine (0x3cf0)
  die: '98', // enemies' cry when hurt or killed
  scream: 'a2', // the hero's death
  item: 'a4', // a thief drops something
  pickup: 'a3', // from the thieves' item code (0x17e70)
  fire: 'bd', // a dragon's breath (0x32084)
  fireball: '9f', // the red dragon (0x32210)
  skeleton: 'a6', // skeletons (0x27468, 0x27520)
  slam: 'a8', // the Bad Brothers' hammers (0x282a0)
  magic: 'b0', // a long effect; spells were never cast in the logged runs
  fall: 'aa', // landing after being knocked down (collision code 0xc416)
  throw: '97',
  coin: '9c',
  knock: '95', // knocked flying (heroes and enemies, before any scream)
  grunt: '98', // an enemy starting an attack (queued at +0x3e by each kind's attack code)
  // the voices (the uPD7759 samples, commands 0x41-0x54): death screams, sent with the knock-
  // down when the blow killed (e.g. 0x19592: tst.b ($70,A6); moveq #$54; jmp $3616)
  'die-heninger': '54',
  'die-longmoan': '53',
  'die-amazon': '49',
  'die-skeleton': '4a',
  'die-big': '4b', // Bad Brothers, knights and Death Adder
  'die-ax': '4c',
  'die-tyris': '48',
  'die-gilius': '46',
  'thief-appear': '43', // the end of a thief's set-up (0x17d98)
  'thief-giggle': '42', // now and then as one walks (0x18104)
  'thief-hurt': '44', // kicked (0x18462)
};

/** Music tracks by command. */
export const MUSIC: Record<string, string> = {
  // the areas' tracks come from the table at 0x2a30; the rest from a log of what the sound CPU received
  select: 'c5',
  area0: 'c1',
  area1: 'c3',
  area2: 'c8',
  area3: 'cb',
  area4: 'c0',
  boss: 'c0', // from progress 0x1431, as the boss nears
  camp: 'c6',
  map: 'c7',
  gameover: 'c9',
  ending: 'ca',
};

const BASE = `${import.meta.env.BASE_URL}assets/audio/`;

function clip_loops(c: Clip | undefined) {
  return !!c && c.loopStart !== undefined && c.file !== 'sca.mp3';
}

class Audio {
  private ctx: AudioContext | null = null;
  private master!: GainNode;
  private sfxGain!: GainNode;
  private musicGain!: GainNode;
  private clips: Record<string, Clip> = {};
  private buffers = new Map<string, Promise<AudioBuffer | null>>();
  private playing = new Map<string, AudioBufferSourceNode>();
  private current: { id: string; src: AudioBufferSourceNode } | null = null;
  private wantMusic: string | null = null;
  muted = false;

  async init() {
    try {
      const r = await fetch(BASE + 'audio.json');
      if (r.ok) this.clips = await r.json();
    } catch {
      // audio is optional
    }
    const unlock = () => {
      this.ensureContext();
      void this.ctx?.resume();
    };
    for (const ev of ['pointerdown', 'touchend', 'keydown']) addEventListener(ev, unlock, { passive: true });
  }

  private ensureContext() {
    if (this.ctx) return;
    const Ctor = window.AudioContext ?? (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext;
    if (!Ctor) return;
    this.ctx = new Ctor();
    this.master = this.ctx.createGain();
    this.master.connect(this.ctx.destination);
    this.sfxGain = this.ctx.createGain();
    this.sfxGain.gain.value = 0.8;
    this.sfxGain.connect(this.master);
    this.musicGain = this.ctx.createGain();
    this.musicGain.gain.value = 0.55;
    this.musicGain.connect(this.master);
    // preload the most common effects
    for (const n of ['hit', 'swing', 'hurt']) if (SND[n]) void this.load(SND[n]);
    if (this.wantMusic) this.playMusic(this.wantMusic);
  }

  private load(id: string): Promise<AudioBuffer | null> {
    let p = this.buffers.get(id);
    if (!p) {
      const clip = this.clips[id];
      p = clip && this.ctx
        ? fetch(BASE + clip.file)
            .then((r) => r.arrayBuffer())
            .then((b) => this.ctx!.decodeAudioData(b))
            .catch(() => null)
        : Promise.resolve(null);
      this.buffers.set(id, p);
    }
    return p;
  }

  /** Play a clip; by default a new instance of the same clip cuts off the previous one. */
  play(id: string, opts: { volume?: number; overlap?: boolean } = {}) {
    if (this.muted || !this.ctx || !this.clips[id]) return;
    void this.load(id).then((buf) => {
      if (!buf || !this.ctx) return;
      if (!opts.overlap) this.playing.get(id)?.stop();
      const src = this.ctx.createBufferSource();
      src.buffer = buf;
      let node: AudioNode = src;
      if (opts.volume !== undefined) {
        const g = this.ctx.createGain();
        g.gain.value = opts.volume;
        src.connect(g);
        node = g;
      }
      node.connect(this.sfxGain);
      src.start();
      this.playing.set(id, src);
      src.onended = () => {
        if (this.playing.get(id) === src) this.playing.delete(id);
      };
    });
  }

  playMusic(id: string | null) {
    this.wantMusic = id;
    if (!this.ctx) return;
    if (this.current?.id === id) return;
    this.current?.src.stop();
    this.current = null;
    if (!id || !this.clips[id]) return;
    void this.load(id).then((buf) => {
      if (!buf || !this.ctx || this.wantMusic !== id || this.current) return;
      const src = this.ctx.createBufferSource();
      src.buffer = buf;
      src.loop = clip_loops(this.clips[id]);
      const clip = this.clips[id];
      if (src.loop && clip.loopStart !== undefined) {
        src.loopStart = clip.loopStart;
        src.loopEnd = clip.loopEnd ?? buf.duration;
      }
      src.connect(this.musicGain);
      src.start();
      this.current = { id, src };
    });
  }

  /** Play a named effect (no-op for names not mapped yet). */
  sfx(name: string) {
    const id = SND[name];
    if (id) this.play(id, { overlap: true });
  }

  /** Switch music by name (null stops). One-shot pieces don't loop. */
  music(name: string | null) {
    this.playMusic(name ? MUSIC[name] ?? null : null);
  }

  toggleMute() {
    this.muted = !this.muted;
    if (this.ctx) this.master.gain.value = this.muted ? 0 : 1;
  }
}

export const audio = new Audio();
