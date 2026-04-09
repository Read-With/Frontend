import JSZip from 'jszip';

const DC_NS = 'http://purl.org/dc/elements/1.1/';

export function epubUploadBasename(filename) {
  return String(filename || '').replace(/\.epub$/i, '').trim() || filename;
}

function findOpfPath(containerDoc) {
  const rootfiles = containerDoc.querySelectorAll('rootfile[full-path]');
  for (const rf of rootfiles) {
    const mt = (rf.getAttribute('media-type') || '').toLowerCase();
    if (mt === 'application/oebps-package+xml' || mt === 'application/xml') {
      return rf.getAttribute('full-path');
    }
  }
  const first = containerDoc.querySelector('rootfile[full-path]');
  return first?.getAttribute('full-path') || null;
}

function getZipFile(zip, path) {
  if (!path) return null;
  const trimmed = path.replace(/^\//, '');
  return zip.file(trimmed) || zip.file(path);
}

export async function extractEpubFileMetadata(file) {
  const fallback = {
    title: epubUploadBasename(file.name),
    author: 'Unknown',
    language: 'ko',
  };
  try {
    const buf = await file.arrayBuffer();
    const zip = await JSZip.loadAsync(buf);
    const containerEntry = zip.file('META-INF/container.xml');
    if (!containerEntry) return fallback;

    const containerXml = await containerEntry.async('string');
    const parser = new DOMParser();
    const containerDoc = parser.parseFromString(containerXml, 'application/xml');
    if (containerDoc.getElementsByTagName('parsererror').length) return fallback;

    const opfPath = findOpfPath(containerDoc);
    const opfEntry = getZipFile(zip, opfPath);
    if (!opfEntry) return fallback;

    const opfXml = await opfEntry.async('string');
    const opfDoc = parser.parseFromString(opfXml, 'application/xml');
    if (opfDoc.getElementsByTagName('parsererror').length) return fallback;

    const titleEl = opfDoc.getElementsByTagNameNS(DC_NS, 'title')[0];
    const title = (titleEl?.textContent || '').trim() || fallback.title;

    const creatorEl = opfDoc.getElementsByTagNameNS(DC_NS, 'creator')[0];
    const author = (creatorEl?.textContent || '').trim() || 'Unknown';

    const langEl = opfDoc.getElementsByTagNameNS(DC_NS, 'language')[0];
    const rawLang = (langEl?.textContent || '').trim() || 'ko';
    const language = rawLang.split(/[-_]/)[0] || 'ko';

    return { title, author, language };
  } catch {
    return fallback;
  }
}
