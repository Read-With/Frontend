import { describe, expect, it } from 'vitest';
import {
  eventUtils,
  graphDataTransformUtils,
  resolveFineGraphEventOrdinal,
  resolveViewerGraphTarget,
} from './viewerUtils';

describe('resolveViewerGraphTarget', () => {
  it('uses the visible event chapter and event for the graph target', () => {
    expect(resolveViewerGraphTarget({
      currentChapter: 2,
      currentEvent: { chapter: 1, eventNum: 12 },
      lastGood: { chapter: 2, eventNum: 1 },
    })).toEqual({ chapter: 1, eventIdx: 12 });
  });

  it('uses the next chapter first event once the visible event moves there', () => {
    expect(resolveViewerGraphTarget({
      currentChapter: 1,
      currentEvent: { chapter: 2, eventNum: 1 },
      lastGood: { chapter: 1, eventNum: 12 },
    })).toEqual({ chapter: 2, eventIdx: 1 });
  });

  it('falls back to the last good event only for the same current chapter', () => {
    expect(resolveViewerGraphTarget({
      currentChapter: 2,
      currentEvent: null,
      lastGood: { chapter: 2, eventNum: 3 },
    })).toEqual({ chapter: 2, eventIdx: 3 });

    expect(resolveViewerGraphTarget({
      currentChapter: 2,
      currentEvent: null,
      lastGood: { chapter: 1, eventNum: 12 },
    })).toEqual({ chapter: 2, eventIdx: 1 });
  });
});

describe('viewerUtils event ordinal helpers', () => {
  it('normalizes legacy event_id and idx fields', () => {
    expect(eventUtils.normalizeEventIdx({ event_id: 4 })).toBe(4);
    expect(eventUtils.normalizeEventIdx({ idx: 5 })).toBe(5);
    expect(eventUtils.normalizeEventIdx({ event: { event_id: 6 } })).toBe(6);
  });

  it('resolves fine graph event ordinals from numeric and string ids', () => {
    expect(resolveFineGraphEventOrdinal({ event_id: 7 })).toBe(7);
    expect(resolveFineGraphEventOrdinal({ eventId: 'chapter-2-event-8' })).toBe(8);
  });
});

describe('viewerUtils graph element helpers', () => {
  it('keeps previous graph elements when a later event adds new relations', () => {
    const previousElements = [
      { data: { id: '1', label: 'A' } },
      { data: { id: '2', label: 'B' } },
      { data: { id: '1->2', source: '1', target: '2', relation: ['ally'], positivity: 0.5 } },
    ];
    const currentElements = [
      { data: { id: '2', label: 'B' } },
      { data: { id: '3', label: 'C' } },
      { data: { id: '2->3', source: '2', target: '3', relation: ['meets'], positivity: 0.1 } },
    ];

    const merged = graphDataTransformUtils.mergeElementsWithPrevious(
      currentElements,
      { elements: previousElements, chapterIdx: 1, eventIdx: 1 },
      1,
      2
    );

    expect(merged.map((el) => el.data.id)).toEqual(['1', '2', '3', '1->2', '2->3']);
  });

  it('updates an existing edge while preserving its accumulated relation tags', () => {
    const previousElements = [
      { data: { id: '1', label: 'A' } },
      { data: { id: '2', label: 'B' } },
      { data: { id: '1->2', source: '1', target: '2', relation: ['ally'], positivity: 0.5 } },
    ];
    const currentElements = [
      { data: { id: '1', label: 'A' } },
      { data: { id: '2', label: 'B' } },
      { data: { id: '1->2', source: '1', target: '2', relation: ['conflict'], positivity: -0.2 } },
    ];

    const merged = graphDataTransformUtils.mergeElementsWithPrevious(
      currentElements,
      { elements: previousElements, chapterIdx: 1, eventIdx: 1 },
      1,
      2
    );
    const edge = merged.find((el) => el.data.id === '1->2');

    expect(edge.data.relation).toEqual(['ally', 'conflict']);
    expect(edge.data.positivity).toBe(-0.2);
  });

  it('keeps accumulated graph elements when advancing to the next chapter', () => {
    const previousElements = [
      { data: { id: '1', label: 'A' } },
      { data: { id: '2', label: 'B' } },
      { data: { id: '1->2', source: '1', target: '2', relation: ['ally'], positivity: 0.5 } },
    ];
    const currentElements = [
      { data: { id: '3', label: 'C' } },
      { data: { id: '4', label: 'D' } },
      { data: { id: '3->4', source: '3', target: '4', relation: ['meets'], positivity: 0.1 } },
    ];

    const merged = graphDataTransformUtils.mergeElementsWithPrevious(
      currentElements,
      { elements: previousElements, chapterIdx: 1, eventIdx: 12 },
      2,
      1
    );

    expect(merged.map((el) => el.data.id)).toEqual(['1', '2', '3', '4', '1->2', '3->4']);
  });

  it('does not keep future chapter elements when moving backward', () => {
    const previousElements = [
      { data: { id: '3', label: 'C' } },
      { data: { id: '4', label: 'D' } },
      { data: { id: '3->4', source: '3', target: '4', relation: ['meets'], positivity: 0.1 } },
    ];
    const currentElements = [
      { data: { id: '1', label: 'A' } },
      { data: { id: '2', label: 'B' } },
      { data: { id: '1->2', source: '1', target: '2', relation: ['ally'], positivity: 0.5 } },
    ];

    const merged = graphDataTransformUtils.mergeElementsWithPrevious(
      currentElements,
      { elements: previousElements, chapterIdx: 2, eventIdx: 1 },
      1,
      12
    );

    expect(merged.map((el) => el.data.id)).toEqual(['1', '2', '1->2']);
  });

  it('does not keep future graph elements when moving backward to an empty event', () => {
    const previousElements = [
      { data: { id: '3', label: 'C' } },
      { data: { id: '4', label: 'D' } },
      { data: { id: '3->4', source: '3', target: '4', relation: ['meets'] } },
    ];

    const merged = graphDataTransformUtils.mergeElementsWithPrevious(
      [],
      { elements: previousElements, chapterIdx: 2, eventIdx: 1 },
      1,
      12
    );

    expect(merged).toEqual([]);
  });
});
