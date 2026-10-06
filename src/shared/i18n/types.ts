// 사전 모양. 한국어 사전(ko)이 기준이고 다른 말 사전은 같은 키를 모두 가져야 한다.

/** 값이 글이면 글, 함수면 같은 인자를 받는 함수. 빠진 키나 남는 키는 타입 오류가 난다. */
export type Translation<T> = {
  [K in keyof T]: T[K] extends (...args: infer A) => string ? (...args: A) => string : string;
};
