import express from 'express';
import fs from 'node:fs';
import path from 'node:path';
import helmet from 'helmet';
import compression from 'compression';
import cookieParser from 'cookie-parser';
import { config } from './config.js';
import { loadUser, csrfGuard, requireAuth } from './middleware/auth.js';
import authRoutes from './routes/auth.js';
import explorerRoutes from './routes/explorer.js';
import projectRoutes from './routes/projects.js';
import adminRoutes from './routes/admin.js';
import importRoutes from './routes/import.js';
import { getMeta } from './services/meta.js';
import { query } from './db.js';

/**
 * opts.worker — running on Cloudflare Workers: static files are served by Workers Assets,
 *               Cloudflare compresses responses, and opts.perRequest sets up the DB per request.
 */
export function createApp(opts = {}) {
  const app = express();
  app.set('trust proxy', 1);
  app.disable('x-powered-by');
  app.use(helmet({
    contentSecurityPolicy: {
      useDefaults: true,
      directives: {
        'script-src': ["'self'", 'https://accounts.google.com/gsi/client'],
        'frame-src': ["'self'", 'https://accounts.google.com'],
        'connect-src': ["'self'", 'https://accounts.google.com'],
        'style-src': ["'self'", "'unsafe-inline'", 'https://accounts.google.com', 'https://fonts.googleapis.com'],
        'font-src': ["'self'", 'https://fonts.gstatic.com', 'data:'],
        'img-src': ["'self'", 'data:', 'https:'],
      },
    },
    crossOriginOpenerPolicy: { policy: 'same-origin-allow-popups' },
  }));
  if (!opts.worker) app.use(compression());
  if (opts.perRequest) app.use('/api', opts.perRequest);
  app.use(express.json({ limit: '2mb' }));
  app.use((req, _res, next) => { if (req.body === undefined) req.body = {}; next(); }); // Express 5 leaves it undefined
  app.use(cookieParser());
  app.use('/api', loadUser, csrfGuard);

  app.get('/api/health', async (_req, res) => {
    await query('SELECT 1');
    res.json({ ok: true });
  });
  app.use('/api/auth', authRoutes);
  app.use('/api/explorer', requireAuth, explorerRoutes);
  app.use('/api/manage/projects', requireAuth, projectRoutes);
  app.use('/api/admin', requireAuth, adminRoutes);
  app.use('/api/import', requireAuth, importRoutes);

  // Reference data for forms (any signed-in editor)
  app.get('/api/reference', requireAuth, async (req, res, next) => {
    try {
      const meta = await getMeta();
      res.json({
        version: meta.version,
        cities: meta.cities, locations: meta.locations, sub_locations: meta.subLocations,
        developers: meta.developers, configuration_types: meta.configTypes, amenities: meta.amenities,
        master_lists: meta.masterLists, master_values: meta.masterValues,
        fields: meta.fields, band_sets: meta.bandSets, bands: meta.bands, filters: meta.filters,
        settings: Object.fromEntries(Object.entries(meta.settings).filter(([k]) => ['psf_display_rule', 'stale_after_days', 'map', 'matching', 'sales_visible_statuses'].includes(k))),
      });
    } catch (e) { next(e); }
  });

  app.use('/api', (_req, res) => res.status(404).json({ error: 'Not found' }));

  // Serve the built frontend (single deployable unit)
  if (!opts.worker && fs.existsSync(config.staticDir)) {
    app.use(express.static(config.staticDir, { index: false, maxAge: '1h' }));
    app.get(/^(?!\/api\/).*/, (_req, res) => res.sendFile(path.join(config.staticDir, 'index.html')));
  }

  // Errors → JSON
  // eslint-disable-next-line no-unused-vars
  app.use((err, req, res, _next) => {
    let status = err.status || 500;
    let message = err.message || 'Something went wrong';
    if (err.code === '23505') { status = 409; message = 'A record with the same value already exists'; }
    else if (err.code === '23514') { status = 400; message = `Value not allowed (${err.constraint})`; }
    else if (err.code === '23503') { status = 400; message = 'A referenced record does not exist'; }
    else if (err.code === '22P02') { status = 400; message = 'Invalid value'; }
    else if (err.code === '23502') { status = 400; message = `${String(err.column || 'A field').replace(/_/g, ' ')} is required`; }
    if (status >= 500) { console.error(err); if (config.env === 'production') message = 'Something went wrong'; }
    res.status(status).json({ error: message, ...(err.details ? { details: err.details } : {}) });
  });
  return app;
}
