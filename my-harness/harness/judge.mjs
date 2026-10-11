#!/usr/bin/env node
// 사용: node harness/judge.mjs <slug> <G1|G2|G3|confirm|G4|G5> [--fixture <파일>]
// 종료 코드: 0 통과, 1 실패 또는 대기, 2 오류, 3 차단
// verdict/verdict.json 의 status 로 실패(fail), 대기(wait), 반려(rejected), 차단(blocked)을 구분한다.
import fs from 'node:fs';
import path from 'node:path';
import { STAGE_FILES, CONFIRM_FILE, STAGES, runDir } from './lib/paths.mjs';
import { HarnessError } from './lib/errors.mjs';
import { loadState, saveState, readRunFile, writeRunFile, sha256Text } from './lib/state.mjs';
import { fetchNodes } from './lib/figma.mjs';
import {
  designViolations, frameSize, accentViolations, starAViolations, starBViolations, screenContentViolations, clippedViolations, scopeViolations, fingerprint, nodeIds, walk,
} from './lib/checks.mjs';
import { assertPinned } from './lib/pin.mjs';

// stage: 이 게이트를 돌릴 수 있는 현재 단계, retry: 실패 시 돌아갈 단계
const GATES = {
  G1: { stage: 'p1', retry: 'p1' },
  G2: { stage: 'p2', retry: 'p2' },
  G3: { stage: 'p3', retry: 'p3' },
  confirm: { stage: 'confirm', retry: 'p2' },
  G4: { stage: 'p4', retry: 'p4' },
  G5: { stage: 'p5', retry: 'p5' },
};

const count = (list) => {
  const by = {};
  for (const v of list) by[v.rule] = (by[v.rule] ?? 0) + 1;
  return Object.entries(by).map(([rule, n]) => ({ rule, count: n }));
};

// 들여쓰지 않은 최상위 목록 줄만 항목으로 센다. 하위 항목(들여쓴 줄)은 메모로 보고 건너뛴다.
const listItems = (text) =>
  text
    .split(/\r?\n/)
    .map((l) => l.match(/^(?:[-*]|\d+\.)\s+(.*)$/)?.[1])
    .filter(Boolean);

// 목록 항목의 마크다운 꾸밈(**굵게**, `코드`)은 벗겨서 화면 이름으로 쓴다.
// 밑줄은 이름의 일부일 수 있어 벗기지 않는다.
const plain = (s) => s.replace(/[*`]/g, '').trim();

function screenNames(inputText) {
  const section = inputText.split(/^##\s+화면 목록\s*$/m)[1] ?? '';
  return listItems(section.split(/^##\s/m)[0]).map(plain);
}

// 재시도할 단계로 돌아갈 때 그 단계 이후의 완료 기록과 지문을 지운다.
function rewind(state, stage) {
  const at = STAGES.indexOf(stage);
  state.completed_stages = state.completed_stages.filter((s) => STAGES.indexOf(s) < at);
  for (const s of Object.keys(state.fingerprints)) if (STAGES.indexOf(s) >= at) delete state.fingerprints[s];
  state.current_stage = stage;
}

async function loadNodes(state, rel, fixture) {
  const ids = nodeIds(readRunFile(state.slug, rel));
  const docs = ids.length ? Object.values(await fetchNodes(state.figma_file_key, ids, fixture)) : [];
  return { ids, docs };
}

// 이 run 의 유효한 컨펌 승인이 있고 컨펌된 키스크린이 그대로인지 본다. G4, G5 가 같이 쓴다.
// 승인 기록이 없거나(approved 아님, 다른 run 의 slug 포함) 지문이 다르면 재컨펌 사유다.
// confirm.md 한 곳에서만 승인 형식(status, slug, fingerprint)을 읽는다. 컨펌 게이트와 G4/G5 가 같은 판단을 하도록 같이 쓴다.
// 승인은 "이 run 의 이 입력과 이 설계에서 만든 이 키스크린"에 대한 것이다. 그래서 승인 시점의 입력 파일 해시와
// 설계 파일 해시도 같이 저장하고, 실행을 다시 열었을 때 하나라도 달라졌으면 예전 승인을 인정하지 않는다.
function parseApproval(recorded, state) {
  const pick = (key) => recorded.match(new RegExp(`^${key}:\\s*(\\S+)`, 'm'))?.[1];
  let currentDesign;
  try {
    currentDesign = sha256Text(readRunFile(state.slug, STAGE_FILES.p2));
  } catch {
    currentDesign = undefined;
  }
  return {
    valid:
      /^status:\s*approved\s*$/m.test(recorded) &&
      pick('slug') === state.slug &&
      pick('input_hash') === state.input_hash &&
      pick('design_hash') !== undefined &&
      pick('design_hash') === currentDesign,
    fingerprint: pick('fingerprint'),
  };
}

// out.keyDocs 에는 판정에 쓴 키스크린 노드를 담아 호출한 쪽이 다시 읽지 않게 한다.
async function approvalViolations(state, fixture, out = {}) {
  let recorded = '';
  try {
    recorded = readRunFile(state.slug, CONFIRM_FILE);
  } catch (e) {
    if (!(e instanceof HarnessError && e.code === 1)) throw e;
  }
  const approval = parseApproval(recorded, state);
  let keys;
  try {
    keys = await loadNodes(state, STAGE_FILES.p3, fixture);
  } catch (e) {
    // 승인된 키스크린이 Figma 에서 사라졌거나 파일이 없으면 P4 가 고칠 수 없다. 재컨펌 사유로 본다.
    if (!(e instanceof HarnessError && e.code === 1)) throw e;
    return [{ rule: 'approved_keyscreens_changed', layer: 'system', node: e.message }];
  }
  out.keyDocs = keys.docs;
  return approval.valid && approval.fingerprint === fingerprint(keys.docs) ? [] : [{ rule: 'approved_keyscreens_changed', layer: 'system' }];
}

// 섹션 본문(같은 단계 이하 제목이 다시 나오기 전까지, 하위 제목 포함)의 공백 제외 글자 수.
function sectionLength(markdown, title) {
  const heads = [...markdown.matchAll(/^(#{1,6})\s+(.+)$/gm)].map((m) => ({ level: m[1].length, title: plain(m[2]), start: m.index, end: m.index + m[0].length }));
  const at = heads.findIndex((h) => h.title === title);
  if (at < 0) return 0;
  const next = heads.slice(at + 1).find((h) => h.level <= heads[at].level);
  return markdown.slice(heads[at].end, next ? next.start : undefined).replace(/\s+/g, '').length;
}

// 노드 트리의 모든 노드 ID.
function allIds(docs) {
  const ids = new Set();
  for (const d of docs) walk(d, (n) => ids.add(n.id));
  return ids;
}

// 게이트별 위반 목록과, 판정에 쓴 단계 노드(지문 기록용). 검사할 대상이 비어 있으면 위반으로 본다.
async function runGate(gate, state, rules, fixture) {
  const v = [];
  let docs = [];
  if (gate === 'G1') {
    const items = listItems(readRunFile(state.slug, STAGE_FILES.p1));
    // 호스트에 점이 있는 URL 만 출처로 인정한다. 서로 다른 URL 이 min_points 개 이상이어야 한다.
    const urlOf = (item) => item.match(/https?:\/\/[^\s/]+\.[^\s/]+\S*/)?.[0];
    const urls = new Set();
    for (const item of items) {
      const url = urlOf(item);
      if (url) urls.add(url);
      else v.push({ rule: 'point_missing_url', layer: 'system' });
    }
    if (items.length < rules.g1.min_points || urls.size < rules.g1.min_points) v.push({ rule: 'points_min', layer: 'system' });
  } else if (gate === 'G2') {
    const names = screenNames(readRunFile(state.slug, 'input.md'));
    if (names.length === 0) v.push({ rule: 'screen_list_empty', layer: 'system' });
    // 제목 글자가 화면 이름과 정확히 같아야 한다. 짧은 이름이 긴 제목으로 만족되지 않게 한다.
    const design = readRunFile(state.slug, STAGE_FILES.p2);
    for (const name of names) {
      const length = sectionLength(design, name);
      if (length === 0 && ![...design.matchAll(/^#{1,6}\s+(.+)$/gm)].some((m) => plain(m[1]) === name)) {
        v.push({ rule: 'screen_missing_in_design', layer: 'system', node: name });
      } else if (length < rules.g2.min_section_chars) {
        // 제목만 있고 내용이 없는 설계는 통과시키지 않는다.
        v.push({ rule: 'design_section_empty', layer: 'system', node: name });
      }
    }
  } else if (gate === 'G3') {
    const loaded = await loadNodes(state, STAGE_FILES.p3, fixture);
    docs = loaded.docs;
    if (loaded.ids.length < rules.g3.keyscreens_min || loaded.ids.length > rules.g3.keyscreens_max) {
      v.push({ rule: 'keyscreen_count', layer: 'system' });
    }
    for (const d of docs) v.push(...frameSize(d, rules));
  } else if (gate === 'G4') {
    // 컨펌 승인이 이 run 의 것이고 승인된 키스크린이 바뀌지 않았는지 먼저 본다.
    v.push(...(await approvalViolations(state, fixture)));
    const loaded = await loadNodes(state, STAGE_FILES.p4, fixture);
    docs = loaded.docs;
    if (loaded.ids.length === 0) v.push({ rule: 'no_nodes', layer: 'system', node: STAGE_FILES.p4 });
    for (const d of docs) v.push(...designViolations(d, rules));
  } else if (gate === 'G5') {
    // 컨펌 승인이 여전히 유효한지, G4 를 통과한 시스템 노드가 그 뒤에 바뀌지 않았는지 본다.
    const approval = {};
    v.push(...(await approvalViolations(state, fixture, approval)));
    let system;
    try {
      system = await loadNodes(state, STAGE_FILES.p4, fixture);
    } catch (e) {
      // 시스템 산출물이 없는 것은 P4 의 문제이므로 P4 로 돌려보낸다.
      if (!(e instanceof HarnessError && e.code === 1)) throw e;
      v.push({ rule: 'input_invalid', layer: 'system', node: e.message });
      return { violations: v, docs: [] };
    }
    if (fingerprint(system.docs) !== state.fingerprints.p4) v.push({ rule: 'fingerprint_changed', layer: 'system' });
    const loaded = await loadNodes(state, STAGE_FILES.p5, fixture);
    docs = loaded.docs;
    if (loaded.ids.length === 0) v.push({ rule: 'no_nodes', layer: 'screen', node: STAGE_FILES.p5 });
    const names = screenNames(readRunFile(state.slug, 'input.md'));
    if (names.length === 0) v.push({ rule: 'screen_list_empty', layer: 'screen' });
    // 프레임 이름이 화면 이름과 정확히 같아야 한다. 하나의 프레임은 하나의 화면만 만족시킨다.
    const frameNames = docs.map((d) => (d.name ?? '').trim());
    const pool = [...frameNames];
    for (const name of names) {
      const at = pool.indexOf(name);
      if (at < 0) v.push({ rule: 'screen_missing', layer: 'screen', node: name });
      else pool.splice(at, 1);
    }
    // 완성 화면은 승인된 키스크린이나 시스템 노드를 다시 가리키면 안 된다.
    // 키스크린과 시스템 노드의 하위 노드까지 포함해 한 번만 계산한다.
    const protectedIds = allIds([...(approval.keyDocs ?? []), ...system.docs]);
    for (const id of loaded.ids) if (protectedIds.has(id)) v.push({ rule: 'screen_reuses_node', layer: 'screen', node: id });
    for (const d of docs) {
      // 화면 노드의 디자인 위반은 화면 층으로 돌려보내 P5 만 다시 한다.
      v.push(
        ...screenContentViolations(d, rules),
        ...clippedViolations(d, rules),
        ...frameSize(d, rules),
        ...accentViolations(d, rules),
        ...starAViolations(d, rules),
        ...starBViolations(d, rules),
        ...scopeViolations(d, rules),
        ...designViolations(d, rules, 'screen'),
      );
    }
  }
  return { violations: v, docs };
}

// 판정한 단계(judgedStage)와 판정 뒤의 상태(next_stage)를 따로 기록한다.
let judgedStage = null;

function finish(state, gate, status, violations, exit, note) {
  const verdict = {
    gate,
    status,
    violations: count(violations),
    details: violations.slice(0, 10),
    note: note ?? null,
    stage: judgedStage,
    next_stage: state.current_stage,
    at: new Date().toISOString(),
  };
  writeRunFile(state.slug, 'verdict/verdict.json', JSON.stringify(verdict, null, 2) + '\n');
  const detail = violations.length ? ' ' + JSON.stringify(verdict.violations) : '';
  console.log(`${gate} ${status}${detail}${note ? ' ' + note : ''}`);
  return exit;
}

async function confirmGate(state, rules, fixture) {
  if (state.confirm_status === 'pending') return finish(state, 'confirm', 'wait', [], 1, '사람의 컨펌 대기');
  if (state.confirm_status === 'rejected') {
    rewind(state, 'p2');
    state.confirm_status = 'pending';
    saveState(state);
    return finish(state, 'confirm', 'rejected', [], 1, '반려, 다음 단계 p2');
  }
  let recorded;
  let docs;
  try {
    recorded = readRunFile(state.slug, CONFIRM_FILE);
    ({ docs } = await loadNodes(state, STAGE_FILES.p3, fixture));
  } catch (e) {
    // confirm.md 나 키스크린 노드가 없는 것도 입력 불량이다: verdict 를 남기고 실패 횟수에 넣는다.
    if (!(e instanceof HarnessError && e.code === 1)) throw e;
    state.gate_failures.confirm = (state.gate_failures.confirm ?? 0) + 1;
    const violations = [{ rule: 'input_invalid', layer: 'system', node: e.message }];
    if (state.gate_failures.confirm >= rules.failure_limit) {
      state.blocked = true;
      saveState(state);
      return finish(state, 'confirm', 'blocked', violations, 3, `confirm ${rules.failure_limit}회 실패`);
    }
    saveState(state);
    return finish(state, 'confirm', 'fail', violations, 1, e.message);
  }
  const approval = parseApproval(recorded, state);
  if (!approval.valid || approval.fingerprint !== fingerprint(docs)) {
    state.confirm_status = 'pending';
    saveState(state);
    return finish(state, 'confirm', 'wait', [{ rule: 'approval_invalidated', layer: 'system' }], 1, '승인 무효, 다시 컨펌 필요');
  }
  state.gate_failures.confirm = 0; // 통과하면 컨펌의 입력 불량 횟수를 지운다 (다른 게이트와 같다)
  if (!state.completed_stages.includes('confirm')) state.completed_stages.push('confirm');
  state.current_stage = 'p4';
  saveState(state);
  return finish(state, 'confirm', 'pass', [], 0);
}

async function main() {
  const argv = process.argv.slice(2);
  const fi = argv.indexOf('--fixture');
  const fixture = fi >= 0 ? argv.splice(fi, 2)[1] : null;
  if (fi >= 0 && !fixture) throw new HarnessError(2, '--fixture 뒤에 파일 경로가 필요하다');
  const [slug, gate] = argv;
  if (!slug || !GATES[gate]) throw new HarnessError(2, '사용법: judge.mjs <slug> <G1|G2|G3|confirm|G4|G5> [--fixture 파일]');

  const rules = assertPinned(); // judge 코드와 rules.yaml 이 고정된 해시와 같아야 한다 (state.mjs confirm 과 같은 검사)

  const state = loadState(slug); // slug 형식도 여기서 검사한다
  if (state.blocked) throw new HarnessError(3, '이미 차단된 run');
  const input = fs.readFileSync(path.join(runDir(slug), 'input.md'));
  if (sha256Text(input) !== state.input_hash) throw new HarnessError(3, '입력 파일이 바뀌었다 (input_hash 불일치)');

  const g = GATES[gate];
  if (state.current_stage !== g.stage) {
    throw new HarnessError(2, `현재 단계는 ${state.current_stage} 이므로 ${gate} 를 실행할 수 없다`);
  }
  judgedStage = state.current_stage;
  if (gate === 'confirm') return confirmGate(state, rules, fixture);

  let result;
  try {
    result = await runGate(gate, state, rules, fixture);
  } catch (e) {
    // 파일이나 노드가 없는 것은 판정 오류가 아니라 입력 불량이므로 실패 횟수에 넣는다.
    if (!(e instanceof HarnessError && e.code === 1)) throw e;
    result = { violations: [{ rule: 'input_invalid', layer: gate === 'G5' ? 'screen' : 'system', node: e.message }], docs: [] };
  }
  const { violations, docs } = result;

  if (violations.length === 0) {
    if (['G3', 'G4', 'G5'].includes(gate)) state.fingerprints[g.stage] = fingerprint(docs);
    // G4 이후 통과는 승인이 유효했다는 뜻이므로 연속 재컨펌 횟수를 지운다 (다른 횟수와 같다).
    if (gate === 'G4' || gate === 'G5') state.gate_failures.reconfirm = 0;
    if (!state.completed_stages.includes(g.stage)) state.completed_stages.push(g.stage);
    state.current_stage = STAGES[STAGES.indexOf(g.stage) + 1];
    state.gate_failures[gate] = 0;
    saveState(state);
    return finish(state, gate, 'pass', [], 0);
  }

  // 컨펌된 키스크린이 바뀐 경우는 P4 가 고칠 수 없으므로 재컨펌으로 돌려보낸다.
  // 게이트 실패 횟수와는 따로 `reconfirm` 으로 세고, 같은 한도(3회)에 닿으면 차단해 사람에게 알린다.
  if (violations.some((x) => x.rule === 'approved_keyscreens_changed')) {
    state.gate_failures.reconfirm = (state.gate_failures.reconfirm ?? 0) + 1;
    if (state.gate_failures.reconfirm >= rules.failure_limit) {
      state.blocked = true;
      saveState(state);
      return finish(state, gate, 'blocked', violations, 3, `재컨펌 ${rules.failure_limit}회: 승인된 키스크린이 계속 바뀐다`);
    }
    state.confirm_status = 'pending';
    rewind(state, 'confirm');
    saveState(state);
    return finish(state, gate, 'fail', violations, 1, '승인된 키스크린이 바뀌었다, 다음 단계 confirm');
  }

  state.gate_failures[gate] = (state.gate_failures[gate] ?? 0) + 1;
  if (state.gate_failures[gate] >= rules.failure_limit) {
    state.blocked = true;
    saveState(state);
    return finish(state, gate, 'blocked', violations, 3, `${gate} ${rules.failure_limit}회 실패`);
  }
  let next = g.retry;
  if (gate === 'G5') next = violations.some((x) => x.layer === 'system') ? 'p4' : 'p5';
  rewind(state, next);
  saveState(state);
  return finish(state, gate, 'fail', violations, 1, `다음 단계 ${state.current_stage}`);
}

main().then(
  (code) => process.exit(code),
  (e) => {
    console.error(e instanceof HarnessError ? e.message : `오류: ${e.stack}`);
    process.exit(e instanceof HarnessError ? e.code : 2);
  },
);
