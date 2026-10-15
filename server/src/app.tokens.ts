// 주입 이름표. 클래스가 아닌 값(설정, 구글 API)을 Nest 에 넘길 때 쓴다.
export const CONFIG = Symbol('CONFIG');
export const GOOGLE_API = Symbol('GOOGLE_API');
