import { test } from 'vitest';
import { factory, lifted, raiding } from './fixture';
import { tick } from './tick';

const DT = 0.1;
/** 猫が働き出すまで 5 秒進めた工場 */
function warm(cats: number, buildings: number, size: number) {
  const s = factory(cats, buildings, size);
  for (let i = 0; i < 50; i++) tick(s, DT);
  return s;
}

test('1 tick', { timeout: 120_000 }, async ({ bench }) => {
  const a = warm(50, 150, 36);
  const b = warm(100, 300, 60);
  const c = raiding(warm(50, 150, 36));
  const d = raiding(warm(100, 300, 60));
  const e = lifted(2000, 2);
  await bench.compare(
    bench('(a) 猫 50・建物 150・36×36', () => void tick(a, DT)),
    bench('(b) 猫 100・建物 300・60×60', () => void tick(b, DT)),
    bench('(c) (a) + 襲撃中の犬 40・水鉄砲 12', () => void tick(c, DT)),
    bench('(d) (b) + 襲撃中の犬 40・水鉄砲 12', () => void tick(d, DT)),
    bench('(e) リフト 2000 タイル・品 4000 個', () => void tick(e, DT)),
    { time: 3000 },
  );
});
