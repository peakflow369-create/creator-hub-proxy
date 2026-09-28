// Clean Cloudflare Worker for Backblaze B2 Direct Stream Uploads
// Pure JavaScript (No external SDK dependencies required)

const CORS_HEADERS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'GET, POST, PUT, OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type, Authorization, X-File-Name',
};

export default {
  async fetch(request, env) {
    if (request.method === 'OPTIONS') {
      return new Response(null, { headers: CORS_HEADERS });
    }

    const url = new URL(request.url);

    // Health check endpoint
    if (url.pathname === '/health') {
      return new Response(JSON.stringify({ status: 'ok', time: new Date().toISOString() }), {
        status: 200,
        headers: { ...CORS_HEADERS, 'Content-Type': 'application/json' },
      });
    }

    // Upload endpoint
    if (url.pathname === '/upload' && request.method === 'POST') {
      try {
        const fileName = request.headers.get('X-File-Name') || `upload-${Date.now()}`;
        const contentType = request.headers.get('Content-Type') || 'application/octet-stream';
        const fileData = await request.arrayBuffer();

        if (!fileData || fileData.byteLength === 0) {
          return new Response(JSON.stringify({ error: 'Empty file payload' }), {
            status: 400,
            headers: { ...CORS_HEADERS, 'Content-Type': 'application/json' },
          });
        }

        // Upload to Backblaze B2 using S3 API
        const b2Url = `https://${env.B2_BUCKET_NAME}.${env.B2_ENDPOINT}/${encodeURIComponent(fileName)}`;
        const dateStr = new Date().toUTCString();

        const s3Response = await fetch(b2Url, {
          method: 'PUT',
          headers: {
            'Content-Type': contentType,
            'Host': `${env.B2_BUCKET_NAME}.${env.B2_ENDPOINT}`,
            'Authorization': await getS3AuthHeader(env, 'PUT', `/${fileName}`, contentType, dateStr),
            'x-amz-date': dateStr,
          },
          body: fileData,
        });

        if (!s3Response.ok) {
          const errText = await s3Response.text();
          return new Response(JSON.stringify({ error: 'B2 Upload Failed', details: errText }), {
            status: 500,
            headers: { ...CORS_HEADERS, 'Content-Type': 'application/json' },
          });
        }

        const publicUrl = `https://${env.B2_BUCKET_NAME}.${env.B2_ENDPOINT}/${fileName}`;

        return new Response(
          JSON.stringify({
            success: true,
            fileName: fileName,
            url: publicUrl,
          }),
          {
            status: 200,
            headers: { ...CORS_HEADERS, 'Content-Type': 'application/json' },
          }
        );
      } catch (err) {
        return new Response(JSON.stringify({ error: err.message }), {
          status: 500,
          headers: { ...CORS_HEADERS, 'Content-Type': 'application/json' },
        });
      }
    }

    return new Response(JSON.stringify({ error: 'Not Found' }), {
      status: 404,
      headers: { ...CORS_HEADERS, 'Content-Type': 'application/json' },
    });
  },
};

// Helper function to generate S3 HMAC Signature
async function getS3AuthHeader(env, method, path, contentType, dateStr) {
  const stringToSign = `${method}\n\n${contentType}\n${dateStr}\n/${env.B2_BUCKET_NAME}${path}`;
  const encoder = new TextEncoder();
  
  const key = await crypto.subtle.importKey(
    'raw',
    encoder.encode(env.B2_APPLICATION_KEY),
    { name: 'HMAC', hash: 'SHA-1' },
    false,
    ['sign']
  );

  const signature = await crypto.subtle.sign('HMAC', key, encoder.encode(stringToSign));
  const base64Sig = btoa(String.fromCharCode(...new Uint8Array(signature)));

  return `AWS ${env.B2_KEY_ID}:${base64Sig}`;
}
