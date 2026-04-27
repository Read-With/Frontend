import { useMemo } from "react";
import { filterMainCharacters } from "../../utils/graph/graphDataUtils";
import { determineFinalElements, sortElementsById } from "../../utils/graph/graphUtils";

/**
 * 정렬 → 주인공 필터 메타 → 검색 시 최종 노드 집합 결정.
 * GraphSplitArea, RelationGraphWrapper가 동일 규칙을 쓰도록 한 경로.
 */
export function useGraphElementPipeline({
  elements,
  filterStage,
  isSearchActive,
  filteredElements,
}) {
  const sortedElements = useMemo(
    () => sortElementsById(elements),
    [elements]
  );

  const filteredMainCharacters = useMemo(
    () => filterMainCharacters(sortedElements, filterStage),
    [sortedElements, filterStage]
  );

  const finalElements = useMemo(
    () =>
      determineFinalElements(
        isSearchActive,
        filteredElements,
        sortedElements,
        filterStage,
        filteredMainCharacters
      ),
    [
      isSearchActive,
      filteredElements,
      sortedElements,
      filterStage,
      filteredMainCharacters,
    ]
  );

  return { sortedElements, filteredMainCharacters, finalElements };
}
