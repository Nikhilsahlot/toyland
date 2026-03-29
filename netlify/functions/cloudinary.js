  const FormData = require('form-data');

exports.handler = async (event) => {
  if (event.httpMethod === 'OPTIONS') return { statusCode: 200, headers: corsHeaders() };
  if (event.httpMethod !== 'POST') return { statusCode: 405, body: 'Method not allowed' };

  const CLOUD_NAME = process.env.CLOUDINARY_CLOUD_NAME;
  const UPLOAD_PRESET = process.env.CLOUDINARY_UPLOAD_PRESET;

  if (!CLOUD_NAME || !UPLOAD_PRESET) {
    return { statusCode: 500, headers: corsHeaders(), body: JSON.stringify({ error: 'Cloudinary not configured' }) };
  }

  try {
    const fileBuffer = event.isBase64Encoded
      ? Buffer.from(event.body, 'base64')
      : Buffer.from(event.body, 'binary');

    const mimeType = event.headers['x-file-type'] || 'image/jpeg';
    const ext = mimeType.split('/')[1] || 'jpg';

    // Sanitize filename — strip slashes and special chars, set explicit public_id
    const rawName = (event.headers['x-file-name'] || 'product').replace(/\.[^/.]+$/, '');
    const safeName = rawName.replace(/[^a-zA-Z0-9_-]/g, '_').substring(0, 80);
    const publicId = `toyland_${safeName}_${Date.now()}`;

    const form = new FormData();
    form.append('file', fileBuffer, { filename: `${safeName}.${ext}`, contentType: mimeType });
    form.append('upload_preset', UPLOAD_PRESET);
    form.append('public_id', publicId);

    const res = await fetch(`https://api.cloudinary.com/v1_1/${CLOUD_NAME}/image/upload`, {
      method: 'POST',
      body: form,
      headers: form.getHeaders()
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
    'Access-Control-Allow-Headers': 'Content-Type, x-file-type, x-file-name',
    'Access-Control-Allow-Methods': 'POST, OPTIONS'
  };
}
