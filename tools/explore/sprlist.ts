import { readDump, sprites, u16 } from '../dumpfile';
const [path, ...fr] = process.argv.slice(2);
const want = new Set(fr.map(Number));
for (const f of readDump(path)) {
  if (!want.has(f.frame)) continue;
  const t = (o: number) => u16(f.text, o).toString(16).padStart(4, '0');
  console.log(`frame ${f.frame} pages fg ${t(0xe80)} bg ${t(0xe82)} vs fg ${t(0xe90)} bg ${t(0xe92)} hs fg ${t(0xe98)} bg ${t(0xe9a)}`);
  for (const s of sprites(f)) if (!s.hide) console.log(`  #${s.i} x${s.x - 184} y${s.top}-${s.bottom} pitch ${s.pitch} ${s.flip ? 'F' : ' '} bank ${s.bank} addr ${s.addr.toString(16)} pri ${s.pri} pal ${s.pal} zoom ${s.zoom.toString(16)}`);
}
