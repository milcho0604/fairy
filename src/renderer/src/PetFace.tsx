/** 펫 화면의 기본 펫과 같은 얼굴. 사진 펫(P1-08)이 생기면 그 그림으로 바꾼다. */
export function PetFace() {
  return (
    <svg className="face" viewBox="0 0 40 36" aria-hidden="true">
      <ellipse cx="20" cy="19" rx="18" ry="15.5" fill="#ffd8a8" stroke="#c4854a" strokeWidth="1.5" />
      <ellipse cx="13.5" cy="17" rx="1.7" ry="2" fill="#1f2328" />
      <ellipse cx="26.5" cy="17" rx="1.7" ry="2" fill="#1f2328" />
      <ellipse cx="9.5" cy="22" rx="3" ry="1.8" fill="rgba(255,140,140,.45)" />
      <ellipse cx="30.5" cy="22" rx="3" ry="1.8" fill="rgba(255,140,140,.45)" />
      <path d="M17.5 21.5q2.5 2.4 5 0" fill="none" stroke="#1f2328" strokeWidth="1.3" strokeLinecap="round" />
    </svg>
  );
}
