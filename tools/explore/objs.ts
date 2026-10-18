// List active objects (0xffc000.., 0x80 bytes each) for given frames.
import { readDump, u16, u32 } from '../dumpfile';
const [path, ...fr] = process.argv.slice(2);
const want = new Set(fr.map(Number));
for (const f of readDump(path)) {
  if (!want.has(f.frame)) continue;
  console.log('frame', f.frame);
  for (let o = 0; o < 0x2000; o += 0x80) {
    const w0 = u16(f.work, o);
    if (!w0) continue;
    const h = (n: number) => n.toString(16);
    console.log(`  ${h(0xffc000 + o)} f0 ${h(w0)} code ${h(u32(f.work, o + 2))} frame ${h(u16(f.work, o + 6))} slot ${f.work[o + 8]} pal ${h(f.work[o + 0xb])} d ${h(f.work[o + 0xd])} x ${h(u16(f.work, o + 0x10))} z ${h(u16(f.work, o + 0x14))} y ${h(u16(f.work, o + 0x18))} anim ${h(u32(f.work, o + 0x28))} hp ${f.work[o + 0x70]}`);
  }
}
