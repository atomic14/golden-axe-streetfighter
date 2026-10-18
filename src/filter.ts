// Optional display filters: the game still draws its 320x224 picture into the 2D canvas, and
// with a filter on, a WebGL canvas laid over it redraws that picture at the screen's real
// resolution through a shader. They can be cycled at any time:
//  - SMOOTH: xBR (Hyllian's pixel-art scaler, level 2) finds edges in each pixel's
//    neighbourhood and rounds off the staircases along them, keeping flat colours and outlines;
//  - SCALE3X: AdvMAME3x, the same idea in blocks of 3x3, so it stays visibly pixelated;
//  - CRT: an arcade monitor: glowing scanlines that swell on bright colours, an aperture
//    grille, a slight curve to the glass and darker corners.

const VERT = `#version 300 es
in vec2 pos;
void main() { gl_Position = vec4(pos, 0.0, 1.0); }`;

// xBR level 2, after Hyllian's xbr-lv2 shader (MIT licence), with a smooth edge of about one
// screen pixel so it works at any scale. The neighbourhood of the source pixel E:
//        A1 B1 C1
//     A0  A  B  C C4
//     D0  D  E  F F4
//     G0  G  H  I I4
//        G5 H5 I5
// Each corner of E is handled at once in one component of a vec4 (bottom-right, top-right,
// top-left, bottom-left), with the neighbourhood rotated to match.
const XBR = `#version 300 es
precision highp float;
uniform sampler2D src;
uniform vec2 srcSize;
uniform vec2 outSize;
out vec4 color;

const float COEF = 2.0;
const float EQ = 15.0;
const vec3 Y = 48.0 * vec3(0.2126, 0.7152, 0.0722);

vec3 at(ivec2 p) {
  return texelFetch(src, clamp(p, ivec2(0), ivec2(srcSize) - 1), 0).rgb;
}
vec4 luma(vec3 a, vec3 b, vec3 c, vec3 d) { return vec4(dot(a, Y), dot(b, Y), dot(c, Y), dot(d, Y)); }
vec4 df(vec4 a, vec4 b) { return abs(a - b); }
vec4 eq(vec4 a, vec4 b) { return step(df(a, b), vec4(EQ)); }
vec4 neq(vec4 a, vec4 b) { return 1.0 - eq(a, b); }
vec4 diff(vec4 a, vec4 b) { return vec4(notEqual(a, b)); }
vec4 wd(vec4 a, vec4 b, vec4 c, vec4 d, vec4 e, vec4 f, vec4 g, vec4 h) {
  return df(a, b) + df(a, c) + df(d, e) + df(d, f) + 4.0 * df(g, h);
}
float cdf(vec3 a, vec3 b) { vec3 d = abs(a - b); return d.r + d.g + d.b; }

void main() {
  vec2 pos = vec2(gl_FragCoord.x, outSize.y - gl_FragCoord.y) / outSize * srcSize;
  ivec2 p = ivec2(floor(pos));
  vec2 fp = fract(pos);

  vec3 A1 = at(p + ivec2(-1, -2)), B1 = at(p + ivec2(0, -2)), C1 = at(p + ivec2(1, -2));
  vec3 A0 = at(p + ivec2(-2, -1)), A = at(p + ivec2(-1, -1)), B = at(p + ivec2(0, -1)), C = at(p + ivec2(1, -1)), C4 = at(p + ivec2(2, -1));
  vec3 D0 = at(p + ivec2(-2, 0)), D = at(p + ivec2(-1, 0)), E = at(p), F = at(p + ivec2(1, 0)), F4 = at(p + ivec2(2, 0));
  vec3 G0 = at(p + ivec2(-2, 1)), G = at(p + ivec2(-1, 1)), H = at(p + ivec2(0, 1)), I = at(p + ivec2(1, 1)), I4 = at(p + ivec2(2, 1));
  vec3 G5 = at(p + ivec2(-1, 2)), H5 = at(p + ivec2(0, 2)), I5 = at(p + ivec2(1, 2));

  vec4 b = luma(B, D, H, F), c = luma(C, A, G, I), d = luma(D, H, F, B), e = luma(E, E, E, E);
  vec4 f = luma(F, B, D, H), g = luma(G, I, C, A), h = luma(H, F, B, D), i = luma(I, C, A, G);
  vec4 i4 = luma(I4, C1, A0, G5), i5 = luma(I5, C4, A1, G0), h5 = luma(H5, F4, B1, D0), f4 = luma(F4, B1, D0, H5);

  // where the edge through each corner falls, for 45, 30 and 60 degree edges
  vec4 fx = vec4(1, -1, -1, 1) * fp.y + vec4(1, 1, -1, -1) * fp.x;
  vec4 fxLeft = vec4(1, -1, -1, 1) * fp.y + vec4(0.5, 2, -0.5, -2) * fp.x;
  vec4 fxUp = vec4(1, -1, -1, 1) * fp.y + vec4(2, 0.5, -2, -0.5) * fp.x;
  float scale = outSize.x / srcSize.x;
  vec4 delta = vec4(1.0 / scale);
  vec4 fx45 = smoothstep(vec4(1.5, 0.5, -0.5, 0.5) - delta, vec4(1.5, 0.5, -0.5, 0.5) + delta, fx);
  vec4 fx30 = smoothstep(vec4(1.0, 1.0, -0.5, 0.0) - delta, vec4(1.0, 1.0, -0.5, 0.0) + delta, fxLeft);
  vec4 fx60 = smoothstep(vec4(2.0, 0.0, -1.0, 0.5) - delta, vec4(2.0, 0.0, -1.0, 0.5) + delta, fxUp);

  vec4 lv0 = diff(e, f) * diff(e, h);
  vec4 lv1 = lv0 * clamp(neq(f, b) * neq(h, d) + eq(e, i) * neq(f, i4) * neq(h, i5) + eq(e, g) + eq(e, c), 0.0, 1.0);
  vec4 lv2Left = diff(e, g) * diff(d, g);
  vec4 lv2Up = diff(e, c) * diff(b, c);

  vec4 edr = vec4(lessThan(wd(e, c, g, i, h5, f4, h, f), wd(h, d, i5, f, i4, b, e, i))) * lv1;
  vec4 edrLeft = step(COEF * df(f, g), df(h, c)) * lv2Left * edr;
  vec4 edrUp = step(COEF * df(h, c), df(f, g)) * lv2Up * edr;

  vec4 m = max(max(edrLeft * fx30, edrUp * fx60), edr * fx45);
  vec4 px = step(df(e, f), df(e, h));

  vec3 r1 = mix(E, mix(H, F, px.x), m.x);
  vec3 r2 = mix(E, mix(B, D, px.z), m.z);
  r1 = mix(r1, r2, step(cdf(E, r1), cdf(E, r2)));
  vec3 r3 = mix(E, mix(F, B, px.y), m.y);
  vec3 r4 = mix(E, mix(D, H, px.w), m.w);
  r3 = mix(r3, r4, step(cdf(E, r3), cdf(E, r4)));
  color = vec4(mix(r1, r3, step(cdf(E, r1), cdf(E, r3))), 1.0);
}`;

// AdvMAME3x: each source pixel becomes 3x3, its corners and edges taken from the neighbours
// where two of them agree across a corner.
const SCALE3X = `#version 300 es
precision highp float;
uniform sampler2D src;
uniform vec2 srcSize;
uniform vec2 outSize;
out vec4 color;
vec3 at(ivec2 p) { return texelFetch(src, clamp(p, ivec2(0), ivec2(srcSize) - 1), 0).rgb; }
bool same(vec3 a, vec3 b) { return all(lessThan(abs(a - b), vec3(0.004))); }
void main() {
  vec2 pos = vec2(gl_FragCoord.x, outSize.y - gl_FragCoord.y) / outSize * srcSize;
  ivec2 p = ivec2(floor(pos));
  ivec2 q = ivec2(floor(fract(pos) * 3.0));
  int k = q.y * 3 + q.x;
  vec3 A = at(p + ivec2(-1, -1)), B = at(p + ivec2(0, -1)), C = at(p + ivec2(1, -1));
  vec3 D = at(p + ivec2(-1, 0)), E = at(p), F = at(p + ivec2(1, 0));
  vec3 G = at(p + ivec2(-1, 1)), H = at(p + ivec2(0, 1)), I = at(p + ivec2(1, 1));
  bool db = same(D, B) && !same(D, H) && !same(B, F);
  bool bf = same(B, F) && !same(B, D) && !same(F, H);
  bool dh = same(D, H) && !same(D, B) && !same(H, F);
  bool hf = same(H, F) && !same(D, H) && !same(B, F);
  vec3 r = E;
  if (k == 0) r = db ? D : E;
  else if (k == 1) r = (db && !same(E, C)) || (bf && !same(E, A)) ? B : E;
  else if (k == 2) r = bf ? F : E;
  else if (k == 3) r = (db && !same(E, G)) || (dh && !same(E, A)) ? D : E;
  else if (k == 5) r = (bf && !same(E, I)) || (hf && !same(E, C)) ? F : E;
  else if (k == 6) r = dh ? D : E;
  else if (k == 7) r = (dh && !same(E, I)) || (hf && !same(E, G)) ? H : E;
  else if (k == 8) r = hf ? F : E;
  color = vec4(r, 1.0);
}`;

// An arcade monitor: each of the 224 lines is a beam whose height grows with its brightness,
// colours blend sideways a little, an aperture grille splits the output into RGB stripes, and
// the glass is slightly curved with darker corners.
const CRT = `#version 300 es
precision highp float;
uniform sampler2D src;
uniform vec2 srcSize;
uniform vec2 outSize;
out vec4 color;
vec3 lin(vec3 c) { return pow(c, vec3(2.4)); }
vec3 at(ivec2 p) { return lin(texelFetch(src, clamp(p, ivec2(0), ivec2(srcSize) - 1), 0).rgb); }
// one line of the picture at x, blending neighbouring pixels sideways
vec3 line(float x, int y) {
  float fx = x - 0.5, f = fract(fx);
  int x0 = int(floor(fx));
  float s = smoothstep(0.2, 0.8, f);
  return mix(at(ivec2(x0, y)), at(ivec2(x0 + 1, y)), s);
}
void main() {
  vec2 uv = vec2(gl_FragCoord.x, outSize.y - gl_FragCoord.y) / outSize;
  // curved glass
  vec2 cc = uv * 2.0 - 1.0;
  cc *= 1.0 + vec2(0.035, 0.05) * (cc.yx * cc.yx);
  uv = cc * 0.5 + 0.5;
  if (any(lessThan(uv, vec2(0.0))) || any(greaterThan(uv, vec2(1.0)))) { color = vec4(0, 0, 0, 1); return; }
  vec2 pos = uv * srcSize;
  int y0 = int(floor(pos.y - 0.5));
  float dy = pos.y - 0.5 - float(y0);
  vec3 a = line(pos.x, y0), b = line(pos.x, y0 + 1);
  // beams: wider for brighter colours
  vec3 wa = 0.24 + 0.16 * sqrt(a), wb = 0.24 + 0.16 * sqrt(b);
  vec3 col = a * exp(-dy * dy / (2.0 * wa * wa)) + b * exp(-(1.0 - dy) * (1.0 - dy) / (2.0 * wb * wb));
  // aperture grille, three output pixels to a triad
  int m = int(mod(gl_FragCoord.x, 3.0));
  vec3 mask = vec3(0.75);
  mask[m] = 1.15;
  col *= mask * 1.65;
  // darker corners
  vec2 v = uv * (1.0 - uv);
  col *= clamp(pow(v.x * v.y * 18.0, 0.18), 0.0, 1.0);
  color = vec4(pow(col, vec3(1.0 / 2.2)), 1.0);
}`;

/** the display modes, in the order the F key cycles through them */
export const MODES = [
  { name: 'ORIGINAL', frag: '' },
  { name: 'SMOOTH', frag: XBR },
  { name: 'SCALE3X', frag: SCALE3X },
  { name: 'CRT', frag: CRT },
  // AI-upscaled sprites (tools/upscale), drawn at 4x: not a filter but a different picture
  { name: 'HD', frag: '', hd: true },
] as { name: string; frag: string; hd?: boolean }[];

interface Program {
  prog: WebGLProgram;
  srcSize: WebGLUniformLocation | null;
  outSize: WebGLUniformLocation | null;
}

export class Filter {
  readonly canvas = document.createElement('canvas');
  /** index into MODES; 0 is the original picture */
  mode = 0;
  private gl: WebGL2RenderingContext | null;
  private tex: WebGLTexture | null = null;
  private progs: (Program | null)[] = [];

  constructor(private src: HTMLCanvasElement) {
    this.canvas.id = 'screen-gl';
    src.after(this.canvas);
    this.gl = this.canvas.getContext('webgl2', { alpha: false, antialias: false, preserveDrawingBuffer: false });
    if (this.gl) this.init(this.gl);
    this.show();
  }

  /** the modes this browser can show (just the original without WebGL2) */
  get modes() {
    return MODES.filter((m, i) => i === 0 || this.progs[i] || m.hd);
  }

  get name() {
    return MODES[this.mode].name;
  }

  /** whether this mode draws the AI-upscaled sprites */
  get hd() {
    return !!MODES[this.mode].hd;
  }

  private init(gl: WebGL2RenderingContext) {
    const shader = (type: number, text: string) => {
      const s = gl.createShader(type)!;
      gl.shaderSource(s, text);
      gl.compileShader(s);
      if (!gl.getShaderParameter(s, gl.COMPILE_STATUS)) console.error(gl.getShaderInfoLog(s));
      return s;
    };
    const vert = shader(gl.VERTEX_SHADER, VERT);
    this.progs = MODES.map(({ frag }) => {
      if (!frag) return null;
      const prog = gl.createProgram()!;
      gl.attachShader(prog, vert);
      gl.attachShader(prog, shader(gl.FRAGMENT_SHADER, frag));
      gl.bindAttribLocation(prog, 0, 'pos');
      gl.linkProgram(prog);
      if (!gl.getProgramParameter(prog, gl.LINK_STATUS)) {
        console.error(gl.getProgramInfoLog(prog));
        return null;
      }
      gl.useProgram(prog);
      gl.uniform1i(gl.getUniformLocation(prog, 'src'), 0);
      return { prog, srcSize: gl.getUniformLocation(prog, 'srcSize'), outSize: gl.getUniformLocation(prog, 'outSize') };
    });
    const buf = gl.createBuffer();
    gl.bindBuffer(gl.ARRAY_BUFFER, buf);
    gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([-1, -1, 3, -1, -1, 3]), gl.STATIC_DRAW);
    gl.enableVertexAttribArray(0);
    gl.vertexAttribPointer(0, 2, gl.FLOAT, false, 0, 0);
    this.tex = gl.createTexture();
    gl.bindTexture(gl.TEXTURE_2D, this.tex);
    for (const [k, v] of [[gl.TEXTURE_MIN_FILTER, gl.NEAREST], [gl.TEXTURE_MAG_FILTER, gl.NEAREST], [gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE], [gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE]])
      gl.texParameteri(gl.TEXTURE_2D, k, v);
  }

  /** Switch to a mode by name (unknown or unavailable names give the original). */
  setMode(name: string) {
    const i = MODES.findIndex((m) => m.name === name);
    this.mode = i > 0 && (this.progs[i] || MODES[i].hd) ? i : 0;
    this.show();
    this.render();
  }

  /** The next available mode along. */
  cycle() {
    const names = this.modes.map((m) => m.name);
    this.setMode(names[(names.indexOf(this.name) + 1) % names.length]);
  }

  private show() {
    this.canvas.style.display = this.progs[this.mode] ? 'block' : 'none';
    if (this.progs[this.mode]) this.fit();
  }

  /** Lay the filter canvas exactly over the game's, at the display's real pixel size. */
  fit() {
    if (!this.progs[this.mode]) return;
    const r = this.src.getBoundingClientRect(), dpr = devicePixelRatio || 1;
    Object.assign(this.canvas.style, { left: `${r.left}px`, top: `${r.top}px`, width: `${r.width}px`, height: `${r.height}px` });
    const w = Math.max(1, Math.round(r.width * dpr)), h = Math.max(1, Math.round(r.height * dpr));
    if (this.canvas.width !== w || this.canvas.height !== h) {
      this.canvas.width = w;
      this.canvas.height = h;
    }
  }

  /** Redraw the game's latest frame through the current filter. */
  render() {
    const gl = this.gl, p = this.progs[this.mode];
    if (!this.mode || !gl || !p) return;
    gl.useProgram(p.prog);
    gl.viewport(0, 0, this.canvas.width, this.canvas.height);
    gl.bindTexture(gl.TEXTURE_2D, this.tex);
    gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, gl.RGBA, gl.UNSIGNED_BYTE, this.src);
    gl.uniform2f(p.srcSize, this.src.width, this.src.height);
    gl.uniform2f(p.outSize, this.canvas.width, this.canvas.height);
    gl.drawArrays(gl.TRIANGLES, 0, 3);
  }
}
