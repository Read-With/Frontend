import React, { memo, useMemo } from 'react';
import PropTypes from 'prop-types';
import { COLORS } from '../../utils/styles/styles.js';

const GraphInfoBar = memo(function GraphInfoBar({
  isApiBook,
  apiFineData,
  currentChapter,
  currentEvent,
  userCurrentChapter,
  nodeCount,
  relationCount,
  filterStage,
}) {
  const hasEvent = !!apiFineData?.event;

  const graphTypeLabel = useMemo(() => {
    if (!isApiBook) return '로컬 그래프';
    return hasEvent ? '세밀 그래프' : '거시 그래프';
  }, [isApiBook, hasEvent]);

  const chapterRangeLabel = useMemo(() => {
    if (!isApiBook) {
      return `Chapter 1 ~ ${currentChapter} 누적`;
    }
    return hasEvent
      ? `Chapter ${currentChapter}, Event ${currentEvent}`
      : `Chapter 1 ~ ${currentChapter} 누적`;
  }, [isApiBook, hasEvent, currentChapter, currentEvent]);

  return (
    <div
      role="region"
      aria-label="그래프 정보"
      style={{
        background: COLORS.background,
        borderBottom: `1px solid ${COLORS.border}`,
        padding: '12px 20px',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'space-between',
        boxShadow: '0 1px 3px rgba(0,0,0,0.05)',
      }}
    >
      <div
        style={{
          display: 'flex',
          alignItems: 'center',
          gap: '12px',
        }}
      >
        <h2
          style={{
            margin: 0,
            fontSize: '16px',
            fontWeight: '600',
            color: COLORS.textPrimary,
          }}
        >
          {graphTypeLabel}
        </h2>
        <div
          style={{
            background: COLORS.backgroundLight,
            padding: '4px 12px',
            borderRadius: '16px',
            fontSize: '12px',
            color: COLORS.textSecondary,
            fontWeight: '500',
          }}
        >
          {chapterRangeLabel}
        </div>
        {isApiBook && userCurrentChapter !== null && (
          <div
            style={{
              background: COLORS.primary + '20',
              padding: '4px 12px',
              borderRadius: '16px',
              fontSize: '11px',
              color: COLORS.primary,
              fontWeight: '600',
            }}
          >
            독서 진행: Chapter {userCurrentChapter}
          </div>
        )}
      </div>
      <div
        style={{
          display: 'flex',
          alignItems: 'center',
          gap: '8px',
          fontSize: '12px',
          color: COLORS.textSecondary,
          fontWeight: '500',
        }}
      >
        <span>
          {filterStage > 0 ? `${nodeCount}명 (필터링됨)` : `${nodeCount}명`}
        </span>
        <span>•</span>
        <span>
          {filterStage > 0 ? `${relationCount}관계 (필터링됨)` : `${relationCount}관계`}
        </span>
        {isApiBook && (
          <>
            <span>•</span>
            <span
              style={{
                color: COLORS.primary,
                fontWeight: '600',
              }}
            >
              API
            </span>
          </>
        )}
        {!isApiBook && (
          <>
            <span>•</span>
            <span
              style={{
                color: COLORS.textSecondary,
                fontWeight: '600',
              }}
            >
              로컬
            </span>
          </>
        )}
      </div>
    </div>
  );
}, (prevProps, nextProps) => {
  if (prevProps.isApiBook !== nextProps.isApiBook) return false;
  if (prevProps.currentChapter !== nextProps.currentChapter) return false;
  if (prevProps.currentEvent !== nextProps.currentEvent) return false;
  if (prevProps.userCurrentChapter !== nextProps.userCurrentChapter) return false;
  if (prevProps.nodeCount !== nextProps.nodeCount) return false;
  if (prevProps.relationCount !== nextProps.relationCount) return false;
  if (prevProps.filterStage !== nextProps.filterStage) return false;
  if (!!prevProps.apiFineData?.event !== !!nextProps.apiFineData?.event) return false;
  return true;
});

GraphInfoBar.propTypes = {
  isApiBook: PropTypes.bool.isRequired,
  apiFineData: PropTypes.shape({
    event: PropTypes.object,
  }),
  currentChapter: PropTypes.number.isRequired,
  currentEvent: PropTypes.number.isRequired,
  userCurrentChapter: PropTypes.number,
  nodeCount: PropTypes.number.isRequired,
  relationCount: PropTypes.number.isRequired,
  filterStage: PropTypes.number.isRequired,
};

export default GraphInfoBar;
