const SHEET_ID = '1SgXhWWgZhY9_g-hStutmrmMR1vsEKKNMxSKdj29DFcI';
const SECRET_KEY = 'TL_xK9#mP2@qR7';

function doGet(e) {
  return ContentService.createTextOutput('Apps Script Admin API Active');
}

function doPost(e) {
  try {
    const raw = e.parameter.data || e.postData.contents || '{}';
    const data = JSON.parse(decodeURIComponent(raw));

    if (data.secret !== SECRET_KEY) {
      return json({ error: 'Unauthorized' });
    }

    const action = data.action;
    const sheet = SpreadsheetApp.openById(SHEET_ID).getActiveSheet();

    switch (action) {
      case 'add_product':   return addProduct(sheet, data);
      case 'toggle_stock':  return toggleStock(sheet, data);
      case 'delete':        return deleteProduct(sheet, data);
      default:
        return json({ error: 'Unknown action' });
    }
  } catch (error) {
    return json({ error: error.toString() });
  }
}

function addProduct(sheet, data) {
  const lastRow = sheet.getLastRow();
  const allData = sheet.getDataRange().getValues();
  const maxId = allData.slice(1).reduce((max, row) => Math.max(max, parseInt(row[0]) || 0), 0);
  const newId = maxId + 1;

  // Write 11 columns: id|name|category|price|original_price|image_url|description|age_range|brand|in_stock|rating
  sheet.getRange(lastRow + 1, 1, 1, 11).setValues([[
    newId,
    data.name || '',
    data.category || '',
    data.price || 0,
    data.original_price || Math.round(data.price * 1.3),
    data.image_url || '',
    data.description || '',
    data.age_range || '',
    data.brand || '',
    data.stock === true || data.stock === 'true' ? 'TRUE' : 'FALSE',
    data.rating || ''
  ]]);

  return json({ success: true, id: newId });
}

function toggleStock(sheet, data) {
  const row = findRowById(sheet, data.id);
  if (row < 0) return json({ error: 'Product not found' });
  sheet.getRange(row, 10).setValue(data.stock === true || data.stock === 'true' ? 'TRUE' : 'FALSE');
  return json({ success: true });
}

function deleteProduct(sheet, data) {
  const row = findRowById(sheet, data.id);
  if (row < 0) return json({ error: 'Product not found' });
  sheet.deleteRow(row);
  reassignIds(sheet);
  return json({ success: true });
}

function reassignIds(sheet) {
  const lastRow = sheet.getLastRow();
  if (lastRow < 2) return;
  for (let i = 2; i <= lastRow; i++) {
    sheet.getRange(i, 1).setValue(i - 1);
  }
}

function findRowById(sheet, id) {
  const data = sheet.getDataRange().getValues();
  for (let i = 1; i < data.length; i++) {
    if (String(data[i][0]) === String(id)) return i + 1;
  }
  return -1;
}

function json(obj) {
  return ContentService.createTextOutput(JSON.stringify(obj))
    .setMimeType(ContentService.MimeType.JSON);
}
