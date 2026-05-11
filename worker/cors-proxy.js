/**
 * cors-proxy.js - Cloudflare Worker CORS 代理
 *
 * 部署方式：
 *   1. 安装 wrangler: npm install -g wrangler
 *   2. 登录: wrangler login
 *   3. 部署: wrangler deploy worker/cors-proxy.js --name jxz-cors-proxy
 *   4. 部署成功后，将显示的 Worker URL 填入游戏设置的"CORS 代理地址"
 *
 * 请求格式：
 *   将原 API URL 编码后拼接到代理 URL 的 ?target= 参数
 *   例：https://your-worker.workers.dev?target=https%3A%2F%2Fapi.example.com%2Fv1%2Fchat%2Fcompletions
 *
 * 安全说明：
 *   - API Key 由用户浏览器端持有，通过 Authorization header 透传，Worker 不存储不记录
 *   - target 参数只允许 HTTPS 协议，防止被滥用为开放代理
 */

const ALLOWED_HEADERS = [
  'content-type',
  'authorization',
  'x-api-key',
  'anthropic-version',
  'anthropic-beta',
  'x-goog-api-key',
];

const CORS_HEADERS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'GET, POST, PUT, DELETE, OPTIONS',
  'Access-Control-Allow-Headers': ALLOWED_HEADERS.join(', '),
  'Access-Control-Max-Age': '86400',
};

export default {
  async fetch(request, env, ctx) {
    // 处理 OPTIONS 预检请求
    if (request.method === 'OPTIONS') {
      return new Response(null, {
        status: 204,
        headers: CORS_HEADERS,
      });
    }

    const url = new URL(request.url);
    const target = url.searchParams.get('target');

    // 参数校验
    if (!target) {
      return new Response(JSON.stringify({ error: 'Missing ?target= parameter' }), {
        status: 400,
        headers: { ...CORS_HEADERS, 'Content-Type': 'application/json' },
      });
    }

    // 安全校验：只允许 HTTPS 目标
    let targetUrl;
    try {
      targetUrl = new URL(target);
    } catch (e) {
      return new Response(JSON.stringify({ error: 'Invalid target URL' }), {
        status: 400,
        headers: { ...CORS_HEADERS, 'Content-Type': 'application/json' },
      });
    }

    if (targetUrl.protocol !== 'https:') {
      return new Response(JSON.stringify({ error: 'Only HTTPS targets are allowed' }), {
        status: 403,
        headers: { ...CORS_HEADERS, 'Content-Type': 'application/json' },
      });
    }

    // 构建转发请求头（只透传白名单 header）
    const forwardHeaders = new Headers();
    for (const key of ALLOWED_HEADERS) {
      const val = request.headers.get(key);
      if (val) forwardHeaders.set(key, val);
    }

    // 转发请求
    let upstreamResponse;
    try {
      upstreamResponse = await fetch(targetUrl.toString(), {
        method: request.method,
        headers: forwardHeaders,
        body: request.method !== 'GET' && request.method !== 'HEAD' ? request.body : undefined,
        // 保持流式传输
        duplex: 'half',
      });
    } catch (e) {
      return new Response(JSON.stringify({ error: 'Upstream request failed: ' + e.message }), {
        status: 502,
        headers: { ...CORS_HEADERS, 'Content-Type': 'application/json' },
      });
    }

    // 构建响应头：透传上游响应头 + 添加 CORS 头
    const responseHeaders = new Headers(upstreamResponse.headers);
    for (const [key, val] of Object.entries(CORS_HEADERS)) {
      responseHeaders.set(key, val);
    }

    // 流式透传响应体（不缓冲，支持 SSE 流式输出）
    return new Response(upstreamResponse.body, {
      status: upstreamResponse.status,
      statusText: upstreamResponse.statusText,
      headers: responseHeaders,
    });
  },
};
