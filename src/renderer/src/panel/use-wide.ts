// 본문 칸 폭의 구간을 돌려주는 훅. CSS 만으로 안 되는 곳(구조가 바뀌는 배치)이 쓴다.
// 구간 값은 컨테이너 쿼리와 같다 (zone.ts). 칸 자체의 폭을 재므로 창이 아니라 칸이 바뀌어도 따라간다.
// 칸은 처음 그릴 때 없을 수 있어(데이터를 받은 뒤 그리는 껍데기) 요소를 state 로 받는다: <div ref={setEl}> 과 useWide(el)
import { useEffect, useState } from 'react';
import { type Zone, zoneOf } from './zone.ts';

export function useWide(el: HTMLElement | null): Zone {
  const [zone, setZone] = useState<Zone>('narrow');
  useEffect(() => {
    if (!el) return;
    const read = (width: number) => setZone(zoneOf(width));
    read(el.getBoundingClientRect().width);
    const ro = new ResizeObserver((entries) => {
      const box = entries[entries.length - 1]?.contentRect;
      if (box) read(box.width);
    });
    ro.observe(el);
    return () => ro.disconnect();
  }, [el]);
  return zone;
}
