/** 그래프 캔버스 키보드 탐색: 화살표로 노드·간선 이동, Enter로 선택, Escape로 해제, +/-/0 줌 */

import { compareKo, cycleIndex } from '../common/valueUtils';
import { GRAPH_ZOOM } from './graphCore';
import { pickCharacterDisplayName } from './graphCharacterNames';
import { centerSelectionOnElementId, fitGraphToNodes, zoomGraphByFactor } from './graphViewport';

function graphElementLabel(ele) {
  if (!ele?.length) return '';
  const data = ele.data?.() || {};
  if (typeof ele.isNode === 'function' && ele.isNode()) {
    return pickCharacterDisplayName(data) || String(data.id || '이름 없음');
  }
  const sn = pickCharacterDisplayName(ele.source?.()?.data?.()) || '인물';
  const tn = pickCharacterDisplayName(ele.target?.()?.data?.()) || '인물';
  return `${sn}와 ${tn}의 관계`;
}

function isNavigableGraphElement(ele) {
  if (!ele?.length) return false;
  if (typeof ele.visible === 'function' && !ele.visible()) return false;
  if (typeof ele.hasClass === 'function' && ele.hasClass('faded')) return false;
  return true;
}

function compareByGraphLabelKo(a, b) {
  return compareKo(graphElementLabel(a), graphElementLabel(b));
}

function listNavigableGraphNodes(cy) {
  if (!cy || cy.destroyed?.()) return [];
  try {
    return cy
      .nodes()
      .filter((n) => isNavigableGraphElement(n))
      .sort(compareByGraphLabelKo)
      .toArray();
  } catch {
    return [];
  }
}

function listNavigableGraphEdgesForNode(node) {
  if (!node?.length) return [];
  try {
    return node
      .connectedEdges()
      .filter((e) => isNavigableGraphElement(e))
      .sort(compareByGraphLabelKo)
      .toArray();
  } catch {
    return [];
  }
}

function setKeyboardFocusElement(cy, element) {
  if (!cy || cy.destroyed?.()) return;
  try {
    cy.batch(() => {
      cy.nodes('.kb-focus').removeClass('kb-focus');
      cy.edges('.kb-focus').removeClass('kb-focus');
      if (element?.length) element.addClass('kb-focus');
    });
  } catch {
    /* ignore */
  }
}

function commitKeyboardFocus(cy, focusRef, kind, ele) {
  setKeyboardFocusElement(cy, ele);
  if (!focusRef) return;
  focusRef.current = ele?.length ? { kind, id: String(ele.id()) } : null;
}

function announceFocus(kind, ele, index, total) {
  const pos = `${index + 1}/${total}`;
  const label = graphElementLabel(ele);
  return kind === 'edge'
    ? `${label} 포커스. ${pos}. Enter로 상세.`
    : `인물 ${label} 포커스. ${pos}. Enter로 상세, 선택 후 좌우로 관계.`;
}

function moveKeyboardFocus(cy, {
  list,
  kind,
  delta,
  focusRef,
  currentId,
  fallbackId = null,
  onAnnounce,
  center = false,
}) {
  if (!list.length) {
    onAnnounce?.(kind === 'edge' ? '연결된 관계가 없습니다.' : '탐색할 인물이 없습니다.');
    return true;
  }
  let idx = list.findIndex((el) => String(el.id()) === String(currentId));
  if (idx < 0 && fallbackId != null) {
    idx = list.findIndex((el) => String(el.id()) === String(fallbackId));
  }
  idx = cycleIndex(idx, list.length, delta);
  const ele = list[idx];
  commitKeyboardFocus(cy, focusRef, kind, ele);
  if (center) {
    try {
      centerSelectionOnElementId(cy, ele.id(), {
        duration: 220,
        padding: 48,
        reserveRight: 24,
      });
    } catch {
      /* ignore */
    }
  }
  onAnnounce?.(announceFocus(kind, ele, idx, list.length));
  return true;
}

const ZOOM_KEY_FACTORS = new Map([
  ['+', GRAPH_ZOOM.STEP],
  ['=', GRAPH_ZOOM.STEP],
  ['-', 1 / GRAPH_ZOOM.STEP],
  ['_', 1 / GRAPH_ZOOM.STEP],
]);

const ARROW_KEYS = new Set(['ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight']);

function isTypingTarget(target) {
  const tag = target?.tagName;
  return tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT' || Boolean(target?.isContentEditable);
}

function clearGraphKeyboardFocus(cy, { onClearSelection, keyboardFocusRef, onAnnounce }) {
  onClearSelection?.();
  setKeyboardFocusElement(cy, null);
  if (keyboardFocusRef) keyboardFocusRef.current = null;
  onAnnounce?.('선택과 포커스를 해제했습니다.');
  return true;
}

/** 화살표: 인물 순환. 노드 선택 중 좌우는 그 인물의 연결 관계 순환 */
function moveFocusByArrow(cy, key, { keyboardFocusRef, onAnnounce, selectedKind, selectedId }) {
  const focus = keyboardFocusRef?.current;
  const delta = key === 'ArrowDown' || key === 'ArrowRight' ? 1 : -1;
  const isHorizontal = key === 'ArrowLeft' || key === 'ArrowRight';

  if (selectedKind === 'node' && selectedId && isHorizontal) {
    return moveKeyboardFocus(cy, {
      list: listNavigableGraphEdgesForNode(cy.getElementById(String(selectedId))),
      kind: 'edge',
      delta,
      focusRef: keyboardFocusRef,
      currentId: focus?.kind === 'edge' ? focus.id : null,
      onAnnounce,
    });
  }

  return moveKeyboardFocus(cy, {
    list: listNavigableGraphNodes(cy),
    kind: 'node',
    delta,
    focusRef: keyboardFocusRef,
    currentId: focus?.kind === 'node' ? focus.id : null,
    fallbackId: selectedId,
    onAnnounce,
    center: true,
  });
}

/** Enter/Space: 포커스 요소 선택 (포커스가 없으면 첫 인물) */
function activateKeyboardFocus(cy, { keyboardFocusRef, onSelectById, onAnnounce }) {
  let kind = keyboardFocusRef?.current?.kind;
  let id = keyboardFocusRef?.current?.id;
  if (!id) {
    const nodes = listNavigableGraphNodes(cy);
    if (!nodes.length) {
      onAnnounce?.('선택할 인물이 없습니다.');
      return true;
    }
    kind = 'node';
    id = String(nodes[0].id());
    commitKeyboardFocus(cy, keyboardFocusRef, 'node', nodes[0]);
  }

  if (!onSelectById?.(kind, id)) {
    onAnnounce?.('선택을 적용하지 못했습니다.');
    return true;
  }
  const label = graphElementLabel(cy.getElementById(String(id)));
  onAnnounce?.(kind === 'edge' ? `${label} 상세를 열었습니다.` : `인물 ${label} 상세를 열었습니다.`);
  return true;
}

/**
 * 그래프 캔버스 region 포커스 단축키.
 * +/= 확대, - 축소, 0 맞춤, Escape 선택·포커스 해제.
 * 화살표: 인물 순환(선택 중 좌우는 연결 관계). Enter/Space: 포커스 선택.
 * @returns {boolean} 처리 여부
 */
export function handleGraphCanvasHotkeys(event, options = {}) {
  if (!event || event.defaultPrevented) return false;
  if (event.metaKey || event.ctrlKey || event.altKey) return false;
  if (isTypingTarget(event.target)) return false;

  const { cy } = options;
  const { key } = event;

  if (key === 'Escape') {
    event.preventDefault();
    return clearGraphKeyboardFocus(cy, options);
  }

  if (!cy || cy.destroyed?.()) return false;

  if (ZOOM_KEY_FACTORS.has(key)) {
    event.preventDefault();
    return zoomGraphByFactor(cy, ZOOM_KEY_FACTORS.get(key));
  }
  if (key === '0') {
    event.preventDefault();
    return fitGraphToNodes(cy, { duration: GRAPH_ZOOM.FIT_DURATION_MS });
  }
  if (ARROW_KEYS.has(key)) {
    event.preventDefault();
    return moveFocusByArrow(cy, key, options);
  }
  if (key === 'Enter' || key === ' ') {
    event.preventDefault();
    return activateKeyboardFocus(cy, options);
  }
  return false;
}
