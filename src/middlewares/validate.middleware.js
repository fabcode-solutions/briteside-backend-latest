import httpStatus from 'http-status';

export function validateMiddleware(schema) {
  return async function validate(req, res, next) {
    try {
      const data = await schema.parseAsync({
        body: req.body,
        query: req.query,
        params: req.params,
      });
      req.body = data.body;
      // Express 5 re-parses req.query on every read, so the assignment below
      // doesn't stick — handlers that need the parsed/coerced values (defaults,
      // numbers, arrays) should read req.validatedQuery instead.
      req.validatedQuery = data.query;
      Object.assign(req.query, data.query);
      Object.assign(req.params, data.params);
      return next();
    } catch (error) {
      console.log('Incoming Params:', req.params);
      console.error('Validation error:', error);
      console.log('Validation successful:', req.path);
      return res.status(httpStatus.BAD_REQUEST).json(error);
    }
  };
}
