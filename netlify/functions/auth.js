exports.handler = async (event) => {
  if (event.httpMethod === 'OPTIONS') {
    return { statusCode: 200, headers: corsHeaders() };
  }
  if (event.httpMethod !== 'POST') {
    return { statusCode: 405, headers: corsHeaders(), body: JSON.stringify({ error: 'Method not allowed' }) };
  }

  const { username, password } = JSON.parse(event.body || '{}');
  const validUser = process.env.ADMIN_USERNAME;
  const validPass = process.env.ADMIN_PASSWORD;

  if (!validUser || !validPass) {
    return { statusCode: 500, headers: corsHeaders(), body: JSON.stringify({ error: 'Auth not configured' }) };
  }

  if (username === validUser && password === validPass) {
    return { statusCode: 200, headers: corsHeaders(), body: JSON.stringify({ success: true }) };
  }
  return { statusCode: 401, headers: corsHeaders(), body: JSON.stringify({ error: 'Invalid credentials' }) };
};

function corsHeaders() {
  return {
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Headers': 'Content-Type',
    'Access-Control-Allow-Methods': 'POST, OPTIONS'
  };
}
