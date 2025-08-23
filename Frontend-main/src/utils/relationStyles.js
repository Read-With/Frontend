/**
 * positivity 값에 따른 색상과 텍스트를 결정하는 함수
 * @param {number} positivity - -1~1 사이의 긍정도 값
 * @returns {object} color와 text를 포함한 객체
 */
export function getRelationStyle(positivity) {
  // 색상: RelationGraphMain.jsx 방식(HSL 그라데이션)
  const h = (120 * (positivity + 1)) / 2; // -1~1 → 0~120
  const color = `hsl(${h}, 70%, 45%)`;
  
  // 텍스트 분류는 기존 방식 유지
  if (positivity > 0.6) return { color, text: "긍정적" };
  if (positivity > 0.3) return { color, text: "우호적" };
  if (positivity > -0.3) return { color, text: "중립적" };
  if (positivity > -0.6) return { color, text: "비우호적" };
  return { color, text: "부정적" };
}

/**
 * 관계 라벨 배열을 생성하는 함수
 * @param {array|string} relation - 관계 데이터 (배열 또는 문자열)
 * @param {string} label - 백업용 라벨 문자열
 * @returns {array} 관계 라벨 배열
 */
export function getRelationLabels(relation, label) {
  return Array.isArray(relation)
    ? relation
    : (typeof label === 'string' ? label.split(',').map(s => s.trim()).filter(Boolean) : []);
}

/**
 * 툴팁 기본 스타일 설정
 */
export const tooltipStyles = {
  container: {
    position: "fixed",
    zIndex: 9999, // 기본값, 컴포넌트에서 오버라이드 가능
    width: "380px",
    perspective: '1200px',
  },
  flipInner: {
    position: 'relative',
    width: '100%',
    minHeight: 400,
    height: 'auto',
    transition: 'transform 0.6s cubic-bezier(0.4,0,0.2,1)',
    transformStyle: 'preserve-3d',
  },
  front: {
    backfaceVisibility: 'hidden',
    position: 'absolute',
    width: '100%',
    height: 'auto',
    minHeight: '100%',
    top: 0,
    left: 0,
  },
  back: {
    backfaceVisibility: 'hidden',
    transform: 'rotateY(180deg)',
    position: 'absolute',
    width: '100%',
    height: 'auto',
    minHeight: '100%',
    top: 0,
    left: 0,
  },
  header: {
    background: '#fff',
    borderBottom: 'none',
    padding: '20px',
  },
  relationTag: {
    background: '#e3e6ef',
    color: '#42506b',
    borderRadius: '8px',
    padding: '4px 12px',
    fontSize: '13px',
    fontWeight: 500,
    display: 'inline-block',
    lineHeight: 1.2,
  },
  progressBar: {
    width: 80,
    height: 24,
    borderRadius: 6,
    opacity: 1,
    transition: "background 0.3s",
    border: "1.5px solid #e5e7eb",
    boxSizing: "border-box",
    marginBottom: 0,
  },
  button: {
    primary: {
      background: '#2563eb',
      color: '#fff',
      border: 'none',
      borderRadius: 8,
      padding: '8px 22px',
      fontWeight: 600,
      fontSize: 15,
      cursor: 'pointer',
      boxShadow: '0 2px 8px rgba(79,109,222,0.13)',
      transition: 'background 0.18s, color 0.18s, box-shadow 0.18s, transform 0.13s',
      margin: '0 auto',
      display: 'inline-block',
    },
    secondary: {
      background: '#fff',
      color: '#2563eb',
      border: '1.5px solid #2563eb',
      borderRadius: 8,
      padding: '8px 22px',
      fontWeight: 600,
      fontSize: 15,
      cursor: 'pointer',
      boxShadow: '0 2px 8px rgba(79,109,222,0.13)',
      transition: 'background 0.18s, color 0.18s, box-shadow 0.18s, transform 0.13s',
      margin: '0 auto',
      display: 'inline-block',
    },
  },
};
