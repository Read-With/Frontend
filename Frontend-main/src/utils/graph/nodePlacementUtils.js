/**
 * nodePlacementUtils.js : 노드 배치 관련 유틸리티 함수 모음
 * 
 * [주요 기능]
 * 1. 스파이럴 패턴 노드 배치: 새로운 노드를 스파이럴 패턴으로 배치
 * 2. 위치 충돌 감지: 기존 노드와의 거리를 확인하여 충돌 방지
 * 
 * [사용처]
 * - CytoscapeGraphUnified: 새로운 노드 추가 시 위치 계산
 */

const NODE_SIZE = 40;
const MIN_DISTANCE = NODE_SIZE * 3.2;
const CONTAINER_PADDING = 80;
const INITIAL_RADIUS = 50;
const RADIUS_INCREMENT = 2;
const MAX_ATTEMPTS = 200;
const ANGLE_INCREMENT = 0.5;
const FALLBACK_RANGE = 100;

/**
 * 스파이럴 패턴으로 노드 위치 계산
 * @param {Array} newNodes - 배치할 새 노드 배열
 * @param {Array} placedPositions - 이미 배치된 노드들의 위치 배열
 * @param {number} containerWidth - 컨테이너 너비
 * @param {number} containerHeight - 컨테이너 높이
 * @returns {Array} 위치가 할당된 노드 배열
 */
export function calculateSpiralPlacement(newNodes, placedPositions, containerWidth, containerHeight) {
  if (!newNodes || newNodes.length === 0) {
    return newNodes;
  }

  const maxRadius = Math.min(containerWidth, containerHeight) / 2 - CONTAINER_PADDING;
  const updatedPositions = [...placedPositions];

  newNodes.forEach(node => {
    let found = false;
    let x, y;
    let attempts = 0;

    while (!found && attempts < MAX_ATTEMPTS) {
      const angle = (attempts * ANGLE_INCREMENT) % (2 * Math.PI);
      const radius = Math.min(INITIAL_RADIUS + attempts * RADIUS_INCREMENT, maxRadius);

      x = Math.cos(angle) * radius;
      y = Math.sin(angle) * radius;

      const isWithinBounds = 
        Math.abs(x) < containerWidth / 2 - CONTAINER_PADDING &&
        Math.abs(y) < containerHeight / 2 - CONTAINER_PADDING;

      if (isWithinBounds) {
        found = updatedPositions.every(pos => {
          const dx = x - pos.x;
          const dy = y - pos.y;
          return Math.sqrt(dx * dx + dy * dy) > MIN_DISTANCE;
        });
      }

      attempts++;
    }

    if (!found) {
      x = (Math.random() - 0.5) * FALLBACK_RANGE;
      y = (Math.random() - 0.5) * FALLBACK_RANGE;
    }

    node.position = { x, y };
    updatedPositions.push({ x, y });
  });

  return newNodes;
}

/**
 * 컨테이너 크기 정보 계산
 * @param {HTMLElement|null} container - 컨테이너 DOM 요소
 * @returns {Object} { width, height, maxRadius }
 */
export function getContainerDimensions(container) {
  const width = container?.clientWidth || 800;
  const height = container?.clientHeight || 600;
  const maxRadius = Math.min(width, height) / 2 - CONTAINER_PADDING;

  return { width, height, maxRadius };
}
