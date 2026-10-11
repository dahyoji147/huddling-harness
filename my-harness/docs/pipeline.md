# 파이프라인과 산출물 (R3, R4)

## 단계 (R3)

| 단계 | 이름 | 입력 | 출력 |
|---|---|---|---|
| P1 | 리서치 | 화면 주제, 화면 목록 | 레퍼런스 모음, 반영 포인트 목록 |
| P2 | 설계 | 반영 포인트 목록, PRD | 화면 설계 (정보 구조, 플로우) |
| P3 | 시안 | 화면 설계, `design.md` | 키스크린 2~3개 |
| 👤 | 컨펌 | 키스크린 | 승인 또는 반려 (사람) |
| P4 | 시스템 | 컨펌된 키스크린, `design.md` | 토큰, 컴포넌트 |
| P5 | 플로우 화면 | 토큰, 컴포넌트, 화면 설계 | 화면 목록 전체의 390×844 완성본 |
| 판정 | 검토 | P5 결과 | 규칙별 위반 건수 (스크립트) |

원래 7단계와의 대응: 1·2 → P1, 3 → P2, 4 → P3, 5 → 컨펌, 6 → P4·P5, 7 → 판정.

## 되돌아가는 지점

- 컨펌 반려 → P2
- 설계에 반영 포인트 부족 → P1
- 판정에서 토큰·컴포넌트 위반(반경, 그림자, 색, 글꼴) → P4
- 판정에서 화면 위반(프레임 크기, ★ A·B) → P5
- 같은 게이트에서 3회 실패하면 차단하고 사람에게 보고한다. (`gates.md` 참조)

## 산출물 (R4)

규칙 SSOT는 `harness/rules.yaml` 하나다. 에이전트 프롬프트와 판정 스크립트는 이 파일만 읽는다.

```
harness/
  rules.yaml                  ← 규칙 SSOT
runs/<slug>/
  state.json                  ← 스크립트만 씀 (에이전트는 읽기만)
  input.md                    ← 화면 주제, 화면 목록
  p1-research/references.md   ← 레퍼런스 모음 (출처 URL 포함)
  p1-research/points.md       ← 반영 포인트 목록
  p2-design/design.md         ← 화면 설계 (정보 구조, 플로우)
  p3-keyscreens/keyscreens.md ← 키스크린 2~3개의 Figma 노드 링크
  confirm/confirm.md          ← 컨펌 결과 (approved 또는 rejected + 사유)
  p4-system/system.md         ← 토큰, 컴포넌트 목록과 Figma 링크
  p5-screens/screens.md       ← 화면별 Figma 노드 링크와 프레임 크기
  verdict/verdict.json        ← 규칙별 위반 건수 (판정 스크립트 출력)
```

- `state.json` 항목: `slug`, `figma_file_key`, `input_hash`, `current_stage`, `completed_stages[]`, `gate_failures{게이트: 연속 실패 횟수, reconfirm: 연속 재컨펌 횟수}`, `confirm_status`, `fingerprints{단계: 지문}`, `blocked`, `updated_at`
- 재개: 스크립트가 `state.json`의 현재 단계를 읽고 그 단계 폴더부터 다시 시작한다.
- 폴더 하나는 한 에이전트만 편집한다.
- Figma: `CLAUDE.md`의 기본 Figma 파일을 쓴다(run을 시작할 때 `--figma <파일키>`로 넘김). 다른 파일을 쓸지만 묻는다. 단계 파일에는 노드 ID와 링크만 적는다.
- 첫 실행에 Figma 링크 외에 정하지 않은 기본값도 묻는다: G1 최소 개수(5), slug 규칙(영문 소문자와 하이픈), ★ A 금지어 목록(빈 목록).
- 종료 코드: 0 통과, 1 실패 또는 대기(`state.json`으로 구분), 2 오류(실패 횟수에 넣지 않음), 3 차단(스스로 풀지 않고 사람에게 보고).
