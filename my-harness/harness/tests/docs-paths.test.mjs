// 실행: node --test harness/tests/docs-paths.test.mjs
// 폴더나 단계 이름을 바꾼 뒤 옛 경로가 문서와 에이전트 템플릿에 남지 않았는지 확인한다.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { STAGE_FILES, CONFIRM_FILE } from '../lib/paths.mjs';

const HARNESS = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const ROOT = path.resolve(HARNESS, '..');
const read = (rel) => fs.readFileSync(path.join(ROOT, rel), 'utf8');
const list = (dir, ext) => fs.readdirSync(path.join(ROOT, dir)).filter((f) => f.endsWith(ext)).map((f) => `${dir}/${f}`);

// runs/<slug>/ 아래에서 유효한 상대 경로 (paths.mjs 가 정의한 폴더 구조)
// references.md 는 P1 의 보조 산출물이다(판정은 points.md 만 읽는다). 이 목록에 명시해 둔다.
const EXTRA_OUTPUTS = ['p1-research/references.md'];
const RUN_FILES = new Set(['input.md', 'state.json', 'verdict/verdict.json', CONFIRM_FILE, ...Object.values(STAGE_FILES), ...EXTRA_OUTPUTS]);

test('D1. 에이전트 템플릿의 "입력:", "출력:" 줄은 현재 폴더 구조와 맞는 경로만 가리킨다', () => {
  const templates = list('harness/agents', '.md').filter((f) => !f.endsWith('README.md'));
  assert.ok(templates.length >= 5, '역할별 템플릿 5개가 있어야 한다');
  for (const file of templates) {
    const lines = read(file).split('\n').filter((l) => /^(입력|출력):/.test(l));
    assert.ok(lines.length >= 2, `${file}: 입력:과 출력: 줄이 있어야 한다`);
    for (const line of lines) {
      for (const raw of line.replace(/^(입력|출력):/, '').split(',')) {
        const p = raw.trim().replace(/\{\{slug\}\}/g, 'x');
        if (p.startsWith('runs/x/')) assert.ok(RUN_FILES.has(p.slice('runs/x/'.length)), `${file}: 알 수 없는 run 경로 ${p}`);
        else assert.ok(fs.existsSync(path.join(ROOT, p)), `${file}: 없는 경로 ${p}`);
      }
    }
  }
});

test('D2. 템플릿의 출력 블록 태그(file=...)가 단계 폴더 구조와 맞는다', () => {
  const stageOf = { 'researcher.md': 'p1', 'designer.md': 'p2', 'keyscreen.md': 'p3', 'system.md': 'p4', 'screens.md': 'p5' };
  for (const [name, stage] of Object.entries(stageOf)) {
    const body = read(`harness/agents/${name}`);
    const tags = [...body.matchAll(/=== BLOCK stage=(\w+) file=(\S+) ===/g)];
    assert.ok(tags.length >= 1, `${name}: 블록 형식이 있어야 한다`);
    for (const [, s, f] of tags) {
      assert.equal(s, stage, `${name}: stage 태그`);
      const known = Object.values(STAGE_FILES).concat(EXTRA_OUTPUTS);
      assert.ok(known.includes(f), `${name}: 알 수 없는 출력 파일 ${f}`);
    }
  }
});

test('D3. CLAUDE.md 와 docs 문서가 백틱으로 가리키는 docs/, harness/ 경로는 실제로 있다', () => {
  const files = ['CLAUDE.md', ...list('docs', '.md').filter((f) => !/prd\.md$|design\.md$/.test(f)), 'harness/agents/README.md'];
  for (const file of files) {
    for (const m of read(file).matchAll(/`((?:docs|harness)\/[^`\s]*)`/g)) {
      const p = m[1];
      if (/[<>{}*]/.test(p)) continue; // 자리표시자와 패턴은 건너뜀
      assert.ok(fs.existsSync(path.join(ROOT, p)), `${file}: 없는 경로 ${p}`);
    }
  }
});

test('D4. 문서에 옛 폴더·파일 이름(work/, rules.json, 번호 붙은 단계 파일)이 남아 있지 않다', () => {
  const stale = /\bwork\/<|\bwork\/|rules\.json|\b0[0-7]-(input|research|design|keyscreens|confirm|system|screens|verdict)\b|retries\{/;
  const files = ['CLAUDE.md', ...list('docs', '.md').filter((f) => !/prd\.md$|design\.md$/.test(f)), ...list('harness/agents', '.md')];
  for (const file of files) {
    const hit = read(file).split('\n').find((l) => stale.test(l));
    assert.equal(hit, undefined, `${file}: 옛 이름이 남아 있다 → ${hit}`);
  }
});

test('D5. rules.yaml 의 단계 폴더 이름이 runs/ 구조와 문서(pipeline.md)에서 같은 이름이다', () => {
  const pipeline = read('docs/pipeline.md');
  for (const rel of [...Object.values(STAGE_FILES), CONFIRM_FILE, 'verdict/verdict.json', 'state.json']) {
    assert.ok(pipeline.includes(rel.split('/').pop().replace(/\.md$|\.json$/, '')) , `pipeline.md 에 ${rel} 가 빠져 있다`);
  }
  assert.ok(pipeline.includes('p1-research/'), 'pipeline.md 에 p1-research/ 폴더가 있어야 한다');
});
