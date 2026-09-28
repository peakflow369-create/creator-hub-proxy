const CORS_HEADERS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'GET, POST, PUT, OPTIONS',
  'Access-Control-Allow-Headers': '*',
};

export default {
  async fetch(request, env) {
    // 1. Handle Preflight OPTIONS Request (Prevents CORS errors)
    if (request.method === 'OPTIONS') {
      return new Response(null, { headers: CORS_HEADERS });
    }

    const url = new URL(request.url);

    // 2. Upload Route
    if (url.pathname === '/upload' && request.method === 'POST') {
      try {
        const formData = await request.formData();
        const file = formData.get('file');

        if (!file) {
          return new Response(JSON.stringify({ error: 'No file provided' }), {
            status: 400,
            headers: { ...CORS_HEADERS, 'Content-Type': 'application/json' },
          });
        }

        const rawFileName = file.name || `file-${Date.now()}`;
        const cleanFileName = `${Date.now()}-${rawFileName.replace(/[^a-zA-Z0-9.-]/g, '_')}`;
        const fileData = await file.arrayBuffer();

        const b2Host = `${env.B2_BUCKET_NAME}.${env.B2_ENDPOINT}`;
        const b2Url = `https://${b2Host}/${cleanFileName}`;
        const dateStr = new Date().toUTCString();
        const contentType = file.type || 'application/octet-stream';

        // Signature generate kar rahe hain
        const authHeader = await getS3AuthHeader(
          env,
          'PUT',
          `/${cleanFileName}`,
          contentType,
          dateStr
        );

        // B2 me upload stream
        const b2Response = await fetch(b2Url, {
          method: 'PUT',
          headers: {
            'Content-Type': contentType,
            'Host': b2Host,
            'Authorization': authHeader,
            'x-amz-date': dateStr,
          },
          body: fileData,
        });

        if (!b2Response.ok) {
          const errText = await b2Response.text();
          return new Response(JSON.stringify({ error: 'B2 Upload Failed', details: errText }), {
            status: 500,
            headers: { ...CORS_HEADERS, 'Content-Type': 'application/json' },
          });
        }

        return new Response(
          JSON.stringify({
            success: true,
            file_name: cleanFileName,
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

    // 3. File Stream Route (Assets stream karne ke liye)
    const fileName = url.searchParams.get('file');
    if (fileName) {
      const b2FileUrl = `https://${env.B2_BUCKET_NAME}.${env.B2_ENDPOINT}/${encodeURIComponent(fileName)}`;
      const b2File = await fetch(b2FileUrl);

      if (!b2File.ok) {
        return new Response('File not found', { status: 404, headers: CORS_HEADERS });
      }

      const response = new Response(b2File.body, b2File);
      Object.keys(CORS_HEADERS).forEach(key => response.headers.set(key, CORS_HEADERS[key]));
      return response;
    }

    return new Response(JSON.stringify({ error: 'Invalid Endpoint' }), {
      status: 404,
      headers: { ...CORS_HEADERS, 'Content-Type': 'application/json' },
    });
  },
};

// S3 HMAC Signature Helper
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
