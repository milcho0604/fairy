// 끝말잇기 내장 단어 (AI 없이 펫이 고르는 말). 흔하고 순한 명사만 둔다.
// 사용자 말은 사전을 보지 않고 믿어 준다 (규칙: 글자 모양, 첫 글자, 같은 말). 이 목록은 펫이 이을 말이다.
// 같은 말이 두 번 들어가도 시험이 잡는다 (word-chain.test.ts).

export const KO_WORDS: readonly string[] = `
가방 가위 가수 가족 가지 가을 가게 가구 가로등 가루 가면 가슴 가시 가요 가치 각도 간식 간장 갈비 갈매기 감기 감자 감동 감사 강물 강아지 강의 개구리 개나리 개미 거미 거북이 거울 거리 거품 건물 건강 걸음 검사 게임 겨울 결과 결심 경기 경주 경찰 계단 계란 계절 고구마 고기 고래 고무 고양이 고추 고향 고드름 곰돌이 공기 공룡 공부 공원 공주 공책 공항 과일 과자 과학 관심 광장 괴물 교실 교과서 구두 구름 구슬 국수 국자 군고구마 궁전 귀신 귤껍질 그림 그네 그릇 극장 글씨 금요일 기린 기차 기분 기억 기적 기타 기침 김밥 김치 까치 깃발 꼬리 꽃게 꽃병 꿀벌 꿈나라
나무 나비 나라 나이 나팔 낙타 낚시 난로 날개 날씨 남극 낮잠 냄비 냉면 냉장고 너구리 노래 노을 녹차 놀이터 농구 누나 눈사람 눈썹 뉴스 늑대 다람쥐 다리 다리미 단추 달걀 달님 달력 달팽이 담요 당근 대나무 대문 대추 도넛 도시락 도마 도서관 도토리 독수리 돌고래 동굴 동물 동생 돼지 된장 두부 두더지 뒤꿈치 드럼 등대 딸기 땅콩 떡볶이 뚜껑 라면 라디오 레몬 로봇 리본 리듬
마늘 마당 마술 마을 마음 만두 만화 말벌 망치 매미 머리 먼지 메뚜기 메아리 멸치 모기 모래 모자 목도리 목걸이 목요일 몽당연필 무지개 무릎 문어 물고기 물감 물개 미소 미역 미술 민들레 바나나 바다 바람 바위 바지 박수 반지 반딧불 발가락 밤송이 밥상 방석 방울 배추 배꼽 백조 버섯 버스 번개 벌레 베개 별자리 병아리 보름달 보물 보리 복숭아 볼펜 봉투 부엉이 부채 북극곰 분수 불꽃 붕어빵 비누 비둘기 비행기 빗자루 빨대 빵집 뽀뽀
사과 사다리 사슴 사자 사탕 산책 산타 상자 상추 새우 색종이 생선 생일 샤워 서랍 선물 선생님 설탕 섬나라 세수 소금 소나기 소풍 손수건 송편 수건 수박 수영 숙제 순두부 숟가락 시계 시소 식빵 신발 실내화 썰매 쓰레기 씨앗 스웨터 스키 스케치북 스티커 슬리퍼 시금치 아기 아빠 아이스크림 악어 안경 앵무새 야구 야자수 약속 양말 양파 어항 얼룩말 얼음 엄마 엉덩이 여름 여우 여행 연필 열쇠 염소 영화 오리 오이 오징어 옥수수 온천 올빼미 요리 요정 우산 우유 우주 운동 원숭이 유리 유령 은행 의자 이불 이빨 인형 일기 잉어
자두 자석 자전거 잠자리 장갑 장미 재채기 저금통 전화 젓가락 접시 정원 제비 조개 조약돌 종이 주머니 주사위 주스 줄넘기 지구 지도 지우개 지팡이 짜장면 참새 참외 창문 책상 책가방 천사 천둥 청소 초콜릿 초밥 축구 치즈 치약 친구 칠판 침대 카레 카메라 캥거루 커튼 컵라면 케이크 코끼리 코알라 콩나물 크레파스 크리스마스 큰곰 키위 타조 탁구 태양 택시 토끼 토마토 통조림 튤립 트럭 트럼펫 티셔츠
파도 파랑새 파인애플 팥빙수 팽이 펭귄 편지 포도 포크 폭포 풍선 풍차 피아노 피자 하늘 하마 학교 할머니 할아버지 해바라기 해님 햄버거 햇살 향기 호랑이 호박 호수 홍차 화분 화가 황소 후추 휴지 흙탕물 희망
가방끈 각설탕 간호사 감나무 개울 거위 경단 고등어 곡식 곰인형 구급차 국화 기러기 기와집 꼭두각시 꽃다발 나침반 낙엽 남자 내일 노란색 노루 눈동자 다슬기 단풍 달리기 대통령 도깨비 도장 동화책 두꺼비 들국화 땅굴 라일락 마라톤 마법사 망원경 머핀 멍멍이 모닥불 모험 무당벌레 문방구 물방울 미끄럼틀 바구니 박물관 반찬 밤하늘 버터 벽돌 별똥별 보자기 부침개 비타민 빨래 사진기 산딸기 삼각형 생쥐 소방차 소시지 솜사탕 수달 수첩 숨바꼭질 스펀지 시냇물 신호등 아침 앞치마 약국 양초 어린이 엽서 옷걸이 왕관 요구르트 우체통 운동화 은하수 이슬 자장가 잔디 저녁 전등 제과점 조랑말 주전자 지렁이 진주 차표 채소 촛불 침팬지 칼국수 코스모스 쿠키 토스트 파스타 팝콘 표범 프라이팬 하모니카 한글 햄스터 허수아비 호두 호루라기 화살 휘파람 흰둥이
기념일 일요일 일출 재미 미끄럼 수레 레고 고슴도치 치타 타자기 기차역 역사 사랑 랑데부 부모님 님프 포스터 터널 널빤지 지하철 철새 새벽 벽시계 계곡 곡선 선풍기 기름 이야기 기술 술래 내기 기온 온도 도라지 지붕 붕대 대장 장난감 감귤 귀걸이 이름표 표지판 판다 다이아몬드 드레스 스프 프린터 터번 번데기 기념품 품앗이 이웃 웃음 음악 악기 기사 사막 막대기 기지개 개똥벌레 레인코트 트램펄린 린스 스노우볼 볼링 링거 거인 인사 사슬 슬픔
`
  .split(/\s+/)
  .filter((w) => w.length >= 2);

export const EN_WORDS: readonly string[] = `
apple ant arrow acorn anchor attic avocado airplane alarm almond album angel ankle apron aquarium
ball banana basket bear bee bell bicycle bird blanket boat book boot bread brush bubble bucket bunny butter button
cake camel candle candy carrot castle cat cherry chicken cloud clock cookie corn cow crayon crown cupcake curtain
daisy dance desk dinosaur dog doll dolphin donut door dragon dream drum duck dumpling
eagle earth egg elephant elf engine envelope eraser evening
fairy feather fence fern fire fish flag flower flute fox frog fruit
garden ghost giraffe glove goat gold goose grape grass guitar gum
hammer hamster hat hedgehog helmet hippo honey horse hug
ice igloo iguana ink insect island
jacket jam jar jellyfish jelly juice jungle
kangaroo kettle key kite kitten kiwi koala
ladder lake lamp leaf lemon lion lizard llama lollipop
magnet mango map marble melon milk mitten monkey moon mouse muffin mushroom
nail napkin necklace nest net noodle nose nut
oak ocean octopus olive onion orange otter owl
paint panda parrot peach pencil penguin piano pillow pizza planet pocket pony puppy
quail queen quilt quiet
rabbit rain rainbow robot rocket rose ruler
salad sandwich scarf shell sky snail snow sock spoon star strawberry sun swing
table teapot tent tiger toast tomato tooth towel train tree turtle
umbrella unicorn uniform
vase violin volcano
wagon walrus watch water whale window wolf
yak yarn yogurt yoyo
zebra zero zoo
`
  .split(/\s+/)
  .filter((w) => /^[a-z]{2,}$/.test(w));
