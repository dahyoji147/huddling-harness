#!/usr/bin/env node
// Claude Code PreToolUse 훅: 하네스의 판정 코드와 승인 기록을 에이전트가 몰래 바꾸지 못하게 한다.
// stdin 으로 { tool_name, tool_input, cwd } JSON 을 받고, 보호 대상이면 사람 확인(ask)을 요구하는 JSON 을 출력한다.
// 보호 대상이 아니면 아무것도 출력하지 않고 0 으로 끝난다(평소 권한 흐름 그대로).
// 입력을 읽지 못하는 등 이상이 생겨도 허용하지 않고 ask 로 돌린다(닫힌 쪽 실패).
import path from 'node:path';
import { HARNESS_DIR } from './lib/paths.mjs';

const ROOT = path.resolve(HARNESS_DIR, '..');

// 파일 쓰기가 사람 확인을 요구하는 경로 (프로젝트 루트 기준, 슬래시로 통일)
const PROTECTED_FILES = [
  /^harness\//, // 판정 스크립트, 규칙, 테스트, 에이전트 템플릿
  /^docs\/design\.md$/, // 디자인 기준
  /^CLAUDE\.md$/, // 오케스트레이터 규칙
  /^\.claude\//, // 훅과 권한 설정 자체
  /^runs\/[^/]+\/state\.json$/, // 진행 상태는 스크립트만 쓴다
  /^runs\/[^/]+\/confirm\//, // 컨펌 기록은 사람의 트리거로만
  /^runs\/[^/]+\/verdict\//, // 판정 결과는 judge 만 쓴다
];

// 사람이 직접 지시했을 때만 실행해야 하는 명령
const HUMAN_ONLY = /HARNESS_HUMAN|pin\.mjs|state\.mjs\s+confirm/;
// 보호 경로를 언급하면서 쓰기·삭제·이동을 하는 셸 명령 (완전하지 않은 보조 장치)
const MENTIONS_PROTECTED = /harness\/|CLAUDE\.md|docs\/design\.md|\.claude\/|state\.json|confirm\/|verdict\//;
const WRITES = /(>>?\s*\S)|\bsed\s+-i|\brm\b|\bmv\b|\bcp\b|\btee\b|\btruncate\b|\bchmod\b|writeFile|appendFile|rename|unlink|rmSync/;

export function decide(input) {
  const tool = input?.tool_name ?? '';
  const args = input?.tool_input ?? {};
  const cwd = input?.cwd ?? process.cwd();

  if (['Write', 'Edit', 'MultiEdit', 'NotebookEdit'].includes(tool)) {
    const file = args.file_path ?? args.notebook_path;
    if (!file) return null;
    // 상대 경로는 훅이 알려 준 cwd 기준과 프로젝트 루트 기준, 두 가지로 풀어 본다.
    // 둘 중 하나라도 보호 대상이면 확인을 요구한다. 이상한 cwd 때문에 보호 경로가 허용으로 새는 것을 막는다.
    const candidates = [path.resolve(cwd, file), path.resolve(ROOT, file)].map((p) => path.relative(ROOT, p).split(path.sep).join('/'));
    for (const rel of candidates) {
      if (rel.startsWith('..') || path.isAbsolute(rel)) continue; // 프로젝트 밖
      if (PROTECTED_FILES.some((re) => re.test(rel))) {
        return `보호된 파일을 고치려 한다: ${rel}. 판정 코드, 규칙, 승인 기록은 사람이 확인한 뒤에만 바꿀 수 있다.`;
      }
    }
    return null;
  }

  if (tool === 'Bash') {
    const cmd = String(args.command ?? '');
    if (HUMAN_ONLY.test(cmd)) return '컨펌 기록이나 해시 갱신은 사람의 지시가 있을 때만 실행한다. 지금 사람이 직접 지시한 것인지 확인해 달라.';
    if (MENTIONS_PROTECTED.test(cmd) && WRITES.test(cmd)) return `보호된 경로를 바꾸는 셸 명령으로 보인다: ${cmd.slice(0, 120)}`;
    return null;
  }
  return null;
}

function respond(reason) {
  process.stdout.write(
    JSON.stringify({ hookSpecificOutput: { hookEventName: 'PreToolUse', permissionDecision: 'ask', permissionDecisionReason: reason } }),
  );
}

if (process.argv[1]?.endsWith('guard.mjs')) {
  let raw = '';
  process.stdin.setEncoding('utf8');
  process.stdin.on('data', (c) => (raw += c));
  process.stdin.on('end', () => {
    try {
      const reason = decide(JSON.parse(raw));
      if (reason) respond(reason);
    } catch (e) {
      respond(`guard 가 입력을 해석하지 못해 사람 확인으로 돌린다: ${e.message}`);
    }
    process.exit(0);
  });
}
