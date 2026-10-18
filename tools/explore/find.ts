// Search the program ROM for a sequence of words (hex, "?" = any).
import { loadRoms, rw } from '../rom';
const [path, ...pat] = process.argv.slice(2);
const { prog } = loadRoms(path);
const words = pat.map((w) => (w === '?' ? -1 : parseInt(w, 16)));
for (let o = 0; o + words.length * 2 <= prog.length; o += 2) {
  if (words.every((w, i) => w < 0 || rw(prog, o + i * 2) === w)) {
    const ctx: string[] = [];
    for (let i = -4; i < words.length + 6; i++) ctx.push(rw(prog, o + i * 2).toString(16).padStart(4, '0'));
    console.log(o.toString(16).padStart(6, '0'), ctx.join(' '));
  }
}
