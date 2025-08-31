// data/*/<files> 를 모두 스캔하여 챕터/이벤트/캐릭터를 자동 인덱싱

// 관계(event) JSON과 캐릭터 JSON을 하위 폴더까지 포함해 eager 로딩
const relationshipModules = import.meta.glob(
  "../data/*/chapter*_relationships_event_*.json",
  { eager: true }
);

const charactersModules = import.meta.glob(
  "../data/*/c_chapter*_0.json",
  { eager: true }
);

// ---------------------------------------------
// 내부 인덱스
// ---------------------------------------------
// key: `${folderKey}:${chapter}:${eventIndex}` -> json
const relationshipIndex = new Map();
// key: `${folderKey}:${chapter}` -> max event index
const chapterMaxEventIndex = new Map();

// key: `${folderKey}:${chapter}` -> characters json
const charactersIndex = new Map();

// 폴더(작품/파일명 단위) 별로 존재하는 챕터 번호 수집
// key: folderKey -> Set<number> (해당 폴더에 존재하는 모든 챕터 번호)
const folderChapters = new Map();

// 폴더 키 추출 유틸 (../data/<folderKey>/... 형태 가정)
function extractFolderKey(path) {
  // 예: "../data/gatsby/chapter3_relationships_event_12.json"
  //     "../data/mybook/c_chapter10_0.json"
  const m = path.match(/^\.\.\/data\/([^/]+)\//);
  return m ? m[1] : ""; // 폴더명을 folderKey 로 사용
}

/**
 * filename을 기반으로 folderKey를 결정하는 함수
 * @param {string} filename - 파일명 (예: "gatsby.epub", "alice.epub")
 * @returns {string} folderKey - 데이터 폴더명
 */
export function getFolderKeyFromFilename(filename) {
  // 사용 가능한 폴더 목록에서 매칭
  const availableFolders = Array.from(folderChapters.keys());
  
  // 폴더가 없으면 빈 문자열 반환 (초기화 전 호출 방지)
  if (availableFolders.length === 0) {
    console.warn('getFolderKeyFromFilename: 사용 가능한 폴더가 없습니다. 모듈 초기화를 확인하세요.');
    return "";
  }
  
  if (!filename) {
    // 기본값을 첫 번째 사용 가능한 폴더로 설정
    return availableFolders[0];
  }
  
  // 파일 확장자 제거
  const nameWithoutExt = filename.replace(/\.(epub|json)$/i, "");
  
  // 정확한 매칭 시도
  if (availableFolders.includes(nameWithoutExt)) {
    return nameWithoutExt;
  }
  
  // 부분 매칭 시도 (예: "gatsby.epub" -> "gatsby")
  const partialMatch = availableFolders.find(folder => 
    nameWithoutExt.toLowerCase().includes(folder.toLowerCase()) ||
    folder.toLowerCase().includes(nameWithoutExt.toLowerCase())
  );
  
  if (partialMatch) {
    return partialMatch;
  }
  
  // 매칭되지 않으면 첫 번째 사용 가능한 폴더 반환
  return availableFolders[0];
}

// ---------------------------------------------
// 관계(event) 파일 인덱싱
// 파일 예: ../data/<folder>/chapter3_relationships_event_12.json
// ---------------------------------------------
for (const path of Object.keys(relationshipModules)) {
  const match = path.match(/\/chapter(\d+)_relationships_event_(\d+)\.json$/);
  if (!match) continue;

  const folderKey = extractFolderKey(path);
  const chapter = Number(match[1]);
  const eventIndex = Number(match[2]); // 파일명은 1-based 인덱스

  const relJson = relationshipModules[path]?.default;
  relationshipIndex.set(`${folderKey}:${chapter}:${eventIndex}`, relJson);

  // 챕터별 최대 이벤트 인덱스 갱신
  const key = `${folderKey}:${chapter}`;
  const currentMax = chapterMaxEventIndex.get(key) || 0;
  if (eventIndex > currentMax) chapterMaxEventIndex.set(key, eventIndex);

  // 폴더-챕터 집합에도 등록
  if (!folderChapters.has(folderKey)) folderChapters.set(folderKey, new Set());
  folderChapters.get(folderKey).add(chapter);
}

// ---------------------------------------------
// 캐릭터 파일 인덱싱
// 파일 예: ../data/<folder>/c_chapter3_0.json
// ---------------------------------------------
for (const path of Object.keys(charactersModules)) {
  const match = path.match(/\/c_chapter(\d+)_0\.json$/);
  if (!match) continue;

  const folderKey = extractFolderKey(path);
  const chapter = Number(match[1]);
  const charJson = charactersModules[path]?.default;

  charactersIndex.set(`${folderKey}:${chapter}`, charJson);

  // 폴더-챕터 집합 갱신
  if (!folderChapters.has(folderKey)) folderChapters.set(folderKey, new Set());
  folderChapters.get(folderKey).add(chapter);
}
/**
 * 특정 폴더(작품) 안에서 감지된 최대 챕터 번호를 반환
 * @param {string} folderKey - 데이터 하위 폴더명
 * @returns {number} max chapter (없으면 0)
 */
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
