# 허들링 화면 하네스

허들링 디자이너가 화면 주제를 주면, 화면 목록의 모든 화면을 390×844 Figma 완성본으로 만든다.
완료 기준은 `design.md`·★ 위반 0건이다. 자세한 내용은 `docs/purpose.md`.

## 읽을 문서
- `docs/purpose.md` 목적과 완료 기준
- `docs/pipeline.md` 단계, 복귀 지점, 폴더 구조, 종료 코드
- `docs/gates.md` 게이트와 ★ 조건, 지문 대조
- `docs/roles.md` 에이전트 역할과 트리거
- `docs/verification.md` 검증과 리뷰
- `docs/story-service.md`, `docs/prd.md`, `docs/design.md` 서비스 맥락과 디자인 기준
- `harness/agents/README.md` 단계별 에이전트 지시문 템플릿 (researcher, designer, keyscreen, system, screens)

## 트리거
- "○○ 화면 하네스 돌려줘": `runs/<slug>/`를 만들고 P1부터 실행
- "이어서 해줘": `state.json`의 현재 단계부터 실행
- "컨펌 받았어": `confirm.md`에 승인 기록, P4로 진행
- "컨펌 반려: <사유>": `confirm.md`에 반려와 사유 기록, P2로 복귀

## 오케스트레이터 규칙
1. 단계를 건너뛰지 않는다. 항상 `state.json`의 현재 단계만 실행한다.
2. 에이전트가 돌려준 블록은 가공하지 않고 태그가 가리키는 단계 폴더에만 저장한다.
3. `state.json`은 직접 쓰지 않고 스크립트로만 갱신한다.
4. `confirm.md`는 사람의 트리거가 있을 때만 `HARNESS_HUMAN=1 node harness/state.mjs confirm ...`으로 기록한다. 사람의 트리거 없이 이 값을 붙이지 않고, 스스로 승인하지 않는다. `harness/pin.mjs`도 마찬가지다.
5. 게이트 판정은 judge 스크립트 결과만 믿는다. 에이전트의 "통과했다"는 말은 믿지 않는다.
6. 같은 게이트에서 3회 실패하면 멈추고 사람에게 보고한다.
7. 규칙은 `harness/rules.yaml`만 읽는다. 규칙 숫자를 이 파일에 복사하지 않는다.
8. 종료 코드: 0 통과, 1 실패 또는 대기(`state.json`으로 구분), 2 오류(실패 횟수에 넣지 않고 보고), 3 차단(스스로 풀지 않고 보고).
9. 새 run의 첫 실행에는 G1 최소 개수, slug 규칙, ★ A 금지어 목록을 먼저 묻는다. Figma 파일은 아래 기본 파일을 쓰고, 다른 파일을 쓸지만 묻는다.
10. 에이전트를 부를 때는 `harness/agents/<역할>.md` 템플릿을 읽고 `{{slug}}`, `{{figma_file_key}}`만 채워 그대로 쓴다. 지시문을 대화에서 새로 쓰거나 줄이지 않는다. 템플릿이 틀렸으면 고치기 전에 사람에게 알린다.
11. 컨펌 기록, 해시 갱신, `harness/` 편집은 훅(`harness/guard.mjs`)이 사람 확인 창을 띄운다. 확인 창을 우회하거나 훅 설정(`.claude/settings.json`)을 고치지 않는다.

## 기본 Figma 파일
- 파일 키: `Eg36GNpIISqRjeA3WkT79g`
- 링크: https://www.figma.com/design/Eg36GNpIISqRjeA3WkT79g
- 새 run을 시작할 때 `node harness/state.mjs init <slug> <input.md> --figma Eg36GNpIISqRjeA3WkT79g`로 넘긴다.
- judge가 REST API로 읽으려면 환경 변수 `FIGMA_TOKEN`(File content 읽기 권한)이 필요하다. 토큰 값은 채팅이나 파일에 적지 않는다.

## 점검 명령
- `npm test`: 판정 테스트와 문서 경로 테스트를 한 번에 돌린다. **규칙(`rules.yaml`)이나 판정 코드를 고칠 때마다** 돌려서 기존 판정이 깨졌는지 확인한다.
- `npm run check`: judge 코드, `rules.yaml`, 훅이 고정된 해시와 같은지(`node harness/check-pin.mjs`)와 테스트를 같이 확인한다.
- 판정 코드나 `rules.yaml`을 고친 뒤에는 사람이 `HARNESS_HUMAN=1 node harness/pin.mjs`로 해시를 다시 고정해야 judge가 동작한다.

## 보고 형식
한 문단으로 "어느 단계, 어느 게이트, 위반 규칙 이름과 건수, 사람이 할 일"만 쓴다.

## 금지
- 에이전트의 export, JSON, 스크린샷을 판정 근거로 쓰지 않는다.
- `harness/rules.yaml`, judge 스크립트, `design.md`를 임의로 수정하지 않는다.
