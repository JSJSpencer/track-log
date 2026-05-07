/**
 * TrackLog — Cloudflare R2 Upload Worker
 * 
 * This worker does two things:
 *   1. POST /upload  — accepts a video file and streams it into R2
 *   2. GET  /        — health check
 *
 * Deploy with: wrangler deploy
 * 
 * Required environment variables (set in Cloudflare dashboard or wrangler.toml):
 *   UPLOAD_SECRET   — a random secret string you choose (e.g. a UUID)
 *   ALLOWED_ORIGIN  — your GitHub Pages URL, e.g. https://yourname.github.io 
 *
 * Required R2 binding (set in wrangler.toml):
 *   BUCKET          — your R2 bucket binding name
 */

export default {
  async fetch(request, env) {
    const origin = request.headers.get('Origin') || '';
    const allowedOrigin = env.ALLOWED_ORIGIN || '*';

    // CORS headers
    const corsHeaders = {
      'Access-Control-Allow-Origin': allowedOrigin,
      'Access-Control-Allow-Methods': 'POST, GET, OPTIONS',
      'Access-Control-Allow-Headers': 'Content-Type, X-Upload-Secret, X-File-Name, X-File-Type, X-User-Id',
    };

    // Handle preflight
    if (request.method === 'OPTIONS') {
      return new Response(null, { status: 204, headers: corsHeaders });
    }

    // Health check
    if (request.method === 'GET') {
      return new Response(JSON.stringify({ status: 'ok', service: 'tracklog-upload' }), {
        headers: { ...corsHeaders, 'Content-Type': 'application/json' }
      });
    }

    // Upload
    if (request.method === 'POST') {
      // Verify secret
      const secret = request.headers.get('X-Upload-Secret');
      if (!secret || secret !== env.UPLOAD_SECRET) {
        return new Response(JSON.stringify({ error: 'Unauthorized' }), {
          status: 401,
          headers: { ...corsHeaders, 'Content-Type': 'application/json' }
        });
      }

      const fileName = request.headers.get('X-File-Name');
      const fileType = request.headers.get('X-File-Type') || 'video/mp4';

      if (!fileName) {
        return new Response(JSON.stringify({ error: 'X-File-Name header required' }), {
          status: 400,
          headers: { ...corsHeaders, 'Content-Type': 'application/json' }
        });
      }

      // Generate unique key: userId/timestamp-filename
      const userId = request.headers.get('X-User-Id') || 'unknown';
      const timestamp = Date.now();
      const safeFileName = fileName.replace(/[^a-zA-Z0-9._-]/g, '_');
      const key = `videos/${userId}/${timestamp}-${safeFileName}`;

      try {
        const body = await request.arrayBuffer();

        if (body.byteLength === 0) {
          return new Response(JSON.stringify({ error: 'Empty file body' }), {
            status: 400,
            headers: { ...corsHeaders, 'Content-Type': 'application/json' }
          });
        }

        // Max 500MB
        if (body.byteLength > 500 * 1024 * 1024) {
          return new Response(JSON.stringify({ error: 'File too large (max 500MB)' }), {
            status: 413,
            headers: { ...corsHeaders, 'Content-Type': 'application/json' }
          });
        }

        await env.BUCKET.put(key, body, {
          httpMetadata: { contentType: fileType },
        });

        // Build public URL — uses your R2 public bucket domain
        const publicUrl = `https://${env.R2_PUBLIC_DOMAIN}/${key}`;

        return new Response(JSON.stringify({ url: publicUrl, key }), {
          status: 200,
          headers: { ...corsHeaders, 'Content-Type': 'application/json' }
        });

      } catch (err) {
        return new Response(JSON.stringify({ error: err.message }), {
          status: 500,
          headers: { ...corsHeaders, 'Content-Type': 'application/json' }
        });
      }
    }

    return new Response('Method not allowed', { status: 405, headers: corsHeaders });
  }
};
