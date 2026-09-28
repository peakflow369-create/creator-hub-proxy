const CORS_HEADERS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'GET, POST, PUT, OPTIONS',
  'Access-Control-Allow-Headers': '*',
};

export default {
  async fetch(request, env) {
    if (request.method === 'OPTIONS') {
      return new Response(null, { headers: CORS_HEADERS });
    }

    const url = new URL(request.url);

    // 1. UPLOAD ENDPOINT
    if (url.pathname === '/upload' && request.method === 'POST') {
      try {
        if (!env.B2_APPLICATION_KEY || !env.B2_KEY_ID || !env.B2_BUCKET_NAME) {
          return new Response(
            JSON.stringify({
              error: 'Missing Cloudflare Worker Variables!',
              details: 'B2_APPLICATION_KEY, B2_KEY_ID, ya B2_BUCKET_NAME missing hain.',
            }),
            { status: 500, headers: { ...CORS_HEADERS, 'Content-Type': 'application/json' } }
          );
        }

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
        const contentType = file.type || 'application/octet-stream';

        // Authorize B2
        const authCredentials = btoa(`${env.B2_KEY_ID}:${env.B2_APPLICATION_KEY}`);
        const authRes = await fetch('https://api.backblazeb2.com/b2api/v2/b2_authorize_account', {
          headers: { Authorization: `Basic ${authCredentials}` },
        });

        if (!authRes.ok) {
          const authErr = await authRes.text();
          throw new Error(`B2 Authorization Failed: ${authErr}`);
        }

        const authData = await authRes.json();
        const apiUrl = authData.apiUrl;
        const accountAuthToken = authData.authorizationToken;
        const downloadUrl = authData.downloadUrl;

        let bucketId = authData.allowed?.bucketId;

        if (!bucketId) {
          const bucketsRes = await fetch(`${apiUrl}/b2api/v2/b2_list_buckets`, {
            method: 'POST',
            headers: { Authorization: accountAuthToken },
            body: JSON.stringify({ accountId: authData.accountId }),
          });

          if (!bucketsRes.ok) {
            const bErr = await bucketsRes.text();
            throw new Error(`Failed to list buckets: ${bErr}`);
          }

          const bucketsData = await bucketsRes.json();
          const targetBucket = bucketsData.buckets?.find(b => b.bucketName === env.B2_BUCKET_NAME);

          if (!targetBucket) {
            throw new Error(`Bucket '${env.B2_BUCKET_NAME}' not found.`);
          }
          bucketId = targetBucket.bucketId;
        }

        // Get Upload URL
        const uploadUrlRes = await fetch(`${apiUrl}/b2api/v2/b2_get_upload_url`, {
          method: 'POST',
          headers: { Authorization: accountAuthToken },
          body: JSON.stringify({ bucketId: bucketId }),
        });

        if (!uploadUrlRes.ok) {
          const uErr = await uploadUrlRes.text();
          throw new Error(`Get Upload URL Failed: ${uErr}`);
        }

        const uploadUrlData = await uploadUrlRes.json();

        // Calculate SHA-1
        const hashBuffer = await crypto.subtle.digest('SHA-1', fileData);
        const hashArray = Array.from(new Uint8Array(hashBuffer));
        const sha1Hash = hashArray.map(b => b.toString(16).padStart(2, '0')).join('');

        // Upload to B2
        const uploadRes = await fetch(uploadUrlData.uploadUrl, {
          method: 'POST',
          headers: {
            Authorization: uploadUrlData.authorizationToken,
            'X-Bz-File-Name': encodeURIComponent(cleanFileName),
            'Content-Type': contentType,
            'X-Bz-Content-Sha1': sha1Hash,
          },
          body: fileData,
        });

        if (!uploadRes.ok) {
          const uploadErr = await uploadRes.text();
          throw new Error(`B2 File Upload Failed: ${uploadErr}`);
        }

        const finalFileUrl = `${downloadUrl}/file/${env.B2_BUCKET_NAME}/${cleanFileName}`;

        return new Response(
          JSON.stringify({
            success: true,
            file_name: cleanFileName,
            file_url: finalFileUrl,
            download_url: finalFileUrl
          }),
          {
            status: 200,
            headers: { ...CORS_HEADERS, 'Content-Type': 'application/json' },
          }
        );
      } catch (err) {
        return new Response(
          JSON.stringify({ error: 'Worker Error (500)', details: err.message }),
          {
            status: 500,
            headers: { ...CORS_HEADERS, 'Content-Type': 'application/json' },
          }
        );
      }
    }

    // 2. DOWNLOAD ENDPOINT (Direct B2 Redirect)
    const fileName = url.searchParams.get('file') || url.pathname.split('/').pop();

    if (fileName && fileName !== '' && fileName !== '/') {
      const b2DirectUrl = `https://f004.backblazeb2.com/file/${env.B2_BUCKET_NAME}/${encodeURIComponent(fileName)}`;
      return Response.redirect(b2DirectUrl, 302);
    }

    return new Response(JSON.stringify({ error: 'Invalid Endpoint' }), {
      status: 404,
      headers: { ...CORS_HEADERS, 'Content-Type': 'application/json' },
    });
  },
};
