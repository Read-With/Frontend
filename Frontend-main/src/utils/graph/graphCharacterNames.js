/** 인물 id·표시 이름: 이름 고르기·기억(책별)·manifest 조회·elements/payload에 표시 이름 반영 */

import { getManifestFromCache } from '../common/cache/manifestCache.js';
import { asArray } from '../common/valueUtils';
import { isGraphNodeElement } from '../viewer/viewerCore.js';

function normalizeCharacterId(value) {
  if (value == null || value === '') return null;
  const numId = Number(value);
  if (!Number.isFinite(numId)) return null;
  return String(Math.trunc(numId));
}

export function extractCharacterId(character) {
  if (!character || typeof character !== 'object') return null;
  return normalizeCharacterId(character.id);
}

/** 표시 이름으로 쓸 수 있는 문자열인지 (ID 숫자 문자열은 제외) */
export function isUsableCharacterDisplayName(name, characterId = null) {
  if (typeof name !== 'string') return false;
  const trimmed = name.trim();
  if (!trimmed) return false;
  const id = normalizeCharacterId(characterId);
  if (id && trimmed === id) return false;
  if (/^\d+$/.test(trimmed) && (!id || trimmed === id)) return false;
  return true;
}

export function pickCharacterDisplayName(character) {
  if (!character || typeof character !== 'object') return '';
  const id = extractCharacterId(character);
  const fromNames = asArray(character.names).find((n) => isUsableCharacterDisplayName(n, id));
  const candidates = [
    character.common_name,
    character.name,
    character.label,
    character.displayName,
    fromNames,
  ];
  for (const candidate of candidates) {
    if (isUsableCharacterDisplayName(candidate, id)) return String(candidate).trim();
  }
  return '';
}

/** bookId → (characterId → displayName) — 챕터/페이지 전환 후에도 재사용 */
const characterDisplayNameMemory = new Map();

function getMemoryMap(bookId) {
  const key = normalizeCharacterId(bookId) ?? String(bookId ?? '').trim();
  if (!key) return null;
  let map = characterDisplayNameMemory.get(key);
  if (!map) {
    map = new Map();
    characterDisplayNameMemory.set(key, map);
  }
  return map;
}

export function rememberCharacterDisplayName(bookId, characterId, displayName) {
  const id = normalizeCharacterId(characterId);
  if (!id || !isUsableCharacterDisplayName(displayName, id)) return;
  const map = getMemoryMap(bookId);
  if (!map) return;
  map.set(id, String(displayName).trim());
}

/** id·표시 이름이 모두 있는 인물만 fn(id, name) 호출 */
function forEachCharacterName(characters, fn) {
  asArray(characters).forEach((char) => {
    const id = extractCharacterId(char);
    const name = pickCharacterDisplayName(char);
    if (id && name) fn(id, name);
  });
}

function rememberCharacterDisplayNames(bookId, characters) {
  forEachCharacterName(characters, (id, name) => rememberCharacterDisplayName(bookId, id, name));
}

export function lookupRememberedCharacterDisplayName(bookId, characterId) {
  const id = normalizeCharacterId(characterId);
  if (!id) return '';
  return getMemoryMap(bookId)?.get(id) || '';
}

// manifest 객체는 캐시 후 변경하지 않음 — 객체 identity 기준 메모 (인물·요소마다 Map 재생성 방지)
const manifestNameLookupMemo = new WeakMap();

/** 읽기 전용 공유 Map (없으면 null) — 변경 금지 */
function getManifestCharacterNameLookup(bookId) {
  if (bookId == null || bookId === '') return null;
  const manifest = getManifestFromCache(bookId);
  if (!manifest || typeof manifest !== 'object') return null;
  let lookup = manifestNameLookupMemo.get(manifest);
  if (!lookup) {
    lookup = new Map();
    forEachCharacterName(manifest.characters, (id, name) => lookup.set(id, name));
    manifestNameLookupMemo.set(manifest, lookup);
  }
  return lookup;
}

/** 호출부가 변경해도 되는 복사본 */
export function buildManifestCharacterNameLookup(bookId) {
  return new Map(getManifestCharacterNameLookup(bookId));
}

/** payload·manifest·세션 메모리를 합쳐 ID→이름 룩업 생성 */
function buildCharacterDisplayNameLookup(bookId, characters = null) {
  const lookup = buildManifestCharacterNameLookup(bookId);
  const memory = getMemoryMap(bookId);
  if (memory) {
    memory.forEach((name, id) => {
      if (!lookup.has(id) && isUsableCharacterDisplayName(name, id)) lookup.set(id, name);
    });
  }
  forEachCharacterName(characters, (id, name) => lookup.set(id, name));
  return lookup;
}

function resolveCharacterDisplayName(characterOrId, { bookId, lookup = null } = {}) {
  const id =
    characterOrId != null && typeof characterOrId === 'object'
      ? extractCharacterId(characterOrId)
      : normalizeCharacterId(characterOrId);
  if (!id) return '';

  if (characterOrId && typeof characterOrId === 'object') {
    const picked = pickCharacterDisplayName(characterOrId);
    if (picked) return picked;
  }

  const fromLookup = lookup?.get(id);
  if (isUsableCharacterDisplayName(fromLookup, id)) return fromLookup;

  const fromManifest = getManifestCharacterNameLookup(bookId)?.get(id);
  if (fromManifest) return fromManifest;

  return lookupRememberedCharacterDisplayName(bookId, id);
}

export function enrichGraphCharacters(characters, { bookId } = {}) {
  const list = asArray(characters);
  if (!list.length) return list;

  const lookup = buildCharacterDisplayNameLookup(bookId, list);
  const enriched = list.map((char) => {
    if (!char || typeof char !== 'object') return char;
    const id = extractCharacterId(char);
    const name = resolveCharacterDisplayName(char, { bookId, lookup });
    if (id && name) {
      rememberCharacterDisplayName(bookId, id, name);
      lookup.set(id, name);
    }
    if (!name) return char;

    const nextNames = asArray(char.names);
    const names =
      name && !nextNames.some((n) => String(n).trim() === name)
        ? [name, ...nextNames]
        : nextNames;

    return {
      ...char,
      common_name: name,
      name: isUsableCharacterDisplayName(char.name, id) ? String(char.name).trim() : name,
      names,
    };
  });

  rememberCharacterDisplayNames(bookId, enriched);
  return enriched;
}

export function applyDisplayNamesToElements(elements, { bookId, characters = null } = {}) {
  const list = asArray(elements);
  if (!list.length) return list;

  const lookup = buildCharacterDisplayNameLookup(bookId, characters);
  return list.map((el) => {
    if (!isGraphNodeElement(el) || !el.data) return el;
    const id = normalizeCharacterId(el.data.id);
    if (!id) return el;

    const resolved =
      resolveCharacterDisplayName(el.data, { bookId, lookup }) ||
      lookup.get(id) ||
      '';
    if (!resolved) return el;

    rememberCharacterDisplayName(bookId, id, resolved);
    const label = el.data.label;
    const common = el.data.common_name;
    const needsFix =
      !isUsableCharacterDisplayName(label, id) ||
      !isUsableCharacterDisplayName(common, id);

    if (!needsFix && label === resolved && common === resolved) return el;

    return {
      ...el,
      data: {
        ...el.data,
        label: resolved,
        name: resolved,
        common_name: resolved,
      },
    };
  });
}

export function enrichGraphPayload(payload, bookId) {
  if (!payload || typeof payload !== 'object') return payload;
  const characters = enrichGraphCharacters(payload.characters, { bookId });
  const next = { ...payload, characters };
  if (Array.isArray(payload.elements)) {
    next.elements = applyDisplayNamesToElements(payload.elements, { bookId, characters });
  }
  return next;
}
