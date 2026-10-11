import fs from 'node:fs';
import { HarnessError } from './errors.mjs';
import { FIXTURE_ALLOWED } from './paths.mjs';

// Figma 에서 노드를 직접 읽는다. 에이전트가 만든 export 는 입력으로 받지 않는다.
// --fixture 파일(같은 응답 형식)은 HARNESS_TEST=1 이고 run 폴더가 임시 폴더 안일 때만 쓴다.
// 그래서 실제 run 에 손으로 쓴 JSON 을 증거로 끼워 넣을 수 없다.
export async function fetchNodes(fileKey, ids, fixturePath) {
  if (fixturePath) {
    if (!FIXTURE_ALLOWED) {
      throw new HarnessError(2, '--fixture 는 테스트용 임시 run 폴더에서만 쓸 수 있다 (HARNESS_TEST=1 과 임시 폴더 필요)');
    }
    const all = JSON.parse(fs.readFileSync(fixturePath, 'utf8')).nodes ?? {};
    return pick(all, ids);
  }
  const token = process.env.FIGMA_TOKEN;
  if (!token) throw new HarnessError(2, 'FIGMA_TOKEN 이 없다');
  if (!fileKey) throw new HarnessError(2, 'state.json 에 figma_file_key 가 없다');
  let res;
  try {
    const url = `https://api.figma.com/v1/files/${fileKey}/nodes?ids=${encodeURIComponent(ids.join(','))}`;
    // 응답이 오지 않아 멈추는 일을 막기 위해 30초 제한을 둔다.
    res = await fetch(url, { headers: { 'X-Figma-Token': token }, signal: AbortSignal.timeout(30000) });
  } catch (e) {
    throw new HarnessError(2, `Figma 에 접속할 수 없다 (연결 실패 또는 30초 초과): ${e.message}`);
  }
  // 원인별로 메시지를 나눠 사람이 무엇을 할지 알 수 있게 한다. 모두 오류(2)이고 실패 횟수에는 들어가지 않는다.
  if (res.status === 403) throw new HarnessError(2, 'Figma 접근 거부(403): FIGMA_TOKEN 의 권한(file_content:read)과 파일 접근 권한을 확인한다');
  if (res.status === 404) throw new HarnessError(2, 'Figma 파일을 찾을 수 없다(404): state.json 의 figma_file_key 를 확인한다');
  if (res.status === 429) throw new HarnessError(2, 'Figma 요청 한도 초과(429): 잠시 뒤 다시 시도한다');
  if (!res.ok) throw new HarnessError(2, `Figma 응답 오류: ${res.status}`);
  const body = await res.json();
  return pick(body.nodes ?? {}, ids);
}

function pick(all, ids) {
  const out = {};
  for (const id of ids) {
    if (!all[id]?.document) throw new HarnessError(1, `Figma 에서 노드를 찾을 수 없다: ${id}`);
    out[id] = all[id].document;
  }
  return out;
}
