import React, {
  forwardRef,
  useRef,
  useMemo,
  useEffect,
  useCallback,
  useImperativeHandle,
} from 'react';
import CytoscapeGraphUnified from './CytoscapeGraphUnified';
import UnifiedNodeInfo from './tooltip/UnifiedNodeInfo';
import UnifiedEdgeTooltip from './tooltip/UnifiedEdgeTooltip';
import './RelationGraph.css';
import { getEdgeStyle, createGraphStylesheet } from '../../utils/styles/graphStyles';
import { graphStyles } from '../../utils/styles/styles';
import { ensureElementsInBounds, clearHighlightClassesOn } from '../../utils/graph/graphUtils';
import { applySearchFadeEffect } from '../../utils/graph/searchUtils.jsx';
import { useGraphDataLoader } from '../../hooks/graph/useGraphDataLoader.js';
import { useGraphSearch } from '../../hooks/graph/graphViewHooks';
import { resolveEventIdxOrFallback } from '../../hooks/common/hooksShared';
import { eventUtils } from '../../utils/viewer/viewerCoreStateUtils';
import { resolveEventOrdinalForDisplay } from '../../utils/viewer/viewerEventProgressUtils';

function buildViewportFitKey({ chapterNum, eventNum, elements }) {
  if (!Array.isArray(elements) || elements.length === 0) return '';
  const elementIds = elements
    .map((element) => element?.data?.id)
    .filter((id) => id != null && id !== '')
    .map(String)
    .sort()
    .join('\x1f');
  return `${chapterNum ?? ''}:${eventNum ?? ''}:${elementIds}`;
}

function useAutoFit(cyRef, viewportFitKey, isSearchActive, isEventTransition) {
  useEffect(() => {
    const cy = cyRef.current;
    if (!cy || isSearchActive || isEventTransition || !viewportFitKey) return;

    let cancelled = false;
    let rafId = 0;

    const runFit = (attempt = 0) => {
      if (cancelled) return;
      const cyLive = cyRef.current;
      if (!cyLive) return;
      const container = typeof cyLive.container === 'function' ? cyLive.container() : null;
      const width = Number(container?.clientWidth ?? 0);
      const height = Number(container?.clientHeight ?? 0);

      if (width <= 0 || height <= 0) {
        if (attempt < 6) {
          rafId = requestAnimationFrame(() => runFit(attempt + 1));
        }
        return;
      }

      try {
        cyLive.resize();
      } catch {
        /* ignore */
      }
      try {
        if (container) ensureElementsInBounds(cyLive, container);
      } catch {
        /* ignore */
      }
      requestAnimationFrame(() => {
        if (cancelled) return;
        const cy2 = cyRef.current;
        if (!cy2) return;
        try {
          const nodes = cy2.nodes(':visible');
          if (nodes.length > 0) {
            cy2.fit(nodes, 80);
          }
        } catch {
          try {
            const n = cy2.nodes();
            if (n.length > 0) cy2.fit(n, 80);
          } catch {
            /* ignore */
          }
        }
      });
    };

    rafId = requestAnimationFrame(() => runFit(0));

    return () => {
      cancelled = true;
      if (rafId) cancelAnimationFrame(rafId);
    };
  }, [cyRef, viewportFitKey, isSearchActive, isEventTransition]);
}

function useCytoscapeReset(cyRef, graphClearRef, selectedNodeIdRef, selectedEdgeIdRef) {
  useEffect(() => {
    if (!graphClearRef) return;

    graphClearRef.current = () => {
      const cy = cyRef.current;
      if (!cy) return;
      clearHighlightClassesOn(cy);
      try {
        if (typeof cy.style === 'function') cy.style().update();
      } catch {}
      if (selectedNodeIdRef) selectedNodeIdRef.current = null;
      if (selectedEdgeIdRef) selectedEdgeIdRef.current = null;
    };
  }, [graphClearRef, cyRef, selectedNodeIdRef, selectedEdgeIdRef]);
}

const ViewerRelationGraph = ({
  elements,
  newNodeIds = [],
  chapterNum,
  eventNum,
  edgeLabelVisible = true,
  maxChapter,
  filename,
  fitNodeIds,
  searchTerm,
  isSearchActive,
  filteredElements,
  isResetFromSearch,
  currentEvent = null,
  prevValidEvent = null,
  events = [],
  activeTooltip = null,
  onClearTooltip = null,
  onSetActiveTooltip = null,
  graphClearRef = null,
  isEventTransition: _isEventTransition = false,
  bookId = null,
}) => {
  const cyRef = useRef(null);
  const selectedEdgeIdRef = useRef(null);
  const selectedNodeIdRef = useRef(null);
  const containerRef = useRef(null);
  const viewportFitKey = useMemo(
    () => buildViewportFitKey({ chapterNum, eventNum, elements }),
    [chapterNum, eventNum, elements]
  );

  useAutoFit(cyRef, viewportFitKey, isSearchActive, _isEventTransition);
  useCytoscapeReset(cyRef, graphClearRef, selectedNodeIdRef, selectedEdgeIdRef);

  const onClearTooltipOnly = useCallback(() => {
    onClearTooltip?.();
  }, [onClearTooltip]);

  const clearTooltipAndGraph = useCallback(() => {
    onClearTooltip?.();
    graphClearRef?.current?.();
    if (isSearchActive && filteredElements?.length > 0 && cyRef.current) {
      applySearchFadeEffect(cyRef.current, filteredElements, isSearchActive);
    }
  }, [onClearTooltip, graphClearRef, isSearchActive, filteredElements, cyRef]);

  const onShowNodeTooltip = useCallback(({ node, nodeCenter, mouseX, mouseY }) => {
    if (!onSetActiveTooltip) return;

    const nodeData = node.data();

    let names = nodeData.names;
    if (typeof names === 'string') {
      try { names = JSON.parse(names); } catch { names = [names]; }
    }

    let main = nodeData.main;
    if (typeof main === 'string') main = main === 'true';

    onSetActiveTooltip({
      type: 'node',
      ...nodeData,
      names,
      main,
      nodeCenter,
      x: mouseX ?? nodeCenter?.x ?? 0,
      y: mouseY ?? nodeCenter?.y ?? 0,
    });
  }, [onSetActiveTooltip]);

  const onShowEdgeTooltip = useCallback(({ edge, edgeCenter, mouseX, mouseY }) => {
    if (!onSetActiveTooltip) return;

    onSetActiveTooltip({
      type: 'edge',
      id: edge.id(),
      data: edge.data(),
      sourceNode: edge.source(),
      targetNode: edge.target(),
      edgeCenter,
      x: mouseX ?? edgeCenter?.x ?? 0,
      y: mouseY ?? edgeCenter?.y ?? 0,
    });
  }, [onSetActiveTooltip]);

  useEffect(() => {
    if (!activeTooltip) return;

    const handleDocumentClick = (event) => {
      const isInsideTooltip =
        !!event.target.closest('.graph-node-tooltip') ||
        !!event.target.closest('.edge-tooltip-container');
      if (isInsideTooltip) return;

      const isInsideGraph =
        containerRef.current && containerRef.current.contains(event.target);
      if (isInsideGraph) return;

      const isDragEnd = event?.detail?.type === 'graphDragEnd';
      if (isDragEnd) return;

      clearTooltipAndGraph();
    };

    const handleGraphDragEnd = (event) => {
      event.preventDefault?.();
      event.stopPropagation?.();
    };

    const timeoutId = setTimeout(() => {
      document.addEventListener('click', handleDocumentClick, true);
      document.addEventListener('graphDragEnd', handleGraphDragEnd, true);
    }, 20);

    return () => {
      clearTimeout(timeoutId);
      document.removeEventListener('click', handleDocumentClick, true);
      document.removeEventListener('graphDragEnd', handleGraphDragEnd, true);
    };
  }, [activeTooltip, clearTooltipAndGraph]);

  const edgeStyleViewer = useMemo(() => getEdgeStyle('viewer'), []);
  const stylesheet = useMemo(
    () => createGraphStylesheet(edgeStyleViewer, edgeLabelVisible),
    [edgeStyleViewer, edgeLabelVisible]
  );
  const presetLayout = useMemo(() => ({ name: 'preset' }), []);

  return (
    <div
      ref={containerRef}
      className="relation-graph-container"
      style={graphStyles.container}
    >
      <div
        style={graphStyles.tooltipContainer}
        onClick={(e) => e.stopPropagation()}
      >
        {activeTooltip?.type === 'node' && (
          <UnifiedNodeInfo
            key={`node-tooltip-${activeTooltip.id}`}
            displayMode="tooltip"
            data={activeTooltip}
            x={activeTooltip.x}
            y={activeTooltip.y}
            nodeCenter={activeTooltip.nodeCenter}
            onClose={clearTooltipAndGraph}
            inViewer={true}
            chapterNum={chapterNum}
            eventNum={eventNum}
            maxChapter={maxChapter}
            filename={filename}
            elements={elements}
            style={graphStyles.tooltipStyle}
            currentEvent={currentEvent}
            prevValidEvent={prevValidEvent}
            events={events}
          />
        )}
        {activeTooltip?.type === 'edge' && (
          <UnifiedEdgeTooltip
            key={`edge-tooltip-${activeTooltip.id}`}
            data={activeTooltip.data}
            x={activeTooltip.x}
            y={activeTooltip.y}
            onClose={clearTooltipAndGraph}
            sourceNode={activeTooltip.sourceNode}
            targetNode={activeTooltip.targetNode}
            mode="viewer"
            chapterNum={chapterNum}
            eventNum={eventNum}
            maxChapter={maxChapter}
            filename={filename}
            style={graphStyles.tooltipStyle}
            currentEvent={currentEvent}
            prevValidEvent={prevValidEvent}
            events={events}
            bookId={bookId}
          />
        )}
      </div>

      <div className="graph-canvas-area" style={graphStyles.graphArea}>
        <CytoscapeGraphUnified
          elements={elements}
          newNodeIds={newNodeIds}
          stylesheet={stylesheet}
          layout={presetLayout}
          cyRef={cyRef}
          fitNodeIds={fitNodeIds}
          searchTerm={searchTerm}
          isSearchActive={isSearchActive}
          filteredElements={filteredElements}
          isResetFromSearch={isResetFromSearch}
          currentChapter={chapterNum}
          onShowNodeTooltip={onShowNodeTooltip}
          onShowEdgeTooltip={onShowEdgeTooltip}
          onClearTooltip={onClearTooltipOnly}
          selectedNodeIdRef={selectedNodeIdRef}
          selectedEdgeIdRef={selectedEdgeIdRef}
          strictBackgroundClear={true}
          showRippleEffect={true}
        />
      </div>
    </div>
  );
};

const MemoViewerRelationGraph = React.memo(ViewerRelationGraph);

const GraphContainer = forwardRef(({
  currentEvent,
  currentChapter,
  edgeLabelVisible = true,
  onSearchStateChange,
  filename,
  elements: externalElements,
  prevValidEvent = null,
  events = [],
  activeTooltip = null,
  onClearTooltip = null,
  onSetActiveTooltip = null,
  graphClearRef = null,
  isEventTransition = false,
  searchTerm: externalSearchTerm,
  isSearchActive: externalIsSearchActive,
  filteredElements: externalFilteredElements,
  fitNodeIds: externalFitNodeIds,
  isResetFromSearch: externalIsResetFromSearch,
  bookId = null,
}, ref) => {
  const isExternalMode = Boolean(externalElements);

  const {
    elements: internalElements,
    newNodeIds,
    currentChapterData,
  } = useGraphDataLoader(
    isExternalMode ? null : (bookId ?? filename ?? null),
    isExternalMode ? null : currentChapter,
    isExternalMode ? null : resolveEventIdxOrFallback(currentEvent, null),
  );

  const elements = externalElements || internalElements;

  const handleSearchStateChange = useCallback((searchState) => {
    if (onSearchStateChange) {
      onSearchStateChange({ ...searchState, currentChapterData });
    }
  }, [onSearchStateChange, currentChapterData]);

  const {
    searchTerm: internalSearchTerm,
    isSearchActive: internalIsSearchActive,
    filteredElements: internalFilteredElements,
    fitNodeIds: internalFitNodeIds,
    isResetFromSearch: internalIsResetFromSearch,
    handleSearchSubmit,
    clearSearch,
  } = useGraphSearch(
    isExternalMode ? [] : (elements || []),
    handleSearchStateChange,
    currentChapterData,
  );

  const effectiveSearchTerm = externalSearchTerm ?? internalSearchTerm;
  const effectiveIsSearchActive = externalIsSearchActive ?? internalIsSearchActive;
  const effectiveFilteredElements = externalFilteredElements ?? internalFilteredElements;
  const effectiveIsResetFromSearch = externalIsResetFromSearch ?? internalIsResetFromSearch;

  const effectiveFitNodeIds = useMemo(() => {
    if (Array.isArray(externalFitNodeIds)) return externalFitNodeIds;
    if (Array.isArray(internalFitNodeIds) && internalFitNodeIds.length > 0) return internalFitNodeIds;
    if (effectiveIsSearchActive && Array.isArray(effectiveFilteredElements) && effectiveFilteredElements.length > 0) {
      const ids = eventUtils.filterNodes(effectiveFilteredElements)
        .map((el) => el.data.id)
        .filter((id) => id != null);
      return Array.from(new Set(ids));
    }
    return [];
  }, [externalFitNodeIds, internalFitNodeIds, effectiveIsSearchActive, effectiveFilteredElements]);

  const finalElements = useMemo(() => {
    if (isExternalMode) {
      return elements;
    }
    if (effectiveIsSearchActive && effectiveFilteredElements?.length > 0) {
      return effectiveFilteredElements;
    }
    return elements;
  }, [isExternalMode, effectiveIsSearchActive, effectiveFilteredElements, elements]);

  useImperativeHandle(ref, () => ({
    handleSearchSubmit: isExternalMode ? () => {} : handleSearchSubmit,
    clearSearch: isExternalMode ? () => {} : clearSearch,
  }), [isExternalMode, handleSearchSubmit, clearSearch]);

  return (
    <MemoViewerRelationGraph
      elements={finalElements}
      newNodeIds={newNodeIds}
      chapterNum={currentChapter}
      eventNum={resolveEventOrdinalForDisplay({
        currentEvent,
        prevValidEvent,
        progressTopBar: null,
        fallback: 0,
      })}
      edgeLabelVisible={edgeLabelVisible}
      filename={filename}
      bookId={bookId}
      fitNodeIds={effectiveFitNodeIds}
      searchTerm={effectiveSearchTerm}
      isSearchActive={effectiveIsSearchActive}
      filteredElements={effectiveFilteredElements}
      isResetFromSearch={effectiveIsResetFromSearch}
      currentEvent={currentEvent}
      prevValidEvent={prevValidEvent}
      events={events}
      activeTooltip={activeTooltip}
      onClearTooltip={onClearTooltip}
      onSetActiveTooltip={onSetActiveTooltip}
      graphClearRef={graphClearRef}
      isEventTransition={isEventTransition}
    />
  );
});

GraphContainer.displayName = 'GraphContainer';

export default GraphContainer;
