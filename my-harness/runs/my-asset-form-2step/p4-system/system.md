# 시스템
- Figma 파일: https://www.figma.com/design/Eg36GNpIISqRjeA3WkT79g

node: 8:29

## 변수
- tokens/color (8개): ink 8:3, canvas 8:4, canvas-soft 8:5, field 8:6, hairline 8:7, text-muted 8:8, text-faint 8:9, on-primary 8:10 (모두 기존 것 재사용)
- tokens/radius (4개): radius-0, radius-16, radius-24, radius-9999 (기존 재사용)
- tokens/spacing (7개): space-4, 8, 12, 16, 24, 32, 48 (기존 재사용)
- 이번 run에서 새로 만든 변수 없음

## 텍스트 스타일
- heading-4 (18/700 Bold) — 기존 재사용
- body (15/400 Regular) — 기존 재사용
- link (15/600 Medium) — 기존 재사용
- label (12/600 Medium) — 기존 재사용, step-indicator 글자에 적용
- caption (12/400 Regular) — 기존 재사용

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
- step-indicator — 18:92 (새로 추가)

## 확인한 점
- 새로 추가한 것은 step-indicator 하나뿐이다. 54×28, 모서리 9999(설정 직후 읽은 값 9999, 네 모서리를 radius-9999 변수에 바인딩), 채움 canvas-soft 변수 바인딩(8:5), 테두리와 효과 없음, 가로 오토레이아웃(좌우 패딩 space-12 바인딩, 가운데 정렬), 글자 "1 / 2"는 label 스타일(Noto Sans KR Medium)이고 글자색은 ink 변수에 바인딩했다.
- 컨테이너 8:29 아래 노드 36개(컨테이너 자신 포함)를 순회한 결과 (a) 바인딩 안 된 SOLID 채움/선 0개, (b) 허용값 밖 반경 0개, (c) 효과가 있는 노드 0개, (d) Noto Sans KR이 아닌 TEXT 0개. 간격 허용값 밖 노드도 0개, 그라디언트 등 SOLID가 아닌 채움도 없다.
- 컨테이너 8:29는 세로 오토레이아웃(간격 24, 패딩 24), 배경 canvas 변수 바인딩을 그대로 유지한다. 자식이 12개에서 13개로 늘어 높이가 825에서 877로 커졌다(위치 0,1200 → 아래쪽 끝 2077). y=2400의 키스크린 줄과 겹치지 않는다.
- 기존 최상위 프레임은 그대로다: 7:2(자식 4), 7:101(6), 7:223(6), 8:29(13), 10:2(4), 15:36(6), 15:99(6), 15:142(8). 위치와 크기도 390×844와 기존 좌표 그대로다. 수정하지 않았다.
- 컨테이너 스크린샷 1장으로 깨짐이 없는 것을 확인했다.
- 글꼴 매핑: Pretendard 대신 Noto Sans KR, 600은 Medium.
