import fs from 'node:fs';
import path from 'node:path';

function getHtmlFiles(dir) {
  let results = [];
  const list = fs.readdirSync(dir);
  for (const file of list) {
    const filePath = path.join(dir, file);
    const stat = fs.statSync(filePath);
    if (stat && stat.isDirectory()) {
      results = results.concat(getHtmlFiles(filePath));
    } else if (file.endsWith('.html')) {
      results.push(filePath);
    }
  }
  return results;
}

const htmlFiles = getHtmlFiles('dist');
const affMisses = [];
const internalBroken = [];

for (const file of htmlFiles) {
  const content = fs.readFileSync(file, 'utf8');
  const relPath = path.relative('dist', file).replace(/\\/g, '/');

  const aMatches = content.matchAll(/<a\b([^>]*)>/gi);
  for (const a of aMatches) {
    const attrs = a[1];
    const hrefMatch = attrs.match(/href=["']([^"']*)["']/i);
    if (hrefMatch) {
      const href = hrefMatch[1];
      if (href.startsWith('http://') || href.startsWith('https://')) {
        if (!href.includes('jichangtuijian.club') && !href.includes('schema.org') && !href.includes('w3.org')) {
          const isAff = href.includes('aff') || href.includes('code=') || href.includes('register') || href.includes('invite');
          if (isAff) {
            const relMatch = attrs.match(/rel=["']([^"']*)["']/i);
            const rel = relMatch ? relMatch[1] : '';
            if (!rel.includes('nofollow') || !rel.includes('sponsored')) {
              affMisses.push({ page: relPath, target: href, rel, tag: a[0] });
            }
          }
        }
      } else if (href.startsWith('/')) {
        const cleanHref = href.split('#')[0].split('?')[0];
        if (cleanHref) {
          let targetFile = path.join('dist', cleanHref.replace(/^\//, ''));
          if (cleanHref.endsWith('/')) targetFile = path.join(targetFile, 'index.html');
          if (!fs.existsSync(targetFile)) {
            internalBroken.push({ from: relPath, href });
          }
        }
      }
    }
  }
}

console.log('Affiliate link misses count:', affMisses.length);
affMisses.forEach(m => {
  console.log(`- Page: /${m.page} | Target: ${m.target} | rel="${m.rel}"`);
});

console.log('\nInternal broken links count (excluding hash anchors):', internalBroken.length);
internalBroken.forEach(b => {
  console.log(`- From: /${b.from} -> ${b.href}`);
});
