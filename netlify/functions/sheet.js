exports.handler = async () => {
  const SHEET_ID = process.env.SHEET_ID;
  if (!SHEET_ID) return { statusCode: 500, body: JSON.stringify({ error: 'SHEET_ID not configured' }) };

  try {
    const res = await fetch(`https://docs.google.com/spreadsheets/d/${SHEET_ID}/gviz/tq?tqx=out:json`);
    const text = await res.text();
    return {
      statusCode: 200,
      headers: { 'Content-Type': 'text/plain', 'Cache-Control': 'no-cache' },
      body: text
    };
  } catch (err) {
    return { statusCode: 500, body: JSON.stringify({ error: err.message }) };
  }
};
