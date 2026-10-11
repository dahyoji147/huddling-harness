#!/usr/bin/env node
// judge 코드나 rules.yaml 을 고치면 사람이 이걸 실행해 rules.yaml 의 judge_sha256 을 갱신한다.
// 사용: HARNESS_HUMAN=1 node harness/pin.mjs
import fs from 'node:fs';
import { RULES_PATH } from './lib/paths.mjs';
import { judgeHash } from './lib/pin.mjs';
import { requireHuman } from './lib/state.mjs';
import { HarnessError } from './lib/errors.mjs';

try {
  requireHuman('pin');
  const hash = judgeHash();
  const text = fs.readFileSync(RULES_PATH, 'utf8');
  fs.writeFileSync(RULES_PATH, text.replace(/^judge_sha256:.*$/m, `judge_sha256: "${hash}"`));
  console.log('pinned', hash);
} catch (e) {
  console.error(e.message);
  process.exit(e instanceof HarnessError ? e.code : 2);
}
