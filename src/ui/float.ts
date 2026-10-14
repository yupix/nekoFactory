import { ICON } from './icons';

const POOL = 30;

/** 画面座標に浮かび上がって消える文字（DOM プール、上限 30） */
export function createFloaters() {
  const pool: HTMLDivElement[] = [];
  let next = 0;
  return function spawn(text: string, x: number, y: number, kind: 'coin' | 'rp' | 'lv') {
    let el = pool[next];
    if (!el) {
      el = pool[next] = document.createElement('div');
      document.body.appendChild(el);
    }
    next = (next + 1) % POOL;
    el.className = `float ${kind}`;
    el.innerHTML = `<i>${kind === 'coin' ? ICON.coin : kind === 'rp' ? ICON.rp : ICON.sparkle}</i><span></span>`;
    el.querySelector('span')!.textContent = text;
    el.style.left = `${x}px`;
    el.style.top = `${y}px`;
    // 再利用時にアニメーションを最初から再生する
    el.style.animation = 'none';
    void el.offsetWidth;
    el.style.animation = '';
  };
}
