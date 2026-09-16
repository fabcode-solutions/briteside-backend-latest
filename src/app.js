import express from 'express';
import helmet from 'helmet';
import bodyParser from 'body-parser';
import compression from 'compression';
import cors from 'cors';
import passport from 'passport';
import swaggerUi from 'swagger-ui-express';

import routes from './routes/index.js';
import webhookRoute from './routes/webhook.route.js';
// import { cleanupExpiredStatusPosts } from './cron/statusPostCleanup.js';
import generateSwaggerDef from '../docs/swagger-def.js';
import * as errorMiddleware from './middlewares/error.middleware.js';
import { morganMiddleware } from './middlewares/morgan.middleware.js';
import { jwtStrategy, googleStrategy, facebookStrategy } from './config/passport.js';
import cookieParser from 'cookie-parser';
import { defaultLimiter } from './middlewares/rateLimiter.js';

const app = express();

// trust proxy if running behind one (ensures rate limiter and ip detection work correctly)
app.set('trust proxy', 1);

// enable cors
app.use(cookieParser());
const allowedOrigins = [
  'http://localhost:3000',
  'http://localhost:3330',
  'https://appleid.apple.com',
  'https://briteside-staging.vercel.app',
  'http://127.0.0.1:3000',
  'https://gokiro-web-app.vercel.app',
  'https://gokiro-web-m3sdoosdy-ravins-projects-1f768d89.vercel.app',
  'https://gokiro-web-app-git-feature-groups-ravins-projects-1f768d89.vercel.app',
  'https://api-briteside.thefabcode.com',
  'https://www.briteside.app',
  process.env.FRONTEND_URL,
];

app.use(
  cors({
    origin: (origin, callback) => {
      // allow non-browser tools (Postman, curl)
      if (!origin) return callback(null, true);

      if (allowedOrigins.includes(origin)) {
        return callback(null, true);
      }

      return callback(new Error('CORS not allowed'));
    },
    credentials: true,
    methods: ['GET', 'POST', 'PUT', 'PATCH', 'DELETE', 'OPTIONS'],
    allowedHeaders: [
      'Content-Type',
      'Authorization',
      'X-CSRF-Token',
      'ngrok-skip-browser-warning',
      'X-Client-Platform',
    ],
  })
);

// secure apps by setting various HTTP headers
app.use(
  helmet({
    crossOriginOpenerPolicy: false,
    crossOriginEmbedderPolicy: false,
  })
);

// request logging.
app.use(morganMiddleware);

// set security HTTP headers
app.use(helmet());

// Stripe webhooks must receive the raw body, so mount the webhook route with raw parser
app.use('/api/webhooks', express.raw({ type: 'application/json' }), webhookRoute);

// parse body params and attache them to req.body
app.use(bodyParser.json());
app.use(bodyParser.urlencoded({ extended: true }));

// compress all responses
app.use(compression());

// serve static files (uploads)
app.use('/uploads', express.static('uploads'));

// jwt authentication
app.use(passport.initialize());
passport.use('jwt', jwtStrategy);
passport.use('google', googleStrategy);
passport.use('facebook', facebookStrategy);
// passport.use('apple', appleStrategy);
// Root route - API information
app.get('/', async (req, res) => {
  try {
    const packageData = JSON.parse(
      await import('fs').then(fs => fs.readFileSync('./package.json', 'utf8'))
    );
    const spec = await getSwaggerSpec();
    const totalEndpoints = Object.keys(spec.paths).length;

    res.json({
      success: true,
      message: 'Welcome to GoKyro Event Management API',
      data: {
        project: {
          name: packageData.name,
          version: packageData.version,
          description:
            'Comprehensive API for GoKyro event management platform with social features',
        },
        api: {
          status: 'operational',
          version: 'v1',
          totalEndpoints,
          baseUrl: '/api',
          documentation: {
            swagger: '/api-docs',
            json: '/api-docs.json',
            refresh: '/api-docs/refresh',
          },
        },
        features: [
          'User Authentication & Authorization',
          'Event Management & Ticketing',
          'Social Media Features',
          'Group Management',
          'Venue & Category Management',
          'File Upload & Media Handling',
          'Analytics & Reporting',
          'Review & Rating System',
          'Real-time Event Chat',
          'Organizer Profiles',
          'Ticket Scanning',
        ],
        endpoints: {
          authentication: '/api/auth',
          users: '/api/users',
          events: '/api/events',
          social: '/api/social',
          groups: '/api/groups',
          tickets: '/api/tickets',
          venues: '/api/venues',
          categories: '/api/categories',
          organizers: '/api/organizers',
          upload: '/api/upload',
          reviews: '/api/reviews',
          analytics: '/api/analytics',
        },
        support: {
          documentation: '/api-docs',
          contact: 'support@gokyro.com',
        },
      },
    });
  } catch (error) {
    res.json({
      success: true,
      message: 'Welcome to GoKyro Event Management API',
      data: {
        project: {
          name: 'gokyro-api',
          version: '1.0.0',
          description: 'Comprehensive API for GoKyro event management platform',
        },
        documentation: '/api-docs',
        baseUrl: '/api',
      },
    });
  }
});

// DEV TEST — manually trigger status post cleanup cron
// app.get('/test/run-status-cleanup', async (req, res) => {
//   await cleanupExpiredStatusPosts();
//   res.json({ ok: true });
// });

// api routes
app.use('/api', defaultLimiter, routes);

// api-docs - Dynamic Swagger generation
let swaggerSpec = null;

const getSwaggerSpec = async () => {
  if (!swaggerSpec) {
    swaggerSpec = await generateSwaggerDef();
  }
  return swaggerSpec;
};

app.use('/api-docs', swaggerUi.serve);
app.get('/api-docs', async (req, res, next) => {
  try {
    const spec = await getSwaggerSpec();
    const swaggerUiHandler = swaggerUi.setup(spec, {
      explorer: true,
      customCss: '.swagger-ui .topbar { display: none }',
      customSiteTitle: 'GoKyro API Documentation',
      swaggerOptions: {
        persistAuthorization: true,
        displayRequestDuration: true,
        filter: true,
        showExtensions: true,
        showCommonExtensions: true,
      },
    });
    swaggerUiHandler(req, res, next);
  } catch (error) {
    console.error('Error generating Swagger documentation:', error);
    res.status(500).json({ error: 'Failed to generate API documentation' });
  }
});

// Endpoint to refresh swagger documentation
app.get('/api-docs/refresh', async (req, res) => {
  try {
    swaggerSpec = null; // Clear cache
    const spec = await getSwaggerSpec();
    res.json({
      message: 'Swagger documentation refreshed successfully',
      paths: Object.keys(spec.paths).length,
    });
  } catch (error) {
    console.error('Error refreshing Swagger documentation:', error);
    res.status(500).json({ error: 'Failed to refresh API documentation' });
  }
});

// JSON endpoint for swagger spec
app.get('/api-docs.json', async (req, res) => {
  try {
    const spec = await getSwaggerSpec();
    res.json(spec);
  } catch (error) {
    console.error('Error generating Swagger JSON:', error);
    res.status(500).json({ error: 'Failed to generate API documentation JSON' });
  }
});

// if error is not an instanceOf APIError, convert it.
app.use(errorMiddleware.converter);

// catch 404 and forward
app.use(errorMiddleware.notFound);

// error handler, send stacktrace only during development/local env
app.use(errorMiddleware.handler);

export default app;
