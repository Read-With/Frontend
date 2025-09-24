/**
 * 캐릭터 관련 유틸리티 함수들
 * 순환 의존성을 방지하기 위해 별도 파일로 분리
 */

/**
 * 캐릭터 데이터를 ID 기반 매핑 객체로 변환
 * @param {Object} characters - 캐릭터 데이터 객체 (characters 필드가 있거나, 곧바로 배열일 수 있음)
 * @returns {{idToName:Object, idToDesc:Object, idToMain:Object, idToNames:Object}}
 */
export function createCharacterMaps(characters) {
  try {
    const idToName = {};
    const idToDesc = {};
    const idToMain = {};
    const idToNames = {};

    if (!characters) {
      return { idToName, idToDesc, idToMain, idToNames };
    }

    const characterArray = characters?.characters || characters || [];
    if (!Array.isArray(characterArray)) {
      return { idToName, idToDesc, idToMain, idToNames };
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
      idToDesc[id] = char.description || "";
      idToMain[id] = char.main_character || false;
      idToNames[id] = char.names || [];
    });

    return { idToName, idToDesc, idToMain, idToNames };
  } catch (error) {
    console.error('createCharacterMaps 실패:', error);
    return { idToName: {}, idToDesc: {}, idToMain: {}, idToNames: {} };
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
