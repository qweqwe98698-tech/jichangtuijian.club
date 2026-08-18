import { defineCollection, z } from 'astro:content';
import { glob } from 'astro/loaders';

const standardContentSchema = z.object({
  title: z.string(),
  description: z.string(),
  pubDate: z.string(),
  updatedDate: z.string(),
  category: z.string(),
  tags: z.array(z.string()).default([]),
  author: z.string().default('机场推荐 Club 评测组'),
  primaryKeyword: z.string(),
  secondaryKeywords: z.array(z.string()).default([]),
  searchIntent: z.enum(['commercial', 'informational', 'navigational', 'transactional', 'troubleshooting', 'tutorial']).default('informational'),
  answerType: z.enum(['decision', 'comparison', 'why', 'how']).default('decision'),
  quickAnswer: z.string(),
  pillar: z.string().default('/'),
  relatedSlugs: z.array(z.string()).default([]),
  commercialLevel: z.enum(['level1', 'level2', 'level3']).default('level2'),
  nextStep: z.string().default('查看 2026 稳定机场推荐与测速横评'),
  verificationStatus: z.enum(['verified', 'partially-verified', 'reference', 'example']).default('verified'),
  draft: z.boolean().default(false),
});

const articles = defineCollection({
  loader: glob({ pattern: '**/*.{md,mdx}', base: './src/content/articles' }),
  schema: standardContentSchema,
});

const knowledge = defineCollection({
  loader: glob({ pattern: '**/*.{md,mdx}', base: './src/content/knowledge' }),
  schema: standardContentSchema,
});

const troubleshooting = defineCollection({
  loader: glob({ pattern: '**/*.{md,mdx}', base: './src/content/troubleshooting' }),
  schema: standardContentSchema,
});

const riskWarning = defineCollection({
  loader: glob({ pattern: '**/*.{md,mdx}', base: './src/content/risk-warning' }),
  schema: standardContentSchema,
});

const tutorials = defineCollection({
  loader: glob({ pattern: '**/*.{md,mdx}', base: './src/content/tutorials' }),
  schema: standardContentSchema,
});

export const collections = {
  articles,
  knowledge,
  troubleshooting,
  'risk-warning': riskWarning,
  tutorials,
};
