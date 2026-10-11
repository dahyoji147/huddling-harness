#!/usr/bin/env node
// 사용:
//   node harness/state.mjs init <slug> <input.md> [--figma <fileKey>]
//   node harness/state.mjs show <slug>
//   HARNESS_HUMAN=1 node harness/state.mjs confirm <slug> approved [--fixture 파일]
//   HARNESS_HUMAN=1 node harness/state.mjs confirm <slug> rejected "<사유>"
// confirm 은 사람의 트리거("컨펌 받았어", "컨펌 반려: ...")가 있을 때만 오케스트레이터가 실행한다.
import { CONFIRM_FILE, STAGE_FILES } from './lib/paths.mjs';
import { HarnessError } from './lib/errors.mjs';
import { initState, loadState, saveState, writeRunFile, readRunFile, requireHuman, assertInputUnchanged, sha256Text } from './lib/state.mjs';
import { assertPinned } from './lib/pin.mjs';
import { fetchNodes } from './lib/figma.mjs';
import { fingerprint, nodeIds } from './lib/checks.mjs';

function opt(argv, name) {
  const i = argv.indexOf(name);
  if (i < 0) return null;
  const value = argv.splice(i, 2)[1];
  if (!value) throw new HarnessError(2, `${name} 뒤에 값이 필요하다`);
  return value;
}

async function main() {
  const argv = process.argv.slice(2);
  const fixture = opt(argv, '--fixture');
  const figma = opt(argv, '--figma');
  const [cmd, slug, a, b] = argv;

  if (cmd === 'init') {
    if (!slug || !a) throw new HarnessError(2, '사용법: init <slug> <input.md> [--figma <fileKey>]');
    console.log(JSON.stringify(initState(slug, a, figma), null, 2));
  } else if (cmd === 'show') {
    console.log(JSON.stringify(loadState(slug), null, 2));
  } else if (cmd === 'confirm') {
    requireHuman('confirm');
    assertPinned(); // judge 코드나 rules.yaml 이 바뀌었으면 컨펌도 기록하지 않는다
    const state = loadState(slug);
    if (state.blocked) throw new HarnessError(3, '차단된 run');
    assertInputUnchanged(state);
    if (state.current_stage !== 'confirm') throw new HarnessError(2, `현재 단계는 ${state.current_stage} 이다. 컨펌 단계가 아니다`);
    if (a === 'approved') {
      const ids = nodeIds(readRunFile(slug, STAGE_FILES.p3));
      if (ids.length === 0) throw new HarnessError(2, '키스크린 노드가 없어 승인할 수 없다');
      const docs = Object.values(await fetchNodes(state.figma_file_key, ids, fixture));
      // 승인 시점의 입력 파일과 설계 파일 해시도 같이 남긴다. 실행을 다시 열었을 때 이것이 달라졌으면 예전 승인은 무효다.
      let design;
      try {
        design = readRunFile(slug, STAGE_FILES.p2);
      } catch {
        throw new HarnessError(2, '설계 파일(p2-design/design.md)이 없어 승인할 수 없다');
      }
      writeRunFile(
        slug,
        CONFIRM_FILE,
        `status: approved\nslug: ${slug}\nfingerprint: ${fingerprint(docs)}\ninput_hash: ${state.input_hash}\ndesign_hash: ${sha256Text(design)}\n`,
      );
      state.confirm_status = 'approved';
    } else if (a === 'rejected') {
      // 사유의 줄바꿈을 공백으로 바꿔 `status:`, `fingerprint:` 같은 줄을 끼워 넣지 못하게 한다.
      const reason = (b ?? '').replace(/\s+/g, ' ').trim();
      if (!reason) throw new HarnessError(2, '반려 사유가 필요하다');
      writeRunFile(slug, CONFIRM_FILE, `status: rejected\nslug: ${slug}\nreason: ${reason}\n`);
      state.confirm_status = 'rejected';
    } else throw new HarnessError(2, 'approved 또는 rejected');
    saveState(state);
    console.log(`confirm ${state.confirm_status}`);
  } else throw new HarnessError(2, '명령: init | show | confirm');
}

main().then(
  () => process.exit(0),
  (e) => {
    console.error(e instanceof HarnessError ? e.message : `오류: ${e.stack}`);
    process.exit(e instanceof HarnessError ? e.code : 2);
  },
);
