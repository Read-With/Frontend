import { getApiBaseUrl } from '../common/authUtils';

/**
 * 캐릭터 데이터를 ID 기반 매핑 객체로 변환
 * @param {Object} characters - characters 필드가 있거나 배열 직접 전달
 * @returns {{idToName:Object, idToDesc:Object, idToDescKo:Object, idToMain:Object, idToNames:Object, idToProfileImage:Object}}
 */
export function createCharacterMaps(characters) {
  const empty = () => ({
    idToName: {},
    idToDesc: {},
    idToDescKo: {},
    idToMain: {},
    idToNames: {},
    idToProfileImage: {},
  });
  try {
    const idToName = {};
    const idToDesc = {};
    const idToDescKo = {};
    const idToMain = {};
    const idToNames = {};
    const idToProfileImage = {};

    if (!characters) {
      return { idToName, idToDesc, idToDescKo, idToMain, idToNames, idToProfileImage };
    }

    const characterArray = characters?.characters || characters || [];
    if (!Array.isArray(characterArray)) {
      return { idToName, idToDesc, idToDescKo, idToMain, idToNames, idToProfileImage };
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
      idToDesc[id] = char.description || char.profile_text || '';
      idToDescKo[id] = char.description_ko || '';
      idToMain[id] = char.main_character || false;
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

    return { idToName, idToDesc, idToDescKo, idToMain, idToNames, idToProfileImage };
  } catch (error) {
    console.error('createCharacterMaps 실패:', error);
    return empty();
  }
}

export function getCharacterImagePath(folderKey, characterId) {
  if (!folderKey || !characterId) {
    return '';
  }
  return `/${folderKey}/${characterId}.png`;
}

/**
 * @param {string} profileImage
 * @returns {string|null}
 */
export function validateAndNormalizeProfileImageUrl(profileImage) {
  if (!profileImage || typeof profileImage !== 'string') {
    return null;
  }

  const trimmed = profileImage.trim();
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
    const apiBaseUrl = getApiBaseUrl();
    return apiBaseUrl ? `${apiBaseUrl.replace(/\/$/, '')}${trimmed}` : trimmed;
  }

  console.warn(`[이미지 검증] 유효하지 않은 이미지 URL 형식: ${trimmed}`);
  return null;
}

export function safeId(id) {
  try {
    if (id === null || id === undefined) {
      return '0';
    }

    const parsed = parseInt(id, 10);
    if (isNaN(parsed)) {
      console.warn(`safeId: 유효하지 않은 ID 값 (${id}), 0으로 대체`);
      return '0';
    }

    return String(parsed);
  } catch (error) {
    console.error(`safeId 변환 실패 (${id}):`, error);
    return '0';
  }
}

export function normalizeCharacterId(id) {
  if (id === undefined || id === null) return null;
  const numId = Number(id);
  if (!Number.isFinite(numId)) return null;
  return String(Math.trunc(numId));
}

export function extractCharacterId(character) {
  if (!character || typeof character !== 'object') return null;
  const candidate =
    character.id ??
    character.characterId ??
    character.character_id ??
    character.char_id ??
    character.pk ??
    character.node_id ??
    null;
  return normalizeCharacterId(candidate);
}

/**
 * 이벤트별 캐릭터를 ID 기준으로 병합 (빈 필드는 이전 값 유지)
 */
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
      const filled = Object.fromEntries(
        Object.entries(char).filter(([, v]) => v !== undefined && v !== null && v !== '')
      );
      charactersMap.set(id, { ...prev, ...filled });
    });
  });

  return charactersMap;
}

/**
 * weight 또는 count가 숫자인 항목만 포함. 동일 ID는 배열 순서상 마지막 항목으로 덮어씀.
 */
export function buildNodeWeights(characters) {
  const nodeWeights = {};

  if (!Array.isArray(characters)) return nodeWeights;

  characters.forEach((char) => {
    if (!char) return;
    const id = normalizeCharacterId(char.id);
    if (!id) return;

    const weight = typeof char.weight === 'number' ? char.weight : null;
    const count = typeof char.count === 'number' ? char.count : null;

    if (weight !== null || count !== null) {
      nodeWeights[id] = {
        weight: weight ?? 3,
        count: count ?? 0,
      };
    }
  });

  return nodeWeights;
}
