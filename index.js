export default {
  async fetch(request, env) {
    const url = new URL(request.url);
    const fileName = url.searchParams.get("file");

    if (!fileName) {
      return new Response("Missing 'file' parameter in request.", { status: 400 });
    }

    const keyID = env.B2_KEY_ID || "0057947ab7c39cc0000000001";
    const applicationKey = env.B2_APPLICATION_KEY || "K005Na/cj49UgQiIAskInq6GEJ6ogUA";
    const bucketName = env.B2_BUCKET_NAME || "creator-hub-assets-2026";

    try {
      const credentials = btoa(`${keyID}:${applicationKey}`);
      const authResponse = await fetch("https://api.backblazeb2.com/b2api/v2/b2_authorize_account", {
        headers: {
          "Authorization": `Basic ${credentials}`
        }
      });

      if (!authResponse.ok) {
        const errorText = await authResponse.text();
        return new Response(`Backblaze Auth Error (${authResponse.status}): ${errorText}`, { status: 500 });
      }

      const authData = await authResponse.json();
      const downloadUrl = authData.downloadUrl;
      const authToken = authData.authorizationToken;

      const fileUrl = `${downloadUrl}/file/${bucketName}/${encodeURIComponent(fileName)}`;
      const fileResponse = await fetch(fileUrl, {
        headers: {
          "Authorization": authToken
        }
      });

      if (!fileResponse.ok) {
        return new Response(`File not found or access denied (${fileResponse.status})`, { status: fileResponse.status });
      }

      return new Response(fileResponse.body, {
        headers: {
          "Content-Type": "audio/mpeg",
          "Content-Disposition": `inline; filename="${fileName}"`,
          "Access-Control-Allow-Origin": "*",
        },
      });
    } catch (err) {
      return new Response("Worker Proxy Error: " + err.message, { status: 500 });
    }
  }
};
