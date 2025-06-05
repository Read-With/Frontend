import React, { useEffect, useRef, useState } from "react";
import cytoscape from "cytoscape";
import "./RelationGraph.css";
import { createPortal } from 'react-dom';

const CytoscapeGraphDirect = (props) => {
  const {
    elements,
    stylesheet,
    layout,
    tapNodeHandler,
    tapEdgeHandler,
    tapBackgroundHandler,
    fitNodeIds,
    style = {},
    cyRef: externalCyRef,
    newNodeIds = [],
    graphDiff = { added: [], removed: [], updated: [] },
    prevElements = [],
    currentElements = [],
    chapterNum,
    eventNum,
    diffNodes,
  } = props;
  const containerRef = useRef(null);
  const cyRef = useRef(null);
  const [ripples, setRipples] = useState([]);
  const [highlightRipples, setHighlightRipples] = useState([]);
  const [isUpdating, setIsUpdating] = useState(false);
  const prevElementsRef = useRef([]);
  const updateTimeoutRef = useRef(null);
  const isInitialized = useRef(false);
  const prevNewNodeIdsRef = useRef([]);
  const prevBlinkNodeIdsRef = useRef([]);
  const lastChapterNumRef = useRef(chapterNum);
  const [rippleLayer, setRippleLayer] = useState(null);

  // 마운트/언마운트 시점 로그 및 DOM/스타일 점검
  useEffect(() => {
    setTimeout(() => {
      const div = containerRef.current;
      if (div) {
        const canvas = div.querySelector('canvas');
        if (canvas) {
        } else {
        }
      }
    }, 500);
    return () => {
    };
  }, [containerRef]);

  // elements의 id 배열이 바뀔 때마다 로그
  useEffect(() => {
    const prevIds = new Set(prevElementsRef.current.map(e => String(e.data && e.data.id)));
    const currIds = new Set(elements.map(e => String(e.data && e.data.id)));

    const actuallyAdded = [...currIds].filter(id => !prevIds.has(id));
    const actuallyRemoved = [...prevIds].filter(id => !currIds.has(id));

  }, [elements]);

  // elements, stylesheet 실제 값 출력
  useEffect(() => {
    console.log('[디버깅] stylesheet:', stylesheet);
  }, [elements, stylesheet]);

  // Cytoscape 인스턴스 초기화 (chapterNum이 바뀔 때만)
  useEffect(() => {
    if (cyRef.current) {
      cyRef.current.destroy();
      cyRef.current = null;
    }
    if (containerRef.current) {
      cyRef.current = cytoscape({
        container: containerRef.current,
        elements,
        style: stylesheet,
        layout,
      });
      cyRef.current.layout(layout).run();
      // 필요시 외부 ref 연결
      if (externalCyRef && typeof externalCyRef === 'object') {
        externalCyRef.current = cyRef.current;
      }
      // 이벤트 핸들러 등록
      if (tapNodeHandler) {
        cyRef.current.on("tap", "node", tapNodeHandler);
      }
      if (tapEdgeHandler) {
        cyRef.current.on("tap", "edge", tapEdgeHandler);
      }
      if (tapBackgroundHandler) {
        cyRef.current.on("tap", tapBackgroundHandler);
      }
      isInitialized.current = true;
    }
    lastChapterNumRef.current = chapterNum;
    return () => {
      // 언마운트 시 destroy
      if (cyRef.current) {
        cyRef.current.removeAllListeners();
        cyRef.current.destroy();
        cyRef.current = null;
      }
      if (updateTimeoutRef.current) {
        clearTimeout(updateTimeoutRef.current);
      }
    };
  }, [containerRef, chapterNum]);

  // eventNum이 바뀔 때마다 prevBlinkNodeIdsRef 초기화
  useEffect(() => {
    prevBlinkNodeIdsRef.current = [];
  }, [eventNum]);

  // diffNodes(이번 이벤트에서 새로 등장한 노드)에만 깜빡임 효과 적용 (중복 방지)
  useEffect(() => {
    if (!cyRef.current || !diffNodes) return;

    // 이전에 이미 효과를 준 노드 id와 비교
    const prevIds = prevBlinkNodeIdsRef.current;
    const newIds = diffNodes
      .map(node => node.data && node.data.id)
      .filter(id => id && !prevIds.includes(id));

    if (newIds.length === 0) return;

    newIds.forEach(id => {
      const ele = cyRef.current.getElementById(String(id));
      if (ele && ele.length > 0) {
        ele.addClass('blink');
        setTimeout(() => {
          ele.removeClass('blink');
        }, 1000);
      }
    });

    // 이번에 효과를 준 id를 저장
    prevBlinkNodeIdsRef.current = [
      ...prevBlinkNodeIdsRef.current,
      ...newIds
    ];
  }, [diffNodes, eventNum]);

  // 1. graphDiff가 바뀔 때마다 ripple 효과 적용 (진짜 추가된 노드에 먼저 적용)
  useEffect(() => {
    if (!cyRef.current) return;
    const cy = cyRef.current;
    const rippleNodeIds = new Set();

    // graphDiff.added가 객체 배열인지 id 배열인지 구분
    if (graphDiff.added && graphDiff.added.length > 0) {
      if (typeof graphDiff.added[0] === 'string' || typeof graphDiff.added[0] === 'number') {
        // id 배열이면 그대로
        graphDiff.added.forEach(id => {
          rippleNodeIds.add(String(id).trim());
        });
      } else if (graphDiff.added[0] && graphDiff.added[0].data) {
        // 객체 배열이면 기존 방식
        graphDiff.added.forEach(el => {
          if (el.data && !el.data.source && !el.data.target) {
            rippleNodeIds.add(String(el.data.id).trim());
          }
        });
      }
    }

    // diffNodes도 id 배열로 처리
    if (diffNodes && diffNodes.length > 0) {
      diffNodes.forEach(id => {
        rippleNodeIds.add(String(id).trim());
      });
    }

    if (rippleNodeIds.size > 0) {
      cy.nodes().forEach(node => {
        const nodeId = String(node.id()).trim();
        if (rippleNodeIds.has(nodeId)) {
          node.addClass('blink');
          setTimeout(() => {
            node.removeClass('blink');
          }, 1000);
        }
      });
    }
  }, [graphDiff, diffNodes, elements]);

  // elements가 바뀔 때마다 Cytoscape에 diff만 반영
  useEffect(() => {
    const cy = cyRef.current;
    if (!cy || !elements) return;

    // 최초 1회만 전체 add/remove/layout/fit 실행 (그래프는 반드시 그림)
    if (prevElementsRef.current.length === 0) {
      cy.elements().remove();
      cy.add(elements);
      cy.layout({ name: 'preset' }).run();
      cy.fit();
      prevElementsRef.current = [...elements];
      // ripple 효과는 무시하고 return
      return;
    }

    // === [진짜 추가된 노드에만 ripple 효과] ===
    const rippleNodeIds = new Set();
    // 추가된 노드
    if (graphDiff.added && graphDiff.added.length > 0) {
      graphDiff.added.forEach(el => {
        if (el.data && !el.data.source && !el.data.target) {
          rippleNodeIds.add(String(el.data.id).trim());
        }
      });
    } else {
      console.log('🤍 [ripple] graphDiff.added 비어있음');
    }
    // ripple 효과 적용 (중복 없이)
    rippleNodeIds.forEach(nodeId => {
      let pos = null;
      const node = cy.getElementById(nodeId);
      if (node && node.length > 0) {
        pos = node.renderedPosition();
      }
      if (pos) {
        const key = Date.now() + Math.random();
        setHighlightRipples(prev => {
          const next = [...prev, { x: pos.x, y: pos.y, key, color: '#2563eb' }];
          return next;
        });
        setTimeout(() => {
          setHighlightRipples(prev => {
            const next = prev.filter(r => r.key !== key);
            return next;
          });
        }, 800);
      }
    });

    // rippleLayer, ripple span, CSS 상태를 한 번에 출력
    setTimeout(() => {
      const rippleLayer = document.querySelector('.cy-ripple-layer');
      const rippleSpans = rippleLayer ? rippleLayer.querySelectorAll('.node-highlight-effect') : [];
      if (rippleSpans.length > 0) {
        const style = window.getComputedStyle(rippleSpans[0]);
      } else {
        console.log('🩷 [ripple] .node-highlight-effect CSS: 없음');
      }
    }, 100);

    // 실제 노드/엣지 추가/삭제만 반영 (애니메이션 없음)
    if (graphDiff.added && graphDiff.added.length > 0) {
      cy.add(graphDiff.added);
    }
    if (graphDiff.removed && graphDiff.removed.length > 0) {
      graphDiff.removed.forEach(e => {
        const ele = cy.getElementById(e.data.id);
        if (ele && ele.length > 0) {
          cy.remove(ele);
        }
      });
    }
    // 데이터만 바뀐 경우 갱신
    elements.forEach(el => {
      const ele = cy.getElementById(el.data.id);
      if (ele && ele.length > 0 && JSON.stringify(ele.data()) !== JSON.stringify(el.data)) {
        ele.data(el.data);
        if (el.position) ele.position(el.position);
      }
    });
    prevElementsRef.current = [...elements];
  }, [elements, graphDiff]);

  // [추가] newNodeIds가 바뀔 때마다 이전 newNodeIds와 비교해서, 이번에만 새로 등장한 노드에만 blink 효과 부여
  useEffect(() => {
    if (!cyRef.current || !newNodeIds) return;
    const prevSet = new Set(prevNewNodeIdsRef.current);
    const onlyNew = newNodeIds.filter(id => !prevSet.has(id));
    onlyNew.forEach(id => {
      const node = cyRef.current.getElementById(String(id));
      if (node && node.length > 0) {
        node.addClass('blink');
        setTimeout(() => node.removeClass('blink'), 700);
      }
    });
    prevNewNodeIdsRef.current = newNodeIds;
  }, [newNodeIds]);

  // 크기 반응형
  useEffect(() => {
    const handleResize = () => {
      if (cyRef.current) {
        requestAnimationFrame(() => {
          cyRef.current.resize();
        });
      }
    };
    window.addEventListener("resize", handleResize);
    return () => window.removeEventListener("resize", handleResize);
  }, []);

  // 그래프 영역 클릭 시 ripple 효과
  const handleRipple = (e) => {
    if (!containerRef.current) return;
    const rect = containerRef.current.getBoundingClientRect();
    const x = e.clientX - rect.left;
    const y = e.clientY - rect.top;
    const key = Date.now() + Math.random();
    setRipples((prev) => [...prev, { x, y, key }]);
    setTimeout(() => {
      setRipples((prev) => prev.filter(r => r.key !== key));
    }, 700);
  };

  useEffect(() => {
    if (cyRef.current) {
      window.cy = cyRef.current;
    }
  }, [cyRef.current]);

  // Cytoscape 내부 캔버스 구조 파악 및 rippleLayer 생성
  useEffect(() => {
    if (!containerRef.current) return;
    // Cytoscape가 내부적으로 생성하는 canvas들을 찾음
    const canvases = containerRef.current.querySelectorAll('canvas');
    if (canvases.length >= 2) {
      // 두 번째(노드) 캔버스 바로 아래에 ripple layer div를 삽입
      let rippleDiv = containerRef.current.querySelector('.cy-ripple-layer');
      if (!rippleDiv) {
        rippleDiv = document.createElement('div');
        rippleDiv.className = 'cy-ripple-layer';
        rippleDiv.style.position = 'absolute';
        rippleDiv.style.left = '0';
        rippleDiv.style.top = '0';
        rippleDiv.style.width = '100%';
        rippleDiv.style.height = '100%';
        rippleDiv.style.pointerEvents = 'none';
        rippleDiv.style.zIndex = 2; // 엣지(1) < ripple(2) < 노드(3)
        canvases[1].insertAdjacentElement('beforebegin', rippleDiv);
      }
      setRippleLayer(rippleDiv);
    }
  }, [containerRef]);

  // rippleLayer에 ripple span을 직접 렌더
  useEffect(() => {
    if (!rippleLayer) {
      return;
    }
    // 기존 ripple 모두 제거
    rippleLayer.innerHTML = '';
    highlightRipples.forEach(ripple => {
      const span = document.createElement('span');
      span.className = 'node-highlight-effect';
      span.style.position = 'absolute';
      span.style.left = (ripple.x - 45) + 'px';
      span.style.top = (ripple.y - 45) + 'px';
      span.style.width = '90px';
      span.style.height = '90px';
      span.style.background = ripple.color || '#2563eb';
      span.style.boxShadow = `0 0 24px 8px ${(ripple.color || '#2563eb')}55`;
      span.style.opacity = 0.35;
      span.style.borderRadius = '50%';
      span.style.pointerEvents = 'none';
      span.style.zIndex = 2;
      span.style.animation = 'ripple-appear 0.8s ease-out';
      rippleLayer.appendChild(span);
    });
    if (rippleLayer.children.length > 0) {
      const style = window.getComputedStyle(rippleLayer.children[0]);
    }
  }, [highlightRipples, rippleLayer]);

  useEffect(() => {
    if (cyRef.current) {
      cyRef.current.nodes().forEach(node => {
        console.log('💙 [ripple] node.id():', node.id());
      });
    }
  }, [graphDiff, rippleLayer, highlightRipples]);

  useEffect(() => {
    if (!cyRef.current || !diffNodes || diffNodes.length === 0) return;
    const cy = cyRef.current;

    diffNodes.forEach(nodeObj => {
      const nodeId = String(nodeObj.data.id);
      const node = cy.getElementById(nodeId);
      if (node && node.length > 0) {
        const pos = node.renderedPosition();
        if (pos) {
          const key = Date.now() + Math.random();
          setHighlightRipples(prev => [
            ...prev,
            { x: pos.x, y: pos.y, key, color: '#2563eb' }
          ]);
          setTimeout(() => {
            setHighlightRipples(prev => prev.filter(r => r.key !== key));
          }, 800);
        }
      }
    });
  }, [diffNodes]);

  // elements나 layout이 바뀔 때마다 기존 엘리먼트 모두 삭제 후 새로 추가, 그리고 layout 강제 재적용
  useEffect(() => {
    if (cyRef.current) {
      try {
        cyRef.current.elements().remove();
        cyRef.current.add(elements);
        cyRef.current.layout(layout).run();
      } catch (e) {
        console.warn('강제 레이아웃 재적용 중 오류:', e);
      }
    }
  }, [elements, layout]);

  // 스타일과 레이아웃을 항상 강제로 재적용 (최대한 단순하게)
  useEffect(() => {
    if (cyRef.current) {
      try {
        cyRef.current.style(stylesheet).update();
        cyRef.current.layout(layout).run();
      } catch (e) {
        console.warn('스타일/레이아웃 강제 재적용 오류:', e);
      }
    }
  }, [stylesheet, layout]);

  return (
    <div
      ref={containerRef}
      className="graph-canvas-area"
      style={{ position: 'relative', width: '100%', height: '100%', minWidth: 0, minHeight: 0, ...style }}
      onClick={handleRipple}
    >
      {/* 클릭 ripple 효과 등은 필요시 이 wrapper에 렌더 */}
      {ripples.map(ripple => (
        <span
          key={ripple.key}
          className="cytoscape-ripple"
          style={{
            left: ripple.x - 80,
            top: ripple.y - 80,
            width: 160,
            height: 160,
          }}
        />
      ))}
    </div>
  );
};

export default React.memo(CytoscapeGraphDirect); 