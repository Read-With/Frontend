// EpubViewerWrapper.jsx
import React from "react";
import { useParams } from "react-router-dom";
import EpubViewer from "./EpubViewer";

const EpubViewerWrapper = () => {
  const { filename } = useParams();

  // 상위 컨테이너에 flex 적용 확인
  return (
    <div
      style={{
        flex: 1,
        height: "100vh",
        borderRight: "1px solid #e7eaf7",
        minWidth: 0, // 오버플로우 방지
        position: "relative", // EPUB 뷰어 위치 기준
      }}
    >
      <EpubViewer
        book={{
          path: `/${filename}`,
          title: filename,
        }}
      />
    </div>
  );
};

export default EpubViewerWrapper;
