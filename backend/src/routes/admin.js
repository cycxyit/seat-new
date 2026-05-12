import express from 'express';
import { v4 as uuidv4 } from 'uuid';
import { runAsync, getAsync, allAsync } from '../db/init.js';
import { validateAdminKey } from '../middleware/auth.js';
import { createTabInSheet } from '../services/sheetsService.js';
import { syncDatabaseFromSheet, getDbSyncStatus } from '../services/dbSyncService.js';

const router = express.Router();

router.use(validateAdminKey);

// ─── 获取全局配置 ───────────────────────────────────────────
router.get('/config', async (req, res) => {
  try {
    const rows = await allAsync('SELECT key, value FROM config');
    const config = {};
    for (const row of rows) {
      config[row.key] = row.value;
    }
    res.json({ success: true, data: config });
  } catch (err) {
    res.status(500).json({ error: 'Failed to fetch config', message: err.message });
  }
});

// ─── 更新全局配置 ───────────────────────────────────────────
router.put('/config', async (req, res) => {
  try {
    const allowed = ['max_subjects', 'site_name', 'logo_url', 'footer_text', 'global_opening_time', 'global_closing_time'];
    const updates = Object.entries(req.body).filter(([k]) => allowed.includes(k));

    if (updates.length === 0) {
      return res.status(400).json({ error: 'No valid config keys provided' });
    }

    for (const [key, value] of updates) {
      await runAsync(
        `INSERT INTO config (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value`,
        [key, String(value)]
      );
    }

    res.json({ success: true, message: '配置已更新' });
  } catch (err) {
    res.status(500).json({ error: 'Failed to update config', message: err.message });
  }
});

// ─── 创建新科室 ─────────────────────────────────────────────
router.post('/theaters', async (req, res) => {
  try {
    const { name, rows, cols, subject, teacher, aisle_after, aisles, class_time, door_row, opening_time, disabled_seats } = req.body;

    if (!name || !rows || !cols) {
      return res.status(400).json({
        error: 'Missing required fields',
        message: '请提供科室名称、行数和列数'
      });
    }

    if (rows < 1 || cols < 1 || rows > 50 || cols > 50) {
      return res.status(400).json({
        error: 'Invalid dimensions',
        message: '行数和列数必须在 1-50 之间'
      });
    }

    const theaterId = uuidv4();
    const finalAisleAfter = aisle_after !== undefined ? parseInt(aisle_after, 10) : 5;
    
    // 智能解析多走道：支持数字或逗号分隔的字符串 (如 "5,10")
    let aislesArr = [finalAisleAfter];
    if (typeof aisle_after === 'string' && aisle_after.includes(',')) {
      aislesArr = aisle_after.split(',').map(s => parseInt(s.trim(), 10)).filter(n => !isNaN(n));
    } else if (Array.isArray(aisles)) {
      aislesArr = aisles;
    }

    const finalAisles = JSON.stringify(aislesArr);
    const finalDoorRow = door_row !== undefined ? parseInt(door_row, 10) : 0;
    const finalDisabledSeats = Array.isArray(disabled_seats) ? JSON.stringify(disabled_seats) : (disabled_seats || '[]');
    const tabName = [class_time, subject, teacher, name].filter(Boolean).join(' ');

    await runAsync(
      `INSERT INTO theaters (id, name, rows, cols, aisle_after, aisles, door_row, class_time, subject, teacher, tab_name, opening_time, disabled_seats)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [theaterId, name, rows, cols, finalAisleAfter, finalAisles, finalDoorRow, class_time || '', subject || '', teacher || '', tabName, opening_time || null, finalDisabledSeats]
    );

    try {
      await createTabInSheet({
        title: tabName,
        theaterName: name,
        rows,
        cols,
        aisles: JSON.parse(finalAisles),
        doorRow: finalDoorRow,
        classTime: class_time,
        subject,
        teacher,
        disabledSeats: JSON.parse(finalDisabledSeats)
      });
    } catch (sheetErr) {
      console.warn('⚠️ Failed to create sheet tab automatically:', sheetErr.message);
    }

    res.json({
      success: true,
      message: '科室创建成功！',
      data: { id: theaterId, name, rows, cols, aisle_after: finalAisleAfter, aisles: JSON.parse(finalAisles), door_row: finalDoorRow, class_time, subject, teacher, tab_name: tabName, opening_time, disabled_seats: JSON.parse(finalDisabledSeats) }
    });
  } catch (err) {
    console.error('Error creating theater:', err);
    res.status(500).json({ error: 'Failed to create theater', message: err.message });
  }
});

router.patch('/theaters/:id', async (req, res) => {
  try {
    const { id } = req.params;
    const exists = await getAsync('SELECT id, rows, cols FROM theaters WHERE id = ?', [id]);
    if (!exists) {
      return res.status(404).json({ success: false, error: 'not_found', message: '科室不存在' });
    }

    const payload = req.body || {};

    const updates = [];
    const params = [];

    if (payload.rows !== undefined) {
      const rows = parseInt(payload.rows, 10);
      if (!Number.isInteger(rows) || rows < 1 || rows > 50) {
        return res.status(400).json({ success: false, error: 'invalid_rows', message: '行数必须在 1-50 之间' });
      }
      updates.push('rows = ?');
      params.push(rows);
    }

    if (payload.cols !== undefined) {
      const cols = parseInt(payload.cols, 10);
      if (!Number.isInteger(cols) || cols < 1 || cols > 50) {
        return res.status(400).json({ success: false, error: 'invalid_cols', message: '列数必须在 1-50 之间' });
      }
      updates.push('cols = ?');
      params.push(cols);
    }

    if (payload.door_row !== undefined) {
      const doorRow = parseInt(payload.door_row, 10);
      if (!Number.isInteger(doorRow) || doorRow < 0 || doorRow > 50) {
        return res.status(400).json({ success: false, error: 'invalid_door_row', message: '门口排数必须在 0-50 之间' });
      }
      updates.push('door_row = ?');
      params.push(doorRow);
    }

    if (payload.aisles !== undefined || payload.aisle_after !== undefined) {
      const raw = payload.aisles !== undefined ? payload.aisles : payload.aisle_after;
      let aislesArr = [];
      if (Array.isArray(raw)) {
        aislesArr = raw.map(Number);
      } else if (typeof raw === 'string') {
        aislesArr = raw.split(',').map(s => parseInt(s.trim(), 10)).filter(n => !isNaN(n));
      } else if (raw !== null && raw !== undefined) {
        const n = parseInt(raw, 10);
        if (!isNaN(n)) aislesArr = [n];
      }

      aislesArr = Array.from(new Set(aislesArr))
        .filter(n => Number.isInteger(n) && n > 0)
        .sort((a, b) => a - b);

      if (aislesArr.length === 0) aislesArr = [5];

      const colsToValidate = payload.cols !== undefined ? parseInt(payload.cols, 10) : parseInt(exists.cols, 10);
      const invalidAisle = aislesArr.find(a => a >= colsToValidate);
      if (invalidAisle !== undefined) {
        return res.status(400).json({ success: false, error: 'invalid_aisles', message: '走道位置必须小于列数' });
      }

      updates.push('aisles = ?');
      params.push(JSON.stringify(aislesArr));
      updates.push('aisle_after = ?');
      params.push(aislesArr[0]);
    }

    if (payload.disabled_seats !== undefined || payload.disabled_seats_str !== undefined) {
      let disabledSeats = [];
      if (Array.isArray(payload.disabled_seats)) {
        disabledSeats = payload.disabled_seats.map(String);
      } else if (typeof payload.disabled_seats === 'string') {
        try {
          const parsed = JSON.parse(payload.disabled_seats);
          if (Array.isArray(parsed)) disabledSeats = parsed.map(String);
        } catch (_) {
          disabledSeats = payload.disabled_seats.split(',').map(s => s.trim()).filter(Boolean);
        }
      } else if (typeof payload.disabled_seats_str === 'string') {
        disabledSeats = payload.disabled_seats_str.split(',').map(s => s.trim()).filter(Boolean);
      }

      disabledSeats = Array.from(new Set(disabledSeats.map(String))).filter(Boolean);
      updates.push('disabled_seats = ?');
      params.push(JSON.stringify(disabledSeats));
    }

    if (updates.length === 0) {
      return res.status(400).json({ success: false, error: 'no_updates', message: '没有可更新的字段' });
    }

    params.push(id);
    await runAsync(`UPDATE theaters SET ${updates.join(', ')} WHERE id = ?`, params);

    const updated = await getAsync(
      'SELECT id, name, rows, cols, aisle_after, aisles, door_row, class_time, subject, teacher, tab_name, opening_time, disabled_seats FROM theaters WHERE id = ?',
      [id]
    );

    res.json({ success: true, message: '科室已更新', data: updated });
  } catch (err) {
    console.error('Error updating theater:', err);
    res.status(500).json({ success: false, error: 'update_failed', message: err.message });
  }
});

router.patch('/theaters/:id/tab-name', async (req, res) => {
  try {
    const { id } = req.params;
    const { tab_name } = req.body || {};
    const newTabName = String(tab_name || '').trim();
    if (!newTabName) {
      return res.status(400).json({ success: false, error: 'invalid_input', message: 'tab_name 不能为空' });
    }

    const exists = await getAsync('SELECT id FROM theaters WHERE id = ?', [id]);
    if (!exists) {
      return res.status(404).json({ success: false, error: 'not_found', message: '科室不存在' });
    }

    await runAsync('UPDATE theaters SET tab_name = ? WHERE id = ?', [newTabName, id]);
    const updated = await getAsync(
      'SELECT id, name, rows, cols, aisle_after, aisles, door_row, class_time, subject, teacher, tab_name, opening_time, disabled_seats FROM theaters WHERE id = ?',
      [id]
    );

    res.json({ success: true, message: 'Tab 名称已更新', data: updated });
  } catch (err) {
    console.error('Error updating theater tab_name:', err);
    res.status(500).json({ success: false, error: 'update_failed', message: err.message });
  }
});

// ─── 删除科室 ───────────────────────────────────────────────
router.delete('/theaters/:id', async (req, res) => {
  try {
    const { id } = req.params;
    const theater = await getAsync('SELECT id FROM theaters WHERE id = ?', [id]);
    if (!theater) {
      return res.status(404).json({ error: 'Theater not found' });
    }
    await runAsync('DELETE FROM bookings WHERE theater_id = ?', [id]);
    await runAsync('DELETE FROM theaters WHERE id = ?', [id]);
    res.json({ success: true, message: '科室删除成功' });
  } catch (err) {
    console.error('Error deleting theater:', err);
    res.status(500).json({ error: 'Failed to delete theater' });
  }
});

// ─── 同步状态查询 ───────────────────────────────────────────
router.get('/sync-status', async (req, res) => {
  try {
    res.json({ success: true, data: getDbSyncStatus() });
  } catch (err) {
    res.status(500).json({ error: 'Failed to fetch sync status', message: err.message });
  }
});

// ─── 手动触发一次同步 ───────────────────────────────────────
router.post('/sync', async (req, res) => {
  try {
    const status = await syncDatabaseFromSheet();
    res.json({ success: true, data: status });
  } catch (err) {
    res.status(500).json({ error: 'Sync failed', message: err.message });
  }
});

export default router;
