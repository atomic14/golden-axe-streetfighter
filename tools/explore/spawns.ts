import { loadRoms } from '../rom';
import { spawns, stops, AREAS } from '../spawns';
const { prog } = loadRoms(process.argv[2]);
const h = (n: number) => n.toString(16);
for (let a = 0; a < AREAS; a++) {
  console.log(`area ${a} stops ${stops(prog, a).map(h).join(' ')}`);
  for (const s of spawns(prog)[a]) console.log(`  @${h(s.trigger)} x ${h(s.x)} z ${h(s.z)} param ${h(s.param)} init ${h(s.init)}`);
}
