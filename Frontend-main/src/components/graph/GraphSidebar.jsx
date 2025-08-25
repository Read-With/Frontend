import React, { useState, useEffect, useCallback } from "react";
import { useParams } from "react-router-dom";
import { useRelationData } from "../../hooks/useRelationData";
import { useGraphDataLoader } from "../../hooks/useGraphDataLoader";
import { safeNum } from "../../utils/relationUtils";
import { getSlideInAnimation } from "../../utils/animations";
import { processRelations } from "../../utils/relationUtils";
import { getFolderKeyFromFilename, getEventDataByIndex } from "../../utils/graphData";
import GraphNodeTooltip from "./tooltip/NodeTooltip";
import UnifiedEdgeTooltip from "./tooltip/UnifiedEdgeTooltip";

function GraphSidebar({
  activeTooltip,
  onClose,
  chapterNum,
  eventNum,
  maxChapter,
  hasNoRelations = false,
  filename,
  elements = [], // 현재 로드된 elements 추가
  isSearchActive = false, // 검색 상태 추가
  filteredElements = [], // 검색된 요소들 추가
  searchTerm = "", // 검색어 추가
}) {
  const { filename: urlFilename } = useParams();
  const actualFilename = filename || urlFilename;

  // useGraphDataLoader를 사용하여 동적으로 감지된 값들 가져오기
  const {
    maxChapter: detectedMaxChapter,
    eventNum: detectedEventNum,
    maxEventNum: detectedMaxEventNum
  } = useGraphDataLoader(actualFilename, chapterNum || 1);

  // 동적으로 감지된 값들을 우선 사용, 없으면 props 값 사용
  const actualMaxChapter = detectedMaxChapter || maxChapter;
  const actualEventNum = detectedEventNum || eventNum;
  const actualChapterNum = chapterNum || 1;
  
  const [isNodeAppeared, setIsNodeAppeared] = useState(false);
  const [error, setError] = useState(null);

  // source/target을 safeNum으로 변환
  const id1 = safeNum(activeTooltip?.data?.source);
  const id2 = safeNum(activeTooltip?.data?.target);

  const { fetchData } = useRelationData('standalone', id1, id2, actualChapterNum, actualEventNum, actualMaxChapter, actualFilename);

  // 노드 등장 여부 확인 함수
  const checkNodeAppearance = useCallback(() => {
    try {
      setIsNodeAppeared(false);
      setError(null);
      
      if (!activeTooltip || !actualChapterNum || actualChapterNum <= 0) {
        return;
      }

      // 노드 데이터 가져오기
      const nodeData = activeTooltip.data;
      if (!nodeData || !nodeData.id) {
        return;
      }

      // graphData.js의 함수를 사용하여 데이터 가져오기
      const folderKey = getFolderKeyFromFilename(actualFilename);
      const json = getEventDataByIndex(folderKey, actualChapterNum, actualEventNum);

      // 노드 ID를 문자열로 변환하여 비교
      const nodeId = String(nodeData.id);
      
      // relations 기반 등장 여부 판별
      if (!json || !json.relations) {
        // 대안: elements에서 노드 등장 여부 확인
        if (elements && elements.length > 0) {
          const appeared = elements.some(element => {
            if (element.data && element.data.source) return false; // edge는 제외
            return String(element.data?.id) === nodeId;
          });
          setIsNodeAppeared(appeared);
        } else {
          setIsNodeAppeared(false);
        }
        return;
      }
      
      // processRelations 유틸리티 사용
      const processedRelations = processRelations(json.relations);
      
      // 더 정확한 ID 비교를 위해 숫자로 변환하여 비교
      const nodeIdNum = parseFloat(nodeId);
      
      const appeared = processedRelations.some(rel => {
        const id1Num = parseFloat(rel.id1);
        const id2Num = parseFloat(rel.id2);
        const match = id1Num === nodeIdNum || id2Num === nodeIdNum;
        return match;
      });
      
      setIsNodeAppeared(appeared);
    } catch (err) {
      setError(err.message);
      setIsNodeAppeared(false);
    }
  }, [activeTooltip, actualChapterNum, actualEventNum, elements, actualFilename]);

  // 노드 등장 여부 확인
  useEffect(() => {
    checkNodeAppearance();
  }, [checkNodeAppearance]);

  // 관계 데이터 가져오기
  useEffect(() => {
    if (activeTooltip && id1 && id2) {
      fetchData();
    }
  }, [activeTooltip, id1, id2, actualChapterNum, actualEventNum, actualMaxChapter, fetchData]);

  // 관계가 없을 때 안내 메시지 표시 (activeTooltip이 없어도 표시)
  if (hasNoRelations) {
    return (
      <div
        style={{
          display: "flex",
          flexDirection: "column",
          alignItems: "center",
          justifyContent: "center",
          height: "100%",
          padding: "40px 20px",
          textAlign: "center",
          color: "#6b7280",
        }}
      >
        <div
          style={{
            fontSize: 48,
            marginBottom: 16,
            opacity: 0.5,
          }}
        >
          📊
        </div>
        <h3
          style={{
            fontSize: 18,
            fontWeight: 600,
            marginBottom: 8,
            color: "#374151",
          }}
        >
          관계 데이터가 없습니다
        </h3>
        <p
          style={{
            fontSize: 14,
            lineHeight: 1.5,
            maxWidth: 280,
          }}
        >
          현재 챕터와 이벤트에서 인물 간의 관계 정보가 없습니다.
        </p>
      </div>
    );
  }

  // 툴팁이 없을 때는 아무것도 표시하지 않음
  if (!activeTooltip) {
    return null;
  }

  // 노드 툴팁 렌더링
  if (activeTooltip.type === "node") {
    return (
      <GraphNodeTooltip
        data={activeTooltip.data}
        x={activeTooltip.x}
        y={activeTooltip.y}
        nodeCenter={activeTooltip.nodeCenter}
        onClose={onClose}
        inViewer={false}
        chapterNum={actualChapterNum}
        eventNum={actualEventNum}
        maxChapter={actualMaxChapter}
        elements={elements}
        isSearchActive={isSearchActive}
        filteredElements={filteredElements}
        searchTerm={searchTerm}
      />
    );
  }

  // 간선 툴팁 렌더링
  if (activeTooltip.type === "edge") {
    return (
      <UnifiedEdgeTooltip
        data={activeTooltip.data}
        x={activeTooltip.x}
        y={activeTooltip.y}
        onClose={onClose}
        inViewer={false}
        chapterNum={actualChapterNum}
        eventNum={actualEventNum}
        maxChapter={actualMaxChapter}
        elements={elements}
      />
    );
  }

  return null;
}

export default GraphSidebar; 