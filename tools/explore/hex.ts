import { loadRoms } from '../rom';
const [p, a, l] = process.argv.slice(2);
const { prog } = loadRoms(p);
const s = parseInt(a, 16);
for (let o = s; o < s + parseInt(l ?? '100', 16); o += 16) console.log(o.toString(16).padStart(6, '0'), [...prog.slice(o, o + 16)].map((b) => b.toString(16).padStart(2, '0')).join(' '));
