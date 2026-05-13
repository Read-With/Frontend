import { describe, expect, it } from 'vitest';
import { eventUtils, resolveFineGraphEventOrdinal } from './viewerUtils';

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
