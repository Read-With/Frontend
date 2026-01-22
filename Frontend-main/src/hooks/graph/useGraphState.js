import { useState, useCallback } from 'react';

export function useGraphState() {
  const [isSidebarOpen, setIsSidebarOpen] = useState(true);
  const [edgeLabelVisible, setEdgeLabelVisible] = useState(true);
  const [activeTooltip, setActiveTooltip] = useState(null);
  const [isSidebarClosing, setIsSidebarClosing] = useState(false);
  const [forceClose, setForceClose] = useState(false);
  const [filterStage, setFilterStage] = useState(0);
  const [isDropdownSelection, setIsDropdownSelection] = useState(false);

  const toggleSidebar = useCallback(() => {
    setIsSidebarOpen((prev) => !prev);
  }, []);

  const toggleEdgeLabel = useCallback(() => {
    setEdgeLabelVisible((prev) => !prev);
  }, []);

  const clearTooltip = useCallback(() => {
    setForceClose(true);
  }, []);

  const startClosing = useCallback(() => {
    setIsSidebarClosing(true);
  }, []);

  const closeSidebar = useCallback(() => {
    setActiveTooltip(null);
    setForceClose(false);
    setIsSidebarClosing(false);
  }, []);

  const setDropdownSelection = useCallback((value) => {
    setIsDropdownSelection(value);
  }, []);

  return {
    isSidebarOpen,
    edgeLabelVisible,
    activeTooltip,
    isSidebarClosing,
    forceClose,
    filterStage,
    isDropdownSelection,
    setActiveTooltip,
    setIsSidebarClosing,
    setForceClose,
    setFilterStage,
    toggleSidebar,
    toggleEdgeLabel,
    clearTooltip,
    startClosing,
    closeSidebar,
    setDropdownSelection,
  };
}
