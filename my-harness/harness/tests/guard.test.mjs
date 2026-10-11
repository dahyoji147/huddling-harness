// 실행: node --test harness/tests/guard.test.mjs
// 훅이 stdin 으로 받는 JSON 을 그대로 흉내 내서 guard.mjs 가 보호 대상만 사람 확인(ask)으로 돌리는지 확인한다.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const HARNESS = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const ROOT = path.resolve(HARNESS, '..');

function guard(input, raw) {
  const r = spawnSync('node', [path.join(HARNESS, 'guard.mjs')], { input: raw ?? JSON.stringify({ cwd: ROOT, ...input }), encoding: 'utf8' });
  assert.equal(r.status, 0);
  return r.stdout ? JSON.parse(r.stdout).hookSpecificOutput : null;
}
const edit = (file_path) => ({ tool_name: 'Edit', tool_input: { file_path } });
const bash = (command) => ({ tool_name: 'Bash', tool_input: { command } });

test('G1. 판정 규칙과 코드를 고치려 하면 사람 확인을 요구한다', () => {
  for (const f of ['harness/rules.yaml', 'harness/judge.mjs', 'harness/lib/checks.mjs', 'harness/tests/harness.test.mjs']) {
    const out = guard(edit(f));
    assert.equal(out?.permissionDecision, 'ask', f);
    assert.equal(out.hookEventName, 'PreToolUse');
  }
});

test('G2. 디자인 기준, 오케스트레이터 규칙, 훅 설정, 승인·상태·판정 기록도 보호한다', () => {
  for (const f of ['docs/design.md', 'CLAUDE.md', '.claude/settings.json', 'runs/x/state.json', 'runs/x/confirm/confirm.md', 'runs/x/verdict/verdict.json']) {
    assert.equal(guard(edit(f))?.permissionDecision, 'ask', f);
  }
});

test('G3. 절대 경로로 가리켜도 같은 보호가 적용된다', () => {
  assert.equal(guard(edit(path.join(ROOT, 'harness', 'rules.yaml')))?.permissionDecision, 'ask');
});

test('G4. 에이전트 블록을 저장하는 단계 폴더와 프로젝트 밖 파일은 막지 않는다', () => {
  for (const f of ['runs/x/p2-design/design.md', 'runs/x/p5-screens/screens.md', 'runs/x/input.md', 'docs/prd.md']) {
    assert.equal(guard(edit(f)), null, f);
  }
  assert.equal(guard(edit(path.join(ROOT, '..', 'other-project', 'harness', 'rules.yaml'))), null);
});

test('G5. 사람만 해야 하는 명령(컨펌 기록, 해시 갱신)은 확인을 요구한다', () => {
  assert.equal(guard(bash('HARNESS_HUMAN=1 node harness/state.mjs confirm x approved'))?.permissionDecision, 'ask');
  assert.equal(guard(bash('node harness/pin.mjs'))?.permissionDecision, 'ask');
});

test('G6. 보호 경로를 쓰기·삭제·이동하는 셸 명령은 확인을 요구하고, 읽기·판정 실행은 막지 않는다', () => {
  for (const c of ['sed -i s/a/b/ harness/rules.yaml', 'echo x > harness/judge.mjs', 'rm harness/rules.yaml', 'mv runs/x/state.json /tmp/s.json', 'cp a CLAUDE.md']) {
    assert.equal(guard(bash(c))?.permissionDecision, 'ask', c);
  }
  for (const c of ['node harness/judge.mjs x G1', 'node --test harness/tests/', 'cat harness/rules.yaml', 'git status', 'ls runs']) {
    assert.equal(guard(bash(c)), null, c);
  }
});

test('G7. 입력이 깨져 있으면 허용하지 않고 사람 확인으로 돌린다 (닫힌 쪽 실패)', () => {
  assert.equal(guard(null, '이건 JSON 이 아니다')?.permissionDecision, 'ask');
});

test('G8. cwd 가 이상한 값(MSYS 경로, 프로젝트 밖)이어도 상대 경로의 보호 대상은 허용으로 새지 않는다', () => {
  for (const cwd of ['/c/Users/gkdud/work-experiments/my-harness', 'C:\somewhere\else', '']) {
    const out = guard({ tool_name: 'Edit', cwd, tool_input: { file_path: 'harness/rules.yaml' } });
    assert.equal(out?.permissionDecision, 'ask', `cwd=${cwd}`);
  }
  // 일반 단계 파일은 여전히 막지 않는다
  assert.equal(guard({ tool_name: 'Edit', cwd: '/c/x', tool_input: { file_path: 'runs/x/p2-design/design.md' } }), null);
});
