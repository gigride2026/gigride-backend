// routes/drivers.js
const express = require('express');
const router = express.Router();
const supabase = require('../utils/../utils/supabaseClient.cjs');

// GET all drivers
router.get('/', async (req, res) => {
  try {
    const { data, error } = await supabase.from('drivers').select('*');
    if (error) return res.status(400).json({ error: error.message });
    res.json(data);
  } catch (err) {
    console.error('Error fetching drivers:', err);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// GET driver by ID
router.get('/:id', async (req, res) => {
  const { id } = req.params;
  try {
    const { data, error } = await supabase.from('drivers').select('*').eq('id', id).single();
    if (error) return res.status(400).json({ error: error.message });
    res.json(data);
  } catch (err) {
    console.error('Error fetching driver:', err);
    res.status(500).json({ error: 'Internal server error' });
  }
});

module.exports = router;
