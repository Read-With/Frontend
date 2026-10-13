/** Cytoscape 인스턴스·레이아웃 실행·elements 동기화·툴팁 payload */

import cytoscape from 'cytoscape';
import coseBilkent from 'cytoscape-cose-bilkent';
import { errorUtils } from '../common/valueUtils';
import { GRAPH_ZOOM, normalizeRelationArray, isGraphEdgeElement } from './graphCore';
import { buildElementsStructureFingerprint, visualElementSignature, visualSignatureImagePart } from './graphModel';
import {
  OVERLAP_RESOLVE,
  OVERLAP_PROFILES,
  readNodeRadius,
  detectAndResolveOverlap,
  calculateAnchorAwarePlacement,
} from './graphLayout';
import { syncReciprocalPairJunctionOffsets } from './graphHighlight';
import { ensureElementsInBounds, isGraphContainerSizeReady } from './graphViewport';

let coseBilkentRegistered = false;

function ensureCoseBilkentRegistered() {
  if (coseBilkentRegistered) return;
  cytoscape.use(coseBilkent);
  coseBilkentRegistered = true;
}

/** cy 파괴·컨테이너 detach 중 호출해도 throw 하지 않음 */
export function safeCyCall(cy, operation, context = 'cy') {
  if (!cy || cy.destroyed?.()) return null;
  try {
    return operation();
  } catch (error) {
    errorUtils.logDebug(context, 'cy operation failed', {
      message: error?.message,
    });
    return null;
  }
}

/** element 정의 배열의 data를 기존 cy 노드/엣지에 동기화 */
export function syncCyElementData(cy, defs) {
  if (!cy || !defs?.length) return;
  for (const def of defs) {
    const rawId = def?.data?.id;
    if (rawId == null || rawId === '') continue;
    const el = cy.getElementById(String(rawId));
    if (!el || el.length === 0) continue;
    try {
      el.data(def.data);
    } catch {
      /* ignore */
    }
  }
}

/** props 정의에서 id Set */
export function elementDefIdSet(defs) {
  return new Set(
    (defs || [])
      .map((d) => (d?.data?.id != null ? String(d.data.id) : ''))
      .filter(Boolean),
  );
}

/**
 * 다음 그래프에도 남는 기존 노드의 위치·반지름·weight (증분 배치 시드)
 * @param {Set<string>} prevNodeIds
 * @param {Set<string>} nextNodeIds
 */
export function collectContinuingNodeLayoutSeed(cy, prevNodeIds, nextNodeIds) {
  const placedPositions = [];
  const placedWeights = [];
  if (!cy || !prevNodeIds?.size) return { placedPositions, placedWeights };
  prevNodeIds.forEach((id) => {
    if (!nextNodeIds.has(id)) return;
    const n = cy.getElementById(id);
    if (!n || n.length === 0) return;
    try {
      const pos = n.position();
      placedPositions.push({
        id,
        x: pos.x,
        y: pos.y,
        radius: readNodeRadius(n, OVERLAP_RESOLVE.FALLBACK_NODE_SIZE),
        label: n.data('label') || '',
      });
      const w = n.data('weight');
      if (w != null) placedWeights.push(w);
    } catch {
      /* ignore */
    }
  });
  return { placedPositions, placedWeights };
}

/** id 목록을 안정적인 비교 키로 */
export function stableIdListKey(ids) {
  if (!ids?.length) return '';
  return [...ids].map(String).filter(Boolean).sort().join('\x1f');
}

export const PRESET_LAYOUT = Object.freeze({
  name: 'preset',
  fit: false,
  animate: false,
});

/** 최초 로딩·전체 재배치용. animate:false로 동기 완료
 *  노드 반지름이 최대 40px(graphStyles NODE_SIZE_MAX/2)까지 나오므로, 인접 노드가 맞닿아 보이지 않도록
 *  idealEdgeLength·nodeRepulsion·tilingPadding을 노드 크기 대비 여유 있게 잡는다. */
const COSE_BILKENT_LAYOUT = Object.freeze({
  name: 'cose-bilkent',
  fit: false,
  animate: false,
  randomize: false,
  nodeDimensionsIncludeLabels: true,
  nodeRepulsion: 5500,
  idealEdgeLength: 130,
  edgeElasticity: 0.45,
  nestingFactor: 0.1,
  gravity: 0.25,
  numIter: 2500,
  tile: true,
  tilingPaddingVertical: 32,
  tilingPaddingHorizontal: 32,
});

/** 노드가 몇 개뿐인 그래프에 COSE_BILKENT_LAYOUT 기본값(넓은 그래프 기준)을 그대로 쓰면
 *  서로 당겨줄 간선·중력이 약해 과도하게 퍼진다. 노드 수가 적을수록 간선 길이·반발력을
 *  줄이고 중력을 높여 촘촘하게 모은다. */
const LAYOUT_DENSITY_RANGE = {
  MIN_NODES: 3,
  MAX_NODES: 20,
  SPARSE: { idealEdgeLength: 70, nodeRepulsion: 2200, gravity: 0.5 },
};

function lerp(a, b, t) {
  return a + (b - a) * t;
}

/** 노드 수에 맞춰 idealEdgeLength·nodeRepulsion·gravity를 보간한 cose-bilkent 레이아웃 옵션 */
function resolveCoseBilkentLayout(nodeCount) {
  const { MIN_NODES, MAX_NODES, SPARSE } = LAYOUT_DENSITY_RANGE;
  const count = Number(nodeCount);

  if (!Number.isFinite(count) || count <= MIN_NODES) {
    return { ...COSE_BILKENT_LAYOUT, ...SPARSE };
  }
  if (count >= MAX_NODES) {
    return { ...COSE_BILKENT_LAYOUT };
  }

  const t = (count - MIN_NODES) / (MAX_NODES - MIN_NODES);
  return {
    ...COSE_BILKENT_LAYOUT,
    idealEdgeLength: lerp(SPARSE.idealEdgeLength, COSE_BILKENT_LAYOUT.idealEdgeLength, t),
    nodeRepulsion: lerp(SPARSE.nodeRepulsion, COSE_BILKENT_LAYOUT.nodeRepulsion, t),
    gravity: lerp(SPARSE.gravity, COSE_BILKENT_LAYOUT.gravity, t),
  };
}

/** preset 레이아웃 (eles 지정 시 해당 컬렉션만) */
export function runPresetLayout(cy, eles) {
  if (!cy) return;
  if (eles?.length > 0) {
    try {
      cy.layout({ ...PRESET_LAYOUT, eles }).run();
      return;
    } catch {
      /* fall through */
    }
  }
  try {
    cy.layout({ ...PRESET_LAYOUT }).run();
  } catch {
    /* ignore */
  }
}

/** 최초/전체 재배치용 cose-bilkent (실패 시 preset). 노드 수가 적으면 간격을 촘촘하게 스케일. */
export function runCoseBilkentLayout(cy) {
  if (!cy) return;
  ensureCoseBilkentRegistered();
  try {
    cy.layout(resolveCoseBilkentLayout(cy.nodes().length)).run();
  } catch {
    runPresetLayout(cy);
  }
}

const parseJsonSafely = (value) => {
  if (typeof value !== 'string') {
    return value;
  }
  try {
    return JSON.parse(value);
  } catch {
    return value;
  }
};

function tooltipEndpointInfo(cyNode) {
  if (!cyNode || typeof cyNode.data !== 'function') {
    return { id: null, label: '', image: '' };
  }
  const d = cyNode.data() || {};
  return {
    id: d.id ?? (typeof cyNode.id === 'function' ? cyNode.id() : null),
    label: d.common_name || d.name || d.label || '',
    image: d.image || '',
  };
}

function buildNodeTooltip(base, center) {
  const fields = base.data ?? {};
  return {
    ...base,
    ...fields,
    nodeCenter: center,
    names: parseJsonSafely(fields.names),
    isMainCharacter: !!fields.isMainCharacter,
    common_name: fields.common_name || fields.name || fields.label,
    description: fields.description || '',
    personalityText: fields.personalityText || '',
    image: fields.image || '',
    weight: fields.weight || 1,
  };
}

/** labelHistory는 객체({라벨: 메타})만 허용 */
function parseLabelHistory(value) {
  const parsed = parseJsonSafely(value);
  return parsed && typeof parsed === 'object' && !Array.isArray(parsed) ? parsed : {};
}

function buildEdgeTooltip(base, element, center) {
  const data = base.data ?? {};
  const relation = normalizeRelationArray(parseJsonSafely(data.relation));
  return {
    ...base,
    sourceEndpoint: tooltipEndpointInfo(element.source()),
    targetEndpoint: tooltipEndpointInfo(element.target()),
    edgeCenter: center,
    data: {
      ...base.data,
      relation,
      latestLabels: normalizeRelationArray(parseJsonSafely(data.latestLabels)),
      labelHistory: parseLabelHistory(data.labelHistory),
      label: data.label || relation[relation.length - 1] || '',
      // positivity는 서버/그래프 값만 유지 — 없으면 null (0과 '없음' 구분)
      positivity: data.positivity == null || data.positivity === '' ? null : data.positivity,
      count: data.count ?? 1,
    },
  };
}

/** 탭 이벤트 → 툴팁용 payload */
export function openTooltipFromTap(tapPayload, type) {
  if (!tapPayload) return null;
  const isNode = type === 'node';
  const element = isNode ? tapPayload.node : tapPayload.edge;
  if (!element) return null;

  try {
    const center = isNode ? tapPayload.nodeCenter : tapPayload.edgeCenter;
    const base = {
      type,
      id: element.id(),
      x: tapPayload.mouseX ?? center?.x ?? 0,
      y: tapPayload.mouseY ?? center?.y ?? 0,
      data: element.data(),
    };
    return isNode ? buildNodeTooltip(base, center) : buildEdgeTooltip(base, element, center);
  } catch {
    return tapPayload;
  }
}

export const isSidebarElement = (event) => {
  const target = event?.target;
  if (!target || typeof target.closest !== 'function') return false;
  return Boolean(
    target.closest('[data-testid="graph-sidebar"]') ||
    target.closest('[data-testid="chapter-sidebar"]') ||
    target.closest('.graph-sidebar')
  );
};

/** 드래그 노드 좌표는 고정, 겹친 주변만 밀어냄 (앵커 배치 로직 미적용) */
export function resolveUserDragCollisions(cyInstance, container, draggedNode, { clampBounds = false } = {}) {
  if (!draggedNode || draggedNode.length === 0) return;
  if (clampBounds && isGraphContainerSizeReady(container)) {
    ensureElementsInBounds(cyInstance, container, { nodes: draggedNode });
  }
  const profile = OVERLAP_PROFILES.USER_DRAG;
  const draggedPos = draggedNode.position();
  const draggedRadius = readNodeRadius(draggedNode, OVERLAP_RESOLVE.FALLBACK_NODE_SIZE);
  const proximity = Math.max(0, (profile.padding ?? 0) - (profile.tolerance ?? 0));
  const movableIds = [];
  cyInstance.nodes(':visible').forEach((node) => {
    if (node.id() === draggedNode.id()) return;
    const pos = node.position();
    const radius = readNodeRadius(node, OVERLAP_RESOLVE.FALLBACK_NODE_SIZE);
    const activationDistance = draggedRadius + radius + proximity;
    if (Math.hypot(pos.x - draggedPos.x, pos.y - draggedPos.y) < activationDistance) {
      movableIds.push(node.id());
    }
  });
  if (movableIds.length === 0) return;
  detectAndResolveOverlap(cyInstance, OVERLAP_RESOLVE.FALLBACK_NODE_SIZE, {
    ...profile,
    movableIds,
  });
  syncReciprocalPairJunctionOffsets(cyInstance, { immediate: true });
}

/** 기존 인스턴스가 살아 있으면 재마운트, 아니면 생성. 실패 시 null */
export function mountCytoscape(container, externalCyRef, initialStylesheet) {
  try {
    const existing = externalCyRef?.current;
    const isLive =
      existing &&
      typeof existing.container === "function" &&
      !existing.destroyed?.();
    if (isLive) {
      if (existing.container() !== container) existing.mount(container);
      return { cyInstance: existing, didCreateInstance: false };
    }
    const cyInstance = cytoscape({
      container,
      elements: [],
      style: initialStylesheet,
      layout: PRESET_LAYOUT,
      pixelRatio: 'auto',
      userZoomingEnabled: true,
      userPanningEnabled: true,
      wheelSensitivity: GRAPH_ZOOM.WHEEL_SENSITIVITY,
      minZoom: GRAPH_ZOOM.MIN,
      maxZoom: GRAPH_ZOOM.MAX,
      autoungrabify: false,
      autolock: false,
      autounselectify: false,
      selectionType: "single",
      touchTapThreshold: 8,
      desktopTapThreshold: 4,
    });
    if (externalCyRef) externalCyRef.current = cyInstance;
    return { cyInstance, didCreateInstance: true };
  } catch (err) {
    errorUtils.logDebug('graphCy', 'cy init failed', {
      message: err?.message,
    });
    return null;
  }
}

/**
 * 시각 시그니처 diff. 신규 요소는 제외하고,
 * 골격(structure)이 이전과 같고 추가가 없으면 이미지 변경만 남긴다 (라벨 등 변경은 펄스 생략).
 */
function diffVisualSignatures(elements, prevSig, newIdSet, { sameStructureNoAdds }) {
  const nextSig = new Map();
  const changed = [];
  for (const el of elements) {
    const rawId = el?.data?.id;
    if (rawId == null || rawId === "") continue;
    const sid = String(rawId);
    const sig = visualElementSignature(el);
    nextSig.set(sid, sig);
    if (prevSig.size > 0 && prevSig.has(sid) && prevSig.get(sid) !== sig && !newIdSet.has(sid)) {
      changed.push(sid);
    }
  }
  const dataChangedIds = sameStructureNoAdds
    ? changed.filter(
        (sid) => visualSignatureImagePart(prevSig.get(sid)) !== visualSignatureImagePart(nextSig.get(sid)),
      )
    : changed;
  return { nextSig, dataChangedIds };
}

/**
 * props elements를 cy에 반영 (cy.batch 안에서 호출).
 * 사라진 요소 제거 → 유지 요소 data 동기화(좌표 보존) → 신규 노드 앵커 배치 후 추가.
 * @returns {{ update: object, nextSig: Map, structureFp: string }} update는 useGraphLayout이 소비
 */
export function syncElementsIntoCy(cy, elements, { prevSig, prevStructureFp, containerWidth, containerHeight }) {
  const nodes = elements.filter((el) => el?.data && !isGraphEdgeElement(el));
  const edges = elements.filter(isGraphEdgeElement);
  const prevNodeIds = new Set(cy.nodes().map((n) => String(n.id())));
  const prevEdgeIds = new Set(cy.edges().map((e) => String(e.id())));
  const hadExistingGraph = prevNodeIds.size > 0;
  const nextNodeIds = elementDefIdSet(nodes);
  const nextEdgeIds = elementDefIdSet(edges);

  // 이미 그려진 id가 다음 props에도 모두 있으면 "순증가"만 → 제거 루프 생략(전체 깜빡임·불필요한 재구성 방지)
  const pureAdditive =
    prevNodeIds.size > 0 &&
    [...prevNodeIds].every((id) => nextNodeIds.has(id)) &&
    [...prevEdgeIds].every((id) => nextEdgeIds.has(id));

  if (!pureAdditive) {
    cy.nodes().forEach((n) => {
      if (!nextNodeIds.has(String(n.id()))) n.remove();
    });
    cy.edges().forEach((e) => {
      if (!nextEdgeIds.has(String(e.id()))) e.remove();
    });
  }

  // 유지되는 요소는 data만 동기화. 좌표는 Cytoscape에 유지(이벤트 전환 시 기존 배치 보존)
  syncCyElementData(cy, nodes);
  syncCyElementData(cy, edges);

  const { placedPositions, placedWeights } = collectContinuingNodeLayoutSeed(
    cy,
    prevNodeIds,
    nextNodeIds,
  );
  const nodesToAdd = nodes.filter(
    (node) => node?.data?.id != null && !prevNodeIds.has(String(node.data.id))
  );
  const edgesToAdd = edges.filter(
    (edge) => edge?.data?.id != null && !prevEdgeIds.has(String(edge.data.id))
  );

  let needsLocalReorder = false;
  // 유지되는 기존 노드가 있을 때만 증분 앵커 배치. 전부 교체면 cose 시드 유지
  const canIncrementalPlace = hadExistingGraph && placedPositions.length > 0;
  if (nodesToAdd.length > 0) {
    if (canIncrementalPlace) {
      const placed = calculateAnchorAwarePlacement(
        nodesToAdd,
        placedPositions,
        edges,
        containerWidth,
        containerHeight,
        {
          padding: OVERLAP_RESOLVE.PADDING,
          weightsForRange: placedWeights,
        },
      );
      needsLocalReorder = Boolean(placed?.needsLocalReorder);
    }
    cy.add(nodesToAdd);
  }
  if (edgesToAdd.length > 0) {
    cy.add(edgesToAdd);
  }

  const newIdSet = new Set(
    [...nodesToAdd.map((n) => n?.data?.id), ...edgesToAdd.map((e) => e?.data?.id)]
      .filter((id) => id != null && id !== "")
      .map((id) => String(id)),
  );
  const structureFp = buildElementsStructureFingerprint(elements);
  const hasAdds = nodesToAdd.length > 0 || edgesToAdd.length > 0;
  const { nextSig, dataChangedIds } = diffVisualSignatures(elements, prevSig, newIdSet, {
    sameStructureNoAdds: Boolean(structureFp) && structureFp === prevStructureFp && !hasAdds,
  });

  return {
    update: {
      nodesToAdd,
      edgesToAdd,
      hasChanges: hasAdds,
      dataChangedIds,
      incrementalLayoutScope: canIncrementalPlace && nodesToAdd.length > 0,
      needsLocalReorder,
    },
    nextSig,
    structureFp: structureFp || "",
  };
}
