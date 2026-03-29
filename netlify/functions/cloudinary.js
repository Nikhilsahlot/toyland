exports.handler = async (event) => {
  if (event.httpMethod === 'OPTIONS') return { statusCode: 200, headers: corsHeaders() };
  if (event.httpMethod !== 'POST') return { statusCode: 405, body: 'Method not allowed' };

  const CLOUD_NAME = process.env.CLOUDINARY_CLOUD_NAME;
  const UPLOAD_PRESET = process.env.CLOUDINARY_UPLOAD_PRESET;

  if (!CLOUD_NAME || !UPLOAD_PRESET) {
    return { statusCode: 500, headers: corsHeaders(), body: JSON.stringify({ error: 'Cloudinary not configured' }) };
  }

  try {
    const { fileBase64 } = JSON.parse(event.body || '{}');

    const params = new URLSearchParams();
    params.append('file', fileBase64);
    params.append('upload_preset', UPLOAD_PRESET.trim());

    const res = await fetch(`https://api.cloudinary.com/v1_1/${CLOUD_NAME.trim()}/image/upload`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: params.toString()
    });

    const data = await res.json();
    if (data.secure_url) {
      return { statusCode: 200, headers: corsHeaders(), body: JSON.stringify({ url: data.secure_url }) };
    }
    return { statusCode: 400, headers: corsHeaders(), body: JSON.stringify({ error: data.error?.message || 'Upload failed' }) };
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
