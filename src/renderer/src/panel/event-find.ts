/** 통합 검색 결과에서 일정 탭이 선택한 회차를 보여 줄 보기 */
export function eventFindDestination(view: 'list' | 'calendar', inList: boolean): 'list' | 'calendar' {
  return view === 'calendar' || !inList ? 'calendar' : 'list';
}
