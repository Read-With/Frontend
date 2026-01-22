
/**
 * 캐릭터 데이터를 ID 기반 매핑 객체로 변환
 * @param {Object} characters - 캐릭터 데이터 객체 (characters 필드가 있거나, 곧바로 배열일 수 있음)
 * @returns {{idToName:Object, idToDesc:Object, idToDescKo:Object, idToMain:Object, idToNames:Object}}
 */
export function createCharacterMaps(characters) {
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

    characterArray.forEach((char) => {
      if (!char || char.id === undefined) {
        return;
      }
      
      const id = String(Math.trunc(char.id));
      idToName[id] =
        char.common_name ||
        char.name ||
        (Array.isArray(char.names) ? char.names[0] : String(char.id));
      idToDesc[id] = char.description || char.profile_text || "";
      idToDescKo[id] = char.description_ko || "";
      idToMain[id] = char.main_character || false;
      idToNames[id] = char.names || [];
      
      // profileImage 검증 및 정규화
      if (char.profileImage) {
        const validatedUrl = validateAndNormalizeProfileImageUrl(char.profileImage);
        if (validatedUrl) {
          idToProfileImage[id] = validatedUrl;
        } else {
          console.warn(`[이미지 검증 실패] 캐릭터 ID: ${id}, 원본 profileImage:`, char.profileImage);
        }
      } else {
        // profileImage가 없는 경우 디버깅 정보 출력 (개발 환경에서만)
        if (import.meta.env.DEV && char.id) {
          console.debug(`[이미지 없음] 캐릭터 ID: ${id}, 이름: ${idToName[id] || 'Unknown'}`);
        }
      }
    });

    return { idToName, idToDesc, idToDescKo, idToMain, idToNames, idToProfileImage };
  } catch (error) {
    console.error('createCharacterMaps 실패:', error);
    return { idToName: {}, idToDesc: {}, idToDescKo: {}, idToMain: {}, idToNames: {}, idToProfileImage: {} };
  }
}

/**
 * 캐릭터 이미지 경로를 동적으로 생성
 * @param {string} folderKey - 폴더 키
 * @param {string} characterId - 캐릭터 ID
 * @returns {string} 이미지 경로
 */
export function getCharacterImagePath(folderKey, characterId) {
  if (!folderKey || !characterId) {
    return '';
  }
  return `/${folderKey}/${characterId}.png`;
}

/**
 * API에서 받은 profileImage URL을 검증하고 정규화
 * @param {string} profileImage - 원본 profileImage URL
 * @returns {string|null} 검증된 이미지 URL, 유효하지 않으면 null
 */
export function validateAndNormalizeProfileImageUrl(profileImage) {
  if (!profileImage || typeof profileImage !== 'string') {
    return null;
  }
  
  const trimmed = profileImage.trim();
  if (trimmed === '') {
    return null;
  }
  
  // 절대 URL인 경우 (http://, https://)
  if (trimmed.startsWith('http://') || trimmed.startsWith('https://')) {
    try {
      new URL(trimmed);
      return trimmed;
    } catch {
      console.warn(`[이미지 검증] 유효하지 않은 절대 URL: ${trimmed}`);
      return null;
    }
  }
  
  // 상대 경로인 경우 API 베이스 URL과 결합
  if (trimmed.startsWith('/')) {
    const apiBaseUrl = getApiBaseUrl();
    const fullUrl = apiBaseUrl ? `${apiBaseUrl}${trimmed}` : trimmed;
    
    if (import.meta.env.DEV) {
      console.debug(`[이미지 URL 정규화] 상대 경로: ${trimmed} -> 개발 환경에서는 프록시 사용`);
    }
    
    return fullUrl;
  }
  
  // 그 외의 경우 (잘못된 형식)
  console.warn(`[이미지 검증] 유효하지 않은 이미지 URL 형식: ${trimmed}`);
  return null;
}

/**
 * 안전한 ID 변환 함수
 * @param {any} id - ID 값
 * @returns {string} 문자열로 변환된 ID
 */
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

/**
 * 캐릭터 ID 정규화 (숫자를 문자열로)
 * @param {any} id - 캐릭터 ID
 * @returns {string|null} 정규화된 ID 또는 null
 */
export function normalizeCharacterId(id) {
  if (id === undefined || id === null) return null;
  const numId = Number(id);
  if (!Number.isFinite(numId)) return null;
  return String(Math.trunc(numId));
}

/**
 * 캐릭터 객체에서 ID 추출
 * @param {object} character - 캐릭터 객체
 * @returns {string|null} 추출된 ID
 */
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
 * 캐릭터 배열을 Map으로 집계 (ID 중복 제거)
 * @param {Array} eventList - 이벤트 배열
 * @returns {Map<string, object>} 캐릭터 Map (ID -> 캐릭터 객체)
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
      if (id) {
        charactersMap.set(id, char);
      }
    });
  });
  
  return charactersMap;
}

/**
 * 캐릭터 배열로부터 노드 가중치 계산
 * @param {Array} characters - 캐릭터 배열
 * @returns {Object} 노드 가중치 맵 (ID -> {weight, count})
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
        count: count ?? 0
      };
    }
  });
  
  return nodeWeights;
}