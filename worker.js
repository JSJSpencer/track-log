export default {
  async fetch(request, env) {
    const allowedOrigin = 'https://jsjspencer.github.io';

    const corsHeaders = {
      'Access-Control-Allow-Origin': allowedOrigin,
      'Access-Control-Allow-Methods': 'POST, GET, DELETE, OPTIONS',
      'Access-Control-Allow-Headers': 'Content-Type, X-Upload-Secret, X-File-Name, X-File-Type, X-User-Id, X-Delete-Key',
    };

    // Preflight
    if (request.method === 'OPTIONS') {
      return new Response(null, { status: 204, headers: corsHeaders });
    }

    // Health check
    if (request.method === 'GET') {
      return new Response(JSON.stringify({ status: 'ok', bucket: env.BUCKET ? 'connected' : 'MISSING' }), {
        headers: { ...corsHeaders, 'Content-Type': 'application/json' }
      });
    }

    // Delete video
    if (request.method === 'DELETE') {
      if (!env.BUCKET) {
        return new Response(JSON.stringify({ error: 'R2 bucket not bound' }), {
          status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' }
        });
      }

      const secret = request.headers.get('X-Upload-Secret');
      if (!secret || secret !== 'tracklog-upload') {
        return new Response(JSON.stringify({ error: 'Unauthorized' }), {
          status: 401, headers: { ...corsHeaders, 'Content-Type': 'application/json' }
        });
      }

      const key = request.headers.get('X-Delete-Key');
      if (!key) {
        return new Response(JSON.stringify({ error: 'X-Delete-Key header required' }), {
          status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' }
        });
      }

      try {
        await env.BUCKET.delete(key);
        return new Response(JSON.stringify({ deleted: key }), {
          status: 200, headers: { ...corsHeaders, 'Content-Type': 'application/json' }
        });
      } catch (err) {
        return new Response(JSON.stringify({ error: err.message }), {
          status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' }
        });
      }
    }

    // Upload
    if (request.method === 'POST') {
      if (!env.BUCKET) {
        return new Response(JSON.stringify({ error: 'R2 bucket not bound' }), {
          status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' }
        });
      }

      const secret = request.headers.get('X-Upload-Secret');
      if (!secret || secret !== 'tracklog-upload') {
        return new Response(JSON.stringify({ error: 'Unauthorized' }), {
          status: 401, headers: { ...corsHeaders, 'Content-Type': 'application/json' }
        });
      }

      const fileName = request.headers.get('X-File-Name');
      const fileType = request.headers.get('X-File-Type') || 'video/mp4';
      const userId = request.headers.get('X-User-Id') || 'unknown';

      if (!fileName) {
        return new Response(JSON.stringify({ error: 'X-File-Name header required' }), {
          status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' }
        });
      }

      const timestamp = Date.now();
      const safeFileName = fileName.replace(/[^a-zA-Z0-9._-]/g, '_');
      const key = `videos/${userId}/${timestamp}-${safeFileName}`;

      try {
        const body = await request.arrayBuffer();

        if (body.byteLength === 0) {
          return new Response(JSON.stringify({ error: 'Empty file body' }), {
            status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' }
          });
        }

        if (body.byteLength > 500 * 1024 * 1024) {
          return new Response(JSON.stringify({ error: 'File too large (max 500MB)' }), {
            status: 413, headers: { ...corsHeaders, 'Content-Type': 'application/json' }
          });
        }

        await env.BUCKET.put(key, body, {
          httpMetadata: { contentType: fileType },
        });

        const publicUrl = `https://pub-460ba23a1f594c27b967bbc435cb3ab7.r2.dev/${key}`;

        return new Response(JSON.stringify({ url: publicUrl, key }), {
          status: 200, headers: { ...corsHeaders, 'Content-Type': 'application/json' }
        });

      } catch (err) {
        return new Response(JSON.stringify({ error: err.message }), {
          status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' }
        });
      }
    }

    return new Response('Method not allowed', { status: 405, headers: corsHeaders });
  }
};
