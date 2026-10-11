// rules.yaml 에 쓰는 최소 YAML만 읽는다: 맵, 리스트, 인라인 리스트, 숫자, 문자열.
// 줄 끝 주석(` # ...`)은 따옴표 밖에서만 잘라 낸다.
function stripComment(s) {
  let quoted = false;
  for (let i = 0; i < s.length; i++) {
    if (s[i] === '"' && s[i - 1] !== '\\') quoted = !quoted;
    if (!quoted && s[i] === '#' && (i === 0 || /\s/.test(s[i - 1]))) return s.slice(0, i);
  }
  return s;
}

function scalar(raw) {
  const s = stripComment(raw).trim();
  if (s === '[]') return [];
  if (s.startsWith('[') && s.endsWith(']')) return splitInline(s.slice(1, -1)).map(scalar);
  if (s.startsWith('"') && s.endsWith('"')) return JSON.parse(s);
  if (/^-?\d+(\.\d+)?$/.test(s)) return Number(s);
  if (s === 'true') return true;
  if (s === 'false') return false;
  return s;
}

function splitInline(s) {
  const out = [];
  let cur = '';
  let quoted = false;
  for (let i = 0; i < s.length; i++) {
    const c = s[i];
    if (c === '"' && s[i - 1] !== '\\') quoted = !quoted;
    if (c === ',' && !quoted) {
      out.push(cur);
      cur = '';
    } else cur += c;
  }
  if (cur.trim()) out.push(cur);
  return out;
}

export function parseYaml(text) {
  const lines = text
    .split(/\r?\n/)
    .filter((l) => l.trim() && !l.trim().startsWith('#'))
    .map((l) => ({ indent: l.length - l.trimStart().length, text: l.trim() }));
  if (lines.length === 0) throw new Error('YAML 이 비어 있다');

  function block(i, indent) {
    if (lines[i].text.startsWith('- ')) {
      const list = [];
      while (i < lines.length && lines[i].indent === indent && lines[i].text.startsWith('- ')) {
        list.push(scalar(lines[i].text.slice(2)));
        i++;
      }
      return [list, i];
    }
    const map = {};
    while (i < lines.length && lines[i].indent === indent) {
      const m = lines[i].text.match(/^([^:]+):\s*(.*)$/);
      if (!m) throw new Error(`YAML 형식 오류: ${lines[i].text}`);
      const [, key, rest] = m;
      i++;
      if (stripComment(rest).trim() === '') {
        const next = lines[i];
        // 들여쓴 자식 블록, 또는 같은 들여쓰기의 `- 항목` 리스트
        if (next && (next.indent > indent || (next.indent === indent && next.text.startsWith('- ')))) {
          const [v, after] = block(i, next.indent);
          map[key] = v;
          i = after;
        } else map[key] = null;
      } else map[key] = scalar(rest);
    }
    return [map, i];
  }

  return block(0, lines[0].indent)[0];
}
