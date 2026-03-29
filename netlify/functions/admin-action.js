exports.handler = async (event) => {
  if (event.httpMethod === 'OPTIONS') return { statusCode: 200, headers: corsHeaders() };
  if (event.httpMethod !== 'POST') return { statusCode: 405, body: 'Method not allowed' };

  const APPS_SCRIPT_URL = process.env.APPS_SCRIPT_URL;
  const APPS_SCRIPT_SECRET = process.env.APPS_SCRIPT_SECRET;

  if (!APPS_SCRIPT_URL) return { statusCode: 500, headers: corsHeaders(), body: JSON.stringify({ error: 'Not configured' }) };

  try {
    const data = JSON.parse(event.body || '{}');
    await fetch(APPS_SCRIPT_URL, {
      method: 'POST',
      body: new URLSearchParams({ data: JSON.stringify({ ...data, secret: APPS_SCRIPT_SECRET }) })
    });
    return { statusCode: 200, headers: corsHeaders(), body: JSON.stringify({ success: true }) };
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
