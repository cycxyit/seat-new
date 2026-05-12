import express from 'express';
import { allAsync, getAsync } from '../db/init.js';
import { addClient, removeClient } from '../sseManager.js';

const router = express.Router();

// Helper to get confirmed seats for a theater
async function getConfirmedSeatsFromDb(theater_id) {
  const rows = await allAsync('SELECT seats FROM bookings WHERE theater_id = ? AND status = ?', [theater_id, 'confirmed']);
  const seatSet = new Set();
  for (const row of rows) {
    try {
      const seats = JSON.parse(row.seats || '[]');
      seats.forEach((seat) => seatSet.add(seat));
    } catch (_) {
      // skip malformed row
    }
  }
  return Array.from(seatSet);
}

// GET /api/theaters - Get all theaters
router.get('/', async (req, res) => {
  try {
    const theaters = await allAsync(
      'SELECT id, name, rows, cols, aisle_after, aisles, door_row, class_time, subject, teacher, tab_name, opening_time, disabled_seats FROM theaters ORDER BY subject, class_time ASC'
    );
    
    const processed = theaters.map(t => {
      let aisles = [5];
      try {
        const parsed = JSON.parse(t.aisles || '[5]');
        aisles = Array.isArray(parsed) ? parsed.map(Number) : [Number(parsed)];
      } catch (e) { console.warn('Aisles parse error', e); }

      let disabled_seats = [];
      try {
        disabled_seats = JSON.parse(t.disabled_seats || '[]');
      } catch (e) { console.warn('Disabled seats parse error', e); }

      return { ...t, aisles, disabled_seats };
    });
    
    res.json({ success: true, data: processed || [], count: processed?.length || 0 });
  } catch (err) {
    console.error('Error fetching theaters:', err);
    res.status(500).json({ error: 'Failed to fetch theaters' });
  }
});

// GET /api/theaters/:id/seats - Get seats status for a theater
router.get('/:id/seats', async (req, res) => {
  try {
    const { id } = req.params;
    const theater = await getAsync(
      'SELECT id, name, rows, cols, aisle_after, aisles, door_row, class_time, subject, teacher, tab_name, opening_time, disabled_seats FROM theaters WHERE id = ?',
      [id]
    );

    if (!theater) {
      return res.status(404).json({ error: 'Theater not found' });
    }

    // Parse aisles
    let aisles = [5];
    try {
      const parsed = JSON.parse(theater.aisles || '[5]');
      aisles = Array.isArray(parsed) ? parsed.map(Number) : [Number(parsed)];
    } catch (e) { console.warn('Aisles parse error', e); }

    // Parse disabled seats
    let disabled_seats = [];
    try {
      disabled_seats = JSON.parse(theater.disabled_seats || '[]');
    } catch (e) { console.warn('Disabled seats parse error', e); }

    // Get booked seats from DB
    const booked_seats = await getConfirmedSeatsFromDb(id);

    const result = {
      ...theater,
      theater_id: theater.id,
      theater_name: theater.name,
      aisles,
      disabled_seats,
      booked_seats
    };

    res.json({ success: true, data: result });
  } catch (err) {
    console.error('Error fetching theater seats:', err);
    res.status(500).json({ error: 'Failed to fetch theater seats' });
  }
});

// GET /api/theaters/:id/stream - SSE real-time updates
router.get('/:id/stream', (req, res) => {
  const { id } = req.params;

  // SSE headers
  res.setHeader('Content-Type', 'text/event-stream');
  res.setHeader('Cache-Control', 'no-cache');
  res.setHeader('Connection', 'keep-alive');
  res.flushHeaders();

  // Initial keep-alive or sync
  res.write(':ok\n\n');

  // Register client
  addClient(id, res);

  // Remove client on close
  req.on('close', () => {
    removeClient(id, res);
  });
});

export default router;
