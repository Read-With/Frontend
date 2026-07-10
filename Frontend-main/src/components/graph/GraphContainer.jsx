import React, {
  useRef,
  useMemo,
  useEffect,
  useCallback,
} from 'react';
import CytoscapeGraphUnified from './CytoscapeGraphUnified';
import UnifiedNodeInfo from './tooltip/UnifiedNodeInfo';
import UnifiedEdgeTooltip from './tooltip/UnifiedEdgeTooltip';
import './RelationGraph.css';
import { getEdgeStyle, createGraphStylesheet } from '../../utils/styles/graphStyles';
import { graphStyles } from '../../utils/styles/styles';
import { ensureElementsInBounds, buildTooltipPayload, processTooltipData, createTooltipTapHandlers } from '../../utils/graph/graphUtils';
import {
  useGraphOutsideDismiss,
  shouldIgnoreViewerOutsideClick,
} from '../../hooks/graph/useGraphOutsideDismiss';
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

const ViewerRelationGraph = ({
  elements,
  chapterNum,
  eventNum,
  edgeLabelVisible = true,
  filename,
  fitNodeIds,
  searchTerm,
  isSearchActive,
  filteredElements,
  isResetFromSearch,
  currentEvent = null,
  prevValidEvent = null,
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

  const clearTooltipAndGraph = useCallback(() => {
    onClearTooltip?.();
    graphClearRef?.current?.();
  }, [onClearTooltip, graphClearRef]);

  const handleTooltipTap = useCallback((tapPayload, type) => {
    if (!onSetActiveTooltip) return;
    onSetActiveTooltip(processTooltipData(buildTooltipPayload(tapPayload, type), type));
  }, [onSetActiveTooltip]);

  const { onShowNodeTooltip, onShowEdgeTooltip } = useMemo(
    () => createTooltipTapHandlers(handleTooltipTap),
    [handleTooltipTap],
  );

  const shouldIgnoreOutsideClick = useCallback(
    (event) => shouldIgnoreViewerOutsideClick(event, containerRef),
    [containerRef],
  );

  useGraphOutsideDismiss({
    enabled: !!activeTooltip,
    onDismiss: clearTooltipAndGraph,
    shouldIgnoreClick: shouldIgnoreOutsideClick,
    attachDelayMs: 20,
  });

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
            onClose={clearTooltipAndGraph}
            chapterNum={chapterNum}
            eventNum={eventNum}
            filename={filename}
            elements={elements}
            currentEvent={currentEvent}
            prevValidEvent={prevValidEvent}
          />
        )}
        {activeTooltip?.type === 'edge' && (
          <UnifiedEdgeTooltip
            key={`edge-tooltip-${activeTooltip.id}`}
            data={activeTooltip.data}
            x={activeTooltip.x}
            y={activeTooltip.y}
            onClose={clearTooltipAndGraph}
            mode="viewer"
            chapterNum={chapterNum}
            eventNum={eventNum}
            style={graphStyles.tooltipStyle}
            currentEvent={currentEvent}
            prevValidEvent={prevValidEvent}
            bookId={bookId}
          />
        )}
      </div>

      <div className="graph-canvas-area" style={graphStyles.graphArea}>
        <CytoscapeGraphUnified
          elements={elements}
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
          onClearTooltip={onClearTooltip}
          selectedNodeIdRef={selectedNodeIdRef}
          selectedEdgeIdRef={selectedEdgeIdRef}
          graphClearRef={graphClearRef}
          strictBackgroundClear={true}
          showRippleEffect={true}
        />
      </div>
    </div>
  );
};

const MemoViewerRelationGraph = React.memo(ViewerRelationGraph);

function GraphContainer({
  currentEvent,
  currentChapter,
  edgeLabelVisible = true,
  filename,
  elements = [],
  prevValidEvent = null,
  activeTooltip = null,
  onClearTooltip = null,
  onSetActiveTooltip = null,
  graphClearRef = null,
  isEventTransition = false,
  searchTerm = '',
  isSearchActive = false,
  filteredElements = [],
  fitNodeIds = [],
  isResetFromSearch = false,
  bookId = null,
}) {
  return (
    <MemoViewerRelationGraph
      elements={elements}
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
      fitNodeIds={fitNodeIds}
      searchTerm={searchTerm}
      isSearchActive={isSearchActive}
      filteredElements={filteredElements}
      isResetFromSearch={isResetFromSearch}
      currentEvent={currentEvent}
      prevValidEvent={prevValidEvent}
      activeTooltip={activeTooltip}
      onClearTooltip={onClearTooltip}
      onSetActiveTooltip={onSetActiveTooltip}
      graphClearRef={graphClearRef}
      isEventTransition={isEventTransition}
    />
  );
}

export default GraphContainer;
