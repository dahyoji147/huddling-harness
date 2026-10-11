// 실행: node --test harness/tests/harness.test.mjs
// 위반을 일부러 넣은 샘플이 기대한 종료 코드로 끝나는지 확인한다. (docs/verification.md)
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { fingerprint } from '../lib/checks.mjs';
import { sha256Text } from '../lib/state.mjs';

const HARNESS = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const SLUG = 'my-asset-form';
const HUMAN = { HARNESS_HUMAN: '1' };

// ---- Figma 노드 샘플 -------------------------------------------------
const bound = { fills: [{ type: 'VARIABLE_ALIAS', id: 'v1' }] };
function rgb(hex) {
  const n = (i) => parseInt(hex.slice(i, i + 2), 16) / 255;
  return { r: n(1), g: n(3), b: n(5) };
}
const solid = (hex = '#141414') => [{ type: 'SOLID', color: rgb(hex) }];
const text = (id, characters, fontFamily = 'Pretendard') => ({
  id, name: `text-${id}`, type: 'TEXT', characters, style: { fontFamily }, fills: solid(), boundVariables: bound,
});
const field = (id, value) => ({
  id, name: `공개범위/기본=${value}`, type: 'FRAME', cornerRadius: 9999, fills: solid('#f0f0f0'), boundVariables: bound,
});
// 화면 프레임. 키스크린은 1:1, 완성 화면은 3:1 로 쓴다.
const screen = (overrides = {}) => ({
  id: '1:1', name: '내 자산 등록', type: 'FRAME',
  absoluteBoundingBox: { width: 390, height: 844 }, cornerRadius: 0,
  fills: solid('#ffffff'), boundVariables: bound,
  children: [text('1:2', '공개 범위'), field('1:3', '비공개')],
  ...overrides,
});
// 토큰·컴포넌트 노드
const sys = (overrides = {}) => ({
  id: '2:1', name: 'system-button', type: 'FRAME', cornerRadius: 9999,
  fills: solid('#141414'), boundVariables: bound, children: [text('2:2', '버튼')],
  ...overrides,
});
const blue = (id) => ({ id, name: `badge-${id}`, type: 'FRAME', cornerRadius: 9999, fills: solid('#0066ff'), boundVariables: bound });
const fixtureOf = (...docs) => ({ nodes: Object.fromEntries(docs.map((d) => [d.id, { document: d }])) });

// ---- run 폴더 준비와 실행 --------------------------------------------
// 화면 설계 섹션은 비어 있으면 안 되므로(g2.min_section_chars) 본문이 있는 샘플을 쓴다.
const DESIGN_BODY = '이 화면은 유료 멤버가 만든 프롬프트와 스킬 파일을 내 자산으로 등록한다. 상단 바, 입력 항목, 공개 범위 행, 하단 고정 버튼 순서로 쌓고 모든 버튼은 pill 모서리를 쓴다. 공개 범위 기본값은 비공개이며 판매 신청은 판매 승인 회원만 고를 수 있다. 입력 항목마다 필수와 선택을 구분해 안내 문구를 적는다. 파일 첨부는 미리보기 행과 제거 버튼을 두고 허용 형식과 용량을 한 줄로 알린다. 태그는 추천 칩을 가로로 스크롤하고 선택한 태그는 칩으로 쌓는다. 하단 버튼은 필수 항목이 비어 있으면 비활성으로 두고 부족한 항목을 문구로 알려 준다.';
const INPUT ='# 입력\n\n## 화면 목록\n- 내 자산 등록\n';

function setup(stage, docs = [], { input = INPUT } = {}) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'harness-test-'));
  const runs = path.join(dir, 'runs');
  const writeFixture = (name, ...d) => {
    const p = path.join(dir, name);
    fs.writeFileSync(p, JSON.stringify(fixtureOf(...d)));
    return p;
  };
  // 승인된 키스크린(1:1)이 fixture 에 없으면 기본 키스크린을 넣는다. G4, G5 가 승인 기록과 대조하기 때문이다.
  const fixture = writeFixture('fixture.json', ...(docs.some((d) => d.id === '1:1') ? docs : [...docs, screen()]));
  fs.writeFileSync(path.join(dir, 'input.md'), input);
  const env = { ...process.env, HARNESS_RUNS_DIR: runs, HARNESS_TEST: '1' };
  delete env.FIGMA_TOKEN;
  delete env.HARNESS_HUMAN;
  const run = (script, args, extraEnv = {}, root = HARNESS) =>
    spawnSync('node', [path.join(root, script), ...args], { env: { ...env, ...extraEnv }, encoding: 'utf8' });

  assert.equal(run('state.mjs', ['init', SLUG, path.join(dir, 'input.md'), '--figma', 'FILEKEY']).status, 0);
  const statePath = path.join(runs, SLUG, 'state.json');
  const readState = () => JSON.parse(fs.readFileSync(statePath, 'utf8'));
  const patchState = (fn) => {
    const s = readState();
    fn(s);
    fs.writeFileSync(statePath, JSON.stringify(s));
  };
  patchState((s) => { s.current_stage = stage; });

  const put = (rel, body) => {
    const full = path.join(runs, SLUG, rel);
    fs.mkdirSync(path.dirname(full), { recursive: true });
    fs.writeFileSync(full, body);
  };
  // 모든 run 에 기본 설계 파일을 둔다 (승인 기록이 설계 파일 해시를 가리킨다)
  put('p2-design/design.md', `# 설계\n## 내 자산 등록\n${DESIGN_BODY}\n`);
  const judge = (gate, fx = fixture) => run('judge.mjs', [SLUG, gate, '--fixture', fx]);
  // 승인 기록: 지문과 함께 승인 시점의 입력 파일, 설계 파일 해시를 적는다.
  const approvalText = (keyDoc) => {
    const design = fs.readFileSync(path.join(runs, SLUG, 'p2-design', 'design.md'), 'utf8');
    return `status: approved\nslug: ${SLUG}\nfingerprint: ${fingerprint([keyDoc])}\ninput_hash: ${readState().input_hash}\ndesign_hash: ${sha256Text(design)}\n`;
  };
  // G4 를 돌리기 위한 준비: 컨펌된 키스크린(1:1)과 시스템 노드(2:1)
  const prepG4 = (keyDoc = screen()) => {
    put('p3-keyscreens/keyscreens.md', 'node: 1:1\n');
    put('confirm/confirm.md', approvalText(keyDoc));
    put('p4-system/system.md', 'node: 2:1\n');
  };
  // G5 를 돌리기 위한 준비: G4 를 통과한 시스템 지문과 완성 화면(3:1)
  const prepG5 = (sysDoc = sys(), keyDoc = screen()) => {
    put('p3-keyscreens/keyscreens.md', 'node: 1:1\n');
    put('confirm/confirm.md', approvalText(keyDoc));
    put('p4-system/system.md', 'node: 2:1\n');
    put('p5-screens/screens.md', 'node: 3:1\n');
    patchState((s) => { s.fingerprints.p4 = fingerprint([sysDoc]); });
  };
  return { dir, run, put, judge, fixture, readState, patchState, writeFixture, prepG4, prepG5, approvalText };
}

// 완성 화면은 비어 있으면 안 되므로(g5.min_nodes, min_text_nodes) 문구 노드를 채워 넣는다.
const fillers = Array.from({ length: 14 }, (_, i) => text(`9:${i}`, `문구 ${i}`));
const g5Screen = (overrides = {}) => {
  const base = screen({ id: '3:1', ...overrides });
  return { ...base, children: [...base.children, ...fillers] };
};

// ---- 위반 주입 테스트 (1~11) -----------------------------------------
test('1. 정상: 위반 없는 화면은 G5 통과 (0)', () => {
  const t = setup('p5', [sys(), g5Screen()]);
  t.prepG5();
  assert.equal(t.judge('G5').status, 0);
});

test('2. 반경 13px 은 G4 위반 (1)', () => {
  const t = setup('p4', [screen(), sys({ cornerRadius: 13 })]);
  t.prepG4();
  const r = t.judge('G4');
  assert.equal(r.status, 1);
  assert.match(r.stdout, /radius/);
});

test('3. 그림자 1개는 G4 위반 (1)', () => {
  const t = setup('p4', [screen(), sys({ effects: [{ type: 'DROP_SHADOW', visible: true }] })]);
  t.prepG4();
  const r = t.judge('G4');
  assert.equal(r.status, 1);
  assert.match(r.stdout, /shadow/);
});

test('4. #0066ff 3개를 한 화면에 두면 G5 위반 (1)', () => {
  const kids = [text('1:2', '공개 범위'), field('1:3', '비공개'), blue('1:4'), blue('1:5'), blue('1:6')];
  const t = setup('p5', [sys(), g5Screen({ children: kids })]);
  t.prepG5();
  const r = t.judge('G5');
  assert.equal(r.status, 1);
  assert.match(r.stdout, /accent_count/);
});

test('5. 공개 범위 기본값이 멤버 공개면 ★ B 위반 (1)', () => {
  const t = setup('p5', [sys(), g5Screen({ children: [text('1:2', '공개 범위'), field('1:3', '멤버 공개')] })]);
  t.prepG5();
  const r = t.judge('G5');
  assert.equal(r.status, 1);
  assert.match(r.stdout, /star_b_default/);
});

test('6. 텍스트에 이메일이 있으면 ★ A 위반 (1)', () => {
  const kids = [text('1:2', '공개 범위'), field('1:3', '비공개'), text('1:4', '문의 hello@example.com')];
  const t = setup('p5', [sys(), g5Screen({ children: kids })]);
  t.prepG5();
  const r = t.judge('G5');
  assert.equal(r.status, 1);
  assert.match(r.stdout, /star_a_email/);
});

test('7. 컨펌 뒤 노드를 몰래 고치면 지문 불일치로 승인 무효 (1)', () => {
  const t = setup('confirm', [screen()]);
  t.put('p3-keyscreens/keyscreens.md', 'node: 1:1\n');
  assert.equal(t.run('state.mjs', ['confirm', SLUG, 'approved', '--fixture', t.fixture], HUMAN).status, 0);
  const tampered = t.writeFixture('tampered.json', screen({ name: '몰래 바꾼 이름' }));
  const r = t.judge('confirm', tampered);
  assert.equal(r.status, 1);
  assert.match(r.stdout, /approval_invalidated/);
});

test('8. 변수에 바인딩되지 않은 hex 채움은 G4 위반 (1)', () => {
  const t = setup('p4', [screen(), sys({ boundVariables: undefined })]);
  t.prepG4();
  const r = t.judge('G4');
  assert.equal(r.status, 1);
  assert.match(r.stdout, /color_unbound/);
});

test('9. Figma 에 접속할 수 없으면 오류 (2)', () => {
  const t = setup('p4', [screen(), sys()]);
  t.prepG4();
  assert.equal(t.run('judge.mjs', [SLUG, 'G4']).status, 2); // --fixture 없음, FIGMA_TOKEN 없음
});

test('10. 같은 게이트에서 3회 실패하면 차단 (3)', () => {
  const t = setup('p4', [screen(), sys({ cornerRadius: 13 })]);
  t.prepG4();
  assert.equal(t.judge('G4').status, 1);
  assert.equal(t.judge('G4').status, 1);
  assert.equal(t.judge('G4').status, 3);
  assert.equal(t.judge('G4').status, 3); // 차단 뒤에는 계속 3
});

test('11. judge 코드 해시가 다르면 차단 (3)', () => {
  const t = setup('p4', [screen(), sys()]);
  t.prepG4();
  const copy = path.join(t.dir, 'harness-copy');
  fs.cpSync(HARNESS, copy, { recursive: true, filter: (src) => !src.includes(`${path.sep}tests`) });
  fs.appendFileSync(path.join(copy, 'judge.mjs'), '\n// 몰래 수정\n');
  assert.equal(t.run('judge.mjs', [SLUG, 'G4', '--fixture', t.fixture], {}, copy).status, 3);
});

// ---- 코드 리뷰 지적 재현 (12~) ---------------------------------------
test('12. 시스템 노드가 하나도 없으면 G4 는 통과가 아니라 실패이고 횟수에 들어간다 (1)', () => {
  const t = setup('p4', [screen(), sys()]);
  t.prepG4();
  t.put('p4-system/system.md', '노드 없음\n');
  const r = t.judge('G4');
  assert.equal(r.status, 1);
  assert.match(r.stdout, /no_nodes/);
  assert.equal(t.readState().gate_failures.G4, 1);
});

test('13. 화면 목록이 비어 있으면 G2 는 실패 (1)', () => {
  const t = setup('p2', [], { input: '# 입력\n' });
  t.put('p2-design/design.md', '# 설계\n');
  const r = t.judge('G2');
  assert.equal(r.status, 1);
  assert.match(r.stdout, /screen_list_empty/);
});

test('14. 단계 파일이 없으면 실패로 세고 verdict 를 남긴다 (1)', () => {
  const t = setup('p1');
  const r = t.judge('G1');
  assert.equal(r.status, 1);
  assert.equal(t.readState().gate_failures.G1, 1);
  const verdict = JSON.parse(fs.readFileSync(path.join(t.dir, 'runs', SLUG, 'verdict', 'verdict.json'), 'utf8'));
  assert.equal(verdict.status, 'fail');
  assert.equal(verdict.violations[0].rule, 'input_invalid');
});

test('15. 형식이 틀린 노드 ID(1-2)는 노드 없음으로 실패 처리 (1)', () => {
  const t = setup('p4', [screen(), sys()]);
  t.prepG4();
  t.put('p4-system/system.md', 'node: 1-2\n');
  const r = t.judge('G4');
  assert.equal(r.status, 1);
  assert.match(r.stdout, /no_nodes/);
  assert.equal(t.readState().gate_failures.G4, 1);
});

test('16. rules.yaml 을 몰래 고치면 해시 불일치로 차단 (3)', () => {
  const t = setup('p4', [screen(), sys()]);
  t.prepG4();
  const copy = path.join(t.dir, 'harness-copy');
  fs.cpSync(HARNESS, copy, { recursive: true, filter: (src) => !src.includes(`${path.sep}tests`) });
  const rulesPath = path.join(copy, 'rules.yaml');
  fs.writeFileSync(rulesPath, fs.readFileSync(rulesPath, 'utf8').replace('failure_limit: 3', 'failure_limit: 999'));
  assert.equal(t.run('judge.mjs', [SLUG, 'G4', '--fixture', t.fixture], {}, copy).status, 3);
});

test('17. 사람 표시(HARNESS_HUMAN) 없이는 컨펌을 기록할 수 없다 (3)', () => {
  const t = setup('confirm', [screen()]);
  t.put('p3-keyscreens/keyscreens.md', 'node: 1:1\n');
  assert.equal(t.run('state.mjs', ['confirm', SLUG, 'approved', '--fixture', t.fixture]).status, 3);
  assert.equal(t.readState().confirm_status, 'pending');
});

test('18. G4 통과 뒤 시스템 노드를 바꾸면 G5 가 지문 불일치로 실패하고 P4 로 돌아간다 (1)', () => {
  const t = setup('p4', [screen(), sys(), g5Screen()]);
  t.prepG4();
  assert.equal(t.judge('G4').status, 0);
  assert.equal(t.readState().current_stage, 'p5');
  t.put('p5-screens/screens.md', 'node: 3:1\n');
  const changed = t.writeFixture('changed.json', screen(), sys({ name: '몰래 바꾼 컴포넌트' }), g5Screen());
  const r = t.judge('G5', changed);
  assert.equal(r.status, 1);
  assert.match(r.stdout, /fingerprint_changed/);
  assert.equal(t.readState().current_stage, 'p4');
});

test('19. 컨펌된 키스크린이 G4 에서 바뀌어 있으면 컨펌 단계로 되돌린다 (1)', () => {
  const t = setup('p4', [screen(), sys()]);
  t.prepG4();
  const changed = t.writeFixture('changed.json', screen({ name: '몰래 바꾼 시안' }), sys());
  const r = t.judge('G4', changed);
  assert.equal(r.status, 1);
  assert.match(r.stdout, /approved_keyscreens_changed/);
  const s = t.readState();
  assert.equal(s.current_stage, 'confirm');
  assert.equal(s.confirm_status, 'pending');
});

test('20. 컨펌 뒤 선(stroke) 색만 바꿔도 승인이 무효가 된다 (1)', () => {
  const t = setup('confirm', [screen()]);
  t.put('p3-keyscreens/keyscreens.md', 'node: 1:1\n');
  assert.equal(t.run('state.mjs', ['confirm', SLUG, 'approved', '--fixture', t.fixture], HUMAN).status, 0);
  const stroked = t.writeFixture('stroked.json', screen({ strokes: [{ type: 'SOLID', color: rgb('#ff0000') }] }));
  const r = t.judge('confirm', stroked);
  assert.equal(r.status, 1);
  assert.match(r.stdout, /approval_invalidated/);
});

test('21. 반려하면 완료 기록과 지문을 되감고 P2 로 돌아간다 (1)', () => {
  const t = setup('confirm', [screen()]);
  t.patchState((s) => {
    s.completed_stages = ['p1', 'p2', 'p3'];
    s.fingerprints = { p3: 'old' };
  });
  assert.equal(t.run('state.mjs', ['confirm', SLUG, 'rejected', '시안이 어둡다'], HUMAN).status, 0);
  const r = t.judge('confirm');
  assert.equal(r.status, 1);
  assert.match(r.stdout, /rejected/);
  const s = t.readState();
  assert.deepEqual(s.completed_stages, ['p1']);
  assert.deepEqual(s.fingerprints, {});
  assert.equal(s.current_stage, 'p2');
});

test('22. slug 에 경로를 넣으면 거부한다 (2)', () => {
  const t = setup('p1');
  assert.equal(t.run('judge.mjs', ['../../x', 'G1']).status, 2);
});

test('23. 긴 숫자는 전화번호로 오인하지 않고, 진짜 번호는 잡는다', () => {
  const ok = setup('p5', [sys(), g5Screen({ children: [text('1:2', '공개 범위'), field('1:3', '비공개'), text('1:4', '주문 2024010512345')] })]);
  ok.prepG5();
  assert.equal(ok.judge('G5').status, 0);
  const bad = setup('p5', [sys(), g5Screen({ children: [text('1:2', '공개 범위'), field('1:3', '비공개'), text('1:4', '010-1234-5678')] })]);
  bad.prepG5();
  const r = bad.judge('G5');
  assert.equal(r.status, 1);
  assert.match(r.stdout, /star_a_phone/);
});

test('24. Pretendard 로 시작만 하는 글꼴(PretendardFake)은 G4 위반 (1)', () => {
  const t = setup('p4', [screen(), sys({ children: [text('2:2', '버튼', 'PretendardFake')] })]);
  t.prepG4();
  const r = t.judge('G4');
  assert.equal(r.status, 1);
  assert.match(r.stdout, /font/);
});

test('25. Noto Sans KR 은 임시 허용 글꼴이라 G4 를 통과하고, Inter 는 위반 (0 / 1)', () => {
  const ok = setup('p4', [screen(), sys({ children: [text('2:2', '버튼', 'Noto Sans KR')] })]);
  ok.prepG4();
  assert.equal(ok.judge('G4').status, 0);
  const bad = setup('p4', [screen(), sys({ children: [text('2:2', '버튼', 'Inter')] })]);
  bad.prepG4();
  assert.equal(bad.judge('G4').status, 1);
});

// ---- 재리뷰 지적 재현 (26~) -----------------------------------------
// 위치 값을 가진 키스크린. dx, dy 는 프레임 전체를 옮기고, fieldY 는 필드 하나만 옮긴다.
const positioned = ({ dx = 0, dy = 0, fieldY = 700, fills } = {}) => {
  const box = (x, y, width, height) => ({ x: x + dx, y: y + dy, width, height });
  const kids = [text('1:2', '공개 범위'), field('1:3', '비공개')];
  kids[0].absoluteBoundingBox = box(16, 100, 100, 20);
  kids[1].absoluteBoundingBox = box(16, fieldY, 358, 56);
  return screen({ absoluteBoundingBox: box(0, 0, 390, 844), children: kids, ...(fills ? { fills } : {}) });
};

test('26. 같은 노드 ID 를 두 번 적어도 키스크린 1개로 센다 (1)', () => {
  const t = setup('p3', [screen()]);
  t.put('p3-keyscreens/keyscreens.md', 'node: 1:1\nnode: 1:1\n');
  const r = t.judge('G3');
  assert.equal(r.status, 1);
  assert.match(r.stdout, /keyscreen_count/);
});

test('27. 컨펌 게이트에서 confirm.md 가 없으면 verdict 를 남기고 실패로 센다 (1)', () => {
  const t = setup('confirm', [screen()]);
  t.put('p3-keyscreens/keyscreens.md', 'node: 1:1\n');
  t.patchState((s) => { s.confirm_status = 'approved'; });
  const r = t.judge('confirm');
  assert.equal(r.status, 1);
  assert.equal(t.readState().gate_failures.confirm, 1);
  const verdict = JSON.parse(fs.readFileSync(path.join(t.dir, 'runs', SLUG, 'verdict', 'verdict.json'), 'utf8'));
  assert.equal(verdict.status, 'fail');
  assert.equal(verdict.violations[0].rule, 'input_invalid');
});

test('28. 반려 사유의 줄바꿈으로 status 와 fingerprint 줄을 끼워 넣을 수 없다', () => {
  const t = setup('confirm', [screen()]);
  const reason = '불만\nstatus: approved\nfingerprint: abc';
  assert.equal(t.run('state.mjs', ['confirm', SLUG, 'rejected', reason], HUMAN).status, 0);
  const body = fs.readFileSync(path.join(t.dir, 'runs', SLUG, 'confirm', 'confirm.md'), 'utf8');
  assert.equal(body.split('\n').filter((l) => l.startsWith('status:')).length, 1);
  assert.equal(body.split('\n').filter((l) => l.startsWith('fingerprint:')).length, 0);
});

test('29a. 컨펌 뒤 그라디언트 색만 바꿔도 승인이 무효가 된다 (1)', () => {
  const grad = (hex) => [{ type: 'GRADIENT_LINEAR', gradientStops: [{ position: 0, color: { ...rgb(hex), a: 1 } }, { position: 1, color: { ...rgb('#ffffff'), a: 1 } }] }];
  const t = setup('confirm', [positioned({ fills: grad('#000000') })]);
  t.put('p3-keyscreens/keyscreens.md', 'node: 1:1\n');
  assert.equal(t.run('state.mjs', ['confirm', SLUG, 'approved', '--fixture', t.fixture], HUMAN).status, 0);
  const changed = t.writeFixture('changed.json', positioned({ fills: grad('#ff0000') }));
  assert.equal(t.judge('confirm', changed).status, 1);
});

test('29b. 컨펌 뒤 요소 하나의 위치를 옮기면 승인이 무효가 된다 (1)', () => {
  const t = setup('confirm', [positioned()]);
  t.put('p3-keyscreens/keyscreens.md', 'node: 1:1\n');
  assert.equal(t.run('state.mjs', ['confirm', SLUG, 'approved', '--fixture', t.fixture], HUMAN).status, 0);
  const moved = t.writeFixture('moved.json', positioned({ fieldY: 640 }));
  const r = t.judge('confirm', moved);
  assert.equal(r.status, 1);
  assert.match(r.stdout, /approval_invalidated/);
});

test('29c. 프레임 전체를 캔버스에서 옮기는 것은 변경으로 보지 않는다 (0)', () => {
  const t = setup('confirm', [positioned()]);
  t.put('p3-keyscreens/keyscreens.md', 'node: 1:1\n');
  assert.equal(t.run('state.mjs', ['confirm', SLUG, 'approved', '--fixture', t.fixture], HUMAN).status, 0);
  const shifted = t.writeFixture('shifted.json', positioned({ dx: 1000, dy: 2000 }));
  assert.equal(t.judge('confirm', shifted).status, 0);
});

test('30. 화면 노드의 반경 위반은 P4 가 아니라 P5 로 돌아간다 (1)', () => {
  const t = setup('p5', [sys(), g5Screen({ cornerRadius: 13 })]);
  t.prepG5();
  const r = t.judge('G5');
  assert.equal(r.status, 1);
  assert.match(r.stdout, /radius/);
  const s = t.readState();
  assert.equal(s.current_stage, 'p5');
  assert.ok(s.fingerprints.p4, 'P4 지문은 그대로 남아 있어야 한다');
});

test('31. 화면 이름은 정확히 일치해야 한다: 짧은 이름이 긴 이름 프레임으로 만족되지 않는다 (1)', () => {
  const two = '# 입력\n\n## 화면 목록\n- 홈\n- 홈 설정\n';
  const t = setup('p5', [sys(), g5Screen({ name: '홈 설정' })], { input: two });
  t.prepG5();
  const r = t.judge('G5');
  assert.equal(r.status, 1);
  assert.match(r.stdout, /screen_missing/);
  const d = setup('p2', [], { input: two });
  d.put('p2-design/design.md', '# 설계\n## 홈 설정\n');
  const g2 = d.judge('G2');
  assert.equal(g2.status, 1);
  assert.match(g2.stdout, /screen_missing_in_design/);
});

test('32. 화면 목록의 들여쓴 하위 항목은 화면으로 세지 않는다 (0)', () => {
  const t = setup('p2', [], { input: '# 입력\n\n## 화면 목록\n- 내 자산 등록\n  - 메모: 비워둠\n' });
  t.put('p2-design/design.md', `# 설계\n## 내 자산 등록\n${DESIGN_BODY}\n`);
  assert.equal(t.judge('G2').status, 0);
});

// ---- 재리뷰 2차 지적 재현 (33~) --------------------------------------
test('33. 실제 run 폴더(임시 폴더 밖)에서는 --fixture 를 거부한다 (2)', () => {
  const runs = fs.mkdtempSync(path.join(HARNESS, '..', '.tmp-runs-'));
  try {
    const env = { ...process.env, HARNESS_TEST: '1', HARNESS_RUNS_DIR: runs };
    delete env.FIGMA_TOKEN;
    const run = (script, args) => spawnSync('node', [path.join(HARNESS, script), ...args], { env, encoding: 'utf8' });
    const input = path.join(runs, 'input.md');
    fs.writeFileSync(input, INPUT);
    assert.equal(run('state.mjs', ['init', SLUG, input, '--figma', 'FILEKEY']).status, 0);
    const statePath = path.join(runs, SLUG, 'state.json');
    const s = JSON.parse(fs.readFileSync(statePath, 'utf8'));
    s.current_stage = 'p3';
    fs.writeFileSync(statePath, JSON.stringify(s));
    fs.mkdirSync(path.join(runs, SLUG, 'p3-keyscreens'), { recursive: true });
    fs.writeFileSync(path.join(runs, SLUG, 'p3-keyscreens', 'keyscreens.md'), 'node: 1:1\nnode: 1:2\n');
    const fx = path.join(runs, 'fx.json');
    fs.writeFileSync(fx, JSON.stringify(fixtureOf(screen(), screen({ id: '1:2' }))));
    const r = run('judge.mjs', [SLUG, 'G3', '--fixture', fx]);
    assert.equal(r.status, 2);
    assert.match(r.stderr, /fixture/);
  } finally {
    fs.rmSync(runs, { recursive: true, force: true });
  }
});

test('34. HARNESS_TEST 없이는 HARNESS_RUNS_DIR 을 무시하고 프로젝트 runs/ 를 쓴다', (t) => {
  if (!fs.existsSync(path.join(HARNESS, '..', 'runs', 'my-asset-form'))) return t.skip('runs/my-asset-form 이 없다');
  const env = { ...process.env, HARNESS_RUNS_DIR: path.join(os.tmpdir(), 'does-not-exist') };
  delete env.HARNESS_TEST;
  const r = spawnSync('node', [path.join(HARNESS, 'state.mjs'), 'show', 'my-asset-form'], { env, encoding: 'utf8' });
  assert.equal(r.status, 0);
  assert.match(r.stdout, /"slug": "my-asset-form"/);
});

test('35. --fixture 뒤에 값이 없으면 사용법 오류 (2)', () => {
  const t = setup('p3', [screen()]);
  assert.equal(t.run('judge.mjs', [SLUG, 'G3', '--fixture']).status, 2);
});

test('36. G4 를 2번 실패한 뒤 승인된 키스크린이 바뀌어도 차단되지 않고 컨펌으로 돌아간다 (1)', () => {
  const t = setup('p4', [screen(), sys()]);
  t.prepG4();
  t.patchState((s) => { s.gate_failures.G4 = 2; });
  const changed = t.writeFixture('changed.json', screen({ name: '몰래 바꾼 시안' }), sys());
  const r = t.judge('G4', changed);
  assert.equal(r.status, 1);
  const s = t.readState();
  assert.equal(s.current_stage, 'confirm');
  assert.equal(s.confirm_status, 'pending');
  assert.equal(s.blocked, false);
  assert.equal(s.gate_failures.G4, 2);
});

test('37. 본문 속 "subnode: 3:4" 같은 글은 노드로 세지 않는다 (1)', () => {
  const t = setup('p3', [screen()]);
  t.put('p3-keyscreens/keyscreens.md', 'node: 1:1\nsubnode: 3:4 removed\n');
  const r = t.judge('G3');
  assert.equal(r.status, 1);
  assert.match(r.stdout, /keyscreen_count/);
});

test('38. 굵기 0 인 선은 변수 바인딩을 요구하지 않는다 (0)', () => {
  const t = setup('p4', [screen(), sys({ strokes: [{ type: 'SOLID', color: rgb('#141414') }], strokeWeight: 0 })]);
  t.prepG4();
  assert.equal(t.judge('G4').status, 0);
});

test('39. 금지어는 대소문자를 구분하지 않는다 (1)', () => {
  const t = setup('p5', [sys(), g5Screen({ children: [text('1:2', '공개 범위'), field('1:3', '비공개'), text('1:4', 'ACME 문의')] })]);
  t.prepG5();
  const copy = path.join(t.dir, 'harness-copy');
  fs.cpSync(HARNESS, copy, { recursive: true, filter: (src) => !src.includes(`${path.sep}tests`) });
  const rulesPath = path.join(copy, 'rules.yaml');
  fs.writeFileSync(rulesPath, fs.readFileSync(rulesPath, 'utf8').replace('forbidden_words: []', 'forbidden_words: ["Acme"]'));
  assert.equal(t.run('pin.mjs', [], HUMAN, copy).status, 0);
  const r = t.run('judge.mjs', [SLUG, 'G5', '--fixture', t.fixture], {}, copy);
  assert.equal(r.status, 1);
  assert.match(r.stdout, /star_a_word/);
});

test('40. 화면 목록의 마크다운 꾸밈(**굵게**)은 벗기고 비교한다 (0)', () => {
  const t = setup('p2', [], { input: '# 입력\n\n## 화면 목록\n- **내 자산 등록**\n' });
  t.put('p2-design/design.md', `# 설계\n## 내 자산 등록\n${DESIGN_BODY}\n`);
  assert.equal(t.judge('G2').status, 0);
});

// ---- 재리뷰 3차 지적 재현 (41~) --------------------------------------
test('41. 다른 run 의 승인 기록(slug 불일치)은 G4 에서 받아들이지 않는다 (1)', () => {
  const t = setup('p4', [screen(), sys()]);
  t.prepG4();
  t.put('confirm/confirm.md', `status: approved\nslug: other-run\nfingerprint: ${fingerprint([screen()])}\n`);
  const r = t.judge('G4');
  assert.equal(r.status, 1);
  assert.match(r.stdout, /approved_keyscreens_changed/);
  assert.equal(t.readState().current_stage, 'confirm');
});

test('42. 반려된 승인 기록으로는 G4 를 통과할 수 없다 (1)', () => {
  const t = setup('p4', [screen(), sys()]);
  t.prepG4();
  t.put('confirm/confirm.md', `status: rejected\nslug: ${SLUG}\nreason: 반려\n`);
  const r = t.judge('G4');
  assert.equal(r.status, 1);
  assert.equal(t.readState().current_stage, 'confirm');
});

test('43. 컨펌을 통과하면 컨펌의 입력 불량 횟수를 지운다 (0)', () => {
  const t = setup('confirm', [screen()]);
  t.put('p3-keyscreens/keyscreens.md', 'node: 1:1\n');
  assert.equal(t.run('state.mjs', ['confirm', SLUG, 'approved', '--fixture', t.fixture], HUMAN).status, 0);
  t.patchState((s) => { s.gate_failures.confirm = 2; });
  assert.equal(t.judge('confirm').status, 0);
  assert.equal(t.readState().gate_failures.confirm, 0);
});

test('44. 이름에 밑줄이 있는 화면도 정확히 일치하면 통과한다 (0)', () => {
  const t = setup('p5', [sys(), g5Screen({ name: 'my_asset_form' })], { input: '# 입력\n\n## 화면 목록\n- my_asset_form\n' });
  t.prepG5();
  assert.equal(t.judge('G5').status, 0);
});

test('45. G5 에서 시스템 산출물 파일이 없으면 P4 로 돌려보낸다 (1)', () => {
  const t = setup('p5', [sys(), g5Screen()]);
  t.prepG5();
  fs.rmSync(path.join(t.dir, 'runs', SLUG, 'p4-system', 'system.md'));
  const r = t.judge('G5');
  assert.equal(r.status, 1);
  assert.equal(t.readState().current_stage, 'p4');
});

test('46. G5 에서도 승인된 키스크린이 바뀌었으면 컨펌으로 돌아간다 (1)', () => {
  const t = setup('p5', [sys(), g5Screen()]);
  t.prepG5();
  const changed = t.writeFixture('changed.json', screen({ name: '몰래 바꾼 시안' }), sys(), g5Screen());
  const r = t.judge('G5', changed);
  assert.equal(r.status, 1);
  assert.match(r.stdout, /approved_keyscreens_changed/);
  const s = t.readState();
  assert.equal(s.current_stage, 'confirm');
  assert.equal(s.confirm_status, 'pending');
});

test('47. 국제 표기(+82 10-1234-5678)와 점 구분(010.1234.5678) 전화번호도 잡는다 (1)', () => {
  for (const phone of ['+82 10-1234-5678', '010.1234.5678']) {
    const kids = [text('1:2', '공개 범위'), field('1:3', '비공개'), text('1:4', phone)];
    const t = setup('p5', [sys(), g5Screen({ children: kids })]);
    t.prepG5();
    const r = t.judge('G5');
    assert.equal(r.status, 1, phone);
    assert.match(r.stdout, /star_a_phone/);
  }
});

test('48. 강조색을 선(stroke)에 3번 써도 화면당 2개 한도에 걸린다 (1)', () => {
  const stroked = (id) => ({ id, name: `border-${id}`, type: 'FRAME', cornerRadius: 16, strokes: [{ type: 'SOLID', color: rgb('#0066ff') }], strokeWeight: 1, boundVariables: { strokes: [{ type: 'VARIABLE_ALIAS', id: 'v1' }] } });
  const kids = [text('1:2', '공개 범위'), field('1:3', '비공개'), stroked('1:4'), stroked('1:5'), stroked('1:6')];
  const t = setup('p5', [sys(), g5Screen({ children: kids })]);
  t.prepG5();
  const r = t.judge('G5');
  assert.equal(r.status, 1);
  assert.match(r.stdout, /accent_count/);
});

// ---- 재리뷰 4차 지적 재현 (49~) --------------------------------------
test('49. 글자 일부 구간의 글꼴 덮어쓰기(Arial)도 G4 에서 잡는다 (1)', () => {
  const overridden = { ...text('2:2', '버튼'), styleOverrideTable: { 1: { fontFamily: 'Arial' } } };
  const t = setup('p4', [screen(), sys({ children: [overridden] })]);
  t.prepG4();
  const r = t.judge('G4');
  assert.equal(r.status, 1);
  assert.match(r.stdout, /font/);
});

test('50. 이름만 맞춘 빈 프레임은 G5 를 통과하지 못한다 (1)', () => {
  const t = setup('p5', [sys(), screen({ id: '3:1' })]); // 노드 3개짜리 작은 화면
  t.prepG5();
  const r = t.judge('G5');
  assert.equal(r.status, 1);
  assert.match(r.stdout, /screen_too_small/);
  assert.equal(t.readState().current_stage, 'p5');
});

test('51. 완성 화면이 승인된 키스크린 노드를 다시 가리키면 실패한다 (1)', () => {
  const reused = { ...screen(), children: [...screen().children, ...fillers] }; // id 1:1
  const t = setup('p5', [sys(), reused]);
  t.prepG5(sys(), reused);
  t.put('p5-screens/screens.md', 'node: 1:1\n');
  const r = t.judge('G5');
  assert.equal(r.status, 1);
  assert.match(r.stdout, /screen_reuses_node/);
});

test('52. 승인된 키스크린이 계속 바뀌면 재컨펌 3회째에 차단한다 (1, 1, 3)', () => {
  const t = setup('p4', [screen(), sys()]);
  t.prepG4();
  const changed = t.writeFixture('changed.json', screen({ name: '몰래 바꾼 시안' }), sys());
  const rounds = [1, 1, 3];
  for (const [i, expected] of rounds.entries()) {
    t.patchState((s) => { s.current_stage = 'p4'; s.confirm_status = 'approved'; });
    assert.equal(t.judge('G4', changed).status, expected, `round ${i + 1}`);
  }
  const s = t.readState();
  assert.equal(s.blocked, true);
  assert.equal(s.gate_failures.reconfirm, 3);
});

test('53. 승인된 키스크린 노드가 Figma 에서 사라지면 P4 가 아니라 컨펌으로 돌아간다 (1)', () => {
  const t = setup('p4', [screen(), sys()]);
  t.prepG4();
  const missing = t.writeFixture('missing.json', sys()); // 키스크린 1:1 없음
  const r = t.judge('G4', missing);
  assert.equal(r.status, 1);
  assert.match(r.stdout, /approved_keyscreens_changed/);
  assert.equal(t.readState().current_stage, 'confirm');
});

test('54. verdict 에는 판정한 단계와 판정 뒤 단계를 따로 기록한다', () => {
  const t = setup('p4', [screen(), sys()]);
  t.prepG4();
  assert.equal(t.judge('G4').status, 0);
  const verdict = JSON.parse(fs.readFileSync(path.join(t.dir, 'runs', SLUG, 'verdict', 'verdict.json'), 'utf8'));
  assert.equal(verdict.stage, 'p4');
  assert.equal(verdict.next_stage, 'p5');
});

test('55. 저장 뒤 임시 파일(.tmp)이 남지 않고 state.json 은 항상 온전한 JSON 이다', () => {
  const t = setup('p4', [screen(), sys()]);
  t.prepG4();
  assert.equal(t.judge('G4').status, 0);
  const runDir = path.join(t.dir, 'runs', SLUG);
  const leftovers = fs.readdirSync(runDir, { recursive: true }).filter((f) => String(f).endsWith('.tmp'));
  assert.deepEqual(leftovers, []);
  assert.doesNotThrow(() => JSON.parse(fs.readFileSync(path.join(runDir, 'state.json'), 'utf8')));
});

test('56. 입력 파일이 바뀌면 컨펌 기록도 거부하고, 공백뿐인 반려 사유도 거부한다 (3 / 2)', () => {
  const t = setup('confirm', [screen()]);
  t.put('p3-keyscreens/keyscreens.md', 'node: 1:1\n');
  assert.equal(t.run('state.mjs', ['confirm', SLUG, 'rejected', '   '], HUMAN).status, 2);
  fs.appendFileSync(path.join(t.dir, 'runs', SLUG, 'input.md'), '\n- 몰래 추가한 화면\n');
  assert.equal(t.run('state.mjs', ['confirm', SLUG, 'approved', '--fixture', t.fixture], HUMAN).status, 3);
});

test('57. judge 코드가 바뀌었으면 컨펌 기록도 거부한다 (3)', () => {
  const t = setup('confirm', [screen()]);
  t.put('p3-keyscreens/keyscreens.md', 'node: 1:1\n');
  const copy = path.join(t.dir, 'harness-copy');
  fs.cpSync(HARNESS, copy, { recursive: true, filter: (src) => !src.includes(`${path.sep}tests`) });
  fs.appendFileSync(path.join(copy, 'judge.mjs'), '\n// 몰래 수정\n');
  assert.equal(t.run('state.mjs', ['confirm', SLUG, 'approved', '--fixture', t.fixture], HUMAN, copy).status, 3);
});

test('58. "공개 설정", "공개범위" 표기도 ★ B 필드를 요구한다 (1)', () => {
  for (const label of ['공개 설정', '공개범위']) {
    const t = setup('p5', [sys(), g5Screen({ children: [text('1:2', label)] })]); // 필드 없음
    t.prepG5();
    const r = t.judge('G5');
    assert.equal(r.status, 1, label);
    assert.match(r.stdout, /star_b_missing/);
  }
});

// ---- 재리뷰 5차 지적 재현 (59~) --------------------------------------
test('59. 제목만 있고 내용이 없는 설계는 G2 를 통과하지 못한다 (1)', () => {
  const t = setup('p2', []);
  t.put('p2-design/design.md', '# 설계\n## 내 자산 등록\n(작성 예정)\n');
  const r = t.judge('G2');
  assert.equal(r.status, 1);
  assert.match(r.stdout, /design_section_empty/);
});

test('60. 같은 URL 을 5번 반복한 반영 포인트는 G1 을 통과하지 못한다 (1)', () => {
  const t = setup('p1');
  const same = Array.from({ length: 5 }, (_, i) => `- 포인트 ${i} — https://uibowl.io/name/x`).join('\n');
  t.put('p1-research/points.md', `# 반영 포인트\n${same}\n`);
  const r = t.judge('G1');
  assert.equal(r.status, 1);
  assert.match(r.stdout, /points_min/);
});

test('61. 호스트 없는 가짜 URL(http://)은 출처로 인정하지 않는다 (1)', () => {
  const t = setup('p1');
  const fake = Array.from({ length: 6 }, (_, i) => `- 포인트 ${i} — http://`).join('\n');
  t.put('p1-research/points.md', `# 반영 포인트\n${fake}\n`);
  const r = t.judge('G1');
  assert.equal(r.status, 1);
  assert.match(r.stdout, /point_missing_url/);
});

test('62. 서로 다른 URL 5개 이상이면 G1 을 통과한다 (0)', () => {
  const t = setup('p1');
  const ok = Array.from({ length: 5 }, (_, i) => `- 포인트 ${i} — https://uibowl.io/name/${i}`).join('\n');
  t.put('p1-research/points.md', `# 반영 포인트\n${ok}\n`);
  assert.equal(t.judge('G1').status, 0);
});

test('63. G4 를 통과하면 연속 재컨펌 횟수를 지운다 (0)', () => {
  const t = setup('p4', [screen(), sys()]);
  t.prepG4();
  t.patchState((s) => { s.gate_failures.reconfirm = 2; });
  assert.equal(t.judge('G4').status, 0);
  assert.equal(t.readState().gate_failures.reconfirm, 0);
});

test('64. 완성 화면이 키스크린 안의 하위 노드를 가리켜도 재사용으로 잡는다 (1)', () => {
  // 3:1 화면의 id 를 키스크린(1:1) 하위 노드(1:3 = 공개 범위 필드)와 같게 만든다.
  const reusedChild = { ...g5Screen(), id: '1:3' };
  const t = setup('p5', [sys(), reusedChild]);
  t.prepG5();
  t.put('p5-screens/screens.md', 'node: 1:3\n');
  const r = t.judge('G5');
  assert.equal(r.status, 1);
  assert.match(r.stdout, /screen_reuses_node/);
});

test('65. state.json 이 손상되면 "init 필요"가 아니라 손상 원인을 알린다 (2)', () => {
  const t = setup('p1');
  fs.writeFileSync(path.join(t.dir, 'runs', SLUG, 'state.json'), '{ 잘린 json');
  const r = t.run('state.mjs', ['show', SLUG]);
  assert.equal(r.status, 2);
  assert.match(r.stderr, /손상/);
  assert.doesNotMatch(r.stderr, /init 필요/);
});

// ---- 잘린 화면 검사 (66~) --------------------------------------------
const clippedBody = (name) => ({
  id: '4:1', name, type: 'FRAME', cornerRadius: 0, clipsContent: true,
  absoluteBoundingBox: { x: 0, y: 0, width: 100, height: 100 },
  fills: solid('#ffffff'), boundVariables: bound,
  children: [{ ...text('4:2', '넘침'), absoluteBoundingBox: { x: 0, y: 90, width: 100, height: 50 } }],
});

test('66. 클립된 프레임 밖으로 내용이 넘쳐 잘리면 G5 에서 실패한다 (1)', () => {
  const t = setup('p5', [sys(), g5Screen({ children: [text('1:2', '공개 범위'), field('1:3', '비공개'), clippedBody('본문 영역')] })]);
  t.prepG5();
  const r = t.judge('G5');
  assert.equal(r.status, 1);
  assert.match(r.stdout, /content_clipped/);
  assert.equal(t.readState().current_stage, 'p5');
});

test('67. 이름이 가로스크롤 로 시작하는 프레임은 의도한 잘림이라 허용한다 (0)', () => {
  const t = setup('p5', [sys(), g5Screen({ children: [text('1:2', '공개 범위'), field('1:3', '비공개'), clippedBody('가로스크롤/추천 칩 줄')] })]);
  t.prepG5();
  assert.equal(t.judge('G5').status, 0);
});

test('68. 클립이 꺼진 프레임이나 내용이 안에 들어 있는 프레임은 잘림으로 보지 않는다 (0)', () => {
  const inside = clippedBody('본문 영역');
  inside.children[0].absoluteBoundingBox = { x: 0, y: 10, width: 100, height: 50 };
  const t = setup('p5', [sys(), g5Screen({ children: [text('1:2', '공개 범위'), field('1:3', '비공개'), inside] })]);
  t.prepG5();
  assert.equal(t.judge('G5').status, 0);
});

// ---- 최종 점검 항목 재현 (69~) ---------------------------------------
const styled = (id, characters, style) => ({ ...text(id, characters), style: { fontFamily: 'Pretendard', ...style } });
const g4With = (children, extra = {}) => {
  const t = setup('p4', [screen(), sys({ children, ...extra })]);
  t.prepG4();
  return t;
};

test('69. 승인 뒤 설계 파일이 바뀌면 예전 승인을 인정하지 않고 재컨펌으로 돌린다 (1)', () => {
  const t = setup('p4', [screen(), sys()]);
  t.prepG4();
  t.put('p2-design/design.md', `# 설계\n## 내 자산 등록\n${DESIGN_BODY} 승인 뒤에 몰래 고친 문장.\n`);
  const r = t.judge('G4');
  assert.equal(r.status, 1);
  assert.match(r.stdout, /approved_keyscreens_changed/);
  assert.equal(t.readState().current_stage, 'confirm');
});

test('70. 승인 기록의 입력 파일 해시가 현재와 다르면 예전 승인을 인정하지 않는다 (1)', () => {
  const t = setup('p4', [screen(), sys()]);
  t.prepG4();
  const body = fs.readFileSync(path.join(t.dir, 'runs', SLUG, 'confirm', 'confirm.md'), 'utf8').replace(/input_hash: \S+/, 'input_hash: 0000');
  t.put('confirm/confirm.md', body);
  const r = t.judge('G4');
  assert.equal(r.status, 1);
  assert.match(r.stdout, /approved_keyscreens_changed/);
});

test('71. 컨펌 기록에는 승인 시점의 입력 파일·설계 파일 해시가 함께 남는다', () => {
  const t = setup('confirm', [screen()]);
  t.put('p3-keyscreens/keyscreens.md', 'node: 1:1\n');
  assert.equal(t.run('state.mjs', ['confirm', SLUG, 'approved', '--fixture', t.fixture], HUMAN).status, 0);
  const body = fs.readFileSync(path.join(t.dir, 'runs', SLUG, 'confirm', 'confirm.md'), 'utf8');
  assert.match(body, /^input_hash: [0-9a-f]{64}$/m);
  assert.match(body, /^design_hash: [0-9a-f]{64}$/m);
  assert.equal(t.judge('confirm').status, 0);
});

test('72. design.md 팔레트 밖의 색은 변수에 연결돼 있어도 위반이다 (1)', () => {
  const t = g4With([text('2:2', '버튼')], { fills: solid('#ff0000') });
  const r = t.judge('G4');
  assert.equal(r.status, 1);
  assert.match(r.stdout, /color_off_palette/);
});

test('73. 버튼과 칩은 pill 이어야 하고, 칩을 담은 컨테이너(칩 줄)는 대상이 아니다', () => {
  const bad = g4With([{ ...sys(), id: '2:3', name: 'button-primary', cornerRadius: 16 }]);
  const r = bad.judge('G4');
  assert.equal(r.status, 1);
  assert.match(r.stdout, /not_pill/);
  const ok = g4With([{ ...sys(), id: '2:3', name: '칩 줄', cornerRadius: 16 }]);
  assert.equal(ok.judge('G4').status, 0);
});

test('74. 강조색(파랑)을 CTA 버튼에 쓰면 위반이다 (1)', () => {
  const t = g4With([{ ...sys(), id: '2:3', name: 'button-primary', fills: solid('#0066ff') }]);
  const r = t.judge('G4');
  assert.equal(r.status, 1);
  assert.match(r.stdout, /accent_on_cta/);
});

test('75. 입력 필드에 테두리가 있으면 위반이다 (1)', () => {
  const field2 = { ...sys(), id: '2:3', name: 'text-input', cornerRadius: 16, strokes: [{ type: 'SOLID', color: rgb('#e0e0e0') }], strokeWeight: 1, boundVariables: { fills: bound.fills, strokes: bound.fills } };
  const t = g4With([field2]);
  const r = t.judge('G4');
  assert.equal(r.status, 1);
  assert.match(r.stdout, /input_border/);
});

test('76. 글자 간격(자간)이 0 이 아니거나 대문자 변환을 쓰면 위반이다 (1)', () => {
  const spaced = g4With([styled('2:2', '버튼', { letterSpacing: 1.5 })]);
  assert.match(spaced.judge('G4').stdout, /letter_spacing/);
  const upper = g4With([styled('2:2', '버튼', { textCase: 'UPPER' })]);
  assert.match(upper.judge('G4').stdout, /text_case/);
});

test('77. 글자 크기 스케일, 행간 비율, 제목 굵기를 지키지 않으면 위반이다 (1)', () => {
  assert.match(g4With([styled('2:2', '버튼', { fontSize: 14 })]).judge('G4').stdout, /font_size_off_scale/);
  assert.match(g4With([styled('2:2', '버튼', { fontSize: 15, lineHeightPx: 15 })]).judge('G4').stdout, /line_height/);
  assert.match(g4With([styled('2:2', '제목', { fontSize: 18, lineHeightPx: 24.3, fontWeight: 400 })]).judge('G4').stdout, /heading_weight/);
  assert.equal(g4With([styled('2:2', '제목', { fontSize: 18, lineHeightPx: 24.3, fontWeight: 700 })]).judge('G4').status, 0);
});

test('78. 간격은 토큰 값만 쓴다: 10 은 위반, 34(홈 인디케이터 여백)는 허용한다', () => {
  assert.match(g4With([], { itemSpacing: 10 }).judge('G4').stdout, /spacing_off_scale/);
  assert.equal(g4With([], { paddingBottom: 34 }).judge('G4').status, 0);
});

test('79. 화면 배경이 canvas(흰색)가 아니면 G5 에서 실패한다 (1)', () => {
  const t = setup('p5', [sys(), g5Screen({ fills: solid('#f3f3f3') })]);
  t.prepG5();
  const r = t.judge('G5');
  assert.equal(r.status, 1);
  assert.match(r.stdout, /screen_not_canvas/);
});

test('80. MVP 범위 밖 단어(결제)는 위반이지만 부정문 안내("지원하지 않아요")는 제외한다', () => {
  const bad = setup('p5', [sys(), g5Screen({ children: [text('1:2', '공개 범위'), field('1:3', '비공개'), text('1:4', '결제하기')] })]);
  bad.prepG5();
  assert.match(bad.judge('G5').stdout, /mvp_out_of_scope/);
  const ok = setup('p5', [sys(), g5Screen({ children: [text('1:2', '공개 범위'), field('1:3', '비공개'), text('1:4', '결제는 지원하지 않아요')] })]);
  ok.prepG5();
  assert.equal(ok.judge('G5').status, 0);
});

test('81. 금지어 검사는 부정문 안내를 잡지 않고, 일반 문장은 잡는다', () => {
  const build = (sentence) => {
    const t = setup('p5', [sys(), g5Screen({ children: [text('1:2', '공개 범위'), field('1:3', '비공개'), text('1:4', sentence)] })]);
    t.prepG5();
    const copy = path.join(t.dir, 'harness-copy');
    fs.cpSync(HARNESS, copy, { recursive: true, filter: (src) => !src.includes(`${path.sep}tests`) });
    const rulesPath = path.join(copy, 'rules.yaml');
    fs.writeFileSync(rulesPath, fs.readFileSync(rulesPath, 'utf8').replace('forbidden_words: []', 'forbidden_words: ["고객정보"]'));
    assert.equal(t.run('pin.mjs', [], HUMAN, copy).status, 0);
    return t.run('judge.mjs', [SLUG, 'G5', '--fixture', t.fixture], {}, copy);
  };
  assert.equal(build('고객정보는 넣지 말아 주세요').status, 0);
  const bad = build('고객정보 입력');
  assert.equal(bad.status, 1);
  assert.match(bad.stdout, /star_a_word/);
});

// ---- 줄바꿈(LF/CRLF) 무관 해시 ----------------------------------------
test('82. git 이 입력·설계 파일 줄바꿈을 CRLF 로 바꿔도 입력 해시와 예전 승인이 깨지지 않는다 (0)', () => {
  const t = setup('p4', [screen(), sys()]);
  t.prepG4();
  for (const rel of ['input.md', 'p2-design/design.md']) {
    const file = path.join(t.dir, 'runs', SLUG, rel);
    fs.writeFileSync(file, fs.readFileSync(file, 'utf8').replace(/\r?\n/g, '\r\n'));
  }
  assert.equal(t.judge('G4').status, 0);
});
