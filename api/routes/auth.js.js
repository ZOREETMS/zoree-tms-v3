// ═══════════════════════════════════════════════════════════════════
// Auth Routes — /api/auth/*
// Login uses Supabase directly — no separate JWT required
// ═══════════════════════════════════════════════════════════════════

const router  = require('express').Router();
const { getTenant } = require('../services/tenants');
const { authMiddleware } = require('../middleware/auth');

const SUPABASE_URL = process.env.SUPABASE_URL || 'https://ljbeihotrmyqthxptcgp.supabase.co';
const ANON_KEY     = process.env.SUPABASE_ANON_KEY || 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImxqYmVpaG90cm15cXRoeHB0Y2dwIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NzI4OTg1ODIsImV4cCI6MjA4ODQ3NDU4Mn0.dc1WOPBdJuDKOOjJnl1roVFVI6e0DMrAD1zQf2iJqAE';

// POST /api/auth/login
router.post('/login', async (req, res, next) => {
  try {
    const { email, password, tenantId = 'zoree-default' } = req.body;
    if (!email || !password) {
      return res.status(400).json({ error: 'email and password are required' });
    }

    // Authenticate directly with Supabase
    const sbRes = await fetch(`${SUPABASE_URL}/auth/v1/token?grant_type=password`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'apikey': ANON_KEY,
      },
      body: JSON.stringify({ email, password }),
    });

    const sbData = await sbRes.json();

    if (!sbRes.ok || !sbData.access_token) {
      return res.status(401).json({ error: 'Invalid email or password' });
    }

    // Resolve tenant config
    const tenant = await getTenant(tenantId);
    const user   = sbData.user;

    // Return Supabase token directly — frontend uses it as-is
    res.json({
      token: sbData.access_token,
      user: {
        id:       user.id,
        email:    user.email,
        name:     user.user_metadata?.full_name || email.split('@')[0],
        role:     user.user_metadata?.role || 'admin',
        tenantId,
      },
      tenant: {
        id:           tenant.id,
        brandName:    tenant.brandName,
        logoUrl:      tenant.logoUrl,
        primaryColor: tenant.primaryColor,
        tier:         tenant.tier,
        features:     tenant.features,
      },
      expiresIn: sbData.expires_in,
    });

  } catch (err) {
    next(err);
  }
});

// GET /api/auth/me
router.get('/me', authMiddleware, (req, res) => {
  res.json({
    user:   req.user,
    tenant: {
      id:           req.tenant.id,
      brandName:    req.tenant.brandName,
      logoUrl:      req.tenant.logoUrl,
      primaryColor: req.tenant.primaryColor,
      tier:         req.tenant.tier,
      features:     req.tenant.features,
    },
  });
});

// POST /api/auth/logout
router.post('/logout', authMiddleware, (req, res) => {
  res.json({ success: true, message: 'Signed out' });
});

module.exports = router;
