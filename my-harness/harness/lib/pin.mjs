import fs from 'node:fs';
import path from 'node:path';
import { HARNESS_DIR, RULES_PATH } from './paths.mjs';
import { sha256 } from './state.mjs';
import { parseYaml } from './yaml.mjs';
import { HarnessError } from './errors.mjs';

const normalize = (text) => text.replace(/\r\n/g, '\n');

// 고정 대상: judge.mjs, state.mjs, pin.mjs, guard.mjs(훅), lib/*.mjs, 그리고 judge_sha256 줄을 뺀 rules.yaml.
// 에이전트가 판정 기준(rules.yaml)이나 상태 스크립트를 몰래 바꾸면 해시가 달라진다.
// 한계: 쓰기 권한이 있는 쪽이 pin.mjs 까지 실행하면 해시를 다시 맞출 수 있다.
// 그래서 pin.mjs 는 HARNESS_HUMAN=1 을 요구하고, 에이전트의 harness/ 편집은 권한 설정으로 막는 것을 권한다.
export function judgeHash() {
  const lib = fs.readdirSync(path.join(HARNESS_DIR, 'lib')).filter((f) => f.endsWith('.mjs')).map((f) => `lib/${f}`);
  const files = ['judge.mjs', 'state.mjs', 'pin.mjs', 'guard.mjs', ...lib].sort();
  const parts = files.map((f) => f + '\n' + normalize(fs.readFileSync(path.join(HARNESS_DIR, f), 'utf8')));
  const rules = normalize(fs.readFileSync(RULES_PATH, 'utf8')).replace(/^judge_sha256:.*$/m, 'judge_sha256:');
  parts.push('rules.yaml\n' + rules);
  return sha256(parts.join('\n'));
}

// judge 코드와 rules.yaml 이 고정된 해시와 같은지 확인한다. 다르면 차단(3). judge 와 state(confirm)가 같이 쓴다.
export function assertPinned() {
  const rules = parseYaml(fs.readFileSync(RULES_PATH, 'utf8'));
  if (judgeHash() !== rules.judge_sha256) throw new HarnessError(3, 'judge 코드 또는 rules.yaml 해시 불일치');
  return rules;
}
