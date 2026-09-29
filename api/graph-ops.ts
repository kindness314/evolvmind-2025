/**
 * api/graph/[op].ts - graph 子操作合并端点(Vercel Hobby 计划单部署 12 函数上限)
 * 原 api/graph/{embed,backfill,search,topicize,classify-topics,disambiguate}.ts 6 个函数合并为 1 个,
 * URL 不变:/api/graph/embed -> op=embed。handler 实现在 _lib/graphOps/。
 */
import embed from './_lib/graphOps/embed.js';
import backfill from './_lib/graphOps/backfill.js';
import search from './_lib/graphOps/search.js';
import topicize from './_lib/graphOps/topicize.js';
import classifyTopics from './_lib/graphOps/classify-topics.js';
import disambiguate from './_lib/graphOps/disambiguate.js';
import type { VercelRequest, VercelResponse } from './_lib/embedding.js';

type Handler = (req: VercelRequest, res: VercelResponse) => unknown;

const handlers: Record<string, Handler> = {
  embed: embed as Handler,
  backfill: backfill as Handler,
  search: search as Handler,
  topicize: topicize as Handler,
  'classify-topics': classifyTopics as Handler,
  disambiguate: disambiguate as Handler,
};

export default async function handler(req: VercelRequest, res: VercelResponse) {
  const fromQuery = typeof req.query?.op === 'string' ? req.query.op : ''; // 生产经 vercel.json 重写带 ?op=
  const op = fromQuery || req.url?.match(/\/api\/graph\/([^/?]+)/)?.[1] || '';
  const h = handlers[op];
  if (!h) {
    res.status(404).json({ error: `Unknown graph op: ${op || '(empty)'}` });
    return;
  }
  return h(req, res);
}
