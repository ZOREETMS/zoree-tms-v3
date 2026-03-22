// ═══════════════════════════════════════════════════════════════════
// Auth Routes — /api/auth/*
// ═══════════════════════════════════════════════════════════════════

const router  = require('express').Router();
const jwt     = require('jsonwebtoken');
const { signIn, verifyToken } = require('../services/supabase');
const { getTenant } = require('../services/tenants');
const { authMiddleware } = require('../middleware/auth');

const JWT_SECRET = process.env.JWT_SECRET || 'zoree-dev-secret';
const JWT_EXPIRY = process.env.JWT_EXPIRY  || '8h';

// POST /api/auth/login
router.post('/login', async (req, res, next) => {
  try {
    const { email, password, tenantId = 'zoree-default' } = req.body;
    if (!email || !password) {
      return res.status(400).json({ error: 'email and password are required' });
    }

    // Resolve tenant (to get their Supabase project if multi-tenant)
    const tenant = await getTenant(tenantId);

    // Authenticate with Supabase
    const { session, user } = await signIn(email, password, {
      supabaseUrl: tenant.supabaseUrl,
      supabaseKey: tenant.supabaseKey,
    });

    // Issue our own JWT (wraps Supabase session + tenant info)
    const token = jwt.sign(
      {
        sub:      user.id,
        email:    user.email,
        role:     user.user_metadata?.role || 'admin',
        tenantId: tenantId,
      },
      JWT_SECRET,
      { expiresIn: JWT_EXPIRY }
    );

    res.json({
      token,
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
      expiresIn: JWT_EXPIRY,
    });

  } catch (err) {
    // Don't leak internal errors on auth failures
    if (err.message?.toLowerCase().includes('invalid') || err.message?.toLowerCase().includes('credentials')) {
      return res.status(401).json({ error: 'Invalid email or password' });
    }
    next(err);
  }
});

// GET /api/auth/me — returns current user + tenant from token
router.get('/me', authMiddleware, async (req, res) => {
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
  // JWT is stateless — client just discards the token.
  // In production: add token to a short-lived blocklist (Redis)
  res.json({ success: true, message: 'Signed out' });
});

module.exports = router;
