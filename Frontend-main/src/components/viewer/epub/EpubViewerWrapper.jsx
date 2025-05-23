import React from "react";
import { useParams } from "react-router-dom";
import EpubViewer from "./EpubViewer"; 

const EpubViewerWrapper = () => {
  const { filename } = useParams();

  // filename만 있을 때
  const book = {
    path: "/" + filename,   // public 폴더 기준 epub 파일 경로
    title: filename,        // 필요시 제목 대신 파일명 사용
  };

  return <EpubViewer book={book} />;
};

export default EpubViewerWrapper;
