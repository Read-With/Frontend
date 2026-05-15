export function resolveViewerGraphTarget({ currentChapter, currentEvent, lastGood = null }) {
  const ch = Number(currentChapter);
  const fallbackChapter = Number.isFinite(ch) && ch >= 1 ? ch : 1;

  if (currentEvent && typeof currentEvent === 'object') {
    const eventChapter = Number(currentEvent.chapter ?? currentEvent.chapterIdx ?? fallbackChapter);
    const eventIdx = Number(currentEvent.eventNum ?? currentEvent.eventIdx);
    if (Number.isFinite(eventChapter) && eventChapter >= 1 && Number.isFinite(eventIdx) && eventIdx >= 1) {
      return { chapter: eventChapter, eventIdx };
    }
  }

  const savedChapter = Number(lastGood?.chapter);
  const savedEventIdx = Number(lastGood?.eventNum ?? lastGood?.eventIdx);
  if (savedChapter === fallbackChapter && Number.isFinite(savedEventIdx) && savedEventIdx >= 1) {
    return { chapter: fallbackChapter, eventIdx: savedEventIdx };
  }

  return { chapter: fallbackChapter, eventIdx: 1 };
}
