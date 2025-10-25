// 통합된 데이터 모듈 로딩
const dataModules = {
  relationships: import.meta.glob(
    "../data/*/chapter*_relationships_event_*.json",
    { eager: true }
  ),
  characters: import.meta.glob(
    "../data/*/chapter*_characters_0.json",
    { eager: true }
  ),
  events: import.meta.glob(
    "../data/*/chapter*_events.json",
    { eager: true }
  ),
  perspectiveSummaries: import.meta.glob(
    "../data/*/chapter*_perspective_summaries_Ko.json",
    { eager: true }
  )
};

// characterUtils.js에서 함수 import
import { createCharacterMaps, safeId } from './characterUtils';

const relationshipIndex = new Map();
const chapterMaxEventIndex = new Map();
const charactersIndex = new Map();
const folderChapters = new Map();
const characterIdIndex = new Map(); // 캐릭터 ID별 전체 챕터 정보 인덱스 (빠른 검색용)

// 성능 최적화를 위한 캐시
const eventsCache = new Map(); // getEventsForChapter 결과 캐시
const characterMapsCache = new Map(); // createCharacterMaps 결과 캐시

// 캐시 크기 제한
const MAX_CACHE_SIZE = 100;
const MAX_CHARACTER_CACHE_SIZE = 50;

// 캐시 정리 함수
function cleanupCache(cache, maxSize) {
  if (cache.size > maxSize) {
    const entries = Array.from(cache.entries());
    const toDelete = entries.slice(0, cache.size - maxSize);
    toDelete.forEach(([key]) => cache.delete(key));
  }
}

function extractFolderKey(path) {
  const m = path.match(/^\.\.\/data\/([^/]+)\//);
  return m ? m[1] : "";
}

export function getFolderKeyFromFilename(filename) {
  try {
    const availableFolders = Array.from(folderChapters.keys());
    
    if (availableFolders.length === 0) {
      console.error('getFolderKeyFromFilename: 사용 가능한 폴더가 없습니다. data 폴더를 확인해주세요.');
      return null;
    }
    
    if (!filename || typeof filename !== 'string') {
      return availableFolders[0];
    }
    
    const nameWithoutExt = filename.replace(/\.(epub|json)$/i, "");
    
    // 정확한 매치 확인
    if (availableFolders.includes(nameWithoutExt)) {
      return nameWithoutExt;
    }
    
    // 부분 매치 확인
    const partialMatch = availableFolders.find(folder => 
      nameWithoutExt.toLowerCase().includes(folder.toLowerCase()) ||
      folder.toLowerCase().includes(nameWithoutExt.toLowerCase())
    );
    
    if (partialMatch) {
      return partialMatch;
    }
    
    return availableFolders[0];
  } catch (error) {
    console.error('getFolderKeyFromFilename 실패:', error, { filename, availableFolders: Array.from(folderChapters.keys()) });
    return null;
  }
}


// 관계 파일 인덱싱
for (const path of Object.keys(dataModules.relationships)) {
  const match = path.match(/\/chapter(\d+)_relationships_event_(\d+)\.json$/);
  if (!match) continue;

  const folderKey = extractFolderKey(path);
  const chapter = Number(match[1]);
  const eventIndex = Number(match[2]); // 파일명은 1-based 인덱스

  const relJson = dataModules.relationships[path]?.default;
  relationshipIndex.set(`${folderKey}:${chapter}:${eventIndex}`, relJson);

  const key = `${folderKey}:${chapter}`;
  const currentMax = chapterMaxEventIndex.get(key) || 0;
  if (eventIndex > currentMax) chapterMaxEventIndex.set(key, eventIndex);

  if (!folderChapters.has(folderKey)) folderChapters.set(folderKey, new Set());
  folderChapters.get(folderKey).add(chapter);
}

// 캐릭터 파일 인덱싱
for (const path of Object.keys(dataModules.characters)) {
  const match = path.match(/\/chapter(\d+)_characters_0\.json$/);
  if (!match) continue;

  const folderKey = extractFolderKey(path);
  const chapter = Number(match[1]);
  const charJson = dataModules.characters[path]?.default;

  charactersIndex.set(`${folderKey}:${chapter}`, charJson);

  // 캐릭터 ID 인덱스 구축 (빠른 검색을 위해)
  if (charJson && charJson.characters && Array.isArray(charJson.characters)) {
    charJson.characters.forEach(char => {
      if (char && char.id !== undefined) {
        const charId = String(char.id);
        const indexKey = `${folderKey}:${charId}`;
        
        if (!characterIdIndex.has(indexKey)) {
          characterIdIndex.set(indexKey, []);
        }
        characterIdIndex.get(indexKey).push({
          chapter,
          character: char
        });
      }
    });
  }

  if (!folderChapters.has(folderKey)) folderChapters.set(folderKey, new Set());
  folderChapters.get(folderKey).add(chapter);
}
// 최대 챕터 번호 반환
export function getDetectedMaxChapter(folderKey) {
  const set = folderChapters.get(folderKey);
  if (!set || set.size === 0) return 0;
  return Math.max(...Array.from(set));
}

/**
 * 안전한 최대 챕터 번호 반환 (fallback 포함)
 * @param {string} folderKey - 폴더 키
 * @param {number} fallback - fallback 값 (기본값: 1)
 * @returns {number} 최대 챕터 번호
 */
export function getSafeMaxChapter(folderKey, fallback = 1) {
  const detected = getDetectedMaxChapter(folderKey);
  return detected > 0 ? detected : fallback;
}

/**
 * 전체 폴더 목록을 반환 (../data/* 의 폴더들)
 * @returns {string[]} folderKey 리스트
 */
export function getAllFolderKeys() {
  return Array.from(folderChapters.keys());
}

/**
 * 특정 폴더/챕터의 캐릭터 JSON 반환
 * @param {string} folderKey - 데이터 하위 폴더명
 * @param {number} chapter - 챕터 번호
 * @returns {Object|null}
 */
export function getCharactersData(folderKey, chapter) {
  if (!folderKey || !chapter || chapter < 1) {
    return null;
  }
  return charactersIndex.get(`${folderKey}:${chapter}`) ?? null;
}

/**
 * 1-based eventIndex로 이벤트 JSON 반환
 * @param {string} folderKey
 * @param {number} chapter
 * @param {number} eventIndex - 1-based
 * @returns {Object|null}
 */
export function getEventDataByIndex(folderKey, chapter, eventIndex) {
  if (!folderKey || !chapter || chapter < 1 || !eventIndex || eventIndex < 1) {
    return null;
  }
  return relationshipIndex.get(`${folderKey}:${chapter}:${eventIndex}`) ?? null;
}

/**
 * UI/state에서 사용하는 0-based eventId를 1-based로 변환해 이벤트 JSON 반환
 * @param {string} folderKey
 * @param {number} chapter
 * @param {number} eventIdZeroBased - 0-based
 * @returns {Object|null}
 */
export function getEventData(folderKey, chapter, eventIdZeroBased) {
  if (eventIdZeroBased === undefined || eventIdZeroBased === null || eventIdZeroBased < 0) {
    return null;
  }
  const eventIndex = Number(eventIdZeroBased) + 1;
  return getEventDataByIndex(folderKey, chapter, eventIndex);
}

/**
 * 특정 폴더/챕터에서 마지막 이벤트 인덱스 반환 (없으면 0)
 * @param {string} folderKey
 * @param {number} chapter
 * @returns {number}
 */
export function getLastEventIndexForChapter(folderKey, chapter) {
  return chapterMaxEventIndex.get(`${folderKey}:${chapter}`) || 0;
}

/**
 * 특정 폴더에서 1..maxChapter 범위의 마지막 이벤트 인덱스 배열 반환
 * @param {string} folderKey
 * @returns {number[]} [chapter1_last, chapter2_last, ...]
 */
export function getChapterLastEventNums(folderKey) {
  const maxChapter = getDetectedMaxChapter(folderKey);
  const lastNums = [];
  for (let chapter = 1; chapter <= maxChapter; chapter++) {
    lastNums.push(getLastEventIndexForChapter(folderKey, chapter));
  }
  return lastNums;
}

/**
 * 특정 폴더에서 전체 챕터 중 가장 큰 이벤트 개수 반환
 * @param {string} folderKey
 * @returns {number}
 */
export function getMaxEventCount(folderKey) {
  const lastEventNums = getChapterLastEventNums(folderKey);
  // 챕터가 없을 때 최소 1을 반환하던 기존 정책 유지
  return Math.max(...(lastEventNums.length ? lastEventNums : [1]));
}

/**
 * 이벤트 파일(raw JSON)에서 relations 배열을 정규화 없이 그대로 추출
 * @param {string} folderKey
 * @param {number} chapter
 * @param {number} eventIndex - 1-based
 * @returns {Array}
 */
export function getEventRelations(folderKey, chapter, eventIndex) {
  const json = getEventDataByIndex(folderKey, chapter, eventIndex);
  if (!json) {
    return [];
  }
  return Array.isArray(json.relations) ? json.relations : [];
}

/**
 * 캐릭터 매핑 생성 (캐시 포함)
 * @param {Object} characters - 캐릭터 데이터 객체
 * @returns {{idToName:Object, idToDesc:Object, idToMain:Object, idToNames:Object}}
 */
export function createCharacterMapsWithCache(characters) {
  try {
    // 캐시 확인 (문자열화된 캐릭터 데이터를 키로 사용)
    const cacheKey = JSON.stringify(characters);
    if (characterMapsCache.has(cacheKey)) {
      return characterMapsCache.get(cacheKey);
    }

    const result = createCharacterMaps(characters);
    characterMapsCache.set(cacheKey, result);
    
    // 캐시 크기 제한
    cleanupCache(characterMapsCache, MAX_CHARACTER_CACHE_SIZE);
    
    return result;
  } catch (error) {
    console.error('createCharacterMapsWithCache 실패:', error);
    return { idToName: {}, idToDesc: {}, idToMain: {}, idToNames: {} };
  }
}

/**
 * 챕터별 이벤트 데이터 가져오기 (ViewerPage 전용)
 * @param {number} chapter - 챕터 번호
 * @param {string} folderKey - 폴더 키 (사용자가 선택한 파일명)
 * @returns {Array} 이벤트 배열
 */
export function getEventsForChapter(chapter, folderKey) {
  try {
    if (!chapter || chapter < 1) {
      return [];
    }
    
    if (!folderKey || typeof folderKey !== 'string') {
      return [];
    }
    
    // 사용 가능한 폴더 키가 없으면 첫 번째 폴더 사용
    if (!getAllFolderKeys().includes(folderKey)) {
      const availableFolders = getAllFolderKeys();
      if (availableFolders.length === 0) {
        console.error('getEventsForChapter: 사용 가능한 폴더가 없습니다');
        return [];
      }
      folderKey = availableFolders[0];
    }

    // 캐시 확인
    const cacheKey = `${folderKey}:${chapter}`;
    if (eventsCache.has(cacheKey)) {
      return eventsCache.get(cacheKey);
    }

    const num = String(chapter);

    // 1. 이벤트 본문 데이터 추출
    const textFilePath = Object.keys(dataModules.events).find((path) =>
      path.includes(`/${folderKey}/chapter${num}_events.json`)
    );
    
    if (!textFilePath) {
      return [];
    }
    
    const textArray = dataModules.events[textFilePath]?.default;
    if (!Array.isArray(textArray)) {
      return [];
    }

    // 2. 각 event에 대해 event_id에 해당하는 관계 파일을 찾음
    const eventsWithRelations = textArray.map((event) => {
      try {
        // event_id가 undefined/null일 때만 0, 그 외에는 원래 값 사용
        const eventId =
          event.event_id === undefined || event.event_id === null
            ? 0
            : Number(event.event_id);
        const fileEventNum = eventId + 1;
        const relFilePath = Object.keys(dataModules.relationships).find((path) =>
          path.includes(`/${folderKey}/chapter${num}_relationships_event_${fileEventNum}.json`)
        );

        const relations = relFilePath
          ? dataModules.relationships[relFilePath]?.default?.relations || []
          : [];
        return {
          ...event,
          eventNum: eventId,
          event_id: eventId,
          relations,
          chapter: Number(chapter),
        };
      } catch (error) {
        console.error(`getEventsForChapter: 이벤트 처리 중 오류 (${folderKey}/chapter${num}):`, error);
        return null;
      }
    }).filter(event => event !== null);
    
    // 3. 현재 챕터의 이벤트만 필터링 (이전 챕터의 마지막 이벤트 제외)
    const currentChapterEvents = eventsWithRelations.filter(event => {
      const eventChapter = Number(event.chapter);
      const targetChapter = Number(chapter);
      
      // 챕터 번호가 정확히 일치하는지 확인
      return eventChapter === targetChapter;
    });
    
    // 결과 캐시에 저장
    eventsCache.set(cacheKey, currentChapterEvents);
    
    // 캐시 크기 제한
    cleanupCache(eventsCache, MAX_CACHE_SIZE);
    
    return currentChapterEvents;
  } catch (error) {
    console.error(`getEventsForChapter 실패 (${folderKey}, chapter ${chapter}):`, error);
    return [];
  }
}

/**
 * 특정 챕터의 이벤트 총 개수 가져오기
 * @param {number} chapter - 챕터 번호
 * @param {string} folderKey - 폴더 키 (사용자가 선택한 파일명)
 * @returns {number} 해당 챕터의 이벤트 총 개수
 */
export function getChapterEventCount(chapter, folderKey) {
  try {
    const events = getEventsForChapter(chapter, folderKey);
    return Array.isArray(events) ? events.length : 0;
  } catch (error) {
    console.error(`getChapterEventCount 실패 (${folderKey}, chapter ${chapter}):`, error);
    return 0;
  }
}

/**
 * 챕터 파일 데이터 가져오기 (ViewerPage 전용)
 * @param {number} chapter - 챕터 번호
 * @param {string} type - 데이터 타입 ('characters', 'relations' 등)
 * @param {string} folderKey - 폴더 키 (사용자가 선택한 파일명)
 * @returns {Array} 데이터 배열
 */
export function getChapterFile(chapter, type, folderKey) {
  try {
    if (!chapter || chapter < 1) {
      return [];
    }
    
    if (!type || typeof type !== 'string') {
      return [];
    }
    
    if (!folderKey || typeof folderKey !== 'string') {
      return [];
    }

    const num = String(chapter);
    
    if (type === "characters") {
      const filePath = Object.keys(dataModules.characters).find((key) =>
        key.includes(`/${folderKey}/chapter${num}_characters_0.json`)
      );
      
      if (!filePath) {
        return [];
      }
      
      const data = dataModules.characters[filePath]?.default;
      return data?.characters || [];
    } else {
      // (relations 등 다른 타입도 필요하다면 여기에 맞게 수정)
      return [];
    }
  } catch (error) {
    console.error(`getChapterFile 실패 (${folderKey}, chapter ${chapter}, type ${type}):`, error);
    return [];
  }
}


/**
 * 캐릭터 ID로 캐릭터 정보를 빠르게 검색 (인덱스 활용)
 * @param {string} folderKey - 폴더 키
 * @param {string} characterId - 캐릭터 ID
 * @param {number} preferredChapter - 선호하는 챕터 (기본값: 최신 챕터)
 * @returns {Object|null} 캐릭터 정보
 */
export function findCharacterById(folderKey, characterId, preferredChapter = null) {
  if (!folderKey || !characterId) {
    return null;
  }
  
  const indexKey = `${folderKey}:${safeId(characterId)}`;
  const characterEntries = characterIdIndex.get(indexKey);
  
  if (!characterEntries || characterEntries.length === 0) {
    return null;
  }
  
  // 선호하는 챕터가 있으면 해당 챕터의 캐릭터 정보 반환
  if (preferredChapter) {
    const preferredEntry = characterEntries.find(entry => entry.chapter === preferredChapter);
    if (preferredEntry) {
      return preferredEntry.character;
    }
  }
  
  // 최신 챕터의 캐릭터 정보 반환 (챕터 번호가 높은 것)
  const latestEntry = characterEntries.reduce((latest, current) => 
    current.chapter > latest.chapter ? current : latest
  );
  
  return latestEntry.character;
}




/**
 * 챕터 데이터 로딩 함수 (ViewerPage 전용)
 * @param {number} currentChapter - 현재 챕터
 * @param {Function} setEvents - 이벤트 설정 함수
 * @param {Function} setCharacterData - 캐릭터 데이터 설정 함수
 * @param {Function} setElements - 요소 설정 함수
 * @param {Function} setIsDataReady - 데이터 준비 상태 설정 함수
 * @param {Function} setLoading - 로딩 상태 설정 함수
 * @param {string} folderKey - 폴더 키 (사용자가 선택한 파일명)
 * @returns {Promise<void>}
 */
export async function loadChapterData(
  currentChapter,
  setEvents,
  setCharacterData,
  setElements,
  setIsDataReady,
  setLoading,
  folderKey
) {
  try {
    if (!folderKey) {
      throw new Error(`폴더 키가 필요합니다. 현재 값: ${folderKey}`);
    }
    
    if (!currentChapter || currentChapter < 1) {
      throw new Error(`유효하지 않은 챕터 번호: ${currentChapter}`);
    }
    
    setLoading(true);
    setIsDataReady(false);

    // 이벤트 데이터 로드
    const events = getEventsForChapter(currentChapter, folderKey);
    if (!Array.isArray(events)) {
      throw new Error(`이벤트 데이터 로드 실패: ${folderKey}/chapter${currentChapter}`);
    }
    setEvents(events);

    // 캐릭터 데이터 로드 - chapter*_characters_0.json 사용
    const characterFilePath = Object.keys(dataModules.characters).find((path) =>
      path.includes(`/${folderKey}/chapter${currentChapter}_characters_0.json`)
    );
    if (!characterFilePath) {
      const availablePaths = Object.keys(dataModules.characters).filter(path => 
        path.includes(`/${folderKey}/`)
      );
      throw new Error(
        `캐릭터 데이터 파일을 찾을 수 없습니다: ${folderKey}/chapter${currentChapter}. 사용 가능한 파일: [${availablePaths.join(', ')}]`
      );
    }
    const characterData = dataModules.characters[characterFilePath].default;
    if (!characterData) {
      throw new Error(`캐릭터 데이터가 비어있습니다: ${characterFilePath}`);
    }
    setCharacterData(characterData.characters || characterData);

    // ViewerPage에서는 관계 데이터를 누적하지 않음
    // currentEventElements에서 개별 이벤트 데이터를 로드함

    // ViewerPage에서는 빈 elements로 초기화
    // 실제 그래프는 currentEventElements에서 생성됨
    setElements([]);
    setIsDataReady(true);
  } catch (error) {
    console.error('loadChapterData 실패:', error, { 
      currentChapter, 
      folderKey, 
      availableFolders: Array.from(folderChapters.keys()) 
    });
    setEvents([]);
    setCharacterData([]);
    setElements([]);
    setIsDataReady(false);
  } finally {
    setLoading(false);
  }
}

// perspective summaries 데이터 로드 함수
export function getPerspectiveSummaries(folderKey, chapterNum) {
  try {
    const pattern = `../data/${folderKey}/chapter${chapterNum}_perspective_summaries_Ko.json`;
    const module = dataModules.perspectiveSummaries[pattern];
    
    if (!module) {
      return null;
    }
    
    return module.default || module;
  } catch (error) {
    console.error(`perspective summaries 데이터 로드 실패 (${folderKey}, chapter ${chapterNum}):`, error);
    return null;
  }
}

// 특정 인물의 perspective summary 가져오기
export function getCharacterPerspectiveSummary(folderKey, chapterNum, characterName) {
  try {
    const summaries = getPerspectiveSummaries(folderKey, chapterNum);
    
    if (!summaries) {
      return null;
    }
    
    // character_name으로 매칭
    for (const key in summaries) {
      if (summaries[key].character_name === characterName) {
        return summaries[key].summary;
      }
    }
    
    return null;
  } catch (error) {
    console.error(`인물 perspective summary 가져오기 실패 (${folderKey}, chapter ${chapterNum}, ${characterName}):`, error);
    return null;
  }
}