import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { runDir } from './paths.mjs';
import { HarnessError } from './errors.mjs';

export const sha256 = (data) => crypto.createHash('sha256').update(data).digest('hex');

// 모든 진입점(judge, state)이 slug 를 같은 규칙으로 검사한다. runs/ 밖으로 나가는 경로를 막는다.
export function assertSlug(slug) {
  if (typeof slug !== 'string' || !/^[a-z0-9]+(-[a-z0-9]+)*$/.test(slug)) {
    throw new HarnessError(2, 'slug 는 영문 소문자, 숫자, 하이픈만 쓴다');
  }
}

// 사람만 실행해야 하는 명령(컨펌 기록, 해시 갱신)은 HARNESS_HUMAN=1 을 요구한다.
// 오케스트레이터는 사람의 트리거("컨펌 받았어" 등)가 있을 때만 이 값을 붙인다.
export function requireHuman(action) {
  if (process.env.HARNESS_HUMAN !== '1') throw new HarnessError(3, `${action} 은(는) 사람의 지시가 있을 때만 실행한다 (HARNESS_HUMAN=1)`);
}

const statePath = (slug) => path.join(runDir(slug), 'state.json');

export function loadState(slug) {
  assertSlug(slug);
  let raw;
  try {
    raw = fs.readFileSync(statePath(slug), 'utf8');
  } catch (e) {
    // 파일이 없는 경우만 init 안내를 한다. 권한 오류 같은 다른 원인은 그대로 알린다.
    throw new HarnessError(2, e.code === 'ENOENT' ? `run 이 없다: ${slug} (init 필요)` : `state.json 을 읽을 수 없다: ${e.message}`);
  }
  try {
    return JSON.parse(raw);
  } catch (e) {
    throw new HarnessError(2, `state.json 이 손상되었다: ${e.message}`);
  }
}

// 임시 파일에 쓴 뒤 이름을 바꿔 저장한다. 도중에 프로세스가 죽어도 반쯤 쓰인 파일이 남지 않는다.
function writeAtomic(file, content) {
  const tmp = `${file}.${process.pid}.tmp`;
  fs.writeFileSync(tmp, content);
  fs.renameSync(tmp, file);
}

// state.json 은 이 모듈(스크립트)만 쓴다.
export function saveState(state) {
  state.updated_at = new Date().toISOString();
  writeAtomic(statePath(state.slug), JSON.stringify(state, null, 2) + '\n');
}

// 입력 파일이 init 때와 같은지 확인한다. 다르면 차단(3).
export function assertInputUnchanged(state) {
  const current = sha256(fs.readFileSync(path.join(runDir(state.slug), 'input.md')));
  if (current !== state.input_hash) throw new HarnessError(3, '입력 파일이 바뀌었다 (input_hash 불일치)');
}

export function initState(slug, inputPath, figmaFileKey) {
  assertSlug(slug);
  const dir = runDir(slug);
  if (fs.existsSync(statePath(slug))) throw new HarnessError(2, `이미 있는 run: ${slug}`);
  const input = fs.readFileSync(inputPath);
  fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(path.join(dir, 'input.md'), input);
  const state = {
    slug,
    figma_file_key: figmaFileKey ?? null,
    input_hash: sha256(input),
    current_stage: 'p1',
    completed_stages: [],
    gate_failures: {},
    confirm_status: 'pending',
    fingerprints: {},
    blocked: false,
    updated_at: null,
  };
  saveState(state);
  return state;
}

export function readRunFile(slug, rel) {
  try {
    return fs.readFileSync(path.join(runDir(slug), rel), 'utf8');
  } catch {
    throw new HarnessError(1, `필요한 파일이 없다: ${rel}`);
  }
}

export function writeRunFile(slug, rel, content) {
  const full = path.join(runDir(slug), rel);
  fs.mkdirSync(path.dirname(full), { recursive: true });
  writeAtomic(full, content);
}
