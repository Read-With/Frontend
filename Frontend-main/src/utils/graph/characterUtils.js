import { sanitizeAssetUrl, resolveApiArtifactUrl } from '../common/urlUtils';
import { isGraphNodeElement } from './graphUtils';

const createEmptyCharacterMaps = () => ({
  idToName: {},
  idToDesc: {},
  idToDescKo: {},
  idToMain: {},
  idToNames: {},
  idToProfileImage: {},
});

/** 캐릭터 배열 → id 기반 lookup 맵 */
export function createCharacterMaps(characters) {
  try {
    const maps = createEmptyCharacterMaps();
    const { idToName, idToDesc, idToDescKo, idToMain, idToNames, idToProfileImage } = maps;

    if (!characters) {
      return maps;
    }

    const characterArray = characters?.characters || characters || [];
    if (!Array.isArray(characterArray)) {
      return maps;
    }

    let missingProfileImage = 0;
    characterArray.forEach((char) => {
      if (!char) return;
      const id = normalizeCharacterId(char.id);
      if (!id) return;

      idToName[id] =
        char.common_name ||
        char.name ||
        (Array.isArray(char.names) ? char.names[0] : id);
      idToDesc[id] = char.description || char.profileText || '';
      idToDescKo[id] = char.personalityText || '';
      idToMain[id] = !!char.isMainCharacter;
      idToNames[id] = char.names || [];

      if (char.profileImage) {
        const validatedUrl = validateAndNormalizeProfileImageUrl(char.profileImage);
        if (validatedUrl) {
          idToProfileImage[id] = validatedUrl;
        } else {
          console.warn(`[이미지 검증 실패] 캐릭터 ID: ${id}, 원본 profileImage:`, char.profileImage);
        }
      } else {
        missingProfileImage += 1;
      }
    });

    if (import.meta.env.DEV && missingProfileImage > 0) {
      console.debug(`[이미지 없음] 캐릭터 ${missingProfileImage}명 (프로필 이미지 미설정)`);
    }

    return maps;
  } catch (error) {
    console.error('createCharacterMaps 실패:', error);
    return createEmptyCharacterMaps();
  }
}

function validateAndNormalizeProfileImageUrl(profileImage) {
  if (!profileImage || typeof profileImage !== 'string') {
    return null;
  }

  const trimmed = sanitizeAssetUrl(profileImage.trim());
  if (trimmed === '') {
    return null;
  }

  if (trimmed.startsWith('http://') || trimmed.startsWith('https://')) {
    try {
      new URL(trimmed);
      return trimmed;
    } catch {
      console.warn(`[이미지 검증] 유효하지 않은 절대 URL: ${trimmed}`);
      return null;
    }
  }

  if (trimmed.startsWith('//')) {
    try {
      const resolved = new URL(trimmed, 'https://placeholder.local');
      return resolved.origin + resolved.pathname + resolved.search + resolved.hash;
    } catch {
      console.warn(`[이미지 검증] 유효하지 않은 프로토콜 상대 URL: ${trimmed}`);
      return null;
    }
  }

  if (trimmed.startsWith('/')) {
    return resolveApiArtifactUrl(trimmed) || trimmed;
  }

  console.warn(`[이미지 검증] 유효하지 않은 이미지 URL 형식: ${trimmed}`);
  return null;
}

function normalizeCharacterId(id) {
  if (id === undefined || id === null) return null;
  const numId = Number(id);
  if (!Number.isFinite(numId)) return null;
  return String(Math.trunc(numId));
}

export function extractCharacterId(character) {
  if (!character || typeof character !== 'object') return null;
  const candidate = character.id ?? null;
  return normalizeCharacterId(candidate);
}

export function isValidNodeWeight(weight) {
  return typeof weight === 'number' && Number.isFinite(weight) && weight > 0;
}

function isValidNodeCount(count) {
  return typeof count === 'number' && Number.isFinite(count) && count > 0;
}

export function isNodeWeightEntryVisible(entry) {
  return Boolean(entry && isValidNodeWeight(entry.weight) && isValidNodeCount(entry.count));
}

function resolveNodeWeightAndCount(char, previousEntry = null) {
  const rawWeight = typeof char?.weight === 'number' ? char.weight : null;
  const hasCountField = typeof char?.count === 'number';
  const rawCount = hasCountField ? char.count : null;

  const weight = isValidNodeWeight(rawWeight)
    ? rawWeight
    : (previousEntry && isValidNodeWeight(previousEntry.weight) ? previousEntry.weight : null);

  let count = null;
  if (hasCountField) {
    count = isValidNodeCount(rawCount) ? rawCount : null;
  } else if (previousEntry && isValidNodeCount(previousEntry.count)) {
    count = previousEntry.count;
  }

  return { weight, count };
}

function cloneNodeWeightsMap(nodeWeights) {
  if (!nodeWeights || typeof nodeWeights !== 'object') return {};
  return Object.fromEntries(
    Object.entries(nodeWeights)
      .filter(([, entry]) => isNodeWeightEntryVisible(entry))
      .map(([id, entry]) => [id, { weight: entry.weight, count: entry.count }])
  );
}

/** 캐릭터 병합 시 weight·count는 직전 값 유지 */
function mergeCharacterRecord(prev, char) {
  const filled = Object.fromEntries(
    Object.entries(char).filter(([, v]) => v !== undefined && v !== null && v !== '')
  );
  const merged = { ...prev, ...filled };
  const { weight, count } = resolveNodeWeightAndCount(merged, prev);

  if (isValidNodeWeight(weight)) {
    merged.weight = weight;
  } else {
    delete merged.weight;
  }

  if (isValidNodeCount(count)) {
    merged.count = count;
  } else if (typeof merged.count !== 'number') {
    delete merged.count;
  }

  return merged;
}

/** Cytoscape elements → nodeWeights 맵 */
export function extractNodeWeightsFromElements(elements) {
  const nodeWeights = {};
  if (!Array.isArray(elements)) return nodeWeights;

  elements.forEach((el) => {
    if (!isGraphNodeElement(el)) return;
    const data = el.data;
    const id = normalizeCharacterId(data.id);
    if (!id) return;
    const entry = { weight: data.weight, count: data.count };
    if (isNodeWeightEntryVisible(entry)) {
      nodeWeights[id] = entry;
    }
  });

  return nodeWeights;
}

/** 이벤트별 캐릭터 ID 병합 (빈 필드는 이전 값 유지) */
export function aggregateCharactersFromEvents(eventList) {
  const charactersMap = new Map();

  if (!Array.isArray(eventList)) return charactersMap;

  eventList.forEach((entry) => {
    if (!entry) return;

    const characters = Array.isArray(entry.characters) ? entry.characters : [];
    characters.forEach((char) => {
      if (!char) return;
      const id = normalizeCharacterId(char.id);
      if (!id) return;

      const prev = charactersMap.get(id);
      if (!prev) {
        charactersMap.set(id, { ...char });
        return;
      }
      charactersMap.set(id, mergeCharacterRecord(prev, char));
    });
  });

  return charactersMap;
}

/** weight·count → nodeWeights 맵 (직전 weight·count 상속, 없으면 노드 비표시) */
export function buildNodeWeights(characters, previousNodeWeights = null) {
  const nodeWeights = cloneNodeWeightsMap(previousNodeWeights);

  if (!Array.isArray(characters)) return nodeWeights;

  characters.forEach((char) => {
    if (!char) return;
    const id = normalizeCharacterId(char.id);
    if (!id) return;

    const previousEntry = nodeWeights[id] ?? null;
    const { weight, count } = resolveNodeWeightAndCount(char, previousEntry);

    if (isValidNodeWeight(weight) && isValidNodeCount(count)) {
      nodeWeights[id] = { weight, count };
    } else {
      delete nodeWeights[id];
    }
  });

  return nodeWeights;
}

/** 빈 nodeWeights 맵은 null로 통일 (convertRelationsToElements 인자용) */
export function toNodeWeightsOrNull(nodeWeights) {
  if (!nodeWeights || typeof nodeWeights !== 'object') return null;
  return Object.keys(nodeWeights).length > 0 ? nodeWeights : null;
}
