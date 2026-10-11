#!/usr/bin/env node
// 사용: node harness/check-pin.mjs
// judge 코드, rules.yaml, guard 훅이 고정된 해시와 같은지만 확인한다 (바꾸지 않는다). 다르면 종료 코드 3.
import { assertPinned } from './lib/pin.mjs';
import { HarnessError } from './lib/errors.mjs';

try {
  assertPinned();
  console.log('pin ok');
} catch (e) {
  console.error(e.message);
  process.exit(e instanceof HarnessError ? e.code : 2);
}
