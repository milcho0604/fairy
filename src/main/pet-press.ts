// 펫 창에서 마지막으로 마우스를 누른 때 (pointerdown). 누르는 순간 맥이 앱을 깨워 큰 창이 포커스를 받으니,
// 클릭이 닿기 전의 "맨 앞이었나" 를 가르는 데 쓴다 (shared/front-memo.ts)
let last: number | undefined;

export const markPetPress = (): void => {
  last = Date.now();
};

export const lastPetPress = (): number | undefined => last;
