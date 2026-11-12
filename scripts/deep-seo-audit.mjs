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
console.log(`Auditing ${htmlFiles.length} HTML files in dist/ ...`);

const externalTargets = new Map();
const internalTargets = new Map();
const canonicalSamples = [];
const missingCanonicals = [];
const nonSelfCanonicals = [];
const allTitles = new Map();
const allDescriptions = new Map();
const brandPageAudits = [];
const wordCountStats = [];
const schemaIssues = [];
const emptyHrefs = [];
const localPathLeaks = [];

for (const file of htmlFiles) {
  const content = fs.readFileSync(file, 'utf8');
  const relPath = path.relative('dist', file).replace(/\\/g, '/');
  const pageUrl = 'https://jichangtuijian.club/' + (relPath === 'index.html' ? '' : relPath.replace(/\/index\.html$/, '/'));

  // 1. Canonical
  if (relPath !== '404.html') {
    const canonicalMatch = content.match(/<link[^>]+rel=["']canonical["'][^>]*>/i);
    if (!canonicalMatch) {
      missingCanonicals.push(relPath);
    } else {
      const hrefMatch = canonicalMatch[0].match(/href=["']([^"']+)["']/i);
      const canonicalHref = hrefMatch ? hrefMatch[1] : '';
      if (canonicalHref !== pageUrl) {
        nonSelfCanonicals.push({ file: relPath, expected: pageUrl, actual: canonicalHref });
      }
      if (canonicalSamples.length < 30) {
        canonicalSamples.push({ file: relPath, canonical: canonicalHref, match: canonicalHref === pageUrl });
      }
    }
  }

  // 2. Title & Description
  const titleMatch = content.match(/<title>([^<]*)<\/title>/i);
  const descMatch = content.match(/<meta[^>]+name=["']description["'][^>]+content=["']([^"']*)["']/i);
  const title = titleMatch ? titleMatch[1].trim() : '';
  const desc = descMatch ? descMatch[1].trim() : '';
  if (title) {
    if (!allTitles.has(title)) allTitles.set(title, []);
    allTitles.get(title).push(relPath);
  }
  if (desc) {
    if (!allDescriptions.has(desc)) allDescriptions.set(desc, []);
    allDescriptions.get(desc).push(relPath);
  }

  // 3. Content character length (Chinese character count)
  const bodyMatch = content.match(/<body[^>]*>([\s\S]*?)<\/body>/i);
  const bodyText = bodyMatch
    ? bodyMatch[1]
        .replace(/<script\b[^<]*(?:(?!<\/script>)<[^<]*)*<\/script>/gi, '')
        .replace(/<style\b[^<]*(?:(?!<\/style>)<[^<]*)*<\/style>/gi, '')
        .replace(/<[^>]+>/g, ' ')
        .replace(/\s+/g, ' ')
        .trim()
    : '';
  const cjkChars = (bodyText.match(/[\u4e00-\u9fa5]/g) || []).length;
  const totalChars = bodyText.length;
  wordCountStats.push({ file: relPath, cjkChars, totalChars });

  // 4. Links audit
  const aMatches = content.matchAll(/<a\b([^>]*)>/gi);
  for (const a of aMatches) {
    const attrs = a[1];
    const hrefMatch = attrs.match(/href=["']([^"']*)["']/i);
    if (!hrefMatch || hrefMatch[1] === '' || hrefMatch[1] === '#') {
      emptyHrefs.push({ file: relPath, tag: a[0] });
    } else {
      const href = hrefMatch[1];
      if (href.startsWith('http://') || href.startsWith('https://')) {
        if (!href.includes('jichangtuijian.club') && !href.includes('schema.org') && !href.includes('w3.org')) {
          const relMatch = attrs.match(/rel=["']([^"']*)["']/i);
          const rel = relMatch ? relMatch[1] : '';
          if (!externalTargets.has(href)) {
            externalTargets.set(href, []);
          }
          externalTargets.get(href).push({ file: relPath, rel, tag: a[0] });
        }
      } else if (href.startsWith('/')) {
        // Internal link check
        let targetFile = path.join('dist', href.replace(/^\//, ''));
        if (href.endsWith('/')) targetFile = path.join(targetFile, 'index.html');
        const exists = fs.existsSync(targetFile);
        if (!exists) {
          if (!internalTargets.has(href)) internalTargets.set(href, []);
          internalTargets.get(href).push({ from: relPath, exists });
        }
      }
    }
  }

  // 5. Schema check
  const jsonLdMatches = content.matchAll(/<script\b[^>]*type=["']application\/ld\+json["'][^>]*>([\s\S]*?)<\/script>/gi);
  for (const s of jsonLdMatches) {
    try {
      const parsed = JSON.parse(s[1]);
      // Check if Product schema has unverified rating
      if (parsed['@type'] === 'Product' && parsed.review) {
        const rating = parsed.review.reviewRating?.ratingValue;
        if (rating === '4.8') {
          // Check if 4.8 is hardcoded
          schemaIssues.push({ file: relPath, issue: 'Hardcoded 4.8 ratingValue in Product Review schema' });
        }
      }
    } catch (e) {
      schemaIssues.push({ file: relPath, issue: 'JSON-LD syntax error: ' + e.message });
    }
  }

  // 6. Template similarity on brand pages
  if (relPath.startsWith('brands/') && relPath !== 'brands/index.html') {
    const h2s = (content.match(/<h2[^>]*>(.*?)<\/h2>/gi) || []).map(h => h.replace(/<[^>]+>/g, '').trim());
    brandPageAudits.push({ file: relPath, h2s, cjkChars });
  }

  // 7. Check local leaks (C:\Users, 127.0.0.1, etc.)
  const leaks = content.match(/(?:C:\\Users|file:\/\/\/|localhost:4321)/gi);
  if (leaks) {
    localPathLeaks.push({ file: relPath, leaks });
  }
}

console.log('=== CANONICAL AUDIT ===');
console.log('Missing canonicals:', missingCanonicals.length);
console.log('Non-self canonicals:', nonSelfCanonicals.length);
console.log('Sample 30 canonicals:', canonicalSamples.slice(0, 30));

console.log('\n=== DUPLICATE TITLES & DESCRIPTIONS ===');
let dupTitlesCount = 0;
for (const [title, files] of allTitles.entries()) {
  if (files.length > 1) {
    dupTitlesCount++;
    console.log(`Duplicate Title (${files.length} pages): "${title}" ->`, files);
  }
}
console.log('Total Duplicate Titles:', dupTitlesCount);

let dupDescCount = 0;
for (const [desc, files] of allDescriptions.entries()) {
  if (files.length > 1) {
    dupDescCount++;
    console.log(`Duplicate Desc (${files.length} pages): "${desc.slice(0, 40)}..." ->`, files);
  }
}
console.log('Total Duplicate Descriptions:', dupDescCount);

console.log('\n=== EXTERNAL AFFILIATE LINKS AUDIT ===');
let totalAffMisses = 0;
for (const [href, occurrences] of externalTargets.entries()) {
  const isAff = href.includes('aff') || href.includes('code=') || href.includes('register') || href.includes('invite');
  if (isAff) {
    const misses = occurrences.filter(o => !o.rel.includes('nofollow') || !o.rel.includes('sponsored'));
    if (misses.length > 0) {
      totalAffMisses += misses.length;
      console.log(`CRITICAL: External affiliate link missing nofollow/sponsored! Target: ${href}`);
      misses.forEach(m => console.log(`   Page: ${m.file} | Current rel: "${m.rel}"`));
    }
  }
}
console.log('Total affiliate links missing nofollow/sponsored:', totalAffMisses);

console.log('\n=== BROKEN INTERNAL LINKS ===');
console.log('Broken internal links count:', internalTargets.size);
for (const [href, refs] of internalTargets.entries()) {
  console.log(`Broken link: "${href}" referenced in:`, refs.map(r => r.from));
}

console.log('\n=== WORD COUNT / THIN CONTENT AUDIT ===');
wordCountStats.sort((a, b) => a.cjkChars - b.cjkChars);
console.log('Lowest 10 pages by Chinese character count:');
console.log(wordCountStats.slice(0, 10));
console.log('Highest 5 pages by Chinese character count:');
console.log(wordCountStats.slice(-5));

console.log('\n=== SCHEMA & RATING AUDIT ===');
console.log('Schema rating issues count:', schemaIssues.length);
if (schemaIssues.length > 0) {
  console.log('Sample schema issues (first 5):', schemaIssues.slice(0, 5));
}

console.log('\n=== LOCAL LEAKS ===');
console.log('Local path leaks (C:\\Users, file://, localhost:4321):', localPathLeaks.length);
if (localPathLeaks.length > 0) {
  console.log(localPathLeaks);
}

console.log('\n=== BRAND PAGE DOM TEMPLATE SIMILARITY ===');
console.log('Total brand detail pages:', brandPageAudits.length);
const brandH2Templates = new Set(brandPageAudits.map(b => b.h2s.join(' || ')));
console.log('Unique H2 structure variations across brand pages:', brandH2Templates.size);
console.log('Sample H2 structure from #1 brand:');
console.log(brandPageAudits[0]?.h2s);
