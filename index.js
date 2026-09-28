import { S3Client, PutObjectCommand } from '@aws-sdk/client-s3';

export default {
  async fetch(request, env) {
    const corsHeaders = {
      'Access-Control-Allow-Origin': '*',
      'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
      'Access-Control-Allow-Headers': '*',
    };

    if (request.method === 'OPTIONS') {
      return new Response(null, { headers: corsHeaders });
    }

    const url = new URL(request.url);

    // ====================================================
    // ROUTE 1: DIRECT UPLOAD TO BACKBLAZE B2
    // ====================================================
    if (request.method === 'POST' && url.pathname === '/upload') {
      try {
        const formData = await request.formData();
        const file = formData.get('file');

        if (!file) {
          return new Response(JSON.stringify({ error: 'No file provided' }), {
            status: 400,
            headers: { ...corsHeaders, 'Content-Type': 'application/json' }
          });
        }

        const fileName = file.name;
        const arrayBuffer = await file.arrayBuffer();

        // AWS S3 Client instance for Backblaze B2 Compatible Endpoint
        const s3 = new S3Client({
          region: env.B2_ENDPOINT.split('.')[1] || 'us-west-004',
          endpoint: `https://${env.B2_ENDPOINT}`,
          credentials: {
            accessKeyId: env.B2_KEY_ID,
            secretAccessKey: env.B2_APPLICATION_KEY,
          },
        });

        // Push file buffer to B2 Bucket
        await s3.send(new PutObjectCommand({
          Bucket: env.B2_BUCKET_NAME,
          Key: fileName,
          Body: new Uint8Array(arrayBuffer),
          ContentType: file.type || 'application/octet-stream',
        }));

        return new Response(JSON.stringify({ 
          success: true, 
          file_name: fileName 
        }), {
          headers: { ...corsHeaders, 'Content-Type': 'application/json' }
        });

      } catch (err) {
        return new Response(JSON.stringify({ error: err.message }), {
          status: 500,
          headers: { ...corsHeaders, 'Content-Type': 'application/json' }
        });
      }
    }

    // ====================================================
    // ROUTE 2: STREAM FILE FROM BACKBLAZE B2 (Proxy Stream)
    // ====================================================
    const fileName = url.searchParams.get('file');
    if (!fileName) {
      return new Response('Missing file parameter', { status: 400, headers: corsHeaders });
    }

    const fileUrl = `https://${env.B2_BUCKET_NAME}.${env.B2_ENDPOINT}/${encodeURIComponent(fileName)}`;
    const b2File = await fetch(fileUrl);

    if (!b2File.ok) {
      return new Response('File not found or access denied (404)', { status: 404, headers: corsHeaders });
    }

    const response = new Response(b2File.body, b2File);
    Object.keys(corsHeaders).forEach(key => response.headers.set(key, corsHeaders[key]));
    return response;
  }
};
