tap('Enter'); advance(20);
await sleep(1500);
const a = window.audio;
const info = { ctx: !!a.ctx, state: a.ctx?.state, clips: Object.keys(a.clips).length, current: a.current?.id ?? null };
a.sfx('swing'); a.sfx('hit');
await sleep(1000);
info.buffers = [...a.buffers.keys()];
info.current2 = a.current?.id ?? null;
return info;
