import type { APIRoute } from 'astro';

const getRobotsTxt = (siteURL: string) => `User-agent: *
Allow: /
Sitemap: ${siteURL.endsWith('/') ? siteURL : `${siteURL}/`}sitemap-index.xml
`;

export const GET: APIRoute = ({ site }) => {
  const siteURL = site?.toString() || 'https://jichangtuijian.club/';
  return new Response(getRobotsTxt(siteURL), {
    headers: {
      'Content-Type': 'text/plain; charset=utf-8',
    },
  });
};
