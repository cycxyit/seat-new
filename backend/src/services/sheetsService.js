import { google } from 'googleapis';
import { readFileSync } from 'fs';
import { resolve } from 'path';

let sheetsClient = null;

export async function initializeSheets() {
  try {
    let key;
    if (process.env.GOOGLE_SERVICE_ACCOUNT_KEY) {
      key = JSON.parse(process.env.GOOGLE_SERVICE_ACCOUNT_KEY);
    } else {
      const keyPath = resolve(process.env.GOOGLE_SERVICE_ACCOUNT_KEY_PATH || './config/service-key.json');
      key = JSON.parse(readFileSync(keyPath, 'utf8'));
    }
    const auth = new google.auth.GoogleAuth({
      credentials: key,
      scopes: ['https://www.googleapis.com/auth/spreadsheets']
    });
    sheetsClient = google.sheets({ version: 'v4', auth });
    console.log('✅ Google Sheets API initialized');
    return sheetsClient;
  } catch (err) {
    console.warn('⚠️ Google Sheets initialization skipped:', err.message);
    return null;
  }
}

// ─── Helpers ──────────────────────────────────────────────────

function colToLetter(column) {
  let temp, letter = '';
  while (column > 0) {
    temp = (column - 1) % 26;
    letter = String.fromCharCode(temp + 65) + letter;
    column = (column - temp - 1) / 26;
  }
  return letter;
}

function getSpreadsheetId() {
  return process.env.GOOGLE_SHEETS_ID;
}

function normalizeAisles(aisles) {
  if (Array.isArray(aisles)) {
    return aisles.map(a => parseInt(a, 10)).filter(a => !Number.isNaN(a)).sort((a, b) => a - b);
  }
  if (typeof aisles === 'string') {
    try {
      const parsed = JSON.parse(aisles);
      if (Array.isArray(parsed)) {
        return parsed.map(a => parseInt(a, 10)).filter(a => !Number.isNaN(a)).sort((a, b) => a - b);
      }
    } catch {
      const num = parseInt(aisles, 10);
      return Number.isNaN(num) ? [5] : [num];
    }
  }
  const num = parseInt(aisles, 10);
  return Number.isNaN(num) ? [5] : [num];
}

function isPhysicalColumnAisle(physCol, aisles) {
  const aislePositions = normalizeAisles(aisles);
  for (let i = 0; i < aislePositions.length; i++) {
    const aisleNum = aislePositions[i];
    // 物理列 = 逻辑列 + 1(行标) + 之前的所有过道数 + 1(当前过道)
    if (physCol === aisleNum + i + 2) {
      return true;
    }
  }
  return false;
}

function getPhysicalPosition(r, c, aisles) {
  const physicalRow = r * 2 + 2;
  let physicalCol = c + 1; // 基础：1(行标) + c
  const aislePositions = normalizeAisles(aisles);
  for (const aisleNum of aislePositions) {
    if (c > aisleNum) {
      physicalCol += 1;
    }
  }
  return { physicalRow, physicalCol };
}

function getLogicalPosition(pRowIndex, pColIndex, maxCols, aisles) {
  const physCol = pColIndex + 1;
  if (physCol === 1) return null; // A列是行标
  
  // 检查是否是过道列
  if (isPhysicalColumnAisle(physCol, aisles)) return null;

  const physicalRow = pRowIndex + 1;
  // 检查是否是座位行（2, 4, 6... 偏移后的 4, 6, 8...）
  if (physicalRow < 4 || (physicalRow - 2) % 2 !== 0) return null;
  const r = Math.floor((physicalRow - 2) / 2);

  const aislePositions = normalizeAisles(aisles);
  let c = physCol - 1; // 减去行标列
  for (let i = 0; i < aislePositions.length; i++) {
    // 如果物理列在第 i 个过道之后，则逻辑列需要减 1
    if (physCol > aislePositions[i] + i + 2) {
      c -= 1;
    }
  }

  if (c > maxCols || c < 1) return null;
  return { r, c };
}

function isSeatOccupiedCellValue(cellValue) {
  const v = String(cellValue ?? '').trim();
  if (!v) return false;
  const normalized = v.replace(/\s+/g, '').toLowerCase();
  if (normalized === '(无座)' || normalized === '无座') return false;
  if (normalized === '(noseat)' || normalized === 'noseat') return false;
  return true;
}

// ─── 1. 获取座位占用状况 ──────────────────────────────────────
export async function getSeatMapFromSheet(tabName, maxRow, maxCol, aisles = [5]) {
  if (!sheetsClient) return {};
  try {
    const spreadsheetId = getSpreadsheetId();
    if (!spreadsheetId) return {};

    const aisleCount = normalizeAisles(aisles).length;
    const maxPhysColIndex = maxCol + aisleCount + 1; // +1 for column A (row labels)
    const endColLetter = colToLetter(maxPhysColIndex + 2); // extra buffer to avoid truncation
    const range = `'${tabName}'!A1:${endColLetter}${maxRow * 2 + 5}`;

    const response = await sheetsClient.spreadsheets.values.get({ spreadsheetId, range });
    const rows = response.data.values || [];
    const seatMap = {};

    for (let rIndex = 0; rIndex < rows.length; rIndex++) {
      const rowData = rows[rIndex];
      for (let cIndex = 0; cIndex < rowData.length; cIndex++) {
        const cellValue = rowData[cIndex];
        if (isSeatOccupiedCellValue(cellValue)) {
          const logical = getLogicalPosition(rIndex, cIndex, maxCol, aisles);
          if (logical) {
            seatMap[`${logical.r}-${logical.c}`] = String(cellValue).trim();
          }
        }
      }
    }
    return seatMap;
  } catch (err) {
    if (err.message && err.message.includes('Unable to parse range')) throw err;
    console.error(`❌ Error fetching seat map for [${tabName}]:`, err.message);
    throw err;
  }
}

export async function getSeatsFromSheet(tabName, maxRow, maxCol, aisles = [5]) {
  const seatMap = await getSeatMapFromSheet(tabName, maxRow, maxCol, aisles);
  return Object.keys(seatMap);
}

export async function getSeatValueFromSheet(tabName, row, col, aisles = [5]) {
  if (!sheetsClient) return '';
  const spreadsheetId = getSpreadsheetId();
  if (!spreadsheetId) return '';

  const { physicalRow, physicalCol } = getPhysicalPosition(row, col, aisles);
  const cellRef = `${colToLetter(physicalCol)}${physicalRow}`;
  const range = `'${tabName}'!${cellRef}`;

  try {
    const response = await sheetsClient.spreadsheets.values.get({ spreadsheetId, range });
    const value = response.data.values?.[0]?.[0];
    return value ? String(value).trim() : '';
  } catch (err) {
    if (err.message && (err.message.includes('Unable to parse range') || err.message.includes('is not valid'))) {
      return '';
    }
    console.error(`❌ Error fetching seat value for [${tabName} ${cellRef}]:`, err.message);
    throw err;
  }
}

// ─── 2. 更新座位格 ────────────────────────────────────────────
export async function updateSeatInSheet(tabName, row, col, infoString, aisles = [5]) {
  if (!sheetsClient) return false;
  try {
    const spreadsheetId = getSpreadsheetId();
    const { physicalRow, physicalCol } = getPhysicalPosition(row, col, aisles);
    const cellRef = `${colToLetter(physicalCol)}${physicalRow}`;
    console.log(`Updating seat: tabName=${tabName}, row=${row}, col=${col}, aisles=${JSON.stringify(aisles)}, physicalRow=${physicalRow}, physicalCol=${physicalCol}, cellRef=${cellRef}`);
    const range = `'${tabName}'!${cellRef}`;

    await sheetsClient.spreadsheets.values.update({
      spreadsheetId,
      range,
      valueInputOption: 'USER_ENTERED',
      requestBody: { values: [[infoString]] }
    });

    console.log(`✅ Updated cell ${cellRef} in tab '${tabName}'`);
    return true;
  } catch (err) {
    console.error(`❌ Error updating seat for [${tabName}]:`, err.message);
    throw err;
  }
}

// ─── 3. 追加总名单记录（支持多科目）────────────────────────────
export async function appendBookingRecord(bookingData) {
  if (!sheetsClient) return;
  try {
    const spreadsheetId = getSpreadsheetId();
    const recordsTab = process.env.GOOGLE_SHEETS_RECORDS_TAB || '总名单';
    const { session_id, user_code, name, student_id, parent_phone, phone, receipt_url, timestamp, bookings = [] } = bookingData;
    
    const maxSubCols = parseInt(process.env.MAX_SUBJECTS || '10', 10);

    // 确保表头存在且布局一致
    await ensureRecordsTabAndHeader(spreadsheetId, recordsTab, maxSubCols);

    // 构造行数据 (严格按照用户给定的 A-T 规范):
    // A (0): 提交时间
    // B (1): 工号 (user_code)
    // C (2): 姓名 (name)
    // D (3): Student ID (student_id)
    // E (4): Parent's Phone (parent_phone)
    // F (5): 电话 (phone)
    // G (6): 补几科 (bookings.length)
    // H (7): 凭证链接 (receipt_url) - 移动到此处
    // I-L (8-11): 科目1 (科目, 老师, 科室, 座位)
    // M-P (12-15): 科目2
    // ... 更多科目
    const row = new Array(8 + maxSubCols * 4).fill(''); 
    row[0] = timestamp || new Date().toISOString();
    row[1] = user_code || '';
    row[2] = name || '';
    row[3] = student_id || bookingData.studentId || '';
    row[4] = parent_phone || bookingData.parentPhone || '';
    row[5] = phone || '';
    row[6] = bookings.length;
    row[7] = receipt_url || '';
    
    // 填充科目信息 (从 I 列开始，索引 8)
    for (let i = 0; i < maxSubCols; i++) {
        const startIdx = 8 + (i * 4); // I(8), M(12), Q(16)
        if (bookings[i] && startIdx < row.length) {
            row[startIdx] = bookings[i].subject || '';
            row[startIdx + 1] = bookings[i].teacher || '';
            row[startIdx + 2] = bookings[i].theater_name || '';
            row[startIdx + 3] = bookings[i].seatFormatted || '';
        }
    }

    const normalizedUserCode = String(user_code ?? '').trim().toLowerCase();
    const blankRow = new Array(row.length).fill('');
    const bColRes = await sheetsClient.spreadsheets.values.get({ spreadsheetId, range: `'${recordsTab}'!B:B` });
    const bColValues = bColRes.data.values || [];
    const matchedRowIndices = [];

    if (normalizedUserCode) {
      for (let i = 0; i < bColValues.length; i++) {
        const v = String(bColValues[i]?.[0] ?? '').trim().toLowerCase();
        if (v && v === normalizedUserCode) matchedRowIndices.push(i);
      }
    }

    if (matchedRowIndices.length > 0) {
      const targetIndex = matchedRowIndices[matchedRowIndices.length - 1];
      const targetRowNumber = targetIndex + 1;
      const updateRange = `'${recordsTab}'!A${targetRowNumber}:${colToLetter(row.length)}${targetRowNumber}`;
      await sheetsClient.spreadsheets.values.update({
        spreadsheetId,
        range: updateRange,
        valueInputOption: 'USER_ENTERED',
        requestBody: { values: [row] }
      });

      for (let i = 0; i < matchedRowIndices.length - 1; i++) {
        const idx = matchedRowIndices[i];
        const rowNumber = idx + 1;
        const clearRange = `'${recordsTab}'!A${rowNumber}:${colToLetter(row.length)}${rowNumber}`;
        await sheetsClient.spreadsheets.values.update({
          spreadsheetId,
          range: clearRange,
          valueInputOption: 'USER_ENTERED',
          requestBody: { values: [blankRow] }
        });
      }

      console.log(`✅ Master record updated at row ${targetRowNumber} (User: ${user_code})`);
      if (matchedRowIndices.length > 1) {
        console.warn(`⚠️ Duplicate master record rows detected and cleared: ${matchedRowIndices.length} (User: ${user_code})`);
      }
    } else {
      const appendRange = `'${recordsTab}'!A:${colToLetter(row.length)}`;
      await sheetsClient.spreadsheets.values.append({
        spreadsheetId,
        range: appendRange,
        valueInputOption: 'USER_ENTERED',
        requestBody: { values: [row] }
      });

      const recheckRes = await sheetsClient.spreadsheets.values.get({ spreadsheetId, range: `'${recordsTab}'!B:B` });
      const recheckValues = recheckRes.data.values || [];
      const reMatched = [];
      if (normalizedUserCode) {
        for (let i = 0; i < recheckValues.length; i++) {
          const v = String(recheckValues[i]?.[0] ?? '').trim().toLowerCase();
          if (v && v === normalizedUserCode) reMatched.push(i);
        }
      }
      if (reMatched.length > 1) {
        const targetIndex = reMatched[reMatched.length - 1];
        const targetRowNumber = targetIndex + 1;
        const updateRange = `'${recordsTab}'!A${targetRowNumber}:${colToLetter(row.length)}${targetRowNumber}`;
        await sheetsClient.spreadsheets.values.update({
          spreadsheetId,
          range: updateRange,
          valueInputOption: 'USER_ENTERED',
          requestBody: { values: [row] }
        });

        for (let i = 0; i < reMatched.length - 1; i++) {
          const idx = reMatched[i];
          const rowNumber = idx + 1;
          const clearRange = `'${recordsTab}'!A${rowNumber}:${colToLetter(row.length)}${rowNumber}`;
          await sheetsClient.spreadsheets.values.update({
            spreadsheetId,
            range: clearRange,
            valueInputOption: 'USER_ENTERED',
            requestBody: { values: [blankRow] }
          });
        }
        console.warn(`⚠️ Duplicate master record rows detected after append and cleared: ${reMatched.length} (User: ${user_code})`);
      } else {
        console.log(`✅ Master record appended (User: ${user_code})`);
      }
    }
  } catch (err) {
    console.error('❌ Error in master record sync:', err.message);
  }
}

export async function searchBookingRecord(userCode, name) {
  if (!sheetsClient) {
    throw new Error('Google Sheets service unavailable');
  }

  const spreadsheetId = getSpreadsheetId();
  if (!spreadsheetId) {
    throw new Error('Google Sheets spreadsheet ID is not configured');
  }

  const recordsTab = process.env.GOOGLE_SHEETS_RECORDS_TAB || '总名单';
  const maxSubCols = parseInt(process.env.MAX_SUBJECTS || '10', 10);
  const totalCols = 8 + maxSubCols * 4;
  const range = `'${recordsTab}'!A2:${colToLetter(totalCols)}`;

  const response = await sheetsClient.spreadsheets.values.get({ spreadsheetId, range });
  const rows = response.data.values || [];
  const normalizedCode = String(userCode || '').trim().toLowerCase();
  const normalizedName = String(name || '').trim().toLowerCase();

  for (const row of rows) {
    const rowCode = String(row[1] || '').trim().toLowerCase();
    const rowName = String(row[2] || '').trim().toLowerCase();
    if (!rowCode || !rowName) continue;

    if (rowCode === normalizedCode && rowName.includes(normalizedName)) {
      const subjectCount = parseInt(row[6], 10) || 0;
      const bookings = [];
      for (let i = 0; i < subjectCount; i++) {
        const offset = 8 + i * 4;
        bookings.push({
          subject: row[offset] || '',
          teacher: row[offset + 1] || '',
          theater_name: row[offset + 2] || '',
          seat: row[offset + 3] || ''
        });
      }

      return {
        user_code: String(row[1] || ''),
        name: String(row[2] || ''),
        student_id: String(row[3] || ''),
        subject_count: subjectCount,
        bookings
      };
    }
  }

  return null;
}

// ─── Ensure Records tab and header row exist ──────────────────
async function ensureRecordsTabAndHeader(spreadsheetId, tabName, subjectCount) {
  try {
    const meta = await sheetsClient.spreadsheets.get({ spreadsheetId });
    const exists = meta.data.sheets.some(s => s.properties.title === tabName);

    if (!exists) {
      await sheetsClient.spreadsheets.batchUpdate({
        spreadsheetId,
        requestBody: { requests: [{ addSheet: { properties: { title: tabName } } }] }
      });
    }

    // Build header row
    // A:提交时间, B:工号, C:姓名, D:Student ID, E:Parent's Phone, F:电话, G:补几科, H:凭证链接
    const header = ['提交时间', '工号', '姓名', 'Student ID', '家长电话', '电话', '补几科', '凭证链接'];
    for (let i = 1; i <= subjectCount; i++) {
        header.push(`科目${i}`, `老师${i}`, `科室${i}`, `座位${i}`);
    }

    // 强力校准：每次同步都检查一次表头，如果不匹配则重写（或至少确保第一次写入是正确的）
    const headerRange = `'${tabName}'!A1:${colToLetter(header.length)}1`;
    await sheetsClient.spreadsheets.values.update({
        spreadsheetId,
        range: headerRange,
        valueInputOption: 'USER_ENTERED',
        requestBody: { values: [header] }
    });
  } catch (err) {
    console.warn('⚠️ Could not ensure Records tab/header:', err.message);
  }
}

// ─── 4. 管理员创建科室时建 Tab 并格式化 ──────────────────────
export async function createTabInSheet(options) {
  if (!sheetsClient) return;
  const { title, theaterName, rows, cols, aisles: rawAisles, doorRow, classTime, subject, teacher } = options;
  try {
    const spreadsheetId = getSpreadsheetId();
    const meta = await sheetsClient.spreadsheets.get({ spreadsheetId });
    const exists = meta.data.sheets.some(s => s.properties.title === title);
    if (exists) {
      console.log(`ℹ️ Sheet tab '${title}' already exists.`);
      return;
    }

    const addSheetResponse = await sheetsClient.spreadsheets.batchUpdate({
      spreadsheetId,
      requestBody: { requests: [{ addSheet: { properties: { title } } }] }
    });

    const sheetId = addSheetResponse.data.replies[0].addSheet.properties.sheetId;
    const aisles = Array.isArray(rawAisles) ? rawAisles : [rawAisles || 5];
    const maxPhysCols = cols + aisles.length;
    const endColIndex = maxPhysCols + 1;
    const requests = [];

    // Cell A1: Theater name (yellow bg)
    requests.push({
      updateCells: {
        range: { sheetId, startRowIndex: 0, endRowIndex: 1, startColumnIndex: 0, endColumnIndex: 2 },
        rows: [{
          values: [{
            userEnteredValue: { stringValue: theaterName || 'BLK' },
            userEnteredFormat: {
              backgroundColor: { red: 1, green: 1, blue: 0.8 },
              textFormat: { bold: true, fontSize: 14 },
              horizontalAlignment: 'CENTER', verticalAlignment: 'MIDDLE'
            }
          }]
        }],
        fields: 'userEnteredValue,userEnteredFormat'
      }
    });
    requests.push({
      mergeCells: {
        range: { sheetId, startRowIndex: 0, endRowIndex: 1, startColumnIndex: 0, endColumnIndex: 2 },
        mergeType: 'MERGE_ALL'
      }
    });

    // Top title: subject + time + teacher
    const topTitle = `${subject || ''} ${classTime || ''} ${teacher || ''}`.trim() || 'Class Info';
    requests.push({
      updateCells: {
        range: { sheetId, startRowIndex: 0, endRowIndex: 1, startColumnIndex: 3, endColumnIndex: Math.max(endColIndex, 5) },
        rows: [{
          values: [{
            userEnteredValue: { stringValue: topTitle },
            userEnteredFormat: { textFormat: { bold: true, fontSize: 16 }, horizontalAlignment: 'CENTER' }
          }]
        }],
        fields: 'userEnteredValue,userEnteredFormat'
      }
    });
    requests.push({
      mergeCells: {
        range: { sheetId, startRowIndex: 0, endRowIndex: 1, startColumnIndex: 3, endColumnIndex: Math.max(endColIndex, 5) },
        mergeType: 'MERGE_ALL'
      }
    });

    // Whiteboard at Row 2
    requests.push({
      updateCells: {
        range: { sheetId, startRowIndex: 1, endRowIndex: 2, startColumnIndex: 2, endColumnIndex: Math.max(endColIndex - 1, 4) },
        rows: [{
          values: [{
            userEnteredValue: { stringValue: 'Whiteboard / 白板' },
            userEnteredFormat: {
              horizontalAlignment: 'CENTER',
              borders: {
                top: { style: 'SOLID' }, bottom: { style: 'SOLID' },
                left: { style: 'SOLID' }, right: { style: 'SOLID' }
              }
            }
          }]
        }],
        fields: 'userEnteredValue,userEnteredFormat'
      }
    });
    requests.push({
      mergeCells: {
        range: { sheetId, startRowIndex: 1, endRowIndex: 2, startColumnIndex: 2, endColumnIndex: Math.max(endColIndex - 1, 4) },
        mergeType: 'MERGE_ALL'
      }
    });

    await sheetsClient.spreadsheets.batchUpdate({ spreadsheetId, requestBody: { requests } });
    await drawGridElements(spreadsheetId, title, rows, cols, rows * 2 + 2, aisles, doorRow, maxPhysCols, options.disabledSeats);

    console.log(`✅ Created and formatted new sheet tab '${title}'`);
  } catch (err) {
    console.error(`❌ Error creating tab in Google Sheets:`, err.message);
  }
}

export async function updateTheaterTabLayoutInSheet(options) {
  if (!sheetsClient) return false;
  const {
    tabName,
    rows,
    cols,
    aisles,
    doorRow,
    disabledSeats = [],
    previousDisabledSeats = [],
    clearAll = false
  } = options || {};

  const title = String(tabName || '').trim();
  if (!title) return false;

  const spreadsheetId = getSpreadsheetId();
  if (!spreadsheetId) return false;

  const meta = await sheetsClient.spreadsheets.get({ spreadsheetId });
  const exists = meta.data.sheets.some(s => s.properties.title === title);
  if (!exists) return false;

  const aisleList = normalizeAisles(aisles);
  const maxPhysCols = parseInt(cols, 10) + aisleList.length;
  const endColLetter = colToLetter(maxPhysCols + 1);
  const endRow = parseInt(rows, 10) * 2 + 2;

  if (clearAll) {
    await sheetsClient.spreadsheets.values.clear({
      spreadsheetId,
      range: `'${title}'!A3:${endColLetter}${endRow}`
    });
  }

  const removed = new Set(previousDisabledSeats.map(String));
  for (const s of disabledSeats.map(String)) removed.delete(s);
  const removedArr = Array.from(removed);
  if (removedArr.length > 0) {
    const clearUpdates = [];
    for (const seat of removedArr) {
      const [rRaw, cRaw] = String(seat).split('-');
      const r = parseInt(rRaw, 10);
      const c = parseInt(cRaw, 10);
      if (!Number.isInteger(r) || !Number.isInteger(c)) continue;
      const { physicalRow, physicalCol } = getPhysicalPosition(r, c, aisleList);
      const cellRef = `${colToLetter(physicalCol)}${physicalRow}`;
      clearUpdates.push({ range: `'${title}'!${cellRef}`, values: [['']] });
    }
    if (clearUpdates.length > 0) {
      await sheetsClient.spreadsheets.values.batchUpdate({
        spreadsheetId,
        requestBody: { valueInputOption: 'USER_ENTERED', data: clearUpdates }
      });
    }
  }

  await drawGridElements(
    spreadsheetId,
    title,
    parseInt(rows, 10),
    parseInt(cols, 10),
    parseInt(rows, 10) * 2 + 2,
    aisleList,
    parseInt(doorRow, 10) || 0,
    maxPhysCols,
    disabledSeats
  );

  return true;
}

async function drawGridElements(spreadsheetId, tabName, rows, cols, maxPhysRows, aisles, doorRow, maxPhysCols, disabledSeats = []) {
  const headerArr = [''];
  let colCounter = 1;

  for (let c = 1; c <= maxPhysCols; c++) {
    // 物理列 = c + 1 (因为 c=1 对应 B列)
    const physCol = c + 1;
    if (isPhysicalColumnAisle(physCol, aisles)) {
      headerArr.push('');
    } else {
      headerArr.push(String.fromCharCode(64 + colCounter));
      colCounter++;
    }
  }

  await sheetsClient.spreadsheets.values.update({
    spreadsheetId,
    range: `'${tabName}'!A3:${colToLetter(maxPhysCols + 1)}3`,
    valueInputOption: 'USER_ENTERED',
    requestBody: { values: [headerArr] }
  });

  const rowUpdates = [];
  const disabledSet = new Set(disabledSeats);
  for (let r = 1; r <= rows; r++) {
    const pRow = r * 2 + 2;
    const cellValue = parseInt(doorRow) === r ? `${r} 🚪门口` : `${r}`;
    rowUpdates.push({ range: `'${tabName}'!A${pRow}`, values: [[cellValue]] });

    // 处理这一行的禁用座位
    for (let c = 1; c <= cols; c++) {
      if (disabledSet.has(`${r}-${c}`)) {
        const { physicalRow, physicalCol } = getPhysicalPosition(r, c, aisles);
        const cellRef = `${colToLetter(physicalCol)}${physicalRow}`;
        rowUpdates.push({ 
          range: `'${tabName}'!${cellRef}`, 
          values: [['(无座)']] // 在表格中标记为无座，或者留空
        });
      }
    }
  }

  if (rowUpdates.length > 0) {
    await sheetsClient.spreadsheets.values.batchUpdate({
      spreadsheetId,
      requestBody: { valueInputOption: 'USER_ENTERED', data: rowUpdates }
    });
  }
}
