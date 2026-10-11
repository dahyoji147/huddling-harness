# 역할 (R6)

## 에이전트

| 역할 | 하는 일 | 읽기 | 저장 위치 (메인 세션이 저장) |
|---|---|---|---|
| researcher | 레퍼런스 수집, 반영 포인트 선별 | `input.md`, uibowl | `runs/<slug>/p1-research/` |
| designer | 화면 설계 | `p1-research/`, PRD | `runs/<slug>/p2-design/` |
| keyscreen | 키스크린 2~3개 제작 | `p2-design/`, `design.md` | `runs/<slug>/p3-keyscreens/` |
| system | 토큰, 컴포넌트 제작 | `p3-keyscreens/`, `design.md` | `runs/<slug>/p4-system/` |
| screens | 전체 화면 제작 | `p4-system/`, `p2-design/` | `runs/<slug>/p5-screens/` |
| judge (읽기전용) | 판정 스크립트만 실행 | 전부, `rules.yaml`, Figma | 없음 (스크립트가 `verdict/`에 기록) |

## 에이전트 지시문
- 각 에이전트의 지시문은 `harness/agents/<역할>.md` 템플릿에 있다(`harness/agents/README.md` 참조). 오케스트레이터는 `{{slug}}`, `{{figma_file_key}}`만 채워 그대로 쓰고 대화에서 새로 쓰지 않는다.
- 템플릿의 `입력:` 줄은 에이전트가 읽을 파일, `출력:` 줄은 블록으로 돌려줄 파일이다. 폴더 구조와 맞는지는 `harness/tests/docs-paths.test.mjs`가 확인한다.

## 저장 방식

- 작업 에이전트 5개는 로컬 파일을 직접 쓰지 않는다. 결과를 `단계 + 파일명` 태그가 붙은 블록으로 돌려준다.
- 메인 세션은 블록을 태그가 가리키는 단계 폴더에만 그대로 저장한다. 가공하거나 다른 폴더에 쓰지 않는다.
- 블록에 단계 태그가 없거나 허용 폴더와 다르면 저장하지 않고 그 에이전트를 한 번 다시 호출한다. 이 실패는 해당 게이트의 실패 횟수(3회 한도)에 포함한다.
- keyscreen, system, screens는 Figma에는 직접 쓰고, 노드 ID와 링크를 블록으로 반환한다. Figma 쓰기는 지문 대조(`gates.md`)로 검증한다.
- `confirm/confirm.md`는 사람의 트리거를 받은 메인 세션만 기록한다. `state.json`은 스크립트만 쓴다.
- judge는 파일을 편집하지 않고 판정 스크립트를 실행해 결과만 보고한다. 에이전트가 만든 export, JSON, 스크린샷은 입력으로 받지 않고 Figma에서 직접 읽은 값만 쓴다.

## 자연어 트리거

| 말 | 동작 |
|---|---|
| "○○ 화면 하네스 돌려줘" | `runs/<slug>/`를 만들고 P1부터 실행 |
| "이어서 해줘" | `state.json`의 현재 단계부터 이어서 실행 |
| "컨펌 받았어" | `confirm.md`에 `approved` 기록, P4로 진행 |
| "컨펌 반려: <사유>" | `confirm.md`에 `rejected`와 사유 기록, P2로 복귀 |
