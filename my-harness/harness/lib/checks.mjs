import { sha256 } from './state.mjs';

// 단계 파일의 `node: 1:2` 줄에서 노드 ID 를 읽는다. Figma API 가 돌려주는 `숫자:숫자` 형식만 받는다.
// 같은 ID 를 여러 번 적어도 한 번만 센다.
// 줄 전체가 `node: 1:2` 인 줄만 인정한다. 본문 설명 속의 "subnode: 3:4" 같은 글은 노드로 세지 않는다.
export const nodeIds = (text) => [...new Set([...text.matchAll(/^[ \t]*node:[ \t]*(\d+:\d+)[ \t]*$/gm)].map((m) => m[1]))];

export function walk(node, fn, parent = null) {
  fn(node, parent);
  for (const child of node.children ?? []) walk(child, fn, node);
}

const startsWithAny = (name, prefixes) => (prefixes ?? []).some((p) => (name ?? '').startsWith(p));

export function toHex(c) {
  const h = (v) => Math.round(v * 255).toString(16).padStart(2, '0');
  return `#${h(c.r)}${h(c.g)}${h(c.b)}`;
}

const solidFills = (node) => (node.fills ?? []).filter((f) => f.type === 'SOLID' && f.visible !== false);

// 위반은 { rule, layer, node } 로 모은다. layer: system(토큰·컴포넌트) / screen(화면)
export function frameSize(frame, rules) {
  const box = frame.absoluteBoundingBox ?? {};
  return box.width === rules.frame.width && box.height === rules.frame.height
    ? []
    : [{ rule: 'frame_size', layer: 'screen', node: frame.name }];
}

// layer: 어느 단계 산출물을 검사하는지. 'system'(P4 노드)이면 P4 로, 'screen'(P5 노드)이면 P5 로 돌아간다.
export function designViolations(root, rules, layer = 'system') {
  const d = rules.design;
  const v = [];
  walk(root, (n) => {
    const where = n.name ?? n.id;
    if (n.type !== 'ELLIPSE' && !startsWithAny(n.name, d.radius_exempt_prefix)) {
      const radii = n.rectangleCornerRadii ?? (n.cornerRadius === undefined ? [] : [n.cornerRadius]);
      if (radii.some((r) => !d.radius_allowed.includes(r))) v.push({ rule: 'radius', layer, node: where });
    }
    if (!startsWithAny(n.name, d.shadow_exempt_prefix)) {
      const shadows = (n.effects ?? []).filter((e) => /SHADOW/.test(e.type) && e.visible !== false);
      if (shadows.length > d.shadows_max) v.push({ rule: 'shadow', layer, node: where });
    }
    if (n.type === 'TEXT') {
      const fontOk = (family) => d.font_families.some((f) => family === f || family === `${f} Variable`);
      if (!fontOk(String(n.style?.fontFamily ?? ''))) v.push({ rule: 'font', layer, node: where });
      // 글자 일부 구간의 덮어쓰기(styleOverrideTable)도 같은 규칙을 지켜야 한다.
      for (const o of Object.values(n.styleOverrideTable ?? {})) {
        if (o.fontFamily && !fontOk(String(o.fontFamily))) v.push({ rule: 'font', layer, node: where });
        // 구간 덮어쓰기의 색은 변수에 바인딩할 수 없으므로 SOLID 채움이 있으면 위반으로 본다.
        if ((o.fills ?? []).some((f) => f.type === 'SOLID' && f.visible !== false)) v.push({ rule: 'color_unbound', layer, node: where });
      }
    }
    const unbound = [
      ...(solidFills(n).length && !n.boundVariables?.fills?.length ? ['fill'] : []),
      // 굵기가 0 인 선은 보이지 않으므로 바인딩을 요구하지 않는다.
      ...((n.strokes ?? []).some((s) => s.type === 'SOLID' && s.visible !== false) && n.strokeWeight !== 0 && !n.boundVariables?.strokes?.length
        ? ['stroke']
        : []),
    ];
    if (unbound.length) v.push({ rule: 'color_unbound', layer, node: where });
  });
  v.push(...guideViolations(root, rules, layer));
  return v;
}

// 부정문("~하지 않는다", "넣지 말아 주세요")은 금지어 검사에서 제외한다. 안내 문구가 오탐되지 않게 하려는 것이다.
export const isNegated = (text, rules) => new RegExp(rules.negation_regex).test(text);

// docs/design.md 의 Do's and Don'ts 중 스크립트로 셀 수 있는 나머지 규칙들.
// 색이 팔레트 안에 있는지, pill 모양, 글자 규칙(자간, 대문자, 크기, 행간, 제목 굵기), 입력 필드 테두리, 간격 토큰.
function guideViolations(root, rules, layer) {
  const d = rules.design;
  const g = rules.guide;
  const pill = new RegExp(g.pill_name_regex);
  const cta = new RegExp(g.cta_name_regex);
  const input = new RegExp(g.input_name_regex);
  const v = [];
  walk(root, (n) => {
    const where = n.name ?? n.id;
    // 색: 보이는 채움과 선의 실제 색이 design.md 팔레트 밖이면 위반. 그라디언트도 UI 크롬에는 금지.
    const paints = [...(n.fills ?? []), ...(n.strokes ?? [])].filter((p) => p.visible !== false);
    for (const p of paints) {
      if (p.type === 'SOLID' && !g.palette.includes(toHex(p.color))) v.push({ rule: 'color_off_palette', layer, node: where });
      if (String(p.type).startsWith('GRADIENT')) v.push({ rule: 'gradient_fill', layer, node: where });
    }
    // 모양: 버튼, 칩, 토글 같은 인터랙션 요소는 전부 pill(9999).
    if (n.type !== 'TEXT' && pill.test(where) && !(n.cornerRadius >= 9999)) v.push({ rule: 'not_pill', layer, node: where });
    // 강조색(파랑)은 CTA 버튼에 쓰지 않는다.
    if (cta.test(where) && solidFills(n).some((f) => toHex(f.color) === d.accent_hex)) v.push({ rule: 'accent_on_cta', layer, node: where });
    // 입력 필드는 쉴 때 테두리가 없다.
    if (n.type !== 'TEXT' && input.test(where) && (n.strokes ?? []).some((s) => s.visible !== false) && n.strokeWeight !== 0) {
      v.push({ rule: 'input_border', layer, node: where });
    }
    // 간격은 8px 기준 토큰 값만.
    const gaps = [n.itemSpacing, n.paddingLeft, n.paddingRight, n.paddingTop, n.paddingBottom].filter((x) => x !== undefined);
    if (gaps.some((x) => !g.spacing_allowed.includes(x))) v.push({ rule: 'spacing_off_scale', layer, node: where });
    if (n.type === 'TEXT' && n.style) {
      const s = n.style;
      if (s.letterSpacing !== undefined && s.letterSpacing !== 0) v.push({ rule: 'letter_spacing', layer, node: where });
      if (s.textCase !== undefined && s.textCase !== 'ORIGINAL') v.push({ rule: 'text_case', layer, node: where });
      if (s.fontSize !== undefined && !g.font_sizes.includes(s.fontSize)) v.push({ rule: 'font_size_off_scale', layer, node: where });
      if (s.fontSize && s.lineHeightPx) {
        const ratio = s.lineHeightPx / s.fontSize;
        const max = s.fontSize >= g.heading_min_size ? g.heading_line_height_max : g.line_height_max;
        if (ratio < g.line_height_min - 0.005 || ratio > max + 0.005) v.push({ rule: 'line_height', layer, node: where });
      }
      // 제목급(큰 글자)은 Bold 700.
      if (s.fontSize >= g.heading_min_size && s.fontWeight !== undefined && s.fontWeight !== 700) v.push({ rule: 'heading_weight', layer, node: where });
    }
  });
  return v;
}

export function accentViolations(frame, rules) {
  let count = 0;
  walk(frame, (n) => {
    // 채움뿐 아니라 보이는 선(stroke)의 강조색도 센다.
    const strokes = (n.strokes ?? []).filter((s) => s.type === 'SOLID' && s.visible !== false);
    count += [...solidFills(n), ...strokes].filter((p) => toHex(p.color) === rules.design.accent_hex).length;
  });
  return count > rules.design.accent_max_per_screen ? [{ rule: 'accent_count', layer: 'screen', node: frame.name }] : [];
}

export function starAViolations(frame, rules) {
  const a = rules.star_a;
  const email = new RegExp(a.email_regex);
  const phone = new RegExp(a.phone_regex);
  const v = [];
  walk(frame, (n) => {
    if (n.type !== 'TEXT') return;
    const t = n.characters ?? '';
    if (email.test(t)) v.push({ rule: 'star_a_email', layer: 'screen', node: n.name });
    if (phone.test(t)) v.push({ rule: 'star_a_phone', layer: 'screen', node: n.name });
    // 금지어는 대소문자를 구분하지 않는다.
    // 부정문("넣지 말아 주세요")은 금지어 검사에서 제외한다. 안내 문구가 오탐되지 않게 한다. (이메일·전화번호 형식은 위에서 문장과 관계없이 잡는다)
    if (!isNegated(t, rules)) {
      for (const w of a.forbidden_words ?? []) if (t.toLowerCase().includes(String(w).toLowerCase())) v.push({ rule: 'star_a_word', layer: 'screen', node: n.name });
    }
  });
  return v;
}

// 기준 결정(story-service.md): MVP 범위 밖 항목(구매, 결제, 정산, 허들링 픽 노출, 판매 중, 피드백)은 화면에 나오지 않는다.
export function scopeViolations(frame, rules) {
  const v = [];
  walk(frame, (n) => {
    if (n.type !== 'TEXT') return;
    const t = n.characters ?? '';
    if (isNegated(t, rules)) return;
    for (const w of rules.scope.out_of_scope_words ?? []) if (t.includes(w)) v.push({ rule: 'mvp_out_of_scope', layer: 'screen', node: n.name });
  });
  return v;
}

// 클립(clipsContent)이 켜진 프레임 안에서 자식이 프레임 밖으로 나가 잘려 보이는 곳을 찾는다.
// 사람이 보면 "만들다 만 화면"처럼 보이는 결함이다. 의도한 가로 스크롤 줄은 이름이 예외 접두사로 시작하면 건너뛴다.
export function clippedViolations(frame, rules) {
  const v = [];
  const prefixes = rules.g5.clip_exempt_prefix ?? [];
  walk(frame, (n) => {
    if (n.clipsContent !== true || !n.absoluteBoundingBox || startsWithAny(n.name, prefixes)) return;
    const p = n.absoluteBoundingBox;
    for (const c of n.children ?? []) {
      if (c.visible === false || !c.absoluteBoundingBox) continue;
      const b = c.absoluteBoundingBox;
      const outside = b.x < p.x - 1 || b.y < p.y - 1 || b.x + b.width > p.x + p.width + 1 || b.y + b.height > p.y + p.height + 1;
      if (outside) v.push({ rule: 'content_clipped', layer: 'screen', node: `${n.name} > ${c.name}` });
    }
  });
  return v;
}

// 화면이 실제로 채워진 프레임인지 본다: 최상위가 FRAME 이고 노드와 텍스트가 최소 개수 이상이어야 한다.
// 빈 프레임을 이름만 맞춰 만들어 위반 0건을 얻는 것을 막는다.
export function screenContentViolations(frame, rules) {
  const v = [];
  if (frame.type !== 'FRAME') v.push({ rule: 'screen_not_frame', layer: 'screen', node: frame.name });
  // 화면 배경은 canvas(흰색)이어야 한다.
  const bg = solidFills(frame)[0];
  if (!bg || toHex(bg.color) !== rules.guide.canvas_hex) v.push({ rule: 'screen_not_canvas', layer: 'screen', node: frame.name });
  let nodes = 0;
  let texts = 0;
  walk(frame, (n) => {
    nodes++;
    if (n.type === 'TEXT') texts++;
  });
  if (nodes - 1 < rules.g5.min_nodes || texts < rules.g5.min_text_nodes) v.push({ rule: 'screen_too_small', layer: 'screen', node: frame.name });
  return v;
}

export function starBViolations(frame, rules) {
  const b = rules.star_b;
  const trigger = new RegExp(b.trigger_regex);
  let hasTrigger = false;
  const fields = [];
  walk(frame, (n) => {
    if (n.type === 'TEXT' && trigger.test(n.characters ?? '')) hasTrigger = true;
    if ((n.name ?? '').startsWith(b.field_name_prefix)) fields.push(n.name.slice(b.field_name_prefix.length));
  });
  const v = [];
  if (hasTrigger && fields.length === 0) v.push({ rule: 'star_b_missing', layer: 'screen', node: frame.name });
  for (const value of fields) {
    if (value !== b.required_default) v.push({ rule: 'star_b_default', layer: 'screen', node: frame.name });
  }
  return v;
}

const paintKey = (p) => [
  p.type, p.visible, p.opacity, p.blendMode, p.color && toHex(p.color),
  p.imageRef ?? p.imageHash, p.scaleMode,
  (p.gradientStops ?? []).map((s) => [s.position, s.color && toHex(s.color), s.color?.a]),
  p.gradientHandlePositions,
];

// 지문: 규칙 판정과 눈에 보이는 모양에 영향을 주는 속성을 해시한다.
// 선(굵기, 정렬), 그라디언트, 이미지, 글자 크기·굵기, 그림자 세부값, 표시 여부, 오토레이아웃 간격,
// 그리고 최상위 노드 기준의 상대 위치(x, y)를 포함한다. 프레임 전체를 캔버스에서 옮기는 것은 변경으로 보지 않는다.
export function fingerprint(roots) {
  const rows = [];
  for (const root of roots) {
    const ox = root.absoluteBoundingBox?.x ?? 0;
    const oy = root.absoluteBoundingBox?.y ?? 0;
    walk(root, (n) => {
      const box = n.absoluteBoundingBox;
      rows.push([
        n.id, n.name, n.type, n.visible, n.opacity,
        box?.width, box?.height, box && box.x - ox, box && box.y - oy,
        n.strokeAlign, n.strokeWeight, n.individualStrokeWeights,
        n.cornerRadius, n.rectangleCornerRadii,
        (n.effects ?? []).map((e) => [e.type, e.visible, e.radius, e.spread, e.offset, e.color && toHex(e.color)]),
        (n.fills ?? []).map(paintKey),
        (n.strokes ?? []).map(paintKey),
        n.boundVariables,
        n.layoutMode, n.itemSpacing, n.paddingLeft, n.paddingRight, n.paddingTop, n.paddingBottom,
        n.style && [n.style.fontFamily, n.style.fontWeight, n.style.fontSize, n.style.lineHeightPx],
        n.characters, n.characterStyleOverrides, n.styleOverrideTable,
      ]);
    });
  }
  return sha256(JSON.stringify(rows));
}
