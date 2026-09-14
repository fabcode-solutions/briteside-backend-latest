import csurf from 'csurf';

const isProd = process.env.NODE_ENV === 'production';

const csrfProtection = csurf({
  cookie: {
    httpOnly: true,
    secure: isProd,
    sameSite: isProd ? 'none' : 'lax',
    // domain: isProd ? '.thefabcode.com' : undefined,
  },
});

export { csrfProtection };
