import React, { useState, useCallback, createContext } from "react";
import CytoscapeGraphDirect from "./CytoscapeGraphDirect";
// import { createPortal } from "react-dom";

export const CytoscapeGraphContext = createContext();

export default function CytoscapeGraphPortalProvider({ children }) {
  const [graphProps, setGraphProps] = useState({
    elements: [],
    stylesheet: [],
    layout: { name: "preset" },
    tapNodeHandler: undefined,
    tapEdgeHandler: undefined,
    tapBackgroundHandler: undefined,
    fitNodeIds: undefined,
    style: {},
    newNodeIds: [],
  });

  // 외부에서 데이터만 바꿀 수 있도록 setter 제공
  const updateGraph = useCallback((newProps) => {
    setGraphProps((prev) => ({ ...prev, ...newProps }));
  }, []);

  return (
    <CytoscapeGraphContext.Provider value={{ graphProps, updateGraph }}>
      {children}
      <CytoscapeGraphDirect {...graphProps} />
    </CytoscapeGraphContext.Provider>
  );
} 