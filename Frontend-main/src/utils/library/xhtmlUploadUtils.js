export function xhtmlUploadBasename(filename) {
  return String(filename || '').replace(/\.(xhtml|html|htm)$/i, '').trim() || filename;
}

export async function extractXhtmlFileMetadata(file) {
  const fallback = {
    title: xhtmlUploadBasename(file.name),
    author: 'Unknown',
    language: 'ko',
  };
  try {
    const text = await file.text();
    if (!text.trim()) return fallback;
    const parser = new DOMParser();
    let doc = parser.parseFromString(text, 'application/xml');
    if (doc.getElementsByTagName('parsererror').length) {
      doc = parser.parseFromString(text, 'text/html');
    }
    const title = (
      doc.querySelector('title')?.textContent ||
      doc.querySelector('h1')?.textContent ||
      ''
    ).trim() || fallback.title;
    let author = 'Unknown';
    const metaAuthor = doc.querySelector('meta[name="author" i], meta[name="dc.creator" i]');
    const fromMeta = metaAuthor?.getAttribute('content')?.trim();
    if (fromMeta) author = fromMeta;
    else {
      const dc = doc.getElementsByTagNameNS('http://purl.org/dc/elements/1.1/', 'creator')[0];
      if (dc?.textContent?.trim()) author = dc.textContent.trim();
    }
    const root = doc.documentElement;
    const rawLang = root?.getAttribute('lang') || root?.getAttribute('xml:lang') || 'ko';
    const language = String(rawLang).split(/[-_]/)[0] || 'ko';
    return { title, author, language };
  } catch {
    return fallback;
  }
}
