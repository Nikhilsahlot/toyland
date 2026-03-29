exports.handler = async (event) => {
  if (event.httpMethod === 'OPTIONS') return { statusCode: 200, headers: corsHeaders() };
  if (event.httpMethod !== 'POST') return { statusCode: 405, body: 'Method not allowed' };

  const CLOUD_NAME = process.env.CLOUDINARY_CLOUD_NAME;
  const UPLOAD_PRESET = process.env.CLOUDINARY_UPLOAD_PRESET;

  if (!CLOUD_NAME || !UPLOAD_PRESET) {
    return { statusCode: 500, headers: corsHeaders(), body: JSON.stringify({ error: 'Cloudinary env vars not set' }) };
  }

  try {
    const body = event.isBase64Encoded
      ? Buffer.from(event.body, 'base64').toString('utf8')
      : event.body;

    const { fileBase64 } = JSON.parse(body || '{}');

    if (!fileBase64) {
      return { statusCode: 400, headers: corsHeaders(), body: JSON.stringify({ error: 'No file data received' }) };
    }

    // Cloudinary accepts data URIs (data:image/jpeg;base64,...) via JSON API
    const res = await fetch(`https://api.cloudinary.com/v1_1/${CLOUD_NAME}/image/upload`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        file: fileBase64,
        upload_preset: UPLOAD_PRESET
      })
    });

    const data = await res.json();

    if (data.secure_url) {
      return { statusCode: 200, headers: corsHeaders(), body: JSON.stringify({ url: data.secure_url }) };
    }

    // Return full Cloudinary error for debugging
    return {
      statusCode: 400,
      headers: corsHeaders(),
      body: JSON.stringify({ error: data.error?.message || JSON.stringify(data) })
    };
  } catch (err) {
    return { statusCode: 500, headers: corsHeaders(), body: JSON.stringify({ error: err.message }) };
  }
};

function corsHeaders() {
  return {
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Headers': 'Content-Type',
    'Access-Control-Allow-Methods': 'POST, OPTIONS'
  };
}
