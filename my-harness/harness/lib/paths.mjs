import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

export const HARNESS_DIR = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
export const RULES_PATH = path.join(HARNESS_DIR, 'rules.yaml');

// 테스트(HARNESS_TEST=1)일 때만 run 폴더를 바꿀 수 있다. 그렇지 않으면 환경 변수는 무시하고 항상 프로젝트의 runs/ 를 쓴다.
export const IS_TEST = process.env.HARNESS_TEST === '1';
export const RUNS_DIR =
  IS_TEST && process.env.HARNESS_RUNS_DIR
    ? path.resolve(process.env.HARNESS_RUNS_DIR)
    : path.resolve(HARNESS_DIR, '..', 'runs');

// 테스트용 fixture(손으로 쓴 노드 JSON)는 run 폴더가 임시 폴더 안에 있을 때만 허용한다.
// 실제 run(프로젝트 runs/)은 Figma 실제 응답으로만 판정한다.
const relToTmp = path.relative(os.tmpdir(), RUNS_DIR);
export const FIXTURE_ALLOWED = IS_TEST && relToTmp !== '' && !relToTmp.startsWith('..') && !path.isAbsolute(relToTmp);

export const runDir = (slug) => path.join(RUNS_DIR, slug);

// 단계별로 에이전트 블록이 저장되는 파일
export const STAGE_FILES = {
  p1: 'p1-research/points.md',
  p2: 'p2-design/design.md',
  p3: 'p3-keyscreens/keyscreens.md',
  p4: 'p4-system/system.md',
  p5: 'p5-screens/screens.md',
};
export const CONFIRM_FILE = 'confirm/confirm.md';
export const STAGES = ['p1', 'p2', 'p3', 'confirm', 'p4', 'p5', 'done'];
