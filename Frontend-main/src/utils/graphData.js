// 데이터 파일 자동 인덱싱
const relationshipModules = import.meta.glob(
  "../data/*/chapter*_relationships_event_*.json",
  { eager: true }
);

const charactersModules = import.meta.glob(
  "../data/*/c_chapter*_0.json",
  { eager: true }
);

// 인덱스 맵들
const relationshipIndex = new Map();
const chapterMaxEventIndex = new Map();
const charactersIndex = new Map();
const folderChapters = new Map();

// 폴더 키 추출
function extractFolderKey(path) {
  const m = path.match(/^\.\.\/data\/([^/]+)\//);
  return m ? m[1] : "";
}

// 파일명으로 폴더 키 찾기
export function getFolderKeyFromFilename(filename) {
  const availableFolders = Array.from(folderChapters.keys());
  
  if (availableFolders.length === 0) {
    console.warn('getFolderKeyFromFilename: 사용 가능한 폴더가 없습니다.');
    return "";
  }
  
  if (!filename) {
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

// 관계 파일 인덱싱
for (const path of Object.keys(relationshipModules)) {
  const match = path.match(/\/chapter(\d+)_relationships_event_(\d+)\.json$/);
  if (!match) continue;

  const folderKey = extractFolderKey(path);
  const chapter = Number(match[1]);
  const eventIndex = Number(match[2]); // 파일명은 1-based 인덱스

  const relJson = relationshipModules[path]?.default;
  relationshipIndex.set(`${folderKey}:${chapter}:${eventIndex}`, relJson);

  const key = `${folderKey}:${chapter}`;
  const currentMax = chapterMaxEventIndex.get(key) || 0;
  if (eventIndex > currentMax) chapterMaxEventIndex.set(key, eventIndex);

  if (!folderChapters.has(folderKey)) folderChapters.set(folderKey, new Set());
  folderChapters.get(folderKey).add(chapter);
}

// 캐릭터 파일 인덱싱
for (const path of Object.keys(charactersModules)) {
  const match = path.match(/\/c_chapter(\d+)_0\.json$/);
  if (!match) continue;

  const folderKey = extractFolderKey(path);
  const chapter = Number(match[1]);
  const charJson = charactersModules[path]?.default;

  charactersIndex.set(`${folderKey}:${chapter}`, charJson);

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
  if (!json) return [];
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

  (characters?.characters || characters || []).forEach((char) => {
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

// ============================================================================
// ViewerPage 전용 함수들 (viewerDataUtils.js에서 통합)
// ============================================================================

// ViewerPage에서 사용하는 모듈 import (기존 charactersModules와 구분)
const viewerEventRelationModules = import.meta.glob(
  "../data/gatsby/chapter*_relationships_event_*.json",
  { eager: true }
);
const viewerEventTextModules = import.meta.glob(
  "../data/gatsby/chapter*_events.json",
  { eager: true }
);
const viewerCharactersModules = import.meta.glob(
  "../data/gatsby/c_chapter*_0.json",
  { eager: true }
);

/**
 * 챕터별 이벤트 데이터 가져오기 (ViewerPage 전용)
 * @param {number} chapter - 챕터 번호
 * @returns {Array} 이벤트 배열
 */
export function getEventsForChapter(chapter) {
  const num = String(chapter);

  // 1. 이벤트 본문 데이터 추출
  const textFilePath = Object.keys(viewerEventTextModules).find((path) =>
    path.includes(`chapter${num}_events.json`)
  );
  const textArray = textFilePath ? viewerEventTextModules[textFilePath]?.default : [];

  // 2. 각 event에 대해 event_id에 해당하는 관계 파일을 찾음
  const eventsWithRelations = textArray.map((event) => {
    // event_id가 undefined/null일 때만 0, 그 외에는 원래 값 사용
    const eventId =
      event.event_id === undefined || event.event_id === null
        ? 0
        : event.event_id;
    const fileEventNum = eventId + 1;
    const relFilePath = Object.keys(viewerEventRelationModules).find((path) =>
      path.includes(`chapter${num}_relationships_event_${fileEventNum}.json`)
    );

    const relations = relFilePath
      ? viewerEventRelationModules[relFilePath]?.default?.relations || []
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
    return event.chapter === Number(chapter);
  });
  
  return currentChapterEvents;
}

/**
 * 챕터 파일 데이터 가져오기 (ViewerPage 전용)
 * @param {number} chapter - 챕터 번호
 * @param {string} type - 데이터 타입 ('characters', 'relations' 등)
 * @returns {Array} 데이터 배열
 */
export function getChapterFile(chapter, type) {
  const num = String(chapter);
  try {
    if (type === "characters") {
      const filePath = Object.keys(viewerCharactersModules).find((key) =>
        key.includes(`c_chapter${num}_0.json`)
      );
      const data = filePath ? viewerCharactersModules[filePath]?.default : undefined;
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
 * 관계 데이터에서 그래프 요소 생성 (ViewerPage 전용)
 * @param {Array} relations - 관계 데이터
 * @param {Array} characterData - 캐릭터 데이터
 * @param {Array} newAppearances - 새로운 등장 인물
 * @param {Object} importance - 중요도 데이터
 * @returns {Array} 그래프 요소 배열
 */
export function getElementsFromRelations(
  relations,
  characterData,
  newAppearances,
  importance
) {
  // 1. relation, importance에 등장하는 id 모두 수집 (newAppearances는 무시)
  const nodeIdSet = new Set();

  // relations가 객체인 경우 relations.relations 배열을 사용
  const relationsArray =
    relations?.relations || (Array.isArray(relations) ? relations : []);

  if (Array.isArray(relationsArray)) {
    relationsArray.forEach((rel) => {
      if (rel.id1 !== undefined) nodeIdSet.add(safeId(rel.id1));
      if (rel.id2 !== undefined) nodeIdSet.add(safeId(rel.id2));
      if (rel.source !== undefined) nodeIdSet.add(safeId(rel.source));
      if (rel.target !== undefined) nodeIdSet.add(safeId(rel.target));
    });
  }

  if (importance && typeof importance === "object") {
    Object.keys(importance).forEach((id) => nodeIdSet.add(safeId(id)));
  }

  let nodes = [];
  if (Array.isArray(characterData)) {
    // relations가 없으면 모든 캐릭터를 노드로!
    const filteredCharacters =
      nodeIdSet.size === 0
        ? characterData
        : characterData.filter((char) => {
            const sid = safeId(char.id);
            return (
              nodeIdSet.has(sid) ||
              nodeIdSet.has(char.id) ||
              nodeIdSet.has(Number(char.id))
            );
          });
    nodes = filteredCharacters.map((char) => {
      const idStr = safeId(char.id); // safeId로 문자열 변환
      return {
        data: {
          id: safeId(char.id),
          label: char.common_name || char.name || safeId(char.id),
          description: char.description || "",
          main: char.main_character !== undefined ? char.main_character : false,
          names:
            char.names && char.names.length > 0
              ? char.names
              : char.common_name
              ? [char.common_name]
              : [],
          portrait_prompt: char.portrait_prompt || "",
          image: `/gatsby/${idStr}.png`, // 노드 이미지 추가
        },
      };
    });
  }

  // 3. 엣지 생성 (safeId 적용)
  const edges = relationsArray
    .filter((rel) => {
      const source = safeId(rel.id1 || rel.source);
      const target = safeId(rel.id2 || rel.target);
      return nodeIdSet.has(source) && nodeIdSet.has(target);
    })
    .map((rel, idx) => {
      // 간선 라벨 로직: 1개인 경우 최초 관계, 여러개인 경우 최근 관계
      let label = "";
      if (Array.isArray(rel.relation)) {
        if (rel.relation.length === 1) {
          // 1개인 경우: 최초의 관계 (첫 번째 요소)
          label = rel.relation[0] || "";
        } else if (rel.relation.length > 1) {
          // 여러개인 경우: 가장 최근에 추가된 관계 (마지막 요소)
          label = rel.relation[rel.relation.length - 1] || "";
        }
      } else {
        label = rel.type || "";
      }
      
      return {
        data: {
          id: `e${idx}`,
          source: safeId(rel.id1 || rel.source),
          target: safeId(rel.id2 || rel.target),
          label: label,
          explanation: rel.explanation,
          positivity: rel.positivity,
          weight: rel.weight,
        },
      };
    });

  return [...nodes, ...edges];
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
 * @returns {Promise<void>}
 */
export async function loadChapterData(
  currentChapter,
  setEvents,
  setCharacterData,
  setElements,
  setIsDataReady,
  setLoading
) {
  try {
    setLoading(true);
    setIsDataReady(false);

    // 이벤트 데이터 로드
    const events = getEventsForChapter(currentChapter);
    setEvents(events);

    // 캐릭터 데이터 로드 - c_chapter1_0.json 사용
    const characterFilePath = Object.keys(viewerCharactersModules).find((path) =>
      path.includes(`c_chapter${currentChapter}_0.json`)
    );
    if (!characterFilePath) {
      throw new Error(
        `캐릭터 데이터 파일을 찾을 수 없습니다: chapter${currentChapter}`
      );
    }
    const characterData = viewerCharactersModules[characterFilePath].default;
    setCharacterData(characterData);

    // 전체 챕터의 관계 데이터를 바로 로드
    const allRelations = [];
    const allImportance = {};
    const allNewAppearances = [];
    const edgeSet = new Set(); // 중복 간선 방지용

    // 각 이벤트의 관계 데이터를 수집
    for (const ev of events) {
      const eventId = ev.event_id || 0;
      const fileEventNum = eventId + 1;
      const eventRelationFilePath = Object.keys(viewerEventRelationModules).find((path) =>
        path.includes(`chapter${currentChapter}_relationships_event_${fileEventNum}.json`)
      );

      if (eventRelationFilePath) {
        const eventRelations = viewerEventRelationModules[eventRelationFilePath].default;
        if (Array.isArray(eventRelations?.relations)) {
          eventRelations.relations.forEach((rel) => {
            const id1 = rel.id1 || rel.source;
            const id2 = rel.id2 || rel.target;
            const edgeKey = `${id1}-${id2}`;
            if (!edgeSet.has(edgeKey)) {
              allRelations.push(rel);
              edgeSet.add(edgeKey);
            }
          });
        }
        if (eventRelations?.importance) {
          Object.entries(eventRelations.importance).forEach(([k, v]) => {
            allImportance[k] = v;
          });
        }
      }

      if (Array.isArray(ev.new_appearances)) {
        allNewAppearances.push(...ev.new_appearances);
      }
    }

    const elements = getElementsFromRelations(
      allRelations,
      characterData,
      allNewAppearances,
      allImportance
    );

    setElements(elements);
    setIsDataReady(true);
    setLoading(false);
  } catch (error) {
    setLoading(false);
    console.error('Chapter data loading error:', error);
  }
}