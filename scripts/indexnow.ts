import fs from 'node:fs';
import path from 'node:path';

const INDEXNOW_KEY = 'e3d7a8b4c9e145899a2b8c7d6e5f4a3b';
const HOST = 'jichangtuijian.club';
const KEY_LOCATION = `https://${HOST}/${INDEXNOW_KEY}.txt`;

/**
 * Submit updated or newly added URLs to IndexNow (Bing, Yandex, Naver, Seznam)
 * Usage: tsx scripts/indexnow.ts [url1] [url2]...
 * Or defaults to top critical indexable URLs
 */
async function submitIndexNow(urls?: string[]) {
  const urlList = urls && urls.length > 0
    ? urls
    : [
        `https://${HOST}/`,
        `https://${HOST}/airport-ranking/`,
        `https://${HOST}/stable-airport/`,
        `https://${HOST}/cheap-airport/`,
        `https://${HOST}/pay-as-you-go-airport/`,
        `https://${HOST}/tutorial/`,
        `https://${HOST}/knowledge/`,
        `https://${HOST}/troubleshooting/`,
        `https://${HOST}/risk-warning/`,
        `https://${HOST}/chatgpt-airport/`,
      ];

  const payload = {
    host: HOST,
    key: INDEXNOW_KEY,
    keyLocation: KEY_LOCATION,
    urlList: urlList,
  };

  console.log(`[IndexNow] Submitting ${urlList.length} URLs for ${HOST}...`);
  console.log(`[IndexNow] Key Location: ${KEY_LOCATION}`);

  try {
    const response = await fetch('https://api.indexnow.org/indexnow', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json; charset=utf-8',
      },
      body: JSON.stringify(payload),
    });

    if (response.status === 200 || response.status === 202) {
      console.log(`✅ [IndexNow] Successfully submitted to IndexNow API (Status: ${response.status})`);
    } else {
      console.warn(`⚠️ [IndexNow] API responded with status ${response.status}: ${await response.text()}`);
    }
  } catch (err: any) {
    console.error(`❌ [IndexNow] Submission failed: ${err.message}`);
  }
}

// Read args if provided
const args = process.argv.slice(2);
submitIndexNow(args.length > 0 ? args : undefined);
