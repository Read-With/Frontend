import { describe, expect, it } from 'vitest';
import {
  graphPanelHasCachedLocationHint,
  graphPanelHasResumeLocationHint,
} from './locatorUtils.js';

describe('graphPanelHasResumeLocationHint', () => {
  it('startLocator에 유효 챕터면 true', () => {
    expect(
      graphPanelHasResumeLocationHint({ startLocator: { chapterIndex: 1, blockIndex: 0, offset: 0 } })
    ).toBe(true);
  });
  it('start만 있고 chapterIdx면 true', () => {
    expect(graphPanelHasResumeLocationHint({ start: { chapterIdx: 2 } })).toBe(true);
  });
  it('앵커 없으면 false', () => {
    expect(graphPanelHasResumeLocationHint(null)).toBe(false);
    expect(graphPanelHasResumeLocationHint({})).toBe(false);
  });
});

describe('graphPanelHasCachedLocationHint', () => {
  it('locator 객체에 유효 챕터면 true', () => {
    expect(
      graphPanelHasCachedLocationHint({ locator: { chapterIndex: 1, blockIndex: 0, offset: 0 } })
    ).toBe(true);
  });
  it('anchor.start에 chapterIdx면 true', () => {
    expect(
      graphPanelHasCachedLocationHint({ anchor: { start: { chapterIdx: 3 } } })
    ).toBe(true);
  });
  it('chapterIdx+eventNum만 있어도 true', () => {
    expect(graphPanelHasCachedLocationHint({ chapterIdx: 1, eventNum: 1 })).toBe(true);
  });
  it('payload 없거나 힌트 없으면 false', () => {
    expect(graphPanelHasCachedLocationHint(null)).toBe(false);
    expect(graphPanelHasCachedLocationHint({ chapterIdx: 1, eventNum: 0 })).toBe(false);
    expect(graphPanelHasCachedLocationHint({ locator: { chapterIndex: 0 } })).toBe(false);
  });
});
