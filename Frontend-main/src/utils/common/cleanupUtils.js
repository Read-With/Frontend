import { clearStyleCache, cleanupRelationStyleResources } from '../styles/relationStyles';
import { clearRelationCache, cleanupRelationResources } from '../graph/relationUtils';

export function cleanupRelationUtils() {
  try {
    clearRelationCache();
    clearStyleCache();
    cleanupRelationResources();
    cleanupRelationStyleResources();
  } catch (error) {
    console.error('관계 유틸리티 정리 실패:', error);
  }
}
