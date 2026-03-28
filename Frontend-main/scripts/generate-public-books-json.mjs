import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(__dirname, '..');
const booksRoot = path.join(root, 'public', 'books');
const outFile = path.join(booksRoot, 'books.json');

function main() {
  if (!fs.existsSync(booksRoot)) {
    console.warn('generate-public-books-json: public/books 없음');
    return;
  }

  let existingById = new Map();
  if (fs.existsSync(outFile)) {
    try {
      const raw = JSON.parse(fs.readFileSync(outFile, 'utf8'));
      if (Array.isArray(raw)) {
        for (const item of raw) {
          if (item?.id != null) existingById.set(String(item.id), item);
        }
      }
    } catch {
      /* ignore */
    }
  }

  const dirents = fs.readdirSync(booksRoot, { withFileTypes: true });
  const next = [];
  for (const d of dirents) {
    if (!d.isDirectory()) continue;
    const id = d.name;
    const combined = path.join(booksRoot, id, 'combined.xhtml');
    if (!fs.existsSync(combined)) continue;
    const prev = existingById.get(id);
    next.push({
      id,
      title: prev?.title ?? id,
      author: prev?.author ?? '',
    });
  }
  next.sort((a, b) => String(a.title).localeCompare(String(b.title), 'ko'));
  fs.writeFileSync(outFile, `${JSON.stringify(next, null, 2)}\n`, 'utf8');
}

main();
