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

// graphDataUtils.js에서 함수 import
import { convertRelationsToElements } from './graphDataUtils';

const relationshipIndex = new Map();
const chapterMaxEventIndex = new Map();
const charactersIndex = new Map();
const folderChapters = new Map();
const characterIdIndex = new Map(); // 캐릭터 ID별 전체 챕터 정보 인덱스 (빠른 검색용)

function extractFolderKey(path) {
  const m = path.match(/^\.\.\/data\/([^/]+)\//);
  return m ? m[1] : "";
}

export function getFolderKeyFromFilename(filename) {
  const availableFolders = Array.from(folderChapters.keys());
  
  if (availableFolders.length === 0) {
    throw new Error('getFolderKeyFromFilename: 사용 가능한 폴더가 없습니다.');
  }
  
  if (!filename || typeof filename !== 'string') {
    return availableFolders[0];
  }
  
  const nameWithoutExt = filename.replace(/\.(epub|json)$/i, "");
  
  if (availableFolders.includes(nameWithoutExt)) {
    return nameWithoutExt;
  }
  
  const partialMatch = availableFolders.find(folder => 
    nameWithoutExt.toLowerCase().includes(folder.toLowerCase()) ||
    folder.toLowerCase().includes(nameWithoutExt.toLowerCase())
  );
  
  if (partialMatch) {
    return partialMatch;
  }
  
  return availableFolders[0];
}

/**
 * 특정 책의 모든 관계 데이터에서 positivity 값들을 수집
 * @param {string} folderKey - 책의 폴더 키
 * @returns {number[]} positivity 값들의 배열
 */
export function collectPositivityValues(folderKey) {
  const positivityValues = [];
  
  // 이미 인덱싱된 관계 데이터에서 positivity 값 수집
  for (const [path, relJson] of Object.entries(dataModules.relationships)) {
    if (!path.includes(`/${folderKey}/`)) continue;
    
    const data = relJson?.default || relJson;
    if (data && data.relations && Array.isArray(data.relations)) {
      data.relations.forEach(relation => {
        if (typeof relation.positivity === 'number' && !isNaN(relation.positivity)) {
          positivityValues.push(relation.positivity);
        }
      });
    }
  }
  
  return positivityValues;
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
 * 캐릭터 데이터를 ID 기반 매핑 객체로 변환
 * @param {Object} characters - 캐릭터 데이터 객체 (characters 필드가 있거나, 곧바로 배열일 수 있음)
 * @returns {{idToName:Object, idToDesc:Object, idToMain:Object, idToNames:Object}}
 */
export function createCharacterMaps(characters) {
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
}

/**
 * 챕터별 이벤트 데이터 가져오기 (ViewerPage 전용)
 * @param {number} chapter - 챕터 번호
 * @param {string} folderKey - 폴더 키 (기본값: 'gatsby')
 * @returns {Array} 이벤트 배열
 */
export function getEventsForChapter(chapter, folderKey = 'gatsby') {
  const num = String(chapter);

  // 1. 이벤트 본문 데이터 추출
  const textFilePath = Object.keys(dataModules.events).find((path) =>
    path.includes(`/${folderKey}/chapter${num}_events.json`)
  );
  const textArray = textFilePath ? dataModules.events[textFilePath]?.default : [];

  // 2. 각 event에 대해 event_id에 해당하는 관계 파일을 찾음
  const eventsWithRelations = textArray.map((event) => {
    // event_id가 undefined/null일 때만 0, 그 외에는 원래 값 사용
    const eventId =
      event.event_id === undefined || event.event_id === null
        ? 0
        : event.event_id;
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
  });
  
  // 3. 현재 챕터의 이벤트만 필터링 (이전 챕터의 마지막 이벤트 제외)
  const currentChapterEvents = eventsWithRelations.filter(event => {
    const eventChapter = Number(event.chapter);
    const targetChapter = Number(chapter);
    
    // 챕터 번호가 정확히 일치하는지 확인
    if (eventChapter !== targetChapter) {
      if (process.env.NODE_ENV === 'development') {
      }
      return false;
    }
    
    return true;
  });
  
  // 디버깅: 필터링 결과 로그
  if (process.env.NODE_ENV === 'development') {
    if (currentChapterEvents.length > 0) {
    }
  }
  
  return currentChapterEvents;
}

/**
 * 특정 챕터의 이벤트 총 개수 가져오기
 * @param {number} chapter - 챕터 번호
 * @param {string} folderKey - 폴더 키 (기본값: 'gatsby')
 * @returns {number} 해당 챕터의 이벤트 총 개수
 */
export function getChapterEventCount(chapter, folderKey = 'gatsby') {
  const events = getEventsForChapter(chapter, folderKey);
  return events.length;
}

/**
 * 챕터 파일 데이터 가져오기 (ViewerPage 전용)
 * @param {number} chapter - 챕터 번호
 * @param {string} type - 데이터 타입 ('characters', 'relations' 등)
 * @param {string} folderKey - 폴더 키 (기본값: 'gatsby')
 * @returns {Array} 데이터 배열
 */
export function getChapterFile(chapter, type, folderKey = 'gatsby') {
  const num = String(chapter);
  try {
    if (type === "characters") {
      const filePath = Object.keys(dataModules.characters).find((key) =>
        key.includes(`/${folderKey}/chapter${num}_characters_0.json`)
      );
      const data = filePath ? dataModules.characters[filePath]?.default : undefined;
      return data?.characters || [];
    } else {
      // (relations 등 다른 타입도 필요하다면 여기에 맞게 수정)
      return [];
    }
  } catch (error) {
    return [];
  }
}

/**
 * 안전한 ID 변환 함수 (viewerUtils.js에서 가져옴)
 * @param {any} id - ID 값
 * @returns {string} 문자열로 변환된 ID
 */
export function safeId(id) {
  return String(parseInt(id, 10));
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
 * 관계 데이터에서 그래프 요소 생성 (ViewerPage 전용) - graphDataUtils.js의 convertRelationsToElements 사용
 * @param {Array} relations - 관계 데이터
 * @param {Array} characterData - 캐릭터 데이터
 * @param {Array} newAppearances - 새로운 등장 인물 (사용하지 않음)
 * @param {Object} importance - 중요도 데이터 (사용하지 않음)
 * @param {number} chapter - 챕터 번호 (사용하지 않음)
 * @param {string} folderKey - 폴더 키
 * @returns {Array} 그래프 요소 배열
 */
export function getElementsFromRelations(
  relations,
  characterData,
  newAppearances,
  importance,
  chapter = 1,
  folderKey = 'gatsby'
) {
  // graphDataUtils.js의 convertRelationsToElements 사용
  
  // 캐릭터 매핑 생성
  const { idToName, idToDesc, idToMain, idToNames } = createCharacterMaps(characterData);
  
  // relations 배열 추출
  const relationsArray = relations?.relations || (Array.isArray(relations) ? relations : []);
  
  // convertRelationsToElements 사용
  return convertRelationsToElements(relationsArray, idToName, idToDesc, idToMain, idToNames, folderKey);
}

/**
 * 고립 노드(독립 인물) 필터링 함수
 * @param {Array} elements - 그래프 요소 배열
 * @param {boolean} hideIsolated - 고립 노드 숨김 여부
 * @returns {Array} 필터링된 요소 배열
 */
export function filterIsolatedNodes(elements, hideIsolated) {
  if (!hideIsolated) return elements;
  // 엣지가 하나도 없으면(즉, relations가 아예 없으면) 노드는 숨기지 않음
  const hasEdge = elements.some(
    (el) => el.data && el.data.source && el.data.target
  );
  if (!hasEdge) return elements;
  // 노드 id 목록
  const nodeIds = new Set(
    elements
      .filter((el) => el.data && el.data.id && !el.data.source)
      .map((el) => el.data.id)
  );
  // 엣지의 source/target id 목록
  const connectedIds = new Set(
    elements
      .filter((el) => el.data && el.data.source && el.data.target)
      .flatMap((el) => [el.data.source, el.data.target])
  );
  // 연결된 노드만 남김
  return elements.filter((el) => {
    if (el.data && el.data.id && !el.data.source) {
      // 노드
      return connectedIds.has(el.data.id);
    }
    // 엣지는 모두 표시
    return true;
  });
}

/**
 * 그래프 diff 계산 함수 (성능 최적화)
 * @param {Array} prevElements - 이전 요소 배열
 * @param {Array} currentElements - 현재 요소 배열
 * @returns {Object} diff 정보
 */
// getGraphDiff는 graphDataUtils.js의 calcGraphDiff를 사용

// hasElementChanged는 graphDataUtils.js의 deepEqual을 사용

/**
 * 챕터 데이터 로딩 함수 (ViewerPage 전용)
 * @param {number} currentChapter - 현재 챕터
 * @param {Function} setEvents - 이벤트 설정 함수
 * @param {Function} setCharacterData - 캐릭터 데이터 설정 함수
 * @param {Function} setElements - 요소 설정 함수
 * @param {Function} setIsDataReady - 데이터 준비 상태 설정 함수
 * @param {Function} setLoading - 로딩 상태 설정 함수
 * @param {string} folderKey - 폴더 키 (기본값: 'gatsby')
 * @returns {Promise<void>}
 */
export async function loadChapterData(
  currentChapter,
  setEvents,
  setCharacterData,
  setElements,
  setIsDataReady,
  setLoading,
  folderKey = 'gatsby'
) {
  try {
    setLoading(true);
    setIsDataReady(false);

    // 이벤트 데이터 로드
    const events = getEventsForChapter(currentChapter, folderKey);
    setEvents(events);

    // 캐릭터 데이터 로드 - chapter*_characters_0.json 사용
    const characterFilePath = Object.keys(dataModules.characters).find((path) =>
      path.includes(`/${folderKey}/chapter${currentChapter}_characters_0.json`)
    );
    if (!characterFilePath) {
      throw new Error(
        `캐릭터 데이터 파일을 찾을 수 없습니다: ${folderKey}/chapter${currentChapter}`
      );
    }
    const characterData = dataModules.characters[characterFilePath].default;
    setCharacterData(characterData.characters || characterData);

    // ViewerPage에서는 관계 데이터를 누적하지 않음
    // currentEventElements에서 개별 이벤트 데이터를 로드함

    // ViewerPage에서는 빈 elements로 초기화
    // 실제 그래프는 currentEventElements에서 생성됨
    setElements([]);
    setIsDataReady(true);
  } catch (error) {
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