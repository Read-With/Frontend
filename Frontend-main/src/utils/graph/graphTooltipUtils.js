/** 노드/간선 탭 시 툴팁 payload·핸들러 */

import { processTooltipData } from './graphUtils';

function resolveTooltipCoords(mouseX, mouseY, center) {
  return {
    x: mouseX ?? center?.x ?? 0,
    y: mouseY ?? center?.y ?? 0,
  };
}

function buildElementTooltipPayload(tapPayload, type) {
  const isNode = type === 'node';
  const element = isNode ? tapPayload.node : tapPayload.edge;
  const center = isNode ? tapPayload.nodeCenter : tapPayload.edgeCenter;
  const { x, y } = resolveTooltipCoords(tapPayload.mouseX, tapPayload.mouseY, center);
  const data = element.data();

  return {
    type,
    id: element.id(),
    x,
    y,
    data,
    ...(isNode
      ? { nodeCenter: center }
      : {
          sourceNode: element.source(),
          targetNode: element.target(),
          edgeCenter: center,
        }),
  };
}

export function buildTooltipPayload(tapPayload, type) {
  return buildElementTooltipPayload(tapPayload, type);
}

export function buildProcessedTooltip(tapPayload, type) {
  return processTooltipData(buildElementTooltipPayload(tapPayload, type), type);
}

export function createTooltipTapHandlers(onTap) {
  return {
    onShowNodeTooltip: (tapPayload) => onTap(tapPayload, 'node'),
    onShowEdgeTooltip: (tapPayload) => onTap(tapPayload, 'edge'),
  };
}
