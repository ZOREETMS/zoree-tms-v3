// ═══════════════════════════════════════════════════════════════════
// Auth Middleware — accepts both our JWT and Supabase tokens
// This allows login to work without needing a separate JWT step
// ═══════════════════════════════════════════════════════════════════

const jwt          = require('jsonwebtoken');
const { getTenant } = require('../services/tenants');

const JWT_SECRET    = process.env.JWT_SECRET || 'zoree-dev-secret';
const SUPABASE_URL  = process.env.SUPABASE_URL || 'https://ljbeihotrmyqthxptcgp.supabase.co';
const ANON_KEY      = process.env.SUPABASE_ANON_KEY;

async function authMiddleware(req, res, next) {
  const authHeader = req.headers.authorization;
  if (!authHeader?.startsWith('Bearer ')) {
    return res.status(401).json({ error: 'Missing or invalid Authorization header' });
  }

  const token = authHeader.slice(7);

  // ── Strategy 1: Try our own JWT first ─────────────────────────
  try {
    const decoded = jwt.verify(token, JWT_SECRET);
    const tenant  = await getTenant(decoded.tenantId || 'zoree-default');
    req.user   = {
      id:       decoded.sub,
      email:    decoded.email,
      role:     decoded.role || 'admin',
      tenantId: decoded.tenantId || 'zoree-default',
    };
    req.tenant = tenant;
    return next();
  } catch (jwtErr) {
    // Not our JWT — try Supabase token next
  }

  // ── Strategy 2: Verify with Supabase directly ─────────────────
  try {
    const sbRes = await fetch(`${SUPABASE_URL}/auth/v1/user`, {
      headers: {
        'Authorization': `Bearer ${token}`,
        'apikey': ANON_KEY,
      }
    });

    if (!sbRes.ok) {
      return res.status(401).json({ error: 'Invalid or expired token' });
    }

    const sbUser = await sbRes.json();
    const tenant = await getTenant('zoree-default');

    req.user = {
      id:       sbUser.id,
      email:    sbUser.email,
      role:     sbUser.user_metadata?.role || 'admin',
      tenantId: 'zoree-default',
      name:     sbUser.user_metadata?.full_name || sbUser.email,
    };
    req.tenant = tenant;
    return next();

  } catch (err) {
    return res.status(401).json({ error: 'Token verification failed' });
  }
}

// ── Role guard ─────────────────────────────────────────────────────
function requireRole(...roles) {
  return (req, res, next) => {
    if (!roles.includes(req.user?.role)) {
      return res.status(403).json({
        error: `Requires role: ${roles.join(' or ')}. Your role: ${req.user?.role}`
      });
    }
    next();
  };
}

// ── Feature guard ──────────────────────────────────────────────────
function requireFeature(feature) {
  return (req, res, next) => {
    const { hasFeature } = require('../services/tenants');
    if (!hasFeature(req.tenant, feature)) {
      return res.status(403).json({
        error: `Feature '${feature}' not available on your plan (${req.tenant?.tier})`,
        upgradeRequired: true,
      });
    }
    next();
  };
}

module.exports = { authMiddleware, requireRole, requireFeature };
