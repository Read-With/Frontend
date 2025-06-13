import React, { useState, useEffect, useRef } from "react";
import { useNavigate, useParams } from "react-router-dom";
import { FaFileAlt, FaComments, FaArrowLeft } from "react-icons/fa";
import "./RelationGraph.css";

function GraphNodeTooltip({
  data,
  x,
  y,
  nodeCenter,
  onClose,
  inViewer = false,
  style,
}) {
  const navigate = useNavigate();
  const { filename } = useParams();

  // 데이터가 중첩되어 있는 경우 처리
  const nodeData = data.data || data;
  console.log("NodeTooltip data structure:", {
    id: nodeData.id,
    label: nodeData.label,
    description: nodeData.description,
    main_character: nodeData.main_character,
    names: nodeData.names,
    portrait_prompt: nodeData.portrait_prompt,
  });

  console.log("NodeTooltip data structure:", data);

  const [position, setPosition] = useState({ x: 200, y: 200 });
  const [showContent, setShowContent] = useState(false);
  const [isDragging, setIsDragging] = useState(false);
  const [dragOffset, setDragOffset] = useState({ x: 0, y: 0 });
  const [isFlipped, setIsFlipped] = useState(false);
  const tooltipRef = useRef(null);
  const cardContainerRef = useRef(null);

  useEffect(() => {
    setShowContent(true);
  }, []);

  const handleMouseDown = (e) => {
    if (
      e.target.closest(".tooltip-close-btn") ||
      e.target.closest(".action-button")
    )
      return;
    setIsDragging(true);
    const rect = tooltipRef.current.getBoundingClientRect();
    setDragOffset({
      x: e.clientX - rect.left,
      y: e.clientY - rect.top,
    });
  };

  const handleMouseMove = (e) => {
    if (!isDragging) return;

    let newX = e.clientX - dragOffset.x;
    let newY = e.clientY - dragOffset.y;

    setPosition({ x: newX, y: newY });
  };

  const handleMouseUp = () => {
    setIsDragging(false);
  };

  useEffect(() => {
    if (isDragging) {
      window.addEventListener("mousemove", handleMouseMove);
      window.addEventListener("mouseup", handleMouseUp);
    }
    return () => {
      window.removeEventListener("mousemove", handleMouseMove);
      window.removeEventListener("mouseup", handleMouseUp);
    };
  }, [isDragging]);

  useEffect(() => {
    if (x !== undefined && y !== undefined && tooltipRef.current) {
      setPosition({ x, y });
    }
  }, [x, y]);

  const handleChatClick = () => {
    if (nodeData.label) {
      // 뷰어 내에서 사용하는 경우 현재 filename을 사용
      const bookFilename = filename || "unknown";
      navigate(`/user/character-chat/${bookFilename}/${nodeData.label}`, {
        state: {
          book: {
            title: bookFilename
              .replace(".epub", "")
              .replace(/([A-Z])/g, " $1")
              .trim(),
          },
        },
      });
    }
  };

  const handleSummaryClick = () => {
    setIsFlipped(!isFlipped);
  };

  // 요약 데이터 - 7줄 분량으로 설정
  const summaryData = {
    summary: nodeData.label
      ? `${nodeData.label}은(는) ${
          nodeData.description || "작품의 중요한 인물입니다."
        }\n\n` +
        `이 인물은 작품의 중심 서사를 이끌어가는 핵심적인 역할을 담당합니다.\n\n` +
        `주로 1장, 3장, 5장에서 중요한 장면에 등장하며, 작품의 주제를 표현합니다.\n\n` +
        `이 인물의 행동과 선택은 작품의 결말에 직접적인 영향을 미칩니다.`
      : "인물에 대한 요약 정보가 없습니다.",
  };

  // 뷰어 내에서 사용할 때는 z-index를 더 높게 설정
  const zIndexValue = inViewer ? 10000 : 9999;

  return (
    <div
      ref={tooltipRef}
      className={`graph-node-tooltip ${isFlipped ? "flipped" : ""}`}
      style={{
        position: "fixed",
        left: position.x,
        top: position.y,
        zIndex: zIndexValue,
        opacity: showContent ? 1 : 0,
        transition: isDragging ? "none" : "opacity 0.3s, transform 0.6s",
        cursor: isDragging ? "grabbing" : "grab",
        transform: isFlipped ? "rotateY(180deg)" : "rotateY(0deg)",
        transformStyle: "preserve-3d",
        width: 500,
        minHeight: 340,
        background: "#fff",
        borderRadius: 20,
        boxShadow:
          "0 8px 32px rgba(79,109,222,0.13), 0 1.5px 8px rgba(0,0,0,0.04)",
        padding: 0,
        border: "1.5px solid #e5e7eb",
        ...(style || {}),
      }}
      onMouseDown={handleMouseDown}
    >
      {/* 앞면 - 기본 정보 */}
      <div
        className="tooltip-content business-card tooltip-front"
        style={{
          backfaceVisibility: "hidden",
          position: isFlipped ? "absolute" : "relative",
          width: "100%",
          height: "100%",
          transform: isFlipped ? "rotateY(180deg)" : "rotateY(0deg)",
          display: "flex",
          flexDirection: "column",
          padding: 0,
        }}
      >
        <button
          onClick={onClose}
          className="tooltip-close-btn"
          style={{
            position: "absolute",
            top: 18,
            right: 18,
            fontSize: 22,
            color: "#bfc8e2",
            background: "none",
            border: "none",
            cursor: "pointer",
            zIndex: 2,
          }}
        >
          &times;
        </button>
        <div
          style={{
            display: "flex",
            flexDirection: "column",
            alignItems: "stretch",
            padding: "32px 0 0 0",
            borderTopLeftRadius: 20,
            borderTopRightRadius: 20,
            background: "linear-gradient(90deg, #e3eafe 0%, #f8fafc 100%)",
          }}
        >
          <div
            style={{
              display: "flex",
              flexDirection: "row",
              alignItems: "flex-start",
              justifyContent: "flex-start",
              gap: 24,
              width: "100%",
            }}
          >
            <div
              className="profile-image-placeholder"
              style={{
                width: 100,
                height: 100,
                borderRadius: "50%",
                background: "#e6e8f0",
                display: "flex",
                alignItems: "center",
                justifyContent: "center",
                marginBottom: 16,
                marginLeft: 24,
                boxShadow: "0 2px 8px rgba(108,142,255,0.10)",
              }}
            >
              {nodeData.img ? (
                <img
                  src={nodeData.img}
                  alt={nodeData.common_name || nodeData.label}
                  className="profile-img"
                  style={{
                    width: 100,
                    height: 100,
                    borderRadius: "50%",
                    objectFit: "cover",
                  }}
                />
              ) : (
                <span style={{ fontSize: 48, color: "#888" }}>👤</span>
              )}
            </div>
            <div
              style={{
                display: "flex",
                flexDirection: "column",
                alignItems: "flex-start",
                justifyContent: "center",
                minWidth: 0,
              }}
            >
              <div
                style={{
                  display: "flex",
                  alignItems: "center",
                  gap: 10,
                  marginBottom: 4,
                }}
              >
                <span
                  style={{
                    fontWeight: 800,
                    fontSize: 24,
                    color: "#22336b",
                    letterSpacing: 0.5,
                    maxWidth: 220,
                    overflow: "hidden",
                    textOverflow: "ellipsis",
                    whiteSpace: "nowrap",
                  }}
                >
                  {nodeData.common_name || nodeData.label}
                </span>
                {nodeData.main_character && (
                  <span
                    style={{
                      background:
                        "linear-gradient(90deg, #4F6DDE 0%, #6fa7ff 100%)",
                      color: "#fff",
                      borderRadius: 14,
                      fontSize: 13,
                      padding: "3px 12px",
                      marginLeft: 2,
                      fontWeight: 700,
                      boxShadow: "0 2px 8px rgba(79,109,222,0.13)",
                    }}
                  >
                    주요 인물
                  </span>
                )}
              </div>
              {nodeData.names && nodeData.names.length > 0 && (
                <div
                  style={{
                    marginTop: 2,
                    marginBottom: 2,
                    display: "flex",
                    gap: 6,
                    flexWrap: "wrap",
                    justifyContent: "flex-start",
                  }}
                >
                  {nodeData.names.map((name, i) => (
                    <span
                      key={i}
                      style={{
                        background: "#f3f4f6",
                        color: "#4b5563",
                        borderRadius: 12,
                        fontSize: 13,
                        padding: "3px 12px",
                        border: "1px solid #e5e7eb",
                        fontWeight: 500,
                      }}
                    >
                      {name}
                    </span>
                  ))}
                </div>
              )}
            </div>
          </div>
        </div>
        <hr
          style={{
            margin: "18px 0 0 0",
            border: 0,
            borderTop: "1.5px solid #f0f2f8",
          }}
        />
        <div
          className="business-card-description"
          style={{
            color: "#333",
            fontSize: 16,
            minHeight: 56,
            margin: "22px 32px 0 32px",
            textAlign: "left",
            lineHeight: 1.6,
            fontWeight: 400,
          }}
        >
          {nodeData.description && nodeData.description.trim() ? (
            nodeData.description
          ) : (
            <span style={{ color: "#bbb" }}>설명 정보가 없습니다.</span>
          )}
        </div>
        <hr
          style={{
            margin: "18px 0 0 0",
            border: 0,
            borderTop: "1.5px solid #f0f2f8",
          }}
        />
        <div style={{ flex: 1, marginBottom: 20 }} />
      </div>

      {/* 뒷면 - 요약 정보 */}
      {/* <div 
        className="tooltip-content business-card tooltip-back"
        style={{
          backfaceVisibility: 'hidden',
          position: isFlipped ? 'relative' : 'absolute',
          width: '100%',
          height: '100%',
          transform: 'rotateY(180deg)'
        }}
      >
        <button onClick={onClose} className="tooltip-close-btn">&times;</button>
        
        <div className="business-card-header">
          <div className="profile-image-placeholder">
            {nodeData.img ? (
              <img src={nodeData.img} alt={nodeData.label} className="profile-img" />
            ) : (
              <span>👤</span>
            )}
          </div>
          <div className="business-card-title">
            <h3>
              {nodeData.label} <span className="summary-badge">요약</span>
            </h3>
          </div>
        </div>

        <div className="business-card-body">
          <div className="info-section" style={{ flex: 1 }}>
            <i className="info-icon description-icon">📄</i>
            <div className="info-content">
              <p className="summary-text">{summaryData.summary}</p>
            </div>
          </div>

          <div className="tooltip-actions">
            <button 
              className="action-button back-btn"
              onClick={handleSummaryClick}
            >
              <FaArrowLeft size={14} />
              돌아가기
            </button>
            <button 
              className="action-button chat-btn"
              onClick={handleChatClick}
              style={{ color: '#ffffff' }}
            >
              <FaComments size={14} />
              채팅하기
            </button>
          </div>
        </div>
      </div> */}
    </div>
  );
}

export default GraphNodeTooltip;
