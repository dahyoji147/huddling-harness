# 시스템
- Figma 파일: https://www.figma.com/design/Eg36GNpIISqRjeA3WkT79g

node: 8:29

## 변수
- 컬렉션 tokens/color (모드 1개 "기본"): ink, canvas, canvas-soft, field, hairline, text-muted, text-faint, on-primary (8개, scopes 명시: 배경 FRAME_FILL/SHAPE_FILL, 글자 TEXT_FILL, hairline은 STROKE_COLOR 추가, ink는 배경과 글자 겸용)
- 컬렉션 tokens/radius (FLOAT, CORNER_RADIUS): radius-0, radius-16, radius-24, radius-9999
- 컬렉션 tokens/spacing (FLOAT, GAP): space-4, space-8, space-12, space-16, space-24, space-32, space-48

## 텍스트 스타일
- heading-4 (Noto Sans KR Bold 18, 행간 135%)
- body (Regular 15, 150%)
- link (Medium 15, 150%)
- label (Medium 12, 140%)
- caption (Regular 12, 140%)

## 컴포넌트
- top-bar — 8:30
- icon-button — 8:32
- text-input — 8:34
- chip/미선택 — 8:36
- chip/선택 — 8:38
- chip-tag-selected — 8:40
- file-attach-row — 8:43
- file-preview-row — 8:46
- visibility-row — 8:52
- button-primary — 8:57
- button-primary-disabled — 8:59
- notice-text — 8:61

## 확인한 점
- 컨테이너 `시스템 · 토큰과 컴포넌트`(x=0, y=1200, 438×825): 채움 0개, 세로 오토레이아웃, 간격 24, 패딩 24. 컨테이너 아래 노드 34개(TEXT 18개) 전수 순회.
- (a) 바인딩 안 된 SOLID 채움/선: 0건. 모든 채움은 setBoundVariableForPaint로 바인딩, 쓰지 않는 채움은 fills=[]. 선(stroke)은 쓰지 않음.
- (b) 허용값(0/16/24/9999) 밖 반경 노드: 0건. pill 노드 9개(icon-button 높이 40, chip/미선택, chip/선택, chip-tag-selected 각 32, file-attach-row 48, 제거 버튼 32, visibility-row 56, button-primary 52, button-primary-disabled 52)는 설정 직후와 순회 시 모두 cornerRadius=9999로 읽혔다(높이/2로 줄어들지 않음). text-input과 file-preview-row는 16.
- (c) 효과가 있는 노드: 0건.
- (d) Noto Sans KR이 아닌 TEXT: 0건. 파랑(#0066ff) 미사용.
- 글꼴 매핑: Pretendard 없음, Noto Sans KR 사용. 700은 Bold, 600은 Medium(SemiBold 스타일 없음), 400은 Regular. 모든 텍스트에 텍스트 스타일 적용.
- 아이콘은 텍스트 글리프(‹ › ✕ ＋)를 사용. chip 미선택/선택은 별도 컴포넌트 2개로 만들었다. 칩은 가로 hug(좌우 패딩 16)이고, 터치 영역 44는 컴포넌트에 반영하지 않았다.
- 텍스트 내용은 설계서의 일반 문구만 사용(이메일, 전화번호, 실명, 회사명 없음).
- 키스크린 3장 그대로 확인: 7:2(하위 98개), 7:101(121개), 7:223(122개), 이름과 위치 변동 없음. 페이지 최상위 노드는 키스크린 3장과 컨테이너 8:29뿐이다.
- 컨테이너 스크린샷으로 컴포넌트 12개가 깨짐 없이 세로로 배열된 것을 확인했다.
